import { db } from "../db/client";
import { BadRequestError } from "../lib/errors";
import * as unipile from "./unipile";
import Papa from "papaparse";
import { AsyncResult, TelemetryCollector, pipe } from "../core/monad";
import type { ChannelProtocol } from "../core/types";

const telemetry = TelemetryCollector.shared();

interface AccountOwnershipProof {
  id: number;
}

interface ProfileFieldProjection {
  name?: string;
  first_name?: string;
  last_name?: string;
  profile_url?: string;
  public_profile_url?: string;
  headline?: string;
  location?: string;
  network_distance?: string;
  current_positions?: Array<{ company?: string; role?: string }>;
  [key: string]: any;
}

interface CsvExportConfiguration {
  fields?: string[];
  maxResults?: number;
  category: string;
}

type EntityToCsvRowMapper = (
  item: any,
  category: string,
) => Record<string, any>;

const MAX_PAGINATED_EXPORT_DEPTH = 50;

async function verifyAccountOwnership(
  accountId: string,
  orgId: number,
): Promise<AccountOwnershipProof> {
  const { data } = await db
    .from("connected_accounts")
    .select("id")
    .eq("unipile_account_id", accountId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data)
    throw new BadRequestError(
      "Account not connected to your organization",
    );
  return data as AccountOwnershipProof;
}

const createAccountGuard =
  (orgId: number) =>
  (accountId: string): Promise<AccountOwnershipProof> =>
    verifyAccountOwnership(accountId, orgId);

export async function search(
  orgId: number,
  accountId: string,
  params: Record<string, unknown>,
) {
  await createAccountGuard(orgId)(accountId);
  return unipile.linkedinSearch(accountId, params);
}

export async function getSearchParams(
  orgId: number,
  accountId: string,
  type: string,
  keywords?: string,
) {
  await createAccountGuard(orgId)(accountId);
  return unipile.linkedinGetSearchParams(accountId, type, keywords);
}

export async function getProfile(
  orgId: number,
  accountId: string,
  profileId: string,
) {
  await createAccountGuard(orgId)(accountId);
  return unipile.linkedinGetProfile(accountId, profileId);
}

export async function sendInvite(
  orgId: number,
  accountId: string,
  providerId: string,
  message?: string,
) {
  await createAccountGuard(orgId)(accountId);
  return unipile.linkedinSendInvite(accountId, providerId, message);
}

export async function bulkInvite(
  orgId: number,
  accountId: string,
  invites: { providerId: string; name?: string }[],
  message?: string,
) {
  await createAccountGuard(orgId)(accountId);

  const dispatchResults: {
    providerId: string;
    name?: string;
    status: string;
    error?: string;
  }[] = [];

  let isFirstDispatch = true;

  for (const inv of invites) {
    if (!isFirstDispatch) {
      await new Promise((r) =>
        setTimeout(r, 2000 + Math.random() * 3000),
      );
    }
    isFirstDispatch = false;

    try {
      await unipile.linkedinSendInvite(
        accountId,
        inv.providerId,
        message,
      );
      dispatchResults.push({
        providerId: inv.providerId,
        name: inv.name,
        status: "SENT",
      });
    } catch (err: unknown) {
      dispatchResults.push({
        providerId: inv.providerId,
        name: inv.name,
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const aggregation = dispatchResults.reduce(
    (acc, r) => ({
      sent: acc.sent + (r.status === "SENT" ? 1 : 0),
      failed: acc.failed + (r.status === "FAILED" ? 1 : 0),
    }),
    { sent: 0, failed: 0 },
  );

  return {
    sent: aggregation.sent,
    failed: aggregation.failed,
    total: invites.length,
    results: dispatchResults,
  };
}

export async function sendMessage(
  orgId: number,
  accountId: string,
  chatId: string,
  text: string,
) {
  await createAccountGuard(orgId)(accountId);
  return unipile.sendChatMessage(chatId, text);
}

export async function createPost(
  orgId: number,
  accountId: string,
  text: string,
) {
  await createAccountGuard(orgId)(accountId);
  return unipile.linkedinCreatePost(accountId, text);
}

export async function listPosts(orgId: number, accountId: string) {
  await createAccountGuard(orgId)(accountId);
  return unipile.linkedinListPosts(accountId);
}

const projectPostEntity: EntityToCsvRowMapper = (item) => ({
  author_name: item.author?.name || "",
  author_profile_id: item.author?.public_identifier || "",
  author_headline: item.author?.headline || "",
  author_is_company: item.author?.is_company ? "Yes" : "No",
  post_url: item.share_url || "",
  post_date: item.date || item.parsed_datetime || "",
  post_text: (item.text || "").slice(0, 500),
  reactions: item.reaction_counter ?? "",
  comments: item.comment_counter ?? "",
  reposts: item.repost_counter ?? "",
  impressions: item.impressions_counter ?? "",
});

const projectCompanyEntity: EntityToCsvRowMapper = (item) => ({
  name: item.name || "",
  company_id: item.id || "",
  profile_url: item.profile_url || "",
  industry: item.industry || "",
  location: item.location || "",
  headcount: item.headcount || "",
  followers: item.followers_count ?? "",
  job_offers: item.job_offers_count ?? "",
  summary: (item.summary || "").slice(0, 300),
});

const projectPersonEntity: EntityToCsvRowMapper = (item) => ({
  name: item.name || "",
  first_name: item.first_name || "",
  last_name: item.last_name || "",
  profile_url: item.profile_url || item.public_profile_url || "",
  headline: item.headline || "",
  location: item.location || "",
  network_distance: item.network_distance || "",
  current_company: item.current_positions?.[0]?.company || "",
  current_role: item.current_positions?.[0]?.role || "",
});

const EntityProjectionRegistry: Record<string, EntityToCsvRowMapper> = {
  posts: projectPostEntity,
  companies: projectCompanyEntity,
  people: projectPersonEntity,
};

function resolveProjectionMapper(
  category: string,
): EntityToCsvRowMapper {
  return EntityProjectionRegistry[category] ?? projectPersonEntity;
}

function applyFieldFilter(
  row: Record<string, any>,
  fields?: string[],
): Record<string, any> {
  if (!fields || fields.length === 0) return row;
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => fields.includes(key)),
  );
}

function transformItemsToCsvRows(
  items: any[],
  config: CsvExportConfiguration,
): Record<string, any>[] {
  const mapper = resolveProjectionMapper(config.category);
  const sliced =
    config.maxResults && config.maxResults > 0
      ? items.slice(0, config.maxResults)
      : items;

  return sliced.map((item) =>
    applyFieldFilter(mapper(item, config.category), config.fields),
  );
}

export async function searchExportCsv(
  orgId: number,
  accountId: string,
  params: Record<string, unknown>,
  fields?: string[],
  maxResults?: number,
): Promise<string> {
  await createAccountGuard(orgId)(accountId);

  const searchParams = { ...params };
  if (!searchParams.limit) searchParams.limit = 100;

  const result = await unipile.linkedinSearch(accountId, searchParams);
  const items: any[] = (result as any)?.items || [];

  console.log(
    `[Export Page] Got ${items.length} items (total_count: ${(result as any)?.paging?.total_count ?? "unknown"})`,
  );

  if (items.length === 0) {
    return Papa.unparse([{ info: "No results found" }]);
  }

  return Papa.unparse(
    transformItemsToCsvRows(items, {
      category: params.category as string,
      fields,
      maxResults,
    }),
  );
}

export async function searchExportAllCsv(
  orgId: number,
  accountId: string,
  params: Record<string, unknown>,
  fields?: string[],
  maxResults?: number,
): Promise<string> {
  await createAccountGuard(orgId)(accountId);

  const aggregatedItems: any[] = [];
  let currentParams = { ...params, limit: 100 };
  let pagesTraversed = 0;
  const resultCap =
    maxResults && maxResults > 0 ? maxResults : Infinity;

  console.log(
    `[Export All] Starting paginated export, category=${params.category}, cap=${resultCap === Infinity ? "none" : resultCap}`,
  );

  while (
    pagesTraversed < MAX_PAGINATED_EXPORT_DEPTH &&
    aggregatedItems.length < resultCap
  ) {
    const result = await unipile.linkedinSearch(
      accountId,
      currentParams,
    );
    const pageItems: any[] = (result as any)?.items || [];
    const totalAvailable = (result as any)?.paging?.total_count;
    aggregatedItems.push(...pageItems);
    pagesTraversed++;

    console.log(
      `[Export All] Page ${pagesTraversed}: got ${pageItems.length} items (total so far: ${aggregatedItems.length}, API total_count: ${totalAvailable ?? "unknown"}, has cursor: ${!!(result as any)?.cursor})`,
    );

    if (!(result as any)?.cursor || pageItems.length === 0) {
      console.log(
        `[Export All] Stopping: ${!(result as any)?.cursor ? "no cursor returned" : "empty page"}`,
      );
      break;
    }

    currentParams = {
      ...params,
      limit: 100,
      cursor: (result as any).cursor,
    } as any;
  }

  if (pagesTraversed >= MAX_PAGINATED_EXPORT_DEPTH)
    console.log(
      `[Export All] Hit max page limit (${MAX_PAGINATED_EXPORT_DEPTH})`,
    );

  console.log(
    `[Export All] Done: ${aggregatedItems.length} total items across ${pagesTraversed} pages`,
  );

  if (aggregatedItems.length === 0) {
    return Papa.unparse([{ info: "No results found" }]);
  }

  telemetry.record("linkedin.exportAll", accountId, {
    pages: pagesTraversed,
    totalItems: aggregatedItems.length,
  });

  return Papa.unparse(
    transformItemsToCsvRows(aggregatedItems, {
      category: params.category as string,
      fields,
      maxResults,
    }),
  );
}
