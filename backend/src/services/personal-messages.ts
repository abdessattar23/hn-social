import { db } from "../db/client";
import { NotFoundError, BadRequestError } from "../lib/errors";
import { deleteUpload, saveUpload } from "../lib/upload";
import type { AssetManifest } from "../lib/upload";
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
    sync_target_status: string | null;
    attachments: AssetManifest[];
}

type RawPersonalMessageBatch = Omit<PersonalMessageBatch, "attachments">;

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
    application_id: string | null;
}

const ATTACHMENT_TEMPLATE_PREFIX = "sys-pm-attachments:";
const ATTACHMENT_TEMPLATE_TAG = "system:personal-batch-attachments";

function normalizeAttachments(attachments: unknown): AssetManifest[] {
    if (!Array.isArray(attachments)) return [];

    return attachments.flatMap((attachment) => {
        if (!attachment || typeof attachment !== "object") return [];

        const candidate = attachment as Partial<AssetManifest>;
        if (
            typeof candidate.filename !== "string" ||
            typeof candidate.originalName !== "string" ||
            typeof candidate.path !== "string" ||
            typeof candidate.mimeType !== "string"
        ) {
            return [];
        }

        return [{
            filename: candidate.filename,
            originalName: candidate.originalName,
            path: candidate.path,
            mimeType: candidate.mimeType,
        }];
    });
}

function normalizeBatchRecord<T extends { attachments?: unknown }>(
    batch: T,
): Omit<T, "attachments"> & { attachments: AssetManifest[] } {
    const { attachments, ...rest } = batch;
    return {
        ...rest,
        attachments: normalizeAttachments(attachments),
    };
}

function buildAttachmentTemplateName(batchId: number): string {
    return `${ATTACHMENT_TEMPLATE_PREFIX}${batchId}`;
}

function buildAttachmentTemplateTags(batchId: number): string[] {
    return [
        ATTACHMENT_TEMPLATE_TAG,
        `${ATTACHMENT_TEMPLATE_PREFIX}${batchId}`,
    ];
}

function extractBatchIdFromTemplateName(name: string): number | null {
    if (!name.startsWith(ATTACHMENT_TEMPLATE_PREFIX)) return null;
    const rawId = name.slice(ATTACHMENT_TEMPLATE_PREFIX.length);
    const parsed = Number(rawId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadAttachmentMap(
    orgId: number,
): Promise<Map<number, AssetManifest[]>> {
    const { data, error } = await db
        .from("message_templates")
        .select("name, attachments")
        .eq("org_id", orgId)
        .like("name", `${ATTACHMENT_TEMPLATE_PREFIX}%`);
    if (error) throw new BadRequestError(error.message);

    const map = new Map<number, AssetManifest[]>();
    for (const row of data || []) {
        const batchId = extractBatchIdFromTemplateName(String(row.name || ""));
        if (!batchId) continue;
        map.set(batchId, normalizeAttachments(row.attachments));
    }
    return map;
}

async function findAttachmentTemplate(batchId: number, orgId: number) {
    const { data, error } = await db
        .from("message_templates")
        .select("id, attachments")
        .eq("org_id", orgId)
        .eq("name", buildAttachmentTemplateName(batchId))
        .maybeSingle();
    if (error) throw new BadRequestError(error.message);
    return data
        ? {
            id: Number(data.id),
            attachments: normalizeAttachments(data.attachments),
        }
        : null;
}

async function writeAttachmentTemplate(
    batch: RawPersonalMessageBatch,
    attachments: AssetManifest[],
) {
    const existing = await findAttachmentTemplate(batch.id, batch.org_id);

    if (attachments.length === 0) {
        if (existing) {
            const { error } = await db
                .from("message_templates")
                .delete()
                .eq("id", existing.id)
                .eq("org_id", batch.org_id);
            if (error) throw new BadRequestError(error.message);
        }
        return;
    }

    if (existing) {
        const { error } = await db
            .from("message_templates")
            .update({ attachments })
            .eq("id", existing.id)
            .eq("org_id", batch.org_id);
        if (error) throw new BadRequestError(error.message);
        return;
    }

    const { error } = await db
        .from("message_templates")
        .insert({
            name: buildAttachmentTemplateName(batch.id),
            type: batch.channel,
            subject: null,
            body: "Internal attachment store",
            org_id: batch.org_id,
            user_id: batch.user_id,
            attachments,
            tags: buildAttachmentTemplateTags(batch.id),
        });
    if (error) throw new BadRequestError(error.message);
}

async function purgeBatchAttachmentStore(
    batchId: number,
    orgId: number,
): Promise<void> {
    const existing = await findAttachmentTemplate(batchId, orgId);
    if (!existing) return;

    if (existing.attachments.length > 0) {
        await purgeAttachmentAssets(existing.attachments);
    }

    const { error } = await db
        .from("message_templates")
        .delete()
        .eq("id", existing.id)
        .eq("org_id", orgId);
    if (error) throw new BadRequestError(error.message);
}

async function materializeBatchRecord(
    id: number,
    orgId: number,
): Promise<PersonalMessageBatch> {
    const { data, error } = await db
        .from("personal_messages")
        .select("*")
        .eq("id", id)
        .eq("org_id", orgId)
        .single();
    if (error || !data) throw new NotFoundError("Personal message batch not found");
    const attachmentTemplate = await findAttachmentTemplate(id, orgId);
    return normalizeBatchRecord({
        ...(data as RawPersonalMessageBatch),
        attachments: attachmentTemplate?.attachments || [],
    });
}

async function purgeAttachmentAssets(
    attachments: AssetManifest[],
): Promise<void> {
    for (const attachment of attachments) {
        await deleteUpload(attachment.path);
    }
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
    const attachmentMap = await loadAttachmentMap(orgId);
    return (data || []).map((row) =>
        normalizeBatchRecord({
            ...(row as RawPersonalMessageBatch),
            attachments: attachmentMap.get(Number(row.id)) || [],
        }),
    );
}

export async function findOne(id: number, orgId: number) {
    const batch = await materializeBatchRecord(id, orgId);
    const { data: items, error: itemsErr } = await db
        .from("personal_message_items")
        .select("*")
        .eq("personal_message_id", id)
        .order("id", { ascending: true });
    if (itemsErr) throw new BadRequestError(itemsErr.message);

    return { ...batch, items: items || [] };
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
    return normalizeBatchRecord({
        ...(batch as RawPersonalMessageBatch),
        attachments: [],
    });
}

export async function remove(id: number, orgId: number) {
    const batch = await materializeBatchRecord(id, orgId);

    await purgeBatchAttachmentStore(id, orgId);

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
    await materializeBatchRecord(id, orgId);

    const { error, count } = await db
        .from("personal_message_items")
        .update({ subject })
        .eq("personal_message_id", id);
    if (error) throw new BadRequestError(error.message);

    return { updated: count, subject };
}

export async function addAttachment(id: number, orgId: number, file: File) {
    const batch = await materializeBatchRecord(id, orgId);
    if (batch.status !== "DRAFT" && batch.status !== "FAILED") {
        throw new BadRequestError("Attachments can only be changed while the batch is in DRAFT or FAILED");
    }

    const saved = await saveUpload(file);
    const attachments = [
        ...batch.attachments,
        {
            filename: saved.filename,
            originalName: saved.originalName,
            path: saved.path,
            mimeType: saved.mimeType,
        },
    ];

    try {
        await writeAttachmentTemplate(batch, attachments);
    } catch (error) {
        await deleteUpload(saved.path).catch(() => { });
        throw error;
    }

    return findOne(id, orgId);
}

export async function removeAttachment(
    id: number,
    orgId: number,
    filename: string,
) {
    const batch = await materializeBatchRecord(id, orgId);
    if (batch.status !== "DRAFT" && batch.status !== "FAILED") {
        throw new BadRequestError("Attachments can only be changed while the batch is in DRAFT or FAILED");
    }

    const targetAttachment = batch.attachments.find(
        (attachment) => attachment.filename === filename,
    );
    if (!targetAttachment) {
        return findOne(id, orgId);
    }

    await deleteUpload(targetAttachment.path);

    const attachments = batch.attachments.filter(
        (attachment) => attachment.filename !== filename,
    );
    await writeAttachmentTemplate(batch, attachments);

    return findOne(id, orgId);
}

// ── Hackathon Events (date-based) ──────────────────────────────────────

interface HackathonEvent {
    id: number;
    label: string;
    startDate: string;   // ISO date, inclusive
    endDate: string | null; // ISO date, inclusive — null means "ongoing / now"
}

const HACKATHON_EVENTS: readonly HackathonEvent[] = [
    { id: 5, label: "Hack-Nation 5", startDate: "2026-02-08", endDate: null },
];

function resolveEvent(eventId: number): HackathonEvent | undefined {
    return HACKATHON_EVENTS.find((e) => e.id === eventId);
}

// ── Admission Batches (date-range cohorts from comms plan) ─────────────

interface AdmissionBatch {
    number: number;
    label: string;
    applicationStart: string;  // ISO date, inclusive
    commsDeadline: string;     // ISO date, inclusive
}

const ADMISSION_BATCHES: readonly AdmissionBatch[] = [
    { number: 1, label: "Batch 1", applicationStart: "2026-02-20", commsDeadline: "2026-02-27" },
    { number: 2, label: "Batch 2", applicationStart: "2026-03-06", commsDeadline: "2026-03-13" },
    { number: 3, label: "Batch 3", applicationStart: "2026-03-18", commsDeadline: "2026-03-25" },
    { number: 4, label: "Batch 4", applicationStart: "2026-03-28", commsDeadline: "2026-04-04" },
    { number: 5, label: "Batch 5", applicationStart: "2026-04-11", commsDeadline: "2026-04-18" },
    { number: 6, label: "Batch 6", applicationStart: "2026-04-17", commsDeadline: "2026-04-19" },
];

export function listAdmissionBatches() {
    return ADMISSION_BATCHES.map((b) => ({
        number: b.number,
        label: b.label,
        applicationStart: b.applicationStart,
        commsDeadline: b.commsDeadline,
    }));
}

// ── Pagination helpers (Supabase caps at 1 000 rows) ───────────────────

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(baseQuery: any): Promise<T[]> {
    const rows: T[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await baseQuery.range(from, from + PAGE_SIZE - 1);
        if (error) throw new BadRequestError(error.message);
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return rows;
}

// ── Application Email Sync ─────────────────────────────────────────────

const PERSONAL_REFERRAL_CODE_PREFIX = "Hack-with-";
const PERSONAL_REFERRAL_CODE_MIN_SUFFIX = 1000;
const PERSONAL_REFERRAL_CODE_MAX_SUFFIX = 9999;
const PERSONAL_REFERRAL_CODE_ATTEMPTS = 100;

function normalizePersonalReferralCode(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function buildPersonalReferralStem(firstName: string): string {
    const cleaned = firstName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "")
        .toLowerCase();

    if (!cleaned) return "Applicant";
    return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

function generatePersonalReferralCode(firstName: string, usedCodes: Set<string>): string {
    const stem = buildPersonalReferralStem(firstName);

    for (let attempt = 0; attempt < PERSONAL_REFERRAL_CODE_ATTEMPTS; attempt += 1) {
        const suffix = Math.floor(
            Math.random() * (PERSONAL_REFERRAL_CODE_MAX_SUFFIX - PERSONAL_REFERRAL_CODE_MIN_SUFFIX + 1),
        ) + PERSONAL_REFERRAL_CODE_MIN_SUFFIX;
        const candidate = `${PERSONAL_REFERRAL_CODE_PREFIX}${stem}-${suffix}`;

        if (!usedCodes.has(candidate)) {
            return candidate;
        }
    }

    throw new BadRequestError(`Could not generate unique referral code for ${firstName || "applicant"}`);
}

interface ApplicationRow {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    personal_referral_code: string | null;
}

async function ensurePersonalReferralCodes(applications: ApplicationRow[]): Promise<Map<string, string>> {
    const codesByApplicationId = new Map<string, string>();
    const missing = applications.filter((application) => {
        const existing = normalizePersonalReferralCode(application.personal_referral_code);
        if (existing) {
            codesByApplicationId.set(application.id, existing);
            return false;
        }
        return true;
    });

    if (missing.length === 0) return codesByApplicationId;

    const { data: existingRows, error } = await db
        .from("hackathon_applications")
        .select("personal_referral_code")
        .not("personal_referral_code", "is", null);
    if (error) throw new BadRequestError(error.message);

    const usedCodes = new Set<string>();
    for (const row of existingRows || []) {
        const code = normalizePersonalReferralCode((row as { personal_referral_code?: string | null }).personal_referral_code);
        if (code) usedCodes.add(code);
    }

    const updates = missing.map((application) => {
        const generated = generatePersonalReferralCode(application.first_name, usedCodes);
        usedCodes.add(generated);
        codesByApplicationId.set(application.id, generated);
        return {
            id: application.id,
            code: generated,
        };
    });

    for (const update of updates) {
        const { error: updateError } = await db
            .from("hackathon_applications")
            .update({ personal_referral_code: update.code })
            .eq("id", update.id);
        if (updateError) throw new BadRequestError(updateError.message);
    }

    return codesByApplicationId;
}

const ACCEPTANCE_TEMPLATE = (firstName: string, _eventName: string, referralCode: string) => ({
    subject: "Congratulations - You're In! | 5th Hack-Nation Global AI Hackathon",
    body: `<p>Dear ${firstName},</p>
<p>Congratulations - you've been selected to join the <span style="color:#c62828;font-weight:700;">5th Hack-Nation Global AI Hackathon</span>, hosted in collaboration with the <strong>MIT Sloan AI Club</strong>, taking place April 25-26, 2026, <strong>both virtually and in person at several local hubs</strong>.</p>
<p><strong>Start: April 25, 11:00 AM Boston time (ET)</strong><br/>
Local meetups will begin earlier so participants can get to know each other before the kick-off.<br/>
<strong>Agenda:</strong> <a href="http://hack-nation.ai">hack-nation.ai</a><br/>
<strong>Info slide deck:</strong> <a href="https://drive.google.com/file/d/1WW485XOMrPW_WKt2QbpKl2t7ap_d4VNN/view">Download the slide deck</a><br/>
<strong>Local hubs:</strong> MIT, Stanford, Oxford, ETH Zurich, Munich, and more.<br/>
We'll share the finalized hub list and instructions on how to join in the next email.<br/>
<strong>On April 10,</strong> we will send out confirmations indicating whether we can offer you an in-person spot at one of our hubs or whether you will be waitlisted for the hub.<br/>
<strong>In any case, you are already accepted to participate online</strong>, so you will definitely be able to join the hackathon.<br/>
<strong>Zoom link for the kick-off:</strong> will be sent shortly before the event via email.</p>
<p><strong>Three actions required:</strong></p>
<ol>
<li><strong>Please RSVP on Luma by Sunday, March 15, to secure your spot:</strong> <a href="https://luma.com/7v8s6xlw?coupon=0LPLM2">RSVP on Luma</a>.<br/>
When registering, please use your <strong>private access code: 0LPLM2</strong>.<br/>
<em>Please keep this code private and do not share it with others.</em></li>
<li><strong>Download</strong> the image to share and celebrate your acceptance <strong>on social media</strong>. Tag us on <a href="https://www.linkedin.com/company/hack-nation">LinkedIn</a> or <a href="https://www.instagram.com/hacknation.globalai/">Instagram</a>.</li>
<li><strong>Refer</strong> cracked AI builders - your referral code: <strong>${referralCode}</strong>.</li>
</ol>
<p><strong>What's at stake:</strong></p>
<ul>
<li><strong>$30k+ in API credits and cash prizes.</strong></li>
<li><strong>$150k+ API credits available during Hack.</strong></li>
<li>Winning teams may be selected for the <strong>venture track</strong> to launch their AI startup, run in collaboration with EWOR, one of Europe's leading startup builders.</li>
</ul>
<p><strong>No idea is required beforehand - the AI challenges will be revealed on hackathon day.</strong> We'll send more details soon about keynotes, challenge tracks, and how to make the most of the experience.</p>
<p>Have an amazing week and see you soon!</p>
<p>Linn &amp; the Hack-Nation Team</p>
<p>--<br/>
Linn Bieske<br/>
MIT Leaders for Global Operations (LGO) Fellow<br/>
MBA/MS Electrical Engineering &amp; Computer Science<br/>
Mobile: +1 857 867 0556<br/>
<a href="mailto:lbieske@mit.edu">lbieske@mit.edu</a><br/>
<a href="https://www.linkedin.com/in/linn-bieske-189b9b138/">LinkedIn</a></p>`,
});

const REJECTION_TEMPLATE = (firstName: string, eventName: string) => ({
    subject: `Your ${eventName} Application Update`,
    body: `Hi ${firstName},

Thank you for your interest in ${eventName} and for taking the time to apply.

After careful review, we regret to inform you that we are unable to offer you a spot in this edition. This was an incredibly competitive cycle with a record number of applications.

We encourage you to apply again for future events — we'd love to see you participate.

Thank you for your understanding, and we wish you the best in your endeavors.

Best regards,
The Hack-Nation Team`,
});

export function listHackathonEvents() {
    return HACKATHON_EVENTS.map((e) => ({
        id: e.id,
        label: e.label,
        startDate: e.startDate,
        endDate: e.endDate,
    }));
}

export async function syncFromApplications(
    statusValue: string,
    statusField: "pre_status" | "status",
    accountId: string,
    orgId: number,
    userId: string,
    eventId?: number,
    batchNumbers?: number[],
) {
    console.log(`[SyncApplications] Starting sync | statusField=${statusField} statusValue=${statusValue} accountId=${accountId} orgId=${orgId} eventId=${eventId} batchNumbers=${JSON.stringify(batchNumbers)}`);

    // Verify account
    const { data: account } = await db
        .from("connected_accounts")
        .select("id")
        .eq("unipile_account_id", accountId)
        .eq("org_id", orgId)
        .maybeSingle();
    if (!account) throw new BadRequestError("Account not connected to your organization");

    // Resolve event for date filtering and template naming
    const event = eventId ? resolveEvent(eventId) : undefined;
    if (eventId && !event) throw new BadRequestError(`Unknown event id: ${eventId}`);

    // Resolve selected admission batches
    const selectedBatches = batchNumbers && batchNumbers.length > 0
        ? ADMISSION_BATCHES.filter((b) => batchNumbers.includes(b.number))
        : [];

    let applications: ApplicationRow[];
    if (selectedBatches.length > 0) {
        const batchResults = await Promise.all(
            selectedBatches.map((batch) => {
                const q = db
                    .from("hackathon_applications")
                    .select("id, first_name, last_name, email, personal_referral_code")
                    .eq(statusField, statusValue)
                    .gte("timestamp", `${batch.applicationStart}T00:00:00.000Z`)
                    .lte("timestamp", `${batch.commsDeadline}T23:59:59.999Z`);
                return fetchAllRows<ApplicationRow>(q);
            }),
        );
        const seen = new Set<string>();
        applications = [];
        for (const rows of batchResults) {
            for (const row of rows) {
                if (!seen.has(row.id)) {
                    seen.add(row.id);
                    applications.push(row);
                }
            }
        }
    } else {
        // No batch filter — use event date range (original behavior)
        let query = db
            .from("hackathon_applications")
            .select("id, first_name, last_name, email, personal_referral_code")
            .eq(statusField, statusValue);

        if (event) {
            query = query.gte("timestamp", `${event.startDate}T00:00:00.000Z`);
            const upper = event.endDate ?? new Date().toISOString().split("T")[0];
            query = query.lte("timestamp", `${upper}T23:59:59.999Z`);
        }

        applications = await fetchAllRows<ApplicationRow>(query);
    }
    console.log(`[SyncApplications] Fetched ${applications.length} applications`);
    if (applications.length > 0) {
        console.log(`[SyncApplications] Sample app:`, JSON.stringify(applications[0]));
    }

    if (applications.length === 0) {
        const range = event ? ` between ${event.startDate} and ${event.endDate ?? "now"}` : "";
        throw new BadRequestError(`No applications found with ${statusField} = '${statusValue}'${range}`);
    }

    const eventName = event?.label ?? "Hack-Nation";
    const isAccepted = statusValue === "pre_accepted" || statusValue === "accepted";
    const label = isAccepted ? "Accepted" : "Rejected";
    const shortLabel = event ? `HN${event.id}` : "HN";
    const batchSuffix = selectedBatches.length > 0
        ? ` B${selectedBatches.map((b) => b.number).join("+")}`
        : "";
    const batchName = `${shortLabel} ${label}${batchSuffix} — ${new Date().toLocaleDateString("en-GB")}`;

    // Derive the target status to apply on hackathon_applications after send
    const syncTargetStatus = isAccepted ? "accepted" : "rejected";
    console.log(`[SyncApplications] isAccepted=${isAccepted} syncTargetStatus=${syncTargetStatus} batchName=${batchName}`);

    // Create batch
    const { data: batch, error: batchErr } = await db
        .from("personal_messages")
        .insert({
            name: batchName,
            channel: "EMAIL",
            account_id: accountId,
            org_id: orgId,
            user_id: userId,
            sync_target_status: syncTargetStatus,
        })
        .select()
        .single();
    if (batchErr) {
        console.error(`[SyncApplications] Batch creation failed:`, batchErr.message);
        throw new BadRequestError(batchErr.message);
    }
    console.log(`[SyncApplications] Batch created: id=${batch.id} sync_target_status=${batch.sync_target_status}`);

    const referralCodesByApplicationId = isAccepted
        ? await ensurePersonalReferralCodes(applications)
        : new Map<string, string>();

    // Generate items with dynamic event name in templates
    const items = applications.map((app) => {
        const firstName = app.first_name || "Applicant";
        const referralCode = referralCodesByApplicationId.get(app.id);
        if (isAccepted && !referralCode) {
            throw new BadRequestError(`Missing personal referral code for application ${app.id}`);
        }
        const tmpl = isAccepted
            ? ACCEPTANCE_TEMPLATE(
                firstName,
                eventName,
                referralCode!,
            )
            : REJECTION_TEMPLATE(firstName, eventName);
        return {
            personal_message_id: batch.id,
            recipient_name: `${app.first_name || ""} ${app.last_name || ""}`.trim() || app.email,
            recipient_identifier: app.email,
            message_body: tmpl.body,
            subject: tmpl.subject,
            status: "PENDING",
            application_id: app.id,
        };
    });

    console.log(`[SyncApplications] Generated ${items.length} items. Sample:`, JSON.stringify({ application_id: items[0]?.application_id, recipient: items[0]?.recipient_identifier }));

    for (let i = 0; i < items.length; i += PAGE_SIZE) {
        const chunk = items.slice(i, i + PAGE_SIZE);
        console.log(`[SyncApplications] Inserting chunk ${i / PAGE_SIZE + 1} (${chunk.length} items)`);
        const { error: insertErr } = await db
            .from("personal_message_items")
            .insert(chunk);
        if (insertErr) {
            console.error(`[SyncApplications] Insert failed:`, insertErr.message);
            throw new BadRequestError(insertErr.message);
        }
    }

    // Update total
    await db
        .from("personal_messages")
        .update({ total: items.length })
        .eq("id", batch.id);

    telemetry.record("personal-batch.synced", batch.id, {
        statusField,
        statusValue,
        eventId: event?.id,
        count: items.length,
    });

    return normalizeBatchRecord({
        ...(batch as RawPersonalMessageBatch),
        attachments: [],
        total: items.length,
        itemCount: items.length,
    });
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

// In-memory abort flags for stopping batch sends
const abortFlags = new Map<number, boolean>();

export function stopBatch(id: number) {
    abortFlags.set(id, true);
    emitLog(id, 'warn', '🛑 STOP requested — halting after current message...');
}

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
    attachmentPaths: string[],
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
                attachmentPaths,
            });
        } else {
            // WHATSAPP / LINKEDIN — identifier is chat_id
            await unipile.sendChatMessage(
                item.recipient_identifier,
                item.message_body,
                attachmentPaths,
            );
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
    const attachmentPaths = batch.attachments.map((attachment) => attachment.path);
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

    // Clear any previous abort flag
    abortFlags.delete(id);

    // Fire off in background — don't block the response
    (async () => {
        let dailyLimit: number | null = null;
        try {
            const { data: org } = await db.from("organizations").select("daily_send_limit").eq("id", orgId).single();
            dailyLimit = org?.daily_send_limit ?? null;
            if (dailyLimit && !emergencyMode) emitLog(id, 'info', `Daily send limit: ${dailyLimit}`);
        } catch { }

        for (const item of batch.items as PersonalMessageItem[]) {
            // Check abort flag
            if (abortFlags.get(id)) {
                emitLog(id, 'warn', `🛑 Batch stopped by user. ${sentCount} sent, ${failedCount} failed.`);
                abortFlags.delete(id);
                await db.from("personal_messages")
                    .update({ status: "DRAFT", sent: sentCount, failed: failedCount })
                    .eq("id", id);
                telemetry.record("personal-batch.stopped", id, { sent: sentCount, failed: failedCount });
                return;
            }

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

            const result = await dispatchItem(
                item,
                channel,
                batch.account_id,
                orgId,
                attachmentPaths,
            );

            if (result.status === "SENT") {
                sentCount++;
                emitLog(id, 'success', `✓ Delivered to ${item.recipient_name}`);
                await db
                    .from("personal_message_items")
                    .update({ status: "SENT", sent_at: new Date().toISOString() })
                    .eq("id", item.id);

                // Update hackathon_applications status if this item was synced from applications
                console.log(`[PersonalBatch ${id}] Item ${item.id}: application_id=${item.application_id} sync_target_status=${(batch as PersonalMessageBatch).sync_target_status}`);
                if (item.application_id && (batch as PersonalMessageBatch).sync_target_status) {
                    const targetStatus = (batch as PersonalMessageBatch).sync_target_status;
                    console.log(`[PersonalBatch ${id}] Updating hackathon_applications id=${item.application_id} → status=${targetStatus}`);
                    const { error: appUpdateErr, data: appUpdateData } = await db
                        .from("hackathon_applications")
                        .update({ status: targetStatus })
                        .eq("id", item.application_id)
                        .select("id, status");
                    if (appUpdateErr) {
                        console.error(`[PersonalBatch ${id}] Application update FAILED:`, appUpdateErr.message);
                        emitLog(id, 'warn', `Failed to update application ${item.application_id} status: ${appUpdateErr.message}`);
                    } else {
                        console.log(`[PersonalBatch ${id}] Application update SUCCESS:`, JSON.stringify(appUpdateData));
                        emitLog(id, 'info', `Updated application ${item.application_id} status → ${targetStatus}`);
                    }
                } else {
                    console.log(`[PersonalBatch ${id}] Skipping application update — no application_id or sync_target_status`);
                }
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
