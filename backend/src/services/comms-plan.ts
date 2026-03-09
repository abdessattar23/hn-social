import { db } from "../db/client";
import { BadRequestError } from "../lib/errors";

// ── Journey Steps Configuration ────────────────────────────────────────

export interface JourneyStep {
    code: string;
    key: string;
    order: number;
    label: string;
    content: string;
    templateType: "bulk" | "personal";
    who: string;
    globalLuma: "Yes" | "-";
}

export const BATCH_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
export type BatchNumber = (typeof BATCH_NUMBERS)[number];

interface BatchDeadlineConfig {
    label: string;
    applicationDeadline: string;
    commsDecisionDate: string;
}

const HACKATHON_DATE = "2026-04-25";
const HUB_PRIO_CUTOFF_DATE = "2026-04-10";

const BATCH_DEADLINES: Record<BatchNumber, BatchDeadlineConfig> = {
    1: { label: "Batch 1", applicationDeadline: "2026-02-20", commsDecisionDate: "2026-02-27" },
    2: { label: "Batch 2", applicationDeadline: "2026-03-06", commsDecisionDate: "2026-03-13" },
    3: { label: "Batch 3", applicationDeadline: "2026-03-18", commsDecisionDate: "2026-03-25" },
    4: { label: "Batch 4", applicationDeadline: "2026-03-28", commsDecisionDate: "2026-04-04" },
    5: { label: "Batch 5", applicationDeadline: "2026-04-11", commsDecisionDate: "2026-04-18" },
    6: { label: "Batch 6", applicationDeadline: "2026-04-17", commsDecisionDate: "2026-04-19" },
};

export const JOURNEY_STEPS: readonly JourneyStep[] = [
    { code: "1a", key: "accepted", order: 1, label: "Accepted", content: "Information about Status - Accepted + Referral Link", templateType: "bulk", who: "All pre-accepted", globalLuma: "Yes" },
    { code: "1b", key: "rejected", order: 2, label: "Rejected", content: "Information about Status - Rejected", templateType: "bulk", who: "All pre-rejected", globalLuma: "-" },
    { code: "2", key: "waitlist", order: 3, label: "Whitelist", content: "Anti-Spam - Whitelist Main-Emails", templateType: "personal", who: "All pre-accepted", globalLuma: "-" },
    { code: "3", key: "symposium", order: 4, label: "Signupcode", content: "Sign-up code for platform, ask to register for hub and select team", templateType: "personal", who: "All accepted", globalLuma: "Yes" },
    { code: "4", key: "speaker", order: 5, label: "Speaker", content: "Announce speakers + Referral Link", templateType: "bulk", who: "All accepted", globalLuma: "-" },
    { code: "5", key: "sponsors", order: 6, label: "Sponsors", content: "Announce sponsors", templateType: "bulk", who: "All accepted", globalLuma: "-" },
    { code: "6a", key: "no_hub_confirm", order: 7, label: "Hub_confirm", content: "Invitation to your hub", templateType: "personal", who: "All accepted_hubprio", globalLuma: "-" },
    { code: "6b", key: "hub_waitlist", order: 8, label: "Hub_waitlist", content: "Info that you've been waitlisted", templateType: "bulk", who: "All accepted_noprio", globalLuma: "-" },
    { code: "7", key: "hub_waitlist_confirm", order: 9, label: "Hub_waitlist_confirm", content: "Info that you've been accepted off waitlist", templateType: "personal", who: "All accepted_noprio", globalLuma: "-" },
    { code: "8", key: "last_info_mail", order: 10, label: "Last Info Mail", content: "Last info mail about zoom, discord etc.", templateType: "bulk", who: "All accepted", globalLuma: "-" },
    { code: "9", key: "sequel_hour", order: 11, label: "Seeyouin1hour", content: "Reminder to join zoom in one hour", templateType: "bulk", who: "All accepted", globalLuma: "-" },
    { code: "10", key: "deadline", order: 12, label: "Deadline", content: "Deadline reminder", templateType: "bulk", who: "All accepted", globalLuma: "-" },
    { code: "11", key: "comeback2", order: 13, label: "Comebackat2", content: "Reminder to come back to the pitches", templateType: "bulk", who: "All accepted", globalLuma: "-" },
    { code: "12", key: "thank_you", order: 14, label: "Thank you", content: "Thank you and feedback survey + social", templateType: "bulk", who: "All accepted", globalLuma: "-" },
    { code: "13", key: "prizes", order: 15, label: "Prizes", content: "Collect info for prize money", templateType: "personal", who: "All accepted_Winners", globalLuma: "-" },
];

type StepScheduleMatrix = Record<JourneyStep["key"], Partial<Record<BatchNumber, string>>>;

const STEP_SCHEDULES: StepScheduleMatrix = {
    accepted: {
        1: "2026-02-27",
        2: "2026-03-13",
        3: "2026-03-25",
        4: "2026-04-04",
        5: "2026-04-18",
        6: "2026-04-19",
    },
    rejected: {
        1: "2026-02-27",
        2: "2026-03-13",
        3: "2026-03-25",
        4: "2026-04-04",
        5: "2026-04-18",
        6: "2026-04-19",
    },
    waitlist: {
        1: "2026-02-27",
        2: "2026-03-13",
        3: "2026-03-25",
        4: "2026-04-04",
        5: "2026-04-18",
        6: "2026-04-19",
    },
    symposium: {
        1: "2026-03-04",
        2: "2026-03-18",
        3: "2026-03-30",
        4: "2026-04-09",
        5: "2026-04-18",
        6: "2026-04-19",
    },
    speaker: {
        1: "2026-03-14",
        2: "2026-03-28",
        3: "2026-04-09",
        4: "2026-04-19",
    },
    sponsors: {
        1: "2026-03-24",
        2: "2026-04-07",
        3: "2026-04-19",
    },
    no_hub_confirm: {
        1: "2026-04-10",
        2: "2026-04-10",
        3: "2026-04-10",
        4: "2026-04-10",
    },
    hub_waitlist: {
        1: "2026-04-10",
        2: "2026-04-10",
        3: "2026-04-10",
        4: "2026-04-10",
        5: "2026-04-18",
        6: "2026-04-19",
    },
    hub_waitlist_confirm: {
        1: "2026-04-20",
        2: "2026-04-20",
        3: "2026-04-20",
        4: "2026-04-20",
        5: "2026-04-20",
        6: "2026-04-20",
    },
    last_info_mail: {
        1: "2026-04-22",
        2: "2026-04-22",
        3: "2026-04-22",
        4: "2026-04-22",
        5: "2026-04-22",
        6: "2026-04-22",
    },
    sequel_hour: {
        1: "2026-04-24",
        2: "2026-04-24",
        3: "2026-04-24",
        4: "2026-04-24",
        5: "2026-04-24",
        6: "2026-04-24",
    },
    deadline: {
        1: "2026-04-26",
        2: "2026-04-26",
        3: "2026-04-26",
        4: "2026-04-26",
        5: "2026-04-26",
        6: "2026-04-26",
    },
    comeback2: {
        1: "2026-04-26",
        2: "2026-04-26",
        3: "2026-04-26",
        4: "2026-04-26",
        5: "2026-04-26",
        6: "2026-04-26",
    },
    thank_you: {
        1: "2026-04-26",
        2: "2026-04-26",
        3: "2026-04-26",
        4: "2026-04-26",
        5: "2026-04-26",
        6: "2026-04-26",
    },
    prizes: {
        1: "2026-04-26",
        2: "2026-04-26",
        3: "2026-04-26",
        4: "2026-04-26",
        5: "2026-04-26",
        6: "2026-04-26",
    },
};

// ── Types ──────────────────────────────────────────────────────────────

export interface StepStatus {
    step_key: string;
    batch_number: number;
    status: "pending" | "done" | "skipped";
    planned_date: string | null;
    completed_at: string | null;
    completed_by: string | null;
    notes: string | null;
    auto_detected: boolean;
}

export interface CommsJourneyTemplate {
    id: number;
    name: string;
    subject: string | null;
    body: string;
}

export interface CommsPlanRow {
    step: JourneyStep;
    template: CommsJourneyTemplate | null;
    batches: Record<number, StepStatus>;
}

interface CommsStepRow {
    org_id: number;
    step_key: string;
    batch_number: number;
    status: "pending" | "done" | "skipped";
    completed_at: string | null;
    completed_by: string | null;
    notes: string | null;
}

interface StoredCommsTemplateRow {
    id: number;
    name: string;
    subject: string | null;
    body: string;
    created_at: string;
}

export interface BatchCommunicationWindow {
    number: BatchNumber;
    startDate: string | null;
    endDate: string | null;
}

export interface BatchScheduleDetails {
    number: BatchNumber;
    label: string;
    applicationDeadline: string;
    commsDecisionDate: string;
    journeyStartDate: string | null;
    journeyEndDate: string | null;
}

export interface PlanMilestone {
    key: "hackathon_date" | "hub_prio_cutoff";
    label: string;
    date: string;
}

const COMMS_PLAN_TEMPLATE_PREFIX = "sys-comms-plan:";
const COMMS_PLAN_TEMPLATE_TAG = "system:comms-plan";

// ── Auto-Detection ─────────────────────────────────────────────────────

const STEP_DETECTION_PATTERNS: Record<string, RegExp> = {
    accepted: /accepted/i,
    rejected: /rejected/i,
};

async function getAutoDetectedSteps(orgId: number): Promise<Map<string, Set<number>>> {
    const detected = new Map<string, Set<number>>();

    try {
        const { data: batches } = await db
            .from("personal_messages")
            .select("name, status")
            .eq("org_id", orgId)
            .in("status", ["SENT", "SENDING"]);

        if (!batches) return detected;

        for (const batch of batches) {
            const name = (batch.name as string) || "";
            for (const [stepKey, pattern] of Object.entries(STEP_DETECTION_PATTERNS)) {
                if (pattern.test(name)) {
                    const nums = [...name.matchAll(/B(\d+)/gi)]
                        .map((m) => Number(m[1]))
                        .filter((n) => n >= 1 && n <= 6);
                    if (nums.length > 0) {
                        if (!detected.has(stepKey)) detected.set(stepKey, new Set());
                        for (const n of nums) detected.get(stepKey)!.add(n);
                    }
                }
            }
        }
    } catch (err) {
        console.error("[CommsPlan] Auto-detection failed:", err);
    }

    return detected;
}

export function getPlannedDate(
    stepKey: JourneyStep["key"],
    batchNumber: BatchNumber,
): string | null {
    return STEP_SCHEDULES[stepKey]?.[batchNumber] ?? null;
}

export function listBatchCommunicationWindows(): BatchCommunicationWindow[] {
    return listBatchScheduleDetails().map((batch) => ({
        number: batch.number,
        startDate: batch.journeyStartDate,
        endDate: batch.journeyEndDate,
    }));
}

export function listBatchScheduleDetails(): BatchScheduleDetails[] {
    return BATCH_NUMBERS.map((batchNumber) => {
        const dates = JOURNEY_STEPS
            .map((step) => getPlannedDate(step.key, batchNumber))
            .filter((date): date is string => Boolean(date))
            .sort();
        const batchDeadline = BATCH_DEADLINES[batchNumber];

        return {
            number: batchNumber,
            label: batchDeadline.label,
            applicationDeadline: batchDeadline.applicationDeadline,
            commsDecisionDate: batchDeadline.commsDecisionDate,
            journeyStartDate: dates[0] ?? batchDeadline.commsDecisionDate,
            journeyEndDate: dates[dates.length - 1] ?? null,
        };
    });
}

export function listPlanMilestones(): PlanMilestone[] {
    return [
        { key: "hackathon_date", label: "Hackathon Date", date: HACKATHON_DATE },
        { key: "hub_prio_cutoff", label: "Hub prio cut-off", date: HUB_PRIO_CUTOFF_DATE },
    ];
}

function normalizeTemplateLabel(label: string): string {
    return label.replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeTemplateSubject(subject: string): string {
    return subject.replace(/\s+/g, " ").trim().slice(0, 500);
}

function buildCommsTemplateName(stepKey: string, label: string): string {
    const safeLabel = normalizeTemplateLabel(label) || "Template";
    return `${COMMS_PLAN_TEMPLATE_PREFIX}${stepKey}:${safeLabel}`;
}

function parseCommsTemplateName(name: string): {
    stepKey: string;
    label: string | null;
} | null {
    if (!name.startsWith(COMMS_PLAN_TEMPLATE_PREFIX)) return null;
    const payload = name.slice(COMMS_PLAN_TEMPLATE_PREFIX.length);
    const separatorIndex = payload.indexOf(":");
    if (separatorIndex === -1) {
        return {
            stepKey: payload,
            label: null,
        };
    }
    const stepKey = payload.slice(0, separatorIndex);
    const label = normalizeTemplateLabel(payload.slice(separatorIndex + 1));
    return {
        stepKey,
        label: label || null,
    };
}

function mapStoredTemplate(
    row: StoredCommsTemplateRow,
    fallbackName: string,
): CommsJourneyTemplate {
    const parsed = parseCommsTemplateName(String(row.name || ""));
    return {
        id: Number(row.id),
        name: parsed?.label || fallbackName,
        subject: row.subject || null,
        body: String(row.body || ""),
    };
}

async function loadJourneyTemplateMap(
    orgId: number,
): Promise<Map<string, CommsJourneyTemplate>> {
    const { data, error } = await db
        .from("message_templates")
        .select("id, name, subject, body, created_at")
        .eq("org_id", orgId)
        .like("name", `${COMMS_PLAN_TEMPLATE_PREFIX}%`)
        .order("created_at", { ascending: false });
    if (error) throw new BadRequestError(error.message);

    const map = new Map<string, CommsJourneyTemplate>();
    for (const row of (data || []) as StoredCommsTemplateRow[]) {
        const parsed = parseCommsTemplateName(String(row.name || ""));
        if (!parsed) continue;
        if (map.has(parsed.stepKey)) continue;

        const step = JOURNEY_STEPS.find((candidate) => candidate.key === parsed.stepKey);
        if (!step) continue;

        map.set(
            parsed.stepKey,
            mapStoredTemplate(row, `${step.code} ${step.label}`),
        );
    }
    return map;
}

async function findJourneyTemplateRecord(
    orgId: number,
    stepKey: string,
): Promise<StoredCommsTemplateRow | null> {
    const { data, error } = await db
        .from("message_templates")
        .select("id, name, subject, body, created_at")
        .eq("org_id", orgId)
        .like("name", `${COMMS_PLAN_TEMPLATE_PREFIX}${stepKey}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw new BadRequestError(error.message);
    return (data as StoredCommsTemplateRow | null) || null;
}

export async function upsertJourneyTemplate(
    orgId: number,
    userId: string,
    stepKey: string,
    input: {
        name?: string;
        subject?: string | null;
        body?: string;
    },
): Promise<CommsJourneyTemplate> {
    const step = JOURNEY_STEPS.find((candidate) => candidate.key === stepKey);
    if (!step) throw new BadRequestError(`Unknown step key: ${stepKey}`);

    const body = String(input.body || "").trim();
    const bodyText = body
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!bodyText) {
        throw new BadRequestError("Template body is required");
    }

    const displayName = normalizeTemplateLabel(input.name || `${step.code} ${step.label}`) || `${step.code} ${step.label}`;
    const subject = normalizeTemplateSubject(input.subject || "") || null;
    const storedName = buildCommsTemplateName(stepKey, displayName);
    const existing = await findJourneyTemplateRecord(orgId, stepKey);

    if (existing) {
        const { data, error } = await db
            .from("message_templates")
            .update({
                name: storedName,
                subject,
                body,
            })
            .eq("id", existing.id)
            .eq("org_id", orgId)
            .select("id, name, subject, body, created_at")
            .single();
        if (error || !data) throw new BadRequestError(error?.message || "Failed to update template");
        return mapStoredTemplate(data as StoredCommsTemplateRow, displayName);
    }

    const { data, error } = await db
        .from("message_templates")
        .insert({
            name: storedName,
            type: "EMAIL",
            subject,
            body,
            org_id: orgId,
            user_id: userId,
            attachments: [],
            tags: [COMMS_PLAN_TEMPLATE_TAG, `${COMMS_PLAN_TEMPLATE_PREFIX}${stepKey}`],
        })
        .select("id, name, subject, body, created_at")
        .single();
    if (error || !data) throw new BadRequestError(error?.message || "Failed to create template");
    return mapStoredTemplate(data as StoredCommsTemplateRow, displayName);
}

export async function deleteJourneyTemplate(
    orgId: number,
    stepKey: string,
): Promise<{ deleted: boolean }> {
    const step = JOURNEY_STEPS.find((candidate) => candidate.key === stepKey);
    if (!step) throw new BadRequestError(`Unknown step key: ${stepKey}`);

    const existing = await findJourneyTemplateRecord(orgId, stepKey);
    if (!existing) return { deleted: true };

    const { error } = await db
        .from("message_templates")
        .delete()
        .eq("id", existing.id)
        .eq("org_id", orgId);
    if (error) throw new BadRequestError(error.message);
    return { deleted: true };
}

// ── Service Functions ──────────────────────────────────────────────────

export async function getFullPlan(orgId: number): Promise<CommsPlanRow[]> {
    const [manualResult, autoDetected, templateMap] = await Promise.all([
        db.from("comms_plan_steps").select("*").eq("org_id", orgId),
        getAutoDetectedSteps(orgId),
        loadJourneyTemplateMap(orgId),
    ]);

    if (manualResult.error) throw new BadRequestError(manualResult.error.message);
    const rows = (manualResult.data || []) as CommsStepRow[];

    const statusMap = new Map<string, CommsStepRow>();
    for (const row of rows) {
        statusMap.set(`${row.step_key}:${row.batch_number}`, row);
    }

    return JOURNEY_STEPS.map((step) => {
        const batches: Record<number, StepStatus> = {};
        for (const b of BATCH_NUMBERS) {
            const key = `${step.key}:${b}`;
            const manual = statusMap.get(key);
            const plannedDate = getPlannedDate(step.key, b);
            const isAutoDetected =
                plannedDate !== null && (autoDetected.get(step.key)?.has(b) ?? false);

            batches[b] = {
                step_key: step.key,
                batch_number: b,
                planned_date: plannedDate,
                status: manual?.status || (isAutoDetected ? "done" : "pending"),
                completed_at: manual?.completed_at || null,
                completed_by: manual?.completed_by || null,
                notes: manual?.notes || null,
                auto_detected: isAutoDetected && !manual,
            };
        }
        return {
            step,
            template: templateMap.get(step.key) || null,
            batches,
        };
    });
}

export async function toggleStep(
    orgId: number,
    stepKey: string,
    batchNumber: number,
    status: "pending" | "done" | "skipped",
    userId?: string,
) {
    if (!JOURNEY_STEPS.find((s) => s.key === stepKey)) {
        throw new BadRequestError(`Unknown step key: ${stepKey}`);
    }
    if (!BATCH_NUMBERS.includes(batchNumber as BatchNumber)) {
        throw new BadRequestError("Batch number must be between 1 and 6");
    }
    if (!getPlannedDate(stepKey as JourneyStep["key"], batchNumber as BatchNumber)) {
        throw new BadRequestError(`Step '${stepKey}' does not apply to batch ${batchNumber}`);
    }

    if (status === "pending") {
        const { error } = await db
            .from("comms_plan_steps")
            .delete()
            .eq("org_id", orgId)
            .eq("step_key", stepKey)
            .eq("batch_number", batchNumber);
        if (error) throw new BadRequestError(error.message);
        return { step_key: stepKey, batch_number: batchNumber, status: "pending" };
    }

    const { data, error } = await db
        .from("comms_plan_steps")
        .upsert(
            {
                org_id: orgId,
                step_key: stepKey,
                batch_number: batchNumber,
                status,
                completed_at: status === "done" ? new Date().toISOString() : null,
                completed_by: userId || null,
            },
            { onConflict: "org_id,step_key,batch_number" },
        )
        .select()
        .single();

    if (error) throw new BadRequestError(error.message);
    return data;
}

export function listJourneySteps() {
    return JOURNEY_STEPS;
}
