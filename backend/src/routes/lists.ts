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

const lists = new Hono();
lists.use("*", authMiddleware);

async function getList(id: number, orgId: number) {
  const { data: list } = await db
    .from("contact_lists")
    .select("*, contacts(*)")
    .eq("id", id)
    .eq("org_id", orgId)
    .single();
  if (!list) throw new NotFoundError("List not found");
  return list;
}

lists.get("/", async (c) => {
  const user = c.get("user");
  const { data: rows } = await db
    .from("contact_lists")
    .select("*, contacts(id)")
    .eq("org_id", user.orgId)
    .order("created_at", { ascending: false });

  return c.json(
    (rows || []).map((l: any) => ({
      ...l,
      contactCount: l.contacts?.length || 0,
      contacts: undefined,
    }))
  );
});

lists.get("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  return c.json(await getList(id, user.orgId));
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

lists.patch("/:id/tags", zValidator("json", updateTagsSchema), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const { tags } = c.req.valid("json");
  await getList(id, user.orgId);
  await db.from("contact_lists").update({ tags }).eq("id", id);
  return c.json({ id, tags });
});

lists.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await getList(id, user.orgId);
  await db.from("campaign_lists").delete().eq("contact_list_id", id);
  await db.from("contact_lists").delete().eq("id", id);
  return c.json({ deleted: true });
});

lists.post("/:id/contacts", zValidator("json", addContactSchema), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const data = c.req.valid("json");
  await getList(id, user.orgId);
  const { data: contact } = await db
    .from("contacts")
    .insert({ name: data.name, identifier: data.identifier, list_id: id })
    .select()
    .single();
  return c.json(contact, 201);
});

lists.delete("/:id/contacts/:contactId", async (c) => {
  const user = c.get("user");
  const listId = Number(c.req.param("id"));
  const contactId = Number(c.req.param("contactId"));
  await getList(listId, user.orgId);
  await db.from("contacts").delete().eq("id", contactId).eq("list_id", listId);
  return c.json({ deleted: true });
});

lists.post("/:id/import-csv", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const list = await getList(id, user.orgId);

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new BadRequestError("File is required");
  if (file.size > 5 * 1024 * 1024) throw new BadRequestError("CSV too large (max 5MB)");

  const csv = await file.text();
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });

  const existing = new Set(
    (list.contacts || []).map((c: any) => c.identifier.toLowerCase())
  );
  const newContacts: { name: string; identifier: string; list_id: number }[] = [];

  for (const row of parsed.data as Record<string, string>[]) {
    const name =
      row.name || row.Name || row.display_name || row["Display Name"] || "";
    const identifier =
      row.email || row.Email || row["Email Address"] || row["email address"] ||
      row.phone || row.Phone || row["Phone Number"] || row["phone number"] ||
      row.identifier || row.chat_id || "";
    if (identifier && !existing.has(identifier.toLowerCase())) {
      newContacts.push({ name, identifier, list_id: id });
      existing.add(identifier.toLowerCase());
    }
  }

  if (newContacts.length) {
    await db.from("contacts").insert(newContacts);
  }

  return c.json({ imported: newContacts.length });
});

lists.post("/:id/import-whatsapp-csv", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const list = await getList(id, user.orgId);
  if (list.type !== "WHATSAPP") throw new BadRequestError("List must be WHATSAPP type");

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new BadRequestError("File is required");

  const csv = await file.text();
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });

  const groupNames = (parsed.data as Record<string, string>[])
    .map((r) => {
      const val =
        r.name || r.Name || r.group || r.Group ||
        r["Group Name"] || r["group name"] || r["Group name"] ||
        Object.values(r)[0] || "";
      return val.trim();
    })
    .filter(Boolean);

  const { data: orgAccounts } = await db
    .from("connected_accounts")
    .select("unipile_account_id")
    .eq("org_id", user.orgId);
  const orgAccountIds = new Set((orgAccounts || []).map((a: any) => a.unipile_account_id));

  const chatsResponse = await unipile.listAllChats("WHATSAPP");
  const chats = ((chatsResponse.items || []) as Record<string, unknown>[]).filter(
    (chat) => orgAccountIds.has(chat.account_id as string)
  );

  const groupNamesLower = groupNames.map((n) => n.toLowerCase());
  const existing = new Set((list.contacts || []).map((c: any) => c.identifier));
  const matched: { name: string; identifier: string; list_id: number }[] = [];

  for (const chat of chats) {
    const chatName = ((chat.name as string) || "").trim().toLowerCase();
    if (chatName && groupNamesLower.includes(chatName) && !existing.has(chat.id as string)) {
      matched.push({ name: (chat.name as string) || "", identifier: chat.id as string, list_id: id });
    }
  }

  if (matched.length) {
    await db.from("contacts").insert(matched);
  }

  return c.json({ imported: matched.length, total: groupNames.length });
});

lists.post("/:id/whatsapp-chats", zValidator("json", addChatsSchema), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await getList(id, user.orgId);
  const { chats } = c.req.valid("json");
  const values = chats.map((chat) => ({
    name: chat.name || "",
    identifier: chat.id,
    list_id: id,
  }));
  if (values.length) {
    await db.from("contacts").insert(values);
  }
  return c.json({ added: values.length });
});

lists.post("/:id/linkedin-chats", zValidator("json", addChatsSchema), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await getList(id, user.orgId);
  const { chats } = c.req.valid("json");
  const values = chats.map((chat) => ({
    name: chat.name || "",
    identifier: chat.id,
    list_id: id,
  }));
  if (values.length) {
    await db.from("contacts").insert(values);
  }
  return c.json({ added: values.length });
});

export default lists;
