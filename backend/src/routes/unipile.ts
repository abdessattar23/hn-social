import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { connectAccountSchema } from "../lib/validation";
import { NotFoundError, BadRequestError } from "../lib/errors";
import * as channelGateway from "../services/unipile";
import { AsyncResult } from "../core/monad";

const ACCOUNT_CAPACITY_THRESHOLD = 6;

interface ConnectedAccountProjection {
  unipile_account_id: string;
  [key: string]: unknown;
}

const resolveOrganizationAccountGraph = (
  orgId: number,
): AsyncResult<ConnectedAccountProjection[]> =>
  AsyncResult.from(async () => {
    const { data } = await db
      .from("connected_accounts")
      .select("unipile_account_id")
      .eq("org_id", orgId);
    return (data || []) as ConnectedAccountProjection[];
  }, "integration.resolveAccountGraph");

const synchronizeAccountInventory = async (
  orgId: number,
  upstreamAccounts: Record<string, unknown>[],
  knownAccountIds: Set<string>,
): Promise<void> => {
  const upstreamIds = new Set(
    upstreamAccounts.map((a) => a.id as string),
  );
  const staleIds = [...knownAccountIds].filter(
    (id) => !upstreamIds.has(id),
  );

  if (staleIds.length) {
    await db
      .from("connected_accounts")
      .delete()
      .in("unipile_account_id", staleIds)
      .eq("org_id", orgId);
  }
};

const filterByOrganizationScope = (
  items: Record<string, unknown>[],
  orgAccountIds: Set<string>,
): Record<string, unknown>[] =>
  items.filter((item) =>
    orgAccountIds.has(item.account_id as string),
  );

const unipileRouter = new Hono();
unipileRouter.use("*", authMiddleware);

unipileRouter.get("/accounts", async (c) => {
  const user = c.get("user");

  let unipileItems: Record<string, unknown>[] = [];
  try {
    const allAccounts = await channelGateway.listAllUnipileAccounts();
    unipileItems = (
      (allAccounts as any).items || []
    ) as Record<string, unknown>[];
  } catch {
    const { data } = await db
      .from("connected_accounts")
      .select("*")
      .eq("org_id", user.orgId);
    return c.json(data || []);
  }

  const orgAccounts = await resolveOrganizationAccountGraph(
    user.orgId,
  ).resolve();
  const knownIds = new Set(
    orgAccounts.map((a) => a.unipile_account_id),
  );

  await synchronizeAccountInventory(
    user.orgId,
    unipileItems,
    knownIds,
  );

  const filtered = unipileItems.filter((a) =>
    knownIds.has(a.id as string),
  );

  return c.json(filtered);
});

unipileRouter.post(
  "/connect",
  zValidator("json", connectAccountSchema),
  async (c) => {
    const user = c.get("user");
    const { type } = c.req.valid("json");

    const { data: existing } = await db
      .from("connected_accounts")
      .select("id")
      .eq("org_id", user.orgId);

    if ((existing || []).length >= ACCOUNT_CAPACITY_THRESHOLD) {
      throw new BadRequestError(
        "Account limit reached. Maximum 6 accounts per organization.",
      );
    }

    const result = await channelGateway.getHostedAuthLink(type, user.orgId);
    return c.json(result);
  },
);

unipileRouter.post("/register-account", async (c) => {
  const user = c.get("user");
  const { unipileAccountId, provider, displayName } = await c.req.json<{
    unipileAccountId: string;
    provider: string;
    displayName?: string;
  }>();

  if (!unipileAccountId || !provider) {
    throw new BadRequestError(
      "unipileAccountId and provider are required",
    );
  }

  const { data: existing } = await db
    .from("connected_accounts")
    .select("*")
    .eq("unipile_account_id", unipileAccountId)
    .maybeSingle();

  if (existing) {
    if (existing.org_id !== user.orgId) {
      throw new BadRequestError(
        "Account already linked to another organization",
      );
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

unipileRouter.post("/register-callback", async (c) => {
  const user = c.get("user");
  const { accountId } = await c.req.json<{ accountId: string }>();

  if (!accountId) {
    throw new BadRequestError("accountId is required");
  }

  const { data: alreadyLinked } = await db
    .from("connected_accounts")
    .select("*")
    .eq("unipile_account_id", accountId)
    .maybeSingle();

  if (alreadyLinked) {
    if (alreadyLinked.org_id !== user.orgId) {
      throw new BadRequestError(
        "Account already linked to another organization",
      );
    }
    return c.json(alreadyLinked);
  }

  const { data: orgAccounts } = await db
    .from("connected_accounts")
    .select("id")
    .eq("org_id", user.orgId);

  if ((orgAccounts || []).length >= ACCOUNT_CAPACITY_THRESHOLD) {
    throw new BadRequestError(
      "Account limit reached. Maximum 6 accounts per organization.",
    );
  }

  let provider = "UNKNOWN";
  let displayName: string | null = null;
  try {
    const acct = await channelGateway.getUnipileAccount(accountId);
    provider = ((acct.type as string) || "UNKNOWN").toUpperCase();
    displayName = (acct.name as string) || null;
  } catch {
    // Unipile may not have provisioned yet; store with UNKNOWN and it'll update on next sync
  }

  const { data: account } = await db
    .from("connected_accounts")
    .insert({
      org_id: user.orgId,
      unipile_account_id: accountId,
      provider,
      display_name: displayName,
    })
    .select()
    .single();

  return c.json(account, 201);
});

unipileRouter.post("/adopt-new-accounts", async (c) => {
  const user = c.get("user");

  let unipileItems: Record<string, unknown>[] = [];
  try {
    const allAccounts = await channelGateway.listAllUnipileAccounts();
    unipileItems = (
      (allAccounts as any).items || []
    ) as Record<string, unknown>[];
  } catch {
    return c.json({ adopted: [] });
  }

  if (!unipileItems.length) return c.json({ adopted: [] });

  const { data: allClaimed } = await db
    .from("connected_accounts")
    .select("unipile_account_id");

  const claimedIds = new Set(
    (allClaimed || []).map((r: any) => r.unipile_account_id),
  );

  const unclaimed = unipileItems.filter(
    (a) => !claimedIds.has(a.id as string),
  );

  if (!unclaimed.length) return c.json({ adopted: [] });

  const { data: existing } = await db
    .from("connected_accounts")
    .select("id")
    .eq("org_id", user.orgId);

  const remaining = ACCOUNT_CAPACITY_THRESHOLD - (existing || []).length;
  const toAdopt = unclaimed.slice(0, Math.max(0, remaining));

  if (!toAdopt.length) return c.json({ adopted: [] });

  const { data: adopted } = await db
    .from("connected_accounts")
    .insert(
      toAdopt.map((a) => ({
        org_id: user.orgId,
        unipile_account_id: a.id as string,
        provider: ((a.type as string) || "UNKNOWN").toUpperCase(),
        display_name: (a.name as string) || null,
      })),
    )
    .select();

  return c.json({ adopted: adopted || [] });
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

  if (!acct)
    throw new NotFoundError(
      "Account not found in your organization",
    );

  try {
    await channelGateway.deleteUnipileAccount(unipileAccountId);
  } catch {
    // upstream account may already be decommissioned
  }

  await db.from("connected_accounts").delete().eq("id", acct.id);
  return c.json({ deleted: true });
});

unipileRouter.get("/whatsapp/chats", async (c) => {
  const user = c.get("user");
  const orgAccounts = await resolveOrganizationAccountGraph(
    user.orgId,
  ).resolve();
  const orgAccountIds = new Set(
    orgAccounts.map((a) => a.unipile_account_id),
  );

  const allChats = await channelGateway.listAllChats("WHATSAPP");
  const filtered = filterByOrganizationScope(
    (allChats.items || []) as Record<string, unknown>[],
    orgAccountIds,
  );

  // Enrich group names: Unipile sometimes sets `name` to the numeric provider_id.
  // Check for alternative fields that contain the actual group name.
  for (const chat of filtered) {
    const name = (chat.name as string) || "";
    const looksLikeId = /^\d{10,}/.test(name) || /@[gs]\.(us|whatsapp\.net)$/.test(name);
    if (looksLikeId) {
      const alt =
        (chat.subject as string) ||
        (chat.group_subject as string) ||
        (chat.display_name as string) ||
        (chat.title as string) ||
        "";
      if (alt && alt.trim()) {
        chat.name = alt.trim();
      }
    }
  }

  return c.json({ items: filtered });
});

unipileRouter.get("/linkedin/chats", async (c) => {
  const user = c.get("user");
  const orgAccounts = await resolveOrganizationAccountGraph(
    user.orgId,
  ).resolve();
  const orgAccountIds = new Set(
    orgAccounts.map((a) => a.unipile_account_id),
  );

  const allChats = await channelGateway.listAllChats("LINKEDIN");
  const filtered = filterByOrganizationScope(
    (allChats.items || []) as Record<string, unknown>[],
    orgAccountIds,
  );
  return c.json({ items: filtered });
});

export default unipileRouter;
