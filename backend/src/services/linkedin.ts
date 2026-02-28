import { db } from "../db/client";
import { BadRequestError } from "../lib/errors";
import * as unipile from "./unipile";

async function verifyAccount(accountId: string, orgId: number) {
  const { data } = await db
    .from("connected_accounts")
    .select("id")
    .eq("unipile_account_id", accountId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) throw new BadRequestError("Account not connected to your organization");
  return data;
}

export async function search(orgId: number, accountId: string, params: Record<string, unknown>) {
  await verifyAccount(accountId, orgId);
  return unipile.linkedinSearch(accountId, params);
}

export async function getSearchParams(orgId: number, accountId: string, type: string, keywords?: string) {
  await verifyAccount(accountId, orgId);
  return unipile.linkedinGetSearchParams(accountId, type, keywords);
}

export async function getProfile(orgId: number, accountId: string, profileId: string) {
  await verifyAccount(accountId, orgId);
  return unipile.linkedinGetProfile(accountId, profileId);
}

export async function sendInvite(orgId: number, accountId: string, providerId: string, message?: string) {
  await verifyAccount(accountId, orgId);
  return unipile.linkedinSendInvite(accountId, providerId, message);
}

export async function sendMessage(orgId: number, accountId: string, chatId: string, text: string) {
  await verifyAccount(accountId, orgId);
  return unipile.sendChatMessage(chatId, text);
}

export async function createPost(orgId: number, accountId: string, text: string) {
  await verifyAccount(accountId, orgId);
  return unipile.linkedinCreatePost(accountId, text);
}

export async function listPosts(orgId: number, accountId: string) {
  await verifyAccount(accountId, orgId);
  return unipile.linkedinListPosts(accountId);
}
