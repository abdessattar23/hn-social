import { db } from "../db/client";
import { NotFoundError, BadRequestError } from "../lib/errors";
import * as unipile from "./unipile";
import * as Papa from "papaparse";
import { Cron } from "croner";
import {
    createThrottlePolicy,
    throttledExecution,
} from "../core/pipeline";
import { TelemetryCollector } from "../core/monad";
import type { ChannelProtocol } from "../core/types";

const telemetry = TelemetryCollector.shared();

// ── Types ──────────────────────────────────────────────────────────────

interface PersonalMessageBatch {
    id: number;
    name: string;
    channel: ChannelProtocol;
    account_id: string;
    org_id: number;
    user_id: string;
    status: string;
    total: number;
    sent: number;
    failed: number;
    created_at: string;
}

interface PersonalMessageItem {
    id: number;
    personal_message_id: number;
    recipient_name: string;
    recipient_identifier: string;
    message_body: string;
    subject: string | null;
    status: string;
    error: string | null;
    sent_at: string | null;
}

// ── CSV Column Detection ───────────────────────────────────────────────

const CSV_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

interface CsvColumnMapping {
    name: string;
    identifier: string;
    message: string;
    subject?: string;
}

function detectColumns(
    headers: string[],
): CsvColumnMapping {
    const lower = headers.map((h) => h.trim().toLowerCase());

    const nameIdx = lower.findIndex((h) =>
        ["name", "recipient", "recipient_name", "contact", "contact_name"].includes(h),
    );
    const identifierIdx = lower.findIndex((h) =>
        ["identifier", "email", "phone", "chat_id", "recipient_identifier", "to", "address"].includes(h),
    );
    const messageIdx = lower.findIndex((h) =>
        ["message", "body", "text", "content", "message_body"].includes(h),
    );
    const subjectIdx = lower.findIndex((h) =>
        ["subject", "email_subject"].includes(h),
    );

    if (nameIdx === -1) throw new BadRequestError("CSV must contain a 'name' column");
    if (identifierIdx === -1) throw new BadRequestError("CSV must contain an 'identifier' (or email/phone/to) column");
    if (messageIdx === -1) throw new BadRequestError("CSV must contain a 'message' (or body/text) column");

    return {
        name: headers[nameIdx],
        identifier: headers[identifierIdx],
        message: headers[messageIdx],
        subject: subjectIdx !== -1 ? headers[subjectIdx] : undefined,
    };
}

// ── CRUD ───────────────────────────────────────────────────────────────

export async function findAll(orgId: number) {
    const { data, error } = await db
        .from("personal_messages")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });
    if (error) throw new BadRequestError(error.message);
    return data || [];
}

export async function findOne(id: number, orgId: number) {
    const { data, error } = await db
        .from("personal_messages")
        .select("*")
        .eq("id", id)
        .eq("org_id", orgId)
        .single();
    if (error || !data) throw new NotFoundError("Personal message batch not found");

    const { data: items, error: itemsErr } = await db
        .from("personal_message_items")
        .select("*")
        .eq("personal_message_id", id)
        .order("id", { ascending: true });
    if (itemsErr) throw new BadRequestError(itemsErr.message);

    return { ...data, items: items || [] };
}

export async function create(
    data: { name: string; channel: string; accountId: string },
    orgId: number,
    userId: string,
) {
    // Verify account belongs to org
    const { data: account } = await db
        .from("connected_accounts")
        .select("id")
        .eq("unipile_account_id", data.accountId)
        .eq("org_id", orgId)
        .maybeSingle();
    if (!account) throw new BadRequestError("Account not connected to your organization");

    const { data: batch, error } = await db
        .from("personal_messages")
        .insert({
            name: data.name,
            channel: data.channel,
            account_id: data.accountId,
            org_id: orgId,
            user_id: userId,
        })
        .select()
        .single();
    if (error) throw new BadRequestError(error.message);
    return batch;
}

export async function remove(id: number, orgId: number) {
    const { data, error: findErr } = await db
        .from("personal_messages")
        .select("id")
        .eq("id", id)
        .eq("org_id", orgId)
        .single();
    if (findErr || !data) throw new NotFoundError("Batch not found");

    // Items cascade-delete via FK
    const { error } = await db
        .from("personal_messages")
        .delete()
        .eq("id", id);
    if (error) throw new BadRequestError(error.message);
    return { deleted: true };
}

// ── CSV Import ─────────────────────────────────────────────────────────

export async function importCsv(
    id: number,
    orgId: number,
    csvContent: string,
) {
    const batch = await findOne(id, orgId);
    if (batch.status !== "DRAFT")
        throw new BadRequestError("Can only import CSV into DRAFT batches");

    if (new Blob([csvContent]).size > CSV_MAX_PAYLOAD_BYTES)
        throw new BadRequestError("CSV file too large (max 5MB)");

    const parsed = Papa.parse(csvContent, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h: string) => h.trim(),
    });

    if (parsed.errors.length > 0) {
        const firstError = parsed.errors[0];
        throw new BadRequestError(`CSV parse error at row ${firstError.row}: ${firstError.message}`);
    }

    const rows = parsed.data as Record<string, string>[];
    if (rows.length === 0) throw new BadRequestError("CSV contains no data rows");

    const headers = Object.keys(rows[0]);
    const mapping = detectColumns(headers);

    const items = rows
        .map((row) => ({
            personal_message_id: id,
            recipient_name: (row[mapping.name] || "").trim(),
            recipient_identifier: (row[mapping.identifier] || "").trim(),
            message_body: (row[mapping.message] || "").trim(),
            subject: mapping.subject ? (row[mapping.subject] || "").trim() || null : null,
        }))
        .filter((item) => item.recipient_name && item.recipient_identifier && item.message_body);

    if (items.length === 0)
        throw new BadRequestError("No valid rows found in CSV");

    // Clear any existing items first
    await db
        .from("personal_message_items")
        .delete()
        .eq("personal_message_id", id);

    // Insert in chunks
    const CHUNK_SIZE = 500;
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        const { error } = await db.from("personal_message_items").insert(chunk);
        if (error) throw new BadRequestError(error.message);
    }

    // Update batch total
    await db
        .from("personal_messages")
        .update({ total: items.length })
        .eq("id", id);

    return { imported: items.length };
}

// ── Dispatch Pipeline ──────────────────────────────────────────────────

async function getDailySentCount(orgId: number): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const startDate = `${today}T00:00:00.000Z`;
    const endDate = `${today}T23:59:59.999Z`;

    let total = 0;
    try {
        const { count: campCount } = await db.from("campaign_logs")
            .select("id, campaigns!inner(org_id)", { count: "exact", head: true })
            .eq("status", "SENT")
            .eq("campaigns.org_id", orgId)
            .gte("sent_at", startDate)
            .lte("sent_at", endDate);
        total += campCount || 0;
    } catch { }

    try {
        const { count: pmCount } = await db.from("personal_message_items")
            .select("id, personal_messages!inner(org_id)", { count: "exact", head: true })
            .eq("status", "SENT")
            .eq("personal_messages.org_id", orgId)
            .gte("sent_at", startDate)
            .lte("sent_at", endDate);
        total += pmCount || 0;
    } catch { }

    return total;
}

async function dispatchItem(
    item: PersonalMessageItem,
    channel: ChannelProtocol,
    accountId: string,
    orgId: number,
): Promise<{ status: string; error: string | null }> {
    try {
        if (channel === "EMAIL") {
            // Resolve org signature
            let body = item.message_body;
            try {
                const { data: org } = await db
                    .from("organizations")
                    .select("account_signatures")
                    .eq("id", orgId)
                    .single();
                const signature = org?.account_signatures?.[accountId];
                if (signature) {
                    body = body + "<br/><br/>--<br/>" + signature;
                }
            } catch { }

            await unipile.sendEmail({
                accountId,
                to: [
                    {
                        display_name: item.recipient_name,
                        identifier: item.recipient_identifier,
                    },
                ],
                subject: item.subject || "",
                body,
            });
        } else {
            // WHATSAPP / LINKEDIN — identifier is chat_id
            await unipile.sendChatMessage(item.recipient_identifier, item.message_body);
        }
        return { status: "SENT", error: null };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return { status: "FAILED", error: errorMessage };
    }
}

export async function send(id: number, orgId: number, delayMinMs?: number, delayMaxMs?: number) {
    const batch = await findOne(id, orgId);
    if (batch.status === "SENDING")
        throw new BadRequestError("Batch is already being sent");
    if (batch.status === "SENT")
        throw new BadRequestError("Batch has already been sent");

    if (!batch.items || batch.items.length === 0)
        throw new BadRequestError("No items to send. Import a CSV first.");

    // Mark as SENDING
    await db
        .from("personal_messages")
        .update({ status: "SENDING" })
        .eq("id", id);

    const channel = (batch.channel || "EMAIL") as ChannelProtocol;
    const defaultPolicy = createThrottlePolicy(channel);
    const throttlePolicy = {
        minIntervalMs: delayMinMs ?? defaultPolicy.minIntervalMs,
        maxIntervalMs: delayMaxMs ?? defaultPolicy.maxIntervalMs,
        jitterFactor: defaultPolicy.jitterFactor,
    };

    let sentCount = 0;
    let failedCount = 0;
    let isFirst = true;

    console.log(
        `[PersonalBatch ${id}] Starting: "${batch.name}" | channel=${channel} | total=${batch.items.length}`,
    );

    // Fire off in background — don't block the response
    (async () => {
        let dailyLimit: number | null = null;
        try {
            const { data: org } = await db.from("organizations").select("daily_send_limit").eq("id", orgId).single();
            dailyLimit = org?.daily_send_limit ?? null;
        } catch { }

        for (const item of batch.items as PersonalMessageItem[]) {
            // Skip already-sent items on retry
            if (item.status === "SENT") {
                sentCount++;
                continue;
            }

            if (dailyLimit !== null) {
                const todaySent = await getDailySentCount(orgId);
                if (todaySent >= dailyLimit) {
                    console.warn(`[PersonalBatch ${id}] Daily limit reached (${todaySent}/${dailyLimit}). Pausing batch.`);
                    telemetry.record("personal-batch.paused", id, { limit: dailyLimit, sentToday: todaySent });

                    await db.from("personal_messages")
                        .update({ sent: sentCount, failed: failedCount })
                        .eq("id", id);

                    return; // Stop processing this batch loop
                }
            }

            if (!isFirst) {
                await throttledExecution(throttlePolicy);
            }
            isFirst = false;

            console.log(
                `[PersonalBatch ${id}] Sending to ${item.recipient_identifier} (${item.recipient_name})`,
            );

            const result = await dispatchItem(item, channel, batch.account_id, orgId);

            if (result.status === "SENT") {
                sentCount++;
                await db
                    .from("personal_message_items")
                    .update({ status: "SENT", sent_at: new Date().toISOString() })
                    .eq("id", item.id);
            } else {
                failedCount++;
                await db
                    .from("personal_message_items")
                    .update({ status: "FAILED", error: result.error })
                    .eq("id", item.id);
            }

            // Flush progress every 10 items
            if ((sentCount + failedCount) % 10 === 0 || (sentCount + failedCount) >= batch.items!.length) {
                await db
                    .from("personal_messages")
                    .update({ sent: sentCount, failed: failedCount })
                    .eq("id", id);
            }
        }

        const finalStatus =
            failedCount > 0 && sentCount === 0 ? "FAILED" : "SENT";
        await db
            .from("personal_messages")
            .update({ status: finalStatus, sent: sentCount, failed: failedCount })
            .eq("id", id);

        console.log(
            `[PersonalBatch ${id}] Complete: ${sentCount} sent, ${failedCount} failed`,
        );

        telemetry.record("personal-batch.completed", id, {
            sent: sentCount,
            failed: failedCount,
        });
    })().catch((err) => {
        console.error(`[PersonalBatch ${id}] Pipeline error:`, err);
        db.from("personal_messages")
            .update({ status: "FAILED" })
            .eq("id", id)
            .then(() => { });
    });

    return { status: "SENDING", total: batch.items.length };
}

export function startPersonalMessageCron() {
    new Cron("0 * * * *", async () => {
        try {
            const { data: sendingBatches } = await db
                .from("personal_messages")
                .select("id, org_id")
                .eq("status", "SENDING");

            for (const batch of sendingBatches || []) {
                const dailySent = await getDailySentCount(batch.org_id);
                const { data: org } = await db.from("organizations").select("daily_send_limit").eq("id", batch.org_id).single();
                const dailyLimit = org?.daily_send_limit ?? null;

                if (dailyLimit === null || dailySent < dailyLimit) {
                    console.log(`[PersonalBatch Cron] Resuming paused batch ${batch.id}`);
                    try {
                        // Reset status to DRAFT briefly to bypass "Batch is already being sent" check
                        await db.from("personal_messages").update({ status: "DRAFT" }).eq("id", batch.id);
                        await send(batch.id, batch.org_id);
                    } catch (err: any) {
                        console.error(`[PersonalBatch Cron] Failed to resume batch ${batch.id}:`, err.message);
                    }
                }
            }
        } catch (err) {
            console.error("Personal Messages Cron error:", err);
        }
    });

    telemetry.record("orchestrationDaemon.personalMessages.started", "system", {
        schedule: "0 * * * *",
    });
}
