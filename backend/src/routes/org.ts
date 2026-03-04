import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/client";
import { authMiddleware, ownerOnly } from "../middleware/auth";
import {
  updateOrgNameSchema,
  updateAccountAliasSchema,
  updateAccountSignatureSchema,
} from "../lib/validation";
import { NotFoundError, ForbiddenError, BadRequestError } from "../lib/errors";
import { randomBytes } from "crypto";
import { AsyncResult } from "../core/monad";

type OrganizationProjection = Record<string, unknown>;

interface MemberProjection {
  id: number;
  user_id: string;
  role: string;
  created_at: string;
}

const INVITE_CODE_ENTROPY_BYTES = 8;

const generateInviteCode = (): string =>
  randomBytes(INVITE_CODE_ENTROPY_BYTES).toString("hex");

const materializeOrganization = (orgId: number): AsyncResult<OrganizationProjection> =>
  AsyncResult.from(async () => {
    const { data, error } = await db
      .from("organizations")
      .select("*")
      .eq("id", orgId)
      .single();
    if (error || !data) throw new NotFoundError("Organization not found");
    return data as OrganizationProjection;
  }, "org.materialize");

const materializeMembers = (orgId: number): AsyncResult<MemberProjection[]> =>
  AsyncResult.from(async () => {
    const { data, error } = await db
      .from("org_members")
      .select("id, user_id, role, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: true });
    if (error) throw new BadRequestError(error.message);
    return (data || []) as MemberProjection[];
  }, "org.materializeMembers");

const reconcileKeyValueStore = async (
  orgId: number,
  storeField: "account_aliases" | "account_signatures",
  key: string,
  value: string | undefined | null,
): Promise<Record<string, string>> => {
  const { data: row, error: fetchErr } = await db
    .from("organizations")
    .select(storeField)
    .eq("id", orgId)
    .single();
  if (fetchErr || !row) throw new NotFoundError("Organization not found");

  const store = { ...((row as any)[storeField] || {}) } as Record<string, string>;

  if (value) {
    store[key] = value;
  } else {
    delete store[key];
  }

  const { error } = await db
    .from("organizations")
    .update({ [storeField]: store })
    .eq("id", orgId);
  if (error) throw new BadRequestError(error.message);

  return store;
};

const org = new Hono();
org.use("*", authMiddleware);

org.get("/", async (c) => {
  const user = c.get("user");
  const organization = await materializeOrganization(user.orgId).resolve();
  return c.json(organization);
});

org.put("/", ownerOnly, zValidator("json", updateOrgNameSchema), async (c) => {
  const user = c.get("user");
  const { name } = c.req.valid("json");
  const { data, error } = await db
    .from("organizations")
    .update({ name })
    .eq("id", user.orgId)
    .select()
    .single();
  if (error) throw new NotFoundError("Organization not found");
  return c.json(data);
});

org.get("/members", async (c) => {
  const user = c.get("user");
  const members = await materializeMembers(user.orgId).resolve();
  return c.json(members);
});

org.delete("/members/:id", ownerOnly, async (c) => {
  const user = c.get("user");
  const memberId = Number(c.req.param("id"));

  const { data: member, error: memErr } = await db
    .from("org_members")
    .select("*")
    .eq("id", memberId)
    .eq("org_id", user.orgId)
    .single();

  if (memErr || !member) throw new NotFoundError("Member not found");
  if (member.user_id === user.id)
    throw new ForbiddenError("Cannot remove yourself");

  const inviteCode = generateInviteCode();
  const { data: newOrg, error: orgErr } = await db
    .from("organizations")
    .insert({ name: "Personal Org", invite_code: inviteCode })
    .select()
    .single();
  if (orgErr || !newOrg)
    throw new BadRequestError(
      orgErr?.message ?? "Failed to create organization",
    );

  const { error: moveErr } = await db
    .from("org_members")
    .update({ org_id: newOrg.id, role: "owner" })
    .eq("id", memberId);
  if (moveErr) throw new BadRequestError(moveErr.message);

  return c.json({ removed: true });
});

org.get("/account-aliases", async (c) => {
  const user = c.get("user");
  const { data, error } = await db
    .from("organizations")
    .select("account_aliases")
    .eq("id", user.orgId)
    .single();
  if (error) throw new BadRequestError(error.message);
  return c.json(data?.account_aliases || {});
});

org.patch(
  "/account-alias",
  zValidator("json", updateAccountAliasSchema),
  async (c) => {
    const user = c.get("user");
    const { accountId, alias } = c.req.valid("json");
    const result = await reconcileKeyValueStore(
      user.orgId,
      "account_aliases",
      accountId,
      alias || undefined,
    );
    return c.json(result);
  },
);

org.get("/account-signatures", async (c) => {
  const user = c.get("user");
  const { data, error } = await db
    .from("organizations")
    .select("account_signatures")
    .eq("id", user.orgId)
    .single();
  if (error) throw new BadRequestError(error.message);
  return c.json(data?.account_signatures || {});
});

org.patch(
  "/account-signature",
  zValidator("json", updateAccountSignatureSchema),
  async (c) => {
    const user = c.get("user");
    const { accountId, signature } = c.req.valid("json");
    const result = await reconcileKeyValueStore(
      user.orgId,
      "account_signatures",
      accountId,
      signature || undefined,
    );
    return c.json(result);
  },
);

org.post("/regenerate-invite", ownerOnly, async (c) => {
  const user = c.get("user");
  const inviteCode = generateInviteCode();
  const { error } = await db
    .from("organizations")
    .update({ invite_code: inviteCode })
    .eq("id", user.orgId);
  if (error) throw new BadRequestError(error.message);
  return c.json({ inviteCode });
});

export default org;
