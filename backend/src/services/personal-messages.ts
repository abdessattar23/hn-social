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

// ── In-Memory Batch Logs ───────────────────────────────────────────────

interface BatchLogEntry {
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'success';
    message: string;
}

const batchLogs = new Map<number, BatchLogEntry[]>();

function emitLog(batchId: number, level: BatchLogEntry['level'], message: string) {
    if (!batchLogs.has(batchId)) batchLogs.set(batchId, []);
    const entry = { timestamp: new Date().toISOString(), level, message };
    batchLogs.get(batchId)!.push(entry);
    // Also log to console
    console.log(`[PersonalBatch ${batchId}] [${entry.timestamp}] ${message}`);
}

export function getBatchLogs(batchId: number): BatchLogEntry[] {
    return batchLogs.get(batchId) || [];
}

function cleanupOldLogs() {
    const oneHourAgo = Date.now() - 3600_000;
    for (const [id, logs] of batchLogs.entries()) {
        if (logs.length > 0 && new Date(logs[logs.length - 1].timestamp).getTime() < oneHourAgo) {
            batchLogs.delete(id);
        }
    }
}

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

export async function updateBatchSubject(id: number, subject: string, orgId: number) {
    // Verify batch belongs to org
    const { data: batch, error: findErr } = await db
        .from("personal_messages")
        .select("id")
        .eq("id", id)
        .eq("org_id", orgId)
        .single();
    if (findErr || !batch) throw new NotFoundError("Batch not found");

    const { error, count } = await db
        .from("personal_message_items")
        .update({ subject })
        .eq("personal_message_id", id);
    if (error) throw new BadRequestError(error.message);

    return { updated: count, subject };
}

// ── Application Email Sync ─────────────────────────────────────────────

const ACCEPTANCE_TEMPLATE = (firstName: string) => ({
    subject: "🎉 Congratulations — You're In! | Hack-Nation 5",
    body: `Hi ${firstName},

We're thrilled to inform you that your application to Hack-Nation 5 has been accepted! 🎉

You've been selected from a competitive pool of applicants, and we can't wait to see what you'll build.

Here's what happens next:
• You'll receive a signup code shortly to create your account on our platform
• Join our community channels to connect with other participants
• Start forming your team if you haven't already

If you have any questions, don't hesitate to reach out.

See you at Hack-Nation 5! 🚀

Best regards,
The Hack-Nation Team`,
});

const REJECTION_TEMPLATE = (firstName: string) => ({
    subject: "Your Hack-Nation 5 Application Update",
    body: `Hi ${firstName},

Thank you for your interest in Hack-Nation 5 and for taking the time to apply.

After careful review, we regret to inform you that we are unable to offer you a spot in this edition. This was an incredibly competitive cycle with a record number of applications.

We encourage you to apply again for future events — we'd love to see you participate.

Thank you for your understanding, and we wish you the best in your endeavors.

Best regards,
The Hack-Nation Team`,
});

export async function listHackathonEvents() {
    // Get distinct event numbers from hackathon_applications
    const { data, error } = await db
        .from("hackathon_applications")
        .select("event")
        .not("event", "is", null)
        .order("event", { ascending: false });
    if (error) throw new BadRequestError(error.message);

    const uniqueEvents = [...new Set((data || []).map((d: any) => d.event).filter(Boolean))];
    return uniqueEvents.map((e: number) => ({ id: e, label: `Hack-Nation ${e}` }));
}

export async function syncFromApplications(
    statusValue: string,
    statusField: "pre_status" | "status",
    accountId: string,
    orgId: number,
    userId: string,
    eventId?: number,
) {
    // Verify account
    const { data: account } = await db
        .from("connected_accounts")
        .select("id")
        .eq("unipile_account_id", accountId)
        .eq("org_id", orgId)
        .maybeSingle();
    if (!account) throw new BadRequestError("Account not connected to your organization");

    // Fetch applications
    let query = db
        .from("hackathon_applications")
        .select("id, first_name, last_name, email, event")
        .eq(statusField, statusValue);

    if (eventId) {
        query = query.eq("event", eventId);
    }

    const { data: applications, error: fetchErr } = await query;

    if (fetchErr) throw new BadRequestError(fetchErr.message);
    if (!applications || applications.length === 0) {
        throw new BadRequestError(`No applications found with ${statusField} = '${statusValue}'${eventId ? ` and event = ${eventId}` : ''}`);
    }

    const isAccepted = statusValue === "pre_accepted" || statusValue === "accepted";
    const label = isAccepted ? "Accepted" : "Rejected";
    const eventLabel = eventId ? `HN${eventId}` : "HN";
    const batchName = `${eventLabel} ${label} — ${new Date().toLocaleDateString("en-GB")}`;

    // Create batch
    const { data: batch, error: batchErr } = await db
        .from("personal_messages")
        .insert({
            name: batchName,
            channel: "EMAIL",
            account_id: accountId,
            org_id: orgId,
            user_id: userId,
        })
        .select()
        .single();
    if (batchErr) throw new BadRequestError(batchErr.message);

    // Generate items
    const templateFn = isAccepted ? ACCEPTANCE_TEMPLATE : REJECTION_TEMPLATE;
    const items = applications.map((app: any) => {
        const firstName = app.first_name || "Applicant";
        const tmpl = templateFn(firstName);
        return {
            personal_message_id: batch.id,
            recipient_name: `${app.first_name || ""} ${app.last_name || ""}`.trim() || app.email,
            recipient_identifier: app.email,
            message_body: tmpl.body,
            subject: tmpl.subject,
            status: "PENDING",
        };
    });

    const { error: insertErr } = await db
        .from("personal_message_items")
        .insert(items);
    if (insertErr) throw new BadRequestError(insertErr.message);

    // Update total
    await db
        .from("personal_messages")
        .update({ total: items.length })
        .eq("id", batch.id);

    telemetry.record("personal-batch.synced", batch.id, {
        statusField,
        statusValue,
        count: items.length,
    });

    return { ...batch, total: items.length, itemCount: items.length };
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

    // Auto-resolve names to chat IDs for Unipile
    if (batch.channel === "WHATSAPP" || batch.channel === "LINKEDIN") {
        try {
            const chatsData = await unipile.listAllChats(batch.channel);
            const chats = chatsData.items || [];

            const chatMap = new Map<string, string>();
            for (const c of chats as any[]) {
                if (c.name) {
                    // STRICT: Only use chats from the active account to avoid
                    // 401 errors from disconnected session chat IDs
                    if (c.account_id !== batch.account_id) continue;
                    const nameKey = c.name.trim().toLowerCase();
                    chatMap.set(nameKey, c.id);
                }
            }

            for (const item of items) {
                const ident = item.recipient_identifier.trim().toLowerCase();
                const nameIdent = item.recipient_name.trim().toLowerCase();

                if (chatMap.has(ident)) {
                    item.recipient_identifier = chatMap.get(ident)!;
                } else if (chatMap.has(nameIdent)) {
                    item.recipient_identifier = chatMap.get(nameIdent)!;
                }
            }
        } catch (err) {
            console.error("Failed to preload chats for ID resolution:", err);
        }
    }

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
                subject: item.subject || "(No Subject)",
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

export async function send(id: number, orgId: number, delayMinMs?: number, delayMaxMs?: number, excludeItemIds?: number[], emergencyMode?: boolean) {
    const batch = await findOne(id, orgId);
    if (batch.status === "SENDING")
        throw new BadRequestError("Batch is already being sent");
    if (batch.status === "SENT")
        throw new BadRequestError("Batch has already been sent");

    if (!batch.items || batch.items.length === 0)
        throw new BadRequestError("No items to send. Import a CSV first.");

    // Delete excluded items if any
    if (excludeItemIds && excludeItemIds.length > 0) {
        await db.from("personal_message_items")
            .delete()
            .eq("personal_message_id", id)
            .in("id", excludeItemIds);

        batch.items = batch.items.filter((i: any) => !excludeItemIds.includes(i.id));
        const newTotal = batch.items.length;

        await db.from("personal_messages").update({ total: newTotal }).eq("id", id);
    }

    if (batch.items.length === 0) {
        throw new BadRequestError("No items left to send after exclusions.");
    }

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

    emitLog(id, 'info', `Starting batch "${batch.name}" | channel=${channel} | items=${batch.items.length}`);
    if (emergencyMode) emitLog(id, 'warn', '⚡ EMERGENCY MODE — all delays and limits bypassed');

    // Fire off in background — don't block the response
    (async () => {
        let dailyLimit: number | null = null;
        try {
            const { data: org } = await db.from("organizations").select("daily_send_limit").eq("id", orgId).single();
            dailyLimit = org?.daily_send_limit ?? null;
            if (dailyLimit && !emergencyMode) emitLog(id, 'info', `Daily send limit: ${dailyLimit}`);
        } catch { }

        for (const item of batch.items as PersonalMessageItem[]) {
            // Skip already-sent items on retry
            if (item.status === "SENT") {
                sentCount++;
                continue;
            }

            if (!emergencyMode && dailyLimit !== null) {
                const todaySent = await getDailySentCount(orgId);
                if (todaySent >= dailyLimit) {
                    emitLog(id, 'warn', `Daily limit reached (${todaySent}/${dailyLimit}). Pausing batch.`);
                    telemetry.record("personal-batch.paused", id, { limit: dailyLimit, sentToday: todaySent });

                    await db.from("personal_messages")
                        .update({ sent: sentCount, failed: failedCount })
                        .eq("id", id);

                    return;
                }
            }

            if (!isFirst && !emergencyMode) {
                const delay = throttlePolicy.minIntervalMs + Math.random() * (throttlePolicy.maxIntervalMs - throttlePolicy.minIntervalMs);
                emitLog(id, 'info', `Waiting ${(delay / 1000).toFixed(1)}s before next message...`);
                await throttledExecution(throttlePolicy);
            }
            isFirst = false;

            emitLog(id, 'info', `Sending to ${item.recipient_name} (${item.recipient_identifier.substring(0, 12)}...)`);

            const result = await dispatchItem(item, channel, batch.account_id, orgId);

            if (result.status === "SENT") {
                sentCount++;
                emitLog(id, 'success', `✓ Delivered to ${item.recipient_name}`);
                await db
                    .from("personal_message_items")
                    .update({ status: "SENT", sent_at: new Date().toISOString() })
                    .eq("id", item.id);
            } else {
                failedCount++;
                emitLog(id, 'error', `✗ Failed: ${item.recipient_name} — ${result.error}`);
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

        emitLog(id, sentCount > 0 ? 'success' : 'error', `Batch complete: ${sentCount} sent, ${failedCount} failed`);
        cleanupOldLogs();

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
