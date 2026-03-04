import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import {
  createListSchema,
  addContactSchema,
  addChatsSchema,
  updateTagsSchema,
} from "../lib/validation";
import { NotFoundError, BadRequestError } from "../lib/errors";
import * as Papa from "papaparse";
import * as unipile from "../services/unipile";
import { AsyncResult } from "../core/monad";

interface AudienceManifestProjection {
  id: number;
  name: string;
  type: string;
  org_id: number;
  tags: string[];
  contacts: any[];
  [key: string]: any;
}

interface NormalizedContactPayload {
  name: string;
  identifier: string;
  list_id: number;
}

const CSV_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

type ColumnDetectionStrategy = (
  row: Record<string, string>,
) => { name: string; identifier: string };

const constructDefaultColumnDetector =
  (): ColumnDetectionStrategy => (row) => {
    const name =
      row.name ||
      row.Name ||
      row.display_name ||
      row["Display Name"] ||
      "";
    const identifier =
      row.email ||
      row.Email ||
      row["Email Address"] ||
      row["email address"] ||
      row.phone ||
      row.Phone ||
      row["Phone Number"] ||
      row["phone number"] ||
      row.identifier ||
      row.chat_id ||
      "";
    return { name, identifier };
  };

const constructWhatsAppGroupDetector =
  (): ((row: Record<string, string>) => string) =>
  (row) => {
    const value =
      row.name ||
      row.Name ||
      row.group ||
      row.Group ||
      row["Group Name"] ||
      row["group name"] ||
      row["Group name"] ||
      Object.values(row)[0] ||
      "";
    return value.trim();
  };

const materializeAudienceManifest = (
  id: number,
  orgId: number,
): AsyncResult<AudienceManifestProjection> =>
  AsyncResult.from(async () => {
    const { data: list, error } = await db
      .from("contact_lists")
      .select("*, contacts(*)")
      .eq("id", id)
      .eq("org_id", orgId)
      .single();
    if (error || !list) throw new NotFoundError("List not found");
    return list as AudienceManifestProjection;
  }, "audience.materialize");

const deduplicateContacts = (
  existingIdentifiers: Set<string>,
  newContacts: NormalizedContactPayload[],
): NormalizedContactPayload[] =>
  newContacts.filter((contact) => {
    const normalized = contact.identifier.toLowerCase();
    if (existingIdentifiers.has(normalized)) return false;
    existingIdentifiers.add(normalized);
    return true;
  });

const lists = new Hono();
lists.use("*", authMiddleware);

lists.get("/", async (c) => {
  const user = c.get("user");
  const { data: rows, error } = await db
    .from("contact_lists")
    .select("*, contacts(id)")
    .eq("org_id", user.orgId)
    .order("created_at", { ascending: false });
  if (error) throw new BadRequestError(error.message);

  return c.json(
    (rows || []).map((l: any) => ({
      ...l,
      contactCount: l.contacts?.length || 0,
      contacts: undefined,
    })),
  );
});

lists.get("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const manifest = await materializeAudienceManifest(
    id,
    user.orgId,
  ).resolve();
  return c.json(manifest);
});

lists.post("/", zValidator("json", createListSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  const { data: list, error } = await db
    .from("contact_lists")
    .insert({
      name: data.name,
      type: data.type,
      org_id: user.orgId,
      user_id: user.id,
      tags: data.tags || [],
    })
    .select()
    .single();
  if (error) throw new BadRequestError(error.message);
  return c.json(list, 201);
});

lists.patch(
  "/:id/tags",
  zValidator("json", updateTagsSchema),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const { tags } = c.req.valid("json");
    await materializeAudienceManifest(id, user.orgId).resolve();
    const { error } = await db
      .from("contact_lists")
      .update({ tags })
      .eq("id", id);
    if (error) throw new BadRequestError(error.message);
    return c.json({ id, tags });
  },
);

lists.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await materializeAudienceManifest(id, user.orgId).resolve();
  const { error: clErr } = await db
    .from("campaign_lists")
    .delete()
    .eq("contact_list_id", id);
  if (clErr) throw new BadRequestError(clErr.message);
  const { error: dlErr } = await db
    .from("contact_lists")
    .delete()
    .eq("id", id);
  if (dlErr) throw new BadRequestError(dlErr.message);
  return c.json({ deleted: true });
});

lists.post(
  "/:id/contacts",
  zValidator("json", addContactSchema),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const data = c.req.valid("json");
    await materializeAudienceManifest(id, user.orgId).resolve();
    const { data: contact, error } = await db
      .from("contacts")
      .insert({
        name: data.name,
        identifier: data.identifier,
        list_id: id,
      })
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);
    return c.json(contact, 201);
  },
);

lists.delete("/:id/contacts/:contactId", async (c) => {
  const user = c.get("user");
  const listId = Number(c.req.param("id"));
  const contactId = Number(c.req.param("contactId"));
  await materializeAudienceManifest(listId, user.orgId).resolve();
  const { error } = await db
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .eq("list_id", listId);
  if (error) throw new BadRequestError(error.message);
  return c.json({ deleted: true });
});

lists.post("/:id/import-csv", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const manifest = await materializeAudienceManifest(
    id,
    user.orgId,
  ).resolve();

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File))
    throw new BadRequestError("File is required");
  if (file.size > CSV_MAX_PAYLOAD_BYTES)
    throw new BadRequestError("CSV too large (max 5MB)");

  const csv = await file.text();
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const columnDetector = constructDefaultColumnDetector();

  const existingIdentifiers = new Set(
    (manifest.contacts || []).map((c: any) =>
      c.identifier.toLowerCase(),
    ),
  );

  const candidateContacts: NormalizedContactPayload[] = [];

  for (const row of parsed.data as Record<string, string>[]) {
    const { name, identifier } = columnDetector(row);
    if (identifier && !existingIdentifiers.has(identifier.toLowerCase())) {
      candidateContacts.push({ name, identifier, list_id: id });
      existingIdentifiers.add(identifier.toLowerCase());
    }
  }

  if (candidateContacts.length) {
    const { error } = await db.from("contacts").insert(candidateContacts);
    if (error) throw new BadRequestError(error.message);
  }

  return c.json({ imported: candidateContacts.length });
});

lists.post("/:id/import-whatsapp-csv", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const manifest = await materializeAudienceManifest(
    id,
    user.orgId,
  ).resolve();
  if (manifest.type !== "WHATSAPP")
    throw new BadRequestError("List must be WHATSAPP type");

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File))
    throw new BadRequestError("File is required");

  const csv = await file.text();
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const groupDetector = constructWhatsAppGroupDetector();

  const groupNames = (parsed.data as Record<string, string>[])
    .map(groupDetector)
    .filter(Boolean);

  const { data: orgAccounts, error: oaErr } = await db
    .from("connected_accounts")
    .select("unipile_account_id")
    .eq("org_id", user.orgId);
  if (oaErr) throw new BadRequestError(oaErr.message);

  const orgAccountIds = new Set(
    (orgAccounts || []).map((a: any) => a.unipile_account_id),
  );

  const chatsResponse = await unipile.listAllChats("WHATSAPP");
  const orgFilteredChats = (
    (chatsResponse.items || []) as Record<string, unknown>[]
  ).filter((chat) =>
    orgAccountIds.has(chat.account_id as string),
  );

  const groupNamesLower = groupNames.map((n) => n.toLowerCase());
  const existingIdentifiers = new Set(
    (manifest.contacts || []).map((c: any) => c.identifier),
  );

  const matchedContacts: NormalizedContactPayload[] = [];

  for (const chat of orgFilteredChats) {
    const chatName = ((chat.name as string) || "").trim().toLowerCase();
    if (
      chatName &&
      groupNamesLower.includes(chatName) &&
      !existingIdentifiers.has(chat.id as string)
    ) {
      matchedContacts.push({
        name: (chat.name as string) || "",
        identifier: chat.id as string,
        list_id: id,
      });
    }
  }

  if (matchedContacts.length) {
    const { error: insErr } = await db
      .from("contacts")
      .insert(matchedContacts);
    if (insErr) throw new BadRequestError(insErr.message);
  }

  return c.json({
    imported: matchedContacts.length,
    total: groupNames.length,
  });
});

lists.post(
  "/:id/whatsapp-chats",
  zValidator("json", addChatsSchema),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    await materializeAudienceManifest(id, user.orgId).resolve();
    const { chats } = c.req.valid("json");
    const values = chats.map((chat) => ({
      name: chat.name || "",
      identifier: chat.id,
      list_id: id,
    }));
    if (values.length) {
      const { error } = await db.from("contacts").insert(values);
      if (error) throw new BadRequestError(error.message);
    }
    return c.json({ added: values.length });
  },
);

lists.post(
  "/:id/linkedin-chats",
  zValidator("json", addChatsSchema),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    await materializeAudienceManifest(id, user.orgId).resolve();
    const { chats } = c.req.valid("json");
    const values = chats.map((chat) => ({
      name: chat.name || "",
      identifier: chat.id,
      list_id: id,
    }));
    if (values.length) {
      const { error } = await db.from("contacts").insert(values);
      if (error) throw new BadRequestError(error.message);
    }
    return c.json({ added: values.length });
  },
);

export default lists;
