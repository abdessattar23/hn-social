import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/client";
import { authMiddleware, ownerOnly } from "../middleware/auth";
import {
  updateOrgNameSchema,
  updateAccountAliasSchema,
  updateAccountSignatureSchema,
} from "../lib/validation";
import { NotFoundError, ForbiddenError } from "../lib/errors";
import { randomBytes } from "crypto";

const org = new Hono();
org.use("*", authMiddleware);

org.get("/", async (c) => {
  const user = c.get("user");
  const { data, error } = await db
    .from("organizations")
    .select("*")
    .eq("id", user.orgId)
    .single();
  if (error || !data) throw new NotFoundError("Organization not found");
  return c.json(data);
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
  const { data } = await db
    .from("org_members")
    .select("id, user_id, role, created_at")
    .eq("org_id", user.orgId)
    .order("created_at", { ascending: true });
  return c.json(data || []);
});

org.delete("/members/:id", ownerOnly, async (c) => {
  const user = c.get("user");
  const memberId = Number(c.req.param("id"));

  const { data: member } = await db
    .from("org_members")
    .select("*")
    .eq("id", memberId)
    .eq("org_id", user.orgId)
    .single();

  if (!member) throw new NotFoundError("Member not found");
  if (member.user_id === user.id) throw new ForbiddenError("Cannot remove yourself");

  const inviteCode = randomBytes(8).toString("hex");
  const { data: newOrg } = await db
    .from("organizations")
    .insert({ name: "Personal Org", invite_code: inviteCode })
    .select()
    .single();

  await db
    .from("org_members")
    .update({ org_id: newOrg!.id, role: "owner" })
    .eq("id", memberId);

  return c.json({ removed: true });
});

org.get("/account-aliases", async (c) => {
  const user = c.get("user");
  const { data } = await db
    .from("organizations")
    .select("account_aliases")
    .eq("id", user.orgId)
    .single();
  return c.json(data?.account_aliases || {});
});

org.patch("/account-alias", zValidator("json", updateAccountAliasSchema), async (c) => {
  const user = c.get("user");
  const { accountId, alias } = c.req.valid("json");
  const { data: row } = await db
    .from("organizations")
    .select("account_aliases")
    .eq("id", user.orgId)
    .single();
  if (!row) throw new NotFoundError("Organization not found");

  const aliases = { ...(row.account_aliases || {}) };
  if (alias) aliases[accountId] = alias;
  else delete aliases[accountId];

  await db.from("organizations").update({ account_aliases: aliases }).eq("id", user.orgId);
  return c.json(aliases);
});

org.get("/account-signatures", async (c) => {
  const user = c.get("user");
  const { data } = await db
    .from("organizations")
    .select("account_signatures")
    .eq("id", user.orgId)
    .single();
  return c.json(data?.account_signatures || {});
});

org.patch("/account-signature", zValidator("json", updateAccountSignatureSchema), async (c) => {
  const user = c.get("user");
  const { accountId, signature } = c.req.valid("json");
  const { data: row } = await db
    .from("organizations")
    .select("account_signatures")
    .eq("id", user.orgId)
    .single();
  if (!row) throw new NotFoundError("Organization not found");

  const sigs = { ...(row.account_signatures || {}) };
  if (signature) sigs[accountId] = signature;
  else delete sigs[accountId];

  await db.from("organizations").update({ account_signatures: sigs }).eq("id", user.orgId);
  return c.json(sigs);
});

org.post("/regenerate-invite", ownerOnly, async (c) => {
  const user = c.get("user");
  const inviteCode = randomBytes(8).toString("hex");
  await db.from("organizations").update({ invite_code: inviteCode }).eq("id", user.orgId);
  return c.json({ inviteCode });
});

export default org;
