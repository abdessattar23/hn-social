import { db } from "../db/client";
import { NotFoundError, BadRequestError } from "../lib/errors";
import * as unipile from "./unipile";
import { Cron } from "croner";

async function verifyAccountOwnership(accountId: string, orgId: number) {
  const { data } = await db
    .from("connected_accounts")
    .select("id")
    .eq("unipile_account_id", accountId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) throw new BadRequestError("Account not connected to your organization");
  return data;
}

export async function findAll(orgId: number) {
  const { data } = await db
    .from("campaigns")
    .select("*, message:message_templates(*), campaign_lists(contact_list_id, list:contact_lists(*))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  return (data || []).map((r: any) => ({
    ...r,
    lists: (r.campaign_lists || []).map((cl: any) => cl.list),
    campaign_lists: undefined,
  }));
}

export async function findOne(id: number, orgId: number) {
  const { data } = await db
    .from("campaigns")
    .select("*, message:message_templates(*), campaign_lists(contact_list_id, list:contact_lists(*, contacts(*))), logs:campaign_logs(*)")
    .eq("id", id)
    .eq("org_id", orgId)
    .single();

  if (!data) throw new NotFoundError("Campaign not found");

  return {
    ...data,
    lists: (data.campaign_lists || []).map((cl: any) => cl.list),
    campaign_lists: undefined,
  };
}

export async function create(
  data: {
    name: string;
    messageId: number;
    listIds: number[];
    accountId: string;
    scheduledAt?: string;
    tags?: string[];
  },
  orgId: number,
  userId: string
) {
  await verifyAccountOwnership(data.accountId, orgId);

  const { data: message } = await db
    .from("message_templates")
    .select("id")
    .eq("id", data.messageId)
    .eq("org_id", orgId)
    .single();
  if (!message) throw new NotFoundError("Message template not found");

  const { data: lists } = await db
    .from("contact_lists")
    .select("id, contacts(id)")
    .in("id", data.listIds)
    .eq("org_id", orgId);

  const total = (lists || []).reduce((sum: number, l: any) => sum + (l.contacts?.length || 0), 0);

  const { data: campaign } = await db
    .from("campaigns")
    .insert({
      name: data.name,
      message_id: data.messageId,
      account_id: data.accountId,
      user_id: userId,
      org_id: orgId,
      total,
      status: data.scheduledAt ? "SCHEDULED" : "DRAFT",
      scheduled_at: data.scheduledAt ? new Date(data.scheduledAt).toISOString() : null,
      tags: data.tags || [],
    })
    .select()
    .single();

  if ((lists || []).length && campaign) {
    await db.from("campaign_lists").insert(
      (lists || []).map((l: any) => ({ campaign_id: campaign.id, contact_list_id: l.id }))
    );
  }

  return campaign;
}

export async function updateTags(id: number, tags: string[], orgId: number) {
  const existing = await findOne(id, orgId);
  await db.from("campaigns").update({ tags }).eq("id", existing.id);
  return { ...existing, tags };
}

export async function send(id: number, orgId: number) {
  const campaign = await findOne(id, orgId);
  if (campaign.status === "SENDING") throw new BadRequestError("Campaign already sending");

  await db.from("campaigns").update({ status: "SENDING", sent: 0, failed: 0 }).eq("id", campaign.id);

  processCampaign(campaign).catch((err) => {
    console.error(`Campaign ${id} crashed: ${err.message}`);
  });

  return { status: "SENDING", total: campaign.total };
}

async function processCampaign(campaign: any) {
  const message = campaign.message;
  const attachmentPaths = message.attachments?.map((a: any) => a.path) || [];
  let sent = 0;
  let failed = 0;
  let isFirst = true;

  let emailBody = message.body;
  try {
    const { data: org } = await db
      .from("organizations")
      .select("account_signatures")
      .eq("id", campaign.org_id)
      .single();
    const signature = org?.account_signatures?.[campaign.account_id];
    if (signature) {
      emailBody = message.body + "<br/><br/>--<br/>" + signature;
    }
  } catch {}

  for (const list of campaign.lists) {
    for (const contact of list.contacts || []) {
      if (!isFirst) {
        await new Promise((r) => setTimeout(r, 1000 + Math.random() * 4000));
      }
      isFirst = false;

      let logStatus = "SENT";
      let logError: string | null = null;

      try {
        if (list.type === "EMAIL") {
          await unipile.sendEmail({
            accountId: campaign.account_id,
            to: [{ display_name: contact.name, identifier: contact.identifier }],
            subject: message.subject || "",
            body: emailBody,
            attachmentPaths,
          });
        } else {
          await unipile.sendChatMessage(contact.identifier, message.body, attachmentPaths);
        }
        sent++;
      } catch (err: unknown) {
        logStatus = "FAILED";
        logError = err instanceof Error ? err.message : String(err);
        failed++;
      }

      await db.from("campaign_logs").insert({
        campaign_id: campaign.id,
        contact_name: contact.name,
        contact_identifier: contact.identifier,
        status: logStatus,
        error: logError,
      });

      await db.from("campaigns").update({ sent, failed }).eq("id", campaign.id);
    }
  }

  const status = failed > 0 && sent === 0 ? "FAILED" : "SENT";
  await db.from("campaigns").update({ status, sent, failed }).eq("id", campaign.id);
}

export async function cancel(id: number, orgId: number) {
  const campaign = await findOne(id, orgId);
  if (campaign.status !== "SCHEDULED") {
    throw new BadRequestError("Only scheduled campaigns can be cancelled");
  }
  await db.from("campaigns").update({ status: "DRAFT", scheduled_at: null }).eq("id", campaign.id);
  return { status: "DRAFT" };
}

export async function remove(id: number, orgId: number) {
  await findOne(id, orgId);
  await db.from("campaigns").delete().eq("id", id);
  return { deleted: true };
}

export async function getScheduleHeatmap(orgId: number) {
  const { data: rows } = await db
    .from("campaigns")
    .select("id, name, status, scheduled_at, created_at, total")
    .eq("org_id", orgId);

  const heatmap: Record<string, { count: number; campaigns: { name: string; status: string; total: number }[] }> = {};

  for (const c of rows || []) {
    const date = (c.scheduled_at || c.created_at || "").split("T")[0];
    if (!heatmap[date]) heatmap[date] = { count: 0, campaigns: [] };
    heatmap[date].count++;
    heatmap[date].campaigns.push({ name: c.name, status: c.status, total: c.total });
  }

  return heatmap;
}

export function startCampaignCron() {
  new Cron("* * * * *", async () => {
    try {
      const { data: due } = await db
        .from("campaigns")
        .select("*, message:message_templates(*), campaign_lists(contact_list_id, list:contact_lists(*, contacts(*)))")
        .eq("status", "SCHEDULED")
        .lte("scheduled_at", new Date().toISOString());

      for (const raw of due || []) {
        const campaign = {
          ...raw,
          lists: (raw.campaign_lists || []).map((cl: any) => cl.list),
        };
        console.log(`Processing scheduled campaign ${campaign.id}: ${campaign.name}`);
        await db.from("campaigns").update({ status: "SENDING", sent: 0, failed: 0 }).eq("id", campaign.id);
        processCampaign(campaign).catch((err) => {
          console.error(`Scheduled campaign ${campaign.id} crashed: ${err.message}`);
        });
      }
    } catch (err) {
      console.error("Cron error:", err);
    }
  });
}
