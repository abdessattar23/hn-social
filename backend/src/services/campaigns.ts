import { db } from "../db/client";
import { NotFoundError, BadRequestError } from "../lib/errors";
import * as unipile from "./unipile";
import { Cron } from "croner";
import {
  CircuitBreakerRegistry,
  createThrottlePolicy,
  throttledExecution,
} from "../core/pipeline";
import { AsyncResult, TelemetryCollector } from "../core/monad";
import type { ThrottlePolicy, CampaignPhase, ChannelProtocol } from "../core/types";

const circuitBreaker = new CircuitBreakerRegistry();
const telemetry = TelemetryCollector.shared();

const CHANNEL_THROTTLE_DEFAULTS: Record<string, ThrottlePolicy> = {
  EMAIL: createThrottlePolicy("EMAIL"),
  WHATSAPP: createThrottlePolicy("WHATSAPP"),
  LINKEDIN: createThrottlePolicy("LINKEDIN"),
};

interface CampaignAggregateProjection {
  id: number;
  name: string;
  status: string;
  message: any;
  lists: any[];
  logs?: any[];
  campaign_lists?: any[];
  total: number;
  sent: number;
  failed: number;
  org_id: number;
  account_id: string;
  delay_min_ms?: number;
  delay_max_ms?: number;
  scheduled_at?: string;
  tags?: string[];
  [key: string]: any;
}

interface PropagationContext {
  campaign: CampaignAggregateProjection;
  throttlePolicy: ThrottlePolicy;
  channelProtocol: ChannelProtocol;
  processedCount: number;
  sentCount: number;
  failedCount: number;
  halted: boolean;
}

const FULL_CAMPAIGN_PROJECTION =
  "*, message:message_templates(*), campaign_lists(contact_list_id, list:contact_lists(*))";
const DETAILED_CAMPAIGN_PROJECTION =
  "*, message:message_templates(*), campaign_lists(contact_list_id, list:contact_lists(*, contacts(*))), logs:campaign_logs(*)";

async function verifyAccountOwnership(accountId: string, orgId: number) {
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
  return data;
}

function hydrateCampaignAggregate(raw: any): CampaignAggregateProjection {
  return {
    ...raw,
    lists: (raw.campaign_lists || []).map((cl: any) => cl.list),
    campaign_lists: undefined,
  };
}

export async function findAll(orgId: number) {
  const { data } = await db
    .from("campaigns")
    .select(FULL_CAMPAIGN_PROJECTION)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return (data || []).map(hydrateCampaignAggregate);
}

export async function findOne(
  id: number,
  orgId: number,
): Promise<CampaignAggregateProjection> {
  const { data } = await db
    .from("campaigns")
    .select(DETAILED_CAMPAIGN_PROJECTION)
    .eq("id", id)
    .eq("org_id", orgId)
    .single();

  if (!data) throw new NotFoundError("Campaign not found");
  return hydrateCampaignAggregate(data);
}

export async function create(
  data: {
    name: string;
    messageId: number;
    listIds: number[];
    accountId: string;
    scheduledAt?: string;
    tags?: string[];
    delayMinMs?: number;
    delayMaxMs?: number;
  },
  orgId: number,
  userId: string,
) {
  await verifyAccountOwnership(data.accountId, orgId);

  const messageResolution = await AsyncResult.from(async () => {
    const { data: message } = await db
      .from("message_templates")
      .select("id, type")
      .eq("id", data.messageId)
      .eq("org_id", orgId)
      .single();
    if (!message) throw new NotFoundError("Message template not found");
    return message;
  }, "campaign.resolveTemplate").resolve();

  const channelDefaults =
    CHANNEL_THROTTLE_DEFAULTS[messageResolution.type] ??
    CHANNEL_THROTTLE_DEFAULTS.EMAIL;

  const audienceManifest = await AsyncResult.from(async () => {
    const { data: lists } = await db
      .from("contact_lists")
      .select("id, contacts(id)")
      .in("id", data.listIds)
      .eq("org_id", orgId);
    return lists || [];
  }, "campaign.resolveAudience").resolve();

  const totalRecipients = audienceManifest.reduce(
    (sum: number, list: any) => sum + (list.contacts?.length || 0),
    0,
  );

  const campaignPayload: Record<string, any> = {
    name: data.name,
    message_id: data.messageId,
    account_id: data.accountId,
    user_id: userId,
    org_id: orgId,
    total: totalRecipients,
    status: data.scheduledAt ? "SCHEDULED" : "DRAFT",
    scheduled_at: data.scheduledAt
      ? new Date(data.scheduledAt).toISOString()
      : null,
    tags: data.tags || [],
    delay_min_ms: data.delayMinMs ?? channelDefaults.minIntervalMs,
    delay_max_ms: data.delayMaxMs ?? channelDefaults.maxIntervalMs,
  };

  let campaignResult = await db
    .from("campaigns")
    .insert(campaignPayload)
    .select()
    .single();

  if (campaignResult.error) {
    delete campaignPayload.delay_min_ms;
    delete campaignPayload.delay_max_ms;
    campaignResult = await db
      .from("campaigns")
      .insert(campaignPayload)
      .select()
      .single();
  }

  const { data: campaign, error: campaignErr } = campaignResult;
  if (campaignErr || !campaign)
    throw new BadRequestError(
      campaignErr?.message || "Failed to create campaign",
    );

  if (audienceManifest.length && campaign) {
    await db.from("campaign_lists").insert(
      audienceManifest.map((l: any) => ({
        campaign_id: campaign.id,
        contact_list_id: l.id,
      })),
    );
  }

  telemetry.record("campaign.created", campaign.id, {
    total: totalRecipients,
    channel: messageResolution.type,
  });

  return campaign;
}

export async function updateTags(
  id: number,
  tags: string[],
  orgId: number,
) {
  const existing = await findOne(id, orgId);
  await db.from("campaigns").update({ tags }).eq("id", existing.id);
  return { ...existing, tags };
}

export async function send(id: number, orgId: number) {
  const campaign = await findOne(id, orgId);

  const { data: claimed } = await db
    .from("campaigns")
    .update({ status: "SENDING", sent: 0, failed: 0 })
    .eq("id", campaign.id)
    .in("status", ["DRAFT", "SCHEDULED", "STOPPED"])
    .select()
    .maybeSingle();

  if (!claimed) throw new BadRequestError("Campaign already sending");

  circuitBreaker.reset(campaign.id);

  telemetry.record("campaign.sendInitiated", campaign.id, {
    total: campaign.total,
  });

  executePropagationPipeline(campaign).catch((err) => {
    console.error(`[Campaign ${id}] Crashed: ${err.message}`);
  });

  return { status: "SENDING", total: campaign.total };
}

export async function emergencyStop(id: number, orgId: number) {
  const campaign = await findOne(id, orgId);

  const { data: stopped } = await db
    .from("campaigns")
    .update({ status: "STOPPED" })
    .eq("id", campaign.id)
    .eq("status", "SENDING")
    .select()
    .maybeSingle();

  if (!stopped)
    throw new BadRequestError("Campaign is not currently sending");

  circuitBreaker.trip(campaign.id);

  telemetry.record("campaign.emergencyStop", campaign.id, {
    sent: campaign.sent,
    failed: campaign.failed,
  });

  return {
    status: "STOPPED",
    sent: campaign.sent,
    failed: campaign.failed,
    total: campaign.total,
  };
}

async function checkDuplicateDispatch(
  campaignId: number,
  contactIdentifier: string,
): Promise<boolean> {
  const { data } = await db
    .from("campaign_logs")
    .select("id")
    .eq("campaign_id", campaignId)
    .eq("contact_identifier", contactIdentifier)
    .maybeSingle();
  return !!data;
}

async function resolveSignatureForChannel(
  orgId: number,
  accountId: string,
  baseBody: string,
): Promise<string> {
  try {
    const { data: org } = await db
      .from("organizations")
      .select("account_signatures")
      .eq("id", orgId)
      .single();
    const signature = org?.account_signatures?.[accountId];
    if (signature) {
      return baseBody + "<br/><br/>--<br/>" + signature;
    }
  } catch {}
  return baseBody;
}

async function dispatchToRecipient(
  context: PropagationContext,
  contact: any,
  listType: string,
  enrichedBody: string,
  attachmentPaths: string[],
): Promise<{ status: string; error: string | null }> {
  try {
    if (listType === "EMAIL") {
      await unipile.sendEmail({
        accountId: context.campaign.account_id,
        to: [
          {
            display_name: contact.name,
            identifier: contact.identifier,
          },
        ],
        subject: context.campaign.message.subject || "",
        body: enrichedBody,
        attachmentPaths,
      });
    } else {
      await unipile.sendChatMessage(
        contact.identifier,
        context.campaign.message.body,
        attachmentPaths,
      );
    }
    return { status: "SENT", error: null };
  } catch (err: unknown) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    return { status: "FAILED", error: errorMessage };
  }
}

async function executePropagationPipeline(
  campaign: CampaignAggregateProjection,
) {
  const startTime = Date.now();
  const message = campaign.message;
  const attachmentPaths =
    message.attachments?.map((a: any) => a.path) || [];
  const channelType = (message.type || "EMAIL") as ChannelProtocol;

  const throttlePolicy: ThrottlePolicy = {
    minIntervalMs: campaign.delay_min_ms ?? 1000,
    maxIntervalMs: campaign.delay_max_ms ?? 5000,
    jitterFactor: 0.4,
  };

  const context: PropagationContext = {
    campaign,
    throttlePolicy,
    channelProtocol: channelType,
    processedCount: 0,
    sentCount: 0,
    failedCount: 0,
    halted: false,
  };

  console.log(
    `[Campaign ${campaign.id}] Starting: "${campaign.name}" | channel=${channelType} | total=${campaign.total} | delay=${throttlePolicy.minIntervalMs}-${throttlePolicy.maxIntervalMs}ms`,
  );

  const enrichedBody = await resolveSignatureForChannel(
    campaign.org_id,
    campaign.account_id,
    message.body,
  );

  let isFirstRecipient = true;

  for (const list of campaign.lists) {
    if (context.halted) break;

    for (const contact of list.contacts || []) {
      if (circuitBreaker.isTripped(campaign.id)) {
        context.halted = true;
        break;
      }

      if (!isFirstRecipient) {
        await throttledExecution(throttlePolicy);
      }
      isFirstRecipient = false;

      if (circuitBreaker.isTripped(campaign.id)) {
        context.halted = true;
        break;
      }

      context.processedCount++;

      const alreadyDispatched = await checkDuplicateDispatch(
        campaign.id,
        contact.identifier,
      );
      if (alreadyDispatched) {
        context.sentCount++;
        continue;
      }

      console.log(
        `[Campaign ${campaign.id}] Sending ${context.processedCount}/${campaign.total} to ${contact.identifier} via ${channelType}`,
      );

      const result = await dispatchToRecipient(
        context,
        contact,
        list.type,
        enrichedBody,
        attachmentPaths,
      );

      if (result.status === "SENT") {
        context.sentCount++;
        console.log(
          `[Campaign ${campaign.id}] ${context.processedCount}/${campaign.total} SENT`,
        );
      } else {
        context.failedCount++;
        console.error(
          `[Campaign ${campaign.id}] ${context.processedCount}/${campaign.total} FAILED: ${result.error}`,
        );
      }

      await db.from("campaign_logs").insert({
        campaign_id: campaign.id,
        contact_name: contact.name,
        contact_identifier: contact.identifier,
        status: result.status,
        error: result.error,
      });

      const shouldFlush =
        context.processedCount % 10 === 0 ||
        context.processedCount >= campaign.total;
      if (shouldFlush) {
        await db
          .from("campaigns")
          .update({
            sent: context.sentCount,
            failed: context.failedCount,
          })
          .eq("id", campaign.id);
      }
    }
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

  if (context.halted) {
    circuitBreaker.reset(campaign.id);
    await db
      .from("campaigns")
      .update({
        status: "STOPPED",
        sent: context.sentCount,
        failed: context.failedCount,
      })
      .eq("id", campaign.id);
    console.log(
      `[Campaign ${campaign.id}] Stopped after ${elapsedSeconds}s: ${context.sentCount} sent, ${context.failedCount} failed`,
    );
  } else {
    const finalStatus =
      context.failedCount > 0 && context.sentCount === 0
        ? "FAILED"
        : "SENT";
    await db
      .from("campaigns")
      .update({
        status: finalStatus,
        sent: context.sentCount,
        failed: context.failedCount,
      })
      .eq("id", campaign.id);
    console.log(
      `[Campaign ${campaign.id}] Complete in ${elapsedSeconds}s: ${context.sentCount} sent, ${context.failedCount} failed`,
    );
  }

  telemetry.record("campaign.completed", campaign.id, {
    sent: context.sentCount,
    failed: context.failedCount,
    elapsedSeconds,
    halted: context.halted,
  });
}

export async function getFailedLogs(id: number, orgId: number) {
  await findOne(id, orgId);
  const { data, error } = await db
    .from("campaign_logs")
    .select("contact_name, contact_identifier, error")
    .eq("campaign_id", id)
    .eq("status", "FAILED")
    .order("id", { ascending: true });
  if (error) throw new BadRequestError(error.message);
  return data || [];
}

export async function cancel(id: number, orgId: number) {
  const campaign = await findOne(id, orgId);
  if (campaign.status !== "SCHEDULED") {
    throw new BadRequestError(
      "Only scheduled campaigns can be cancelled",
    );
  }
  await db
    .from("campaigns")
    .update({ status: "DRAFT", scheduled_at: null })
    .eq("id", campaign.id);
  return { status: "DRAFT" };
}

export async function remove(id: number, orgId: number) {
  const campaign = await findOne(id, orgId);
  if (campaign.status === "SENDING")
    throw new BadRequestError(
      "Cannot delete a campaign that is currently sending. Stop it first.",
    );
  await db.from("campaigns").delete().eq("id", id);
  return { deleted: true };
}

export async function getScheduleHeatmap(orgId: number) {
  const { data: rows } = await db
    .from("campaigns")
    .select("id, name, status, scheduled_at, created_at, total")
    .eq("org_id", orgId);

  const heatmap: Record<
    string,
    {
      count: number;
      campaigns: { name: string; status: string; total: number }[];
    }
  > = {};

  for (const c of rows || []) {
    const date = (c.scheduled_at || c.created_at || "").split("T")[0];
    if (!heatmap[date])
      heatmap[date] = { count: 0, campaigns: [] };
    heatmap[date].count++;
    heatmap[date].campaigns.push({
      name: c.name,
      status: c.status,
      total: c.total,
    });
  }

  return heatmap;
}

async function recoverOrphanedPropagations() {
  try {
    const { data: orphans } = await db
      .from("campaigns")
      .select("id, name, total")
      .eq("status", "SENDING");

    if (!orphans?.length) return;

    for (const campaign of orphans) {
      const { count } = await db
        .from("campaign_logs")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id);

      const logsCount = count || 0;
      console.log(
        `Recovering orphaned campaign ${campaign.id} "${campaign.name}": ${logsCount}/${campaign.total} logged`,
      );

      await db
        .from("campaigns")
        .update({ status: "STOPPED", sent: logsCount })
        .eq("id", campaign.id);
    }
  } catch (err) {
    console.error("Failed to recover orphaned campaigns:", err);
  }
}

export function startCampaignCron() {
  recoverOrphanedPropagations();

  new Cron("* * * * *", async () => {
    try {
      const { data: due } = await db
        .from("campaigns")
        .select(
          "*, message:message_templates(*), campaign_lists(contact_list_id, list:contact_lists(*, contacts(*)))",
        )
        .eq("status", "SCHEDULED")
        .lte("scheduled_at", new Date().toISOString());

      for (const raw of due || []) {
        const campaign = hydrateCampaignAggregate(raw);

        const { data: claimed } = await db
          .from("campaigns")
          .update({ status: "SENDING", sent: 0, failed: 0 })
          .eq("id", campaign.id)
          .eq("status", "SCHEDULED")
          .select()
          .maybeSingle();

        if (!claimed) continue;

        console.log(
          `[Campaign ${campaign.id}] Scheduled campaign starting: ${campaign.name}`,
        );

        executePropagationPipeline(campaign).catch((err) => {
          console.error(
            `[Campaign ${campaign.id}] Scheduled campaign crashed: ${err.message}`,
          );
        });
      }
    } catch (err) {
      console.error("Cron error:", err);
    }
  });

  telemetry.record("orchestrationDaemon.started", "system", {
    schedule: "* * * * *",
  });
}
