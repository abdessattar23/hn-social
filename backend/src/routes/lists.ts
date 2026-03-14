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
  const bypassLimit = c.req.query("bypass_limit") === "true";
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

  if (candidateContacts.length === 0) {
    return c.json({ imported: 0, lists: [] });
  }

  let dailySendLimit: number | null = null;
  if (!bypassLimit) {
    const { data: org } = await db
      .from("organizations")
      .select("daily_send_limit")
      .eq("id", user.orgId)
      .single();
    dailySendLimit = org?.daily_send_limit ?? null;
  }

  const existingCount = (manifest.contacts || []).length;
  const effectiveLimit = dailySendLimit
    ? Math.max(0, dailySendLimit - existingCount)
    : null;

  const shouldSplit =
    effectiveLimit !== null && candidateContacts.length > effectiveLimit;

  if (!shouldSplit) {
    if (candidateContacts.length) {
      const { error } = await db.from("contacts").insert(candidateContacts);
      if (error) throw new BadRequestError(error.message);
    }
    return c.json({ imported: candidateContacts.length, lists: [] });
  }

  const chunks: NormalizedContactPayload[][] = [];
  const firstChunkSize = effectiveLimit;
  if (firstChunkSize > 0) {
    chunks.push(candidateContacts.slice(0, firstChunkSize));
  }
  const remaining = candidateContacts.slice(firstChunkSize);
  for (let i = 0; i < remaining.length; i += dailySendLimit!) {
    chunks.push(remaining.slice(i, i + dailySendLimit!));
  }

  const createdLists: Array<{ id: number; name: string; count: number }> = [];

  if (chunks[0] && chunks[0].length > 0) {
    const { error } = await db.from("contacts").insert(chunks[0]);
    if (error) throw new BadRequestError(error.message);
    createdLists.push({
      id: manifest.id,
      name: manifest.name,
      count: chunks[0].length,
    });
  }

  for (let i = 1; i < chunks.length; i++) {
    const partName = `${manifest.name} (Part ${i + (firstChunkSize > 0 ? 1 : 0)})`;
    const { data: newList, error: listErr } = await db
      .from("contact_lists")
      .insert({
        name: partName,
        type: manifest.type,
        org_id: user.orgId,
        user_id: user.id,
        tags: manifest.tags || [],
      })
      .select()
      .single();
    if (listErr) throw new BadRequestError(listErr.message);

    const contactsForList = chunks[i].map((contact) => ({
      ...contact,
      list_id: newList.id,
    }));
    const { error: insErr } = await db
      .from("contacts")
      .insert(contactsForList);
    if (insErr) throw new BadRequestError(insErr.message);

    createdLists.push({
      id: newList.id,
      name: partName,
      count: contactsForList.length,
    });
  }

  return c.json({
    imported: candidateContacts.length,
    split: true,
    dailySendLimit,
    lists: createdLists,
  });
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

  const existingIdentifiers = new Set(
    (manifest.contacts || []).map((c: any) => c.identifier),
  );

  // ── Normalization helpers ──
  const stripEmoji = (s: string) =>
    s.replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu,
      "",
    );
  const normalize = (s: string) =>
    stripEmoji(s)
      .toLowerCase()
      .replace(/[''`´]/g, "'")
      .replace(/[|·—–\-_/\\]/g, " ")
      .replace(/[^\w\s'@&.+]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b[i - 1] === a[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }
    return matrix[b.length][a.length];
  };

  // ── Build chat lookup structures ──
  type ChatEntry = { chat: Record<string, unknown>; lower: string; normalized: string };
  const chatEntries: ChatEntry[] = [];
  const chatsByExact = new Map<string, Record<string, unknown>>();

  for (const chat of orgFilteredChats) {
    const rawName = ((chat.name as string) || "").trim();
    if (!rawName) continue;
    const lower = rawName.toLowerCase();
    const norm = normalize(rawName);
    chatEntries.push({ chat, lower, normalized: norm });
    if (!chatsByExact.has(lower)) chatsByExact.set(lower, chat);
  }

  // ── Multi-strategy matcher ──
  type MatchStrategy = "exact" | "normalized" | "contains" | "words" | "levenshtein";

  // Only consider words with 3+ chars to avoid common short words like "AI", "x", "at"
  const extractWords = (s: string) =>
    s.split(/\s+/).filter((w) => w.length >= 3);

  const wordOverlapScore = (a: string[], b: string[]): number => {
    if (a.length === 0 || b.length === 0) return 0;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    const longerSet = new Set(longer);
    const matched = shorter.filter((w) => longerSet.has(w)).length;
    return matched / shorter.length;
  };

  const findBestMatch = (
    csvName: string,
  ): { chat: Record<string, unknown>; strategy: MatchStrategy } | null => {
    const csvLower = csvName.toLowerCase();
    const csvNorm = normalize(csvName);

    // Strategy 1: Exact lowercase match
    const exact = chatsByExact.get(csvLower);
    if (exact) return { chat: exact, strategy: "exact" };

    // Strategy 2: Normalized match (strip emoji, special chars, collapse whitespace)
    for (const entry of chatEntries) {
      if (entry.normalized === csvNorm && csvNorm.length > 0) {
        return { chat: entry.chat, strategy: "normalized" };
      }
    }

    // Strategy 3: Substring containment (either direction, min 8 chars, length ratio within 2x)
    if (csvNorm.length >= 8) {
      for (const entry of chatEntries) {
        if (entry.normalized.length < 8) continue;
        const ratio = Math.max(csvNorm.length, entry.normalized.length) /
          Math.min(csvNorm.length, entry.normalized.length);
        if (ratio > 2) continue;
        if (entry.normalized.includes(csvNorm) || csvNorm.includes(entry.normalized)) {
          return { chat: entry.chat, strategy: "contains" };
        }
      }
    }

    // Strategy 4: Word overlap (≥80% of words from shorter string found in longer, min 3 words)
    const csvWords = extractWords(csvNorm);
    if (csvWords.length >= 3) {
      let bestScore = 0;
      let bestChat: Record<string, unknown> | null = null;
      for (const entry of chatEntries) {
        const entryWords = extractWords(entry.normalized);
        if (entryWords.length < 3) continue;
        const score = wordOverlapScore(csvWords, entryWords);
        if (score >= 0.8 && score > bestScore) {
          bestScore = score;
          bestChat = entry.chat;
        }
      }
      if (bestChat) return { chat: bestChat, strategy: "words" };
    }

    // Strategy 5: Levenshtein distance (max 25% of longer string, min 8 chars)
    if (csvNorm.length >= 8) {
      let bestDist = Infinity;
      let bestChat: Record<string, unknown> | null = null;
      for (const entry of chatEntries) {
        if (entry.normalized.length < 8) continue;
        const maxLen = Math.max(csvNorm.length, entry.normalized.length);
        const threshold = Math.floor(maxLen * 0.25);
        const dist = levenshtein(csvNorm, entry.normalized);
        if (dist <= threshold && dist < bestDist) {
          bestDist = dist;
          bestChat = entry.chat;
        }
      }
      if (bestChat) return { chat: bestChat, strategy: "levenshtein" };
    }

    return null;
  };

  // ── Match each CSV row ──
  type GroupSyncDetail = {
    csvName: string;
    status: "synced" | "already_exists" | "not_found";
    matchedChatName?: string;
    chatId?: string;
    matchStrategy?: MatchStrategy;
  };

  const details: GroupSyncDetail[] = [];
  const contactsToInsert: NormalizedContactPayload[] = [];
  const usedChatIds = new Set<string>();

  for (const csvName of groupNames) {
    const match = findBestMatch(csvName);

    if (!match) {
      details.push({ csvName, status: "not_found" });
    } else {
      const chatId = match.chat.id as string;
      const chatName = (match.chat.name as string) || "";

      if (existingIdentifiers.has(chatId)) {
        details.push({
          csvName,
          status: "already_exists",
          matchedChatName: chatName,
          chatId,
          matchStrategy: match.strategy,
        });
      } else if (usedChatIds.has(chatId)) {
        // Duplicate CSV row pointing at same chat — treat as already_exists
        details.push({
          csvName,
          status: "already_exists",
          matchedChatName: chatName,
          chatId,
          matchStrategy: match.strategy,
        });
      } else {
        contactsToInsert.push({
          name: chatName,
          identifier: chatId,
          list_id: id,
        });
        existingIdentifiers.add(chatId);
        usedChatIds.add(chatId);
        details.push({
          csvName,
          status: "synced",
          matchedChatName: chatName,
          chatId,
          matchStrategy: match.strategy,
        });
      }
    }
  }

  if (contactsToInsert.length) {
    const { error: insErr } = await db
      .from("contacts")
      .insert(contactsToInsert);
    if (insErr) throw new BadRequestError(insErr.message);
  }

  return c.json({
    imported: contactsToInsert.length,
    alreadyExisted: details.filter((d) => d.status === "already_exists").length,
    notFound: details.filter((d) => d.status === "not_found").length,
    total: groupNames.length,
    details,
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
