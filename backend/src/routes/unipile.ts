import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { connectAccountSchema } from "../lib/validation";
import { NotFoundError, BadRequestError } from "../lib/errors";
import * as unipileSvc from "../services/unipile";

const unipileRouter = new Hono();
unipileRouter.use("*", authMiddleware);

unipileRouter.get("/accounts", async (c) => {
  const user = c.get("user");

  let unipileItems: Record<string, unknown>[] = [];
  try {
    const allAccounts = await unipileSvc.listAllUnipileAccounts();
    unipileItems = ((allAccounts as any).items || []) as Record<string, unknown>[];
  } catch {
    // If Unipile is unreachable, return what we have in DB
    const { data } = await db
      .from("connected_accounts")
      .select("*")
      .eq("org_id", user.orgId);
    return c.json(data || []);
  }

  // Auto-sync: register any Unipile accounts not yet in our DB
  const { data: orgAccounts } = await db
    .from("connected_accounts")
    .select("unipile_account_id")
    .eq("org_id", user.orgId);

  const knownIds = new Set((orgAccounts || []).map((a: any) => a.unipile_account_id));
  const newAccounts = unipileItems.filter((a) => !knownIds.has(a.id as string));

  if (newAccounts.length) {
    await db.from("connected_accounts").insert(
      newAccounts.map((a) => ({
        org_id: user.orgId,
        unipile_account_id: a.id as string,
        provider: ((a.type as string) || "UNKNOWN").toUpperCase(),
        display_name: (a.name as string) || null,
      }))
    );
  }

  return c.json(unipileItems);
});

unipileRouter.post("/connect", zValidator("json", connectAccountSchema), async (c) => {
  const user = c.get("user");
  const { type } = c.req.valid("json");

  const { data: existing } = await db
    .from("connected_accounts")
    .select("id")
    .eq("org_id", user.orgId);

  if ((existing || []).length >= 6) {
    throw new BadRequestError("Account limit reached. Maximum 6 accounts per organization.");
  }

  const result = await unipileSvc.getHostedAuthLink(type);
  return c.json(result);
});

unipileRouter.post("/register-account", async (c) => {
  const user = c.get("user");
  const { unipileAccountId, provider, displayName } = await c.req.json<{
    unipileAccountId: string;
    provider: string;
    displayName?: string;
  }>();

  if (!unipileAccountId || !provider) {
    throw new BadRequestError("unipileAccountId and provider are required");
  }

  const { data: existing } = await db
    .from("connected_accounts")
    .select("*")
    .eq("unipile_account_id", unipileAccountId)
    .maybeSingle();

  if (existing) {
    if (existing.org_id !== user.orgId) {
      throw new BadRequestError("Account already linked to another organization");
    }
    return c.json(existing);
  }

  const { data: account } = await db
    .from("connected_accounts")
    .insert({
      org_id: user.orgId,
      unipile_account_id: unipileAccountId,
      provider: provider.toUpperCase(),
      display_name: displayName || null,
    })
    .select()
    .single();

  return c.json(account, 201);
});

unipileRouter.delete("/accounts/:id", async (c) => {
  const user = c.get("user");
  const unipileAccountId = c.req.param("id");

  const { data: acct } = await db
    .from("connected_accounts")
    .select("*")
    .eq("unipile_account_id", unipileAccountId)
    .eq("org_id", user.orgId)
    .maybeSingle();

  if (!acct) throw new NotFoundError("Account not found in your organization");

  try {
    await unipileSvc.deleteUnipileAccount(unipileAccountId);
  } catch {
    // account may already be deleted on Unipile's side
  }

  await db.from("connected_accounts").delete().eq("id", acct.id);
  return c.json({ deleted: true });
});

unipileRouter.get("/whatsapp/chats", async (c) => {
  const user = c.get("user");
  const { data: orgAccounts } = await db
    .from("connected_accounts")
    .select("unipile_account_id")
    .eq("org_id", user.orgId);

  const orgAccountIds = new Set((orgAccounts || []).map((a: any) => a.unipile_account_id));
  const allChats = await unipileSvc.listAllChats("WHATSAPP");
  const filtered = ((allChats.items || []) as Record<string, unknown>[]).filter(
    (chat) => orgAccountIds.has(chat.account_id as string)
  );
  return c.json({ items: filtered });
});

unipileRouter.get("/linkedin/chats", async (c) => {
  const user = c.get("user");
  const { data: orgAccounts } = await db
    .from("connected_accounts")
    .select("unipile_account_id")
    .eq("org_id", user.orgId);

  const orgAccountIds = new Set((orgAccounts || []).map((a: any) => a.unipile_account_id));
  const allChats = await unipileSvc.listAllChats("LINKEDIN");
  const filtered = ((allChats.items || []) as Record<string, unknown>[]).filter(
    (chat) => orgAccountIds.has(chat.account_id as string)
  );
  return c.json({ items: filtered });
});

export default unipileRouter;
