import { db } from "../db/client";
import { BadRequestError } from "../lib/errors";

// ── Journey Steps Configuration ────────────────────────────────────────

export interface JourneyStep {
    key: string;
    order: number;
    label: string;
    content: string;
    templateType: "bulk" | "personal";
    who: string;
}

export const JOURNEY_STEPS: readonly JourneyStep[] = [
    { key: "accepted", order: 1, label: "Accepted", content: "Information about Status - Accepted + Referral Link", templateType: "bulk", who: "All pre-accepted" },
    { key: "rejected", order: 2, label: "Rejected", content: "Information about Status - Rejected", templateType: "bulk", who: "All pre-rejected" },
    { key: "waitlist", order: 3, label: "Waitlist", content: "Ask Open - Waitlisted Main Grands", templateType: "personal", who: "All pre-rejected" },
    { key: "symposium", order: 4, label: "Symposium", content: "Sign up code for platform, ask to register for hub and event bars", templateType: "personal", who: "All accepted" },
    { key: "speaker", order: 5, label: "Speaker", content: "Announce speakers + Referral Link", templateType: "bulk", who: "All accepted" },
    { key: "sponsors", order: 6, label: "Sponsors", content: "Announce sponsors", templateType: "bulk", who: "All accepted" },
    { key: "no_hub_confirm", order: 7, label: "No Hub Confirm", content: "Invitation to your hub", templateType: "personal", who: "All accepted_budgets" },
    { key: "hub_waitlist", order: 8, label: "Hub Waitlist", content: "Info that you've been waitlisted", templateType: "bulk", who: "All accepted_maybe" },
    { key: "hub_waitlist_confirm", order: 9, label: "Hub Waitlist Confirm", content: "Info that you've been accepted off waitlist", templateType: "personal", who: "All accepted_maybe" },
    { key: "last_info_mail", order: 10, label: "Last Info Mail", content: "Last info mail about zoom, discord etc.", templateType: "bulk", who: "All accepted" },
    { key: "sequel_hour", order: 11, label: "Sequel/Hour", content: "Reminder to join zoom in one hour", templateType: "bulk", who: "All accepted" },
    { key: "deadline", order: 12, label: "Deadline", content: "Deadline reminder", templateType: "bulk", who: "All accepted" },
    { key: "comeback2", order: 13, label: "Comeback", content: "Reminder to come back to the pitches", templateType: "bulk", who: "All accepted" },
    { key: "thank_you", order: 14, label: "Thank You", content: "Thank you and feedback survey + social", templateType: "bulk", who: "All accepted" },
    { key: "prizes", order: 15, label: "Prizes", content: "Collect info for prize money", templateType: "personal", who: "All accepted, Winners" },
];

// ── Types ──────────────────────────────────────────────────────────────

export interface StepStatus {
    step_key: string;
    batch_number: number;
    status: "pending" | "done" | "skipped";
    completed_at: string | null;
    completed_by: string | null;
    notes: string | null;
    auto_detected: boolean;
}

export interface CommsPlanRow {
    step: JourneyStep;
    batches: Record<number, StepStatus>;
}

// ── Auto-Detection ─────────────────────────────────────────────────────

// Maps personal_messages batch name patterns to step keys
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
            const name = batch.name || "";
            // Try to match step key from batch name
            for (const [stepKey, pattern] of Object.entries(STEP_DETECTION_PATTERNS)) {
                if (pattern.test(name)) {
                    // Extract batch numbers from name like "HN5 Accepted B1+B2"
                    const batchMatch = name.match(/B(\d[\d+]*)/i);
                    if (batchMatch) {
                        const nums = batchMatch[1].split("+").map(Number).filter((n: number) => n >= 1 && n <= 6);
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

// ── Service Functions ──────────────────────────────────────────────────

export async function getFullPlan(orgId: number): Promise<CommsPlanRow[]> {
    // Fetch manual statuses from DB
    const { data: rows, error } = await db
        .from("comms_plan_steps")
        .select("*")
        .eq("org_id", orgId);
    if (error) throw new BadRequestError(error.message);

    // Fetch auto-detected steps
    const autoDetected = await getAutoDetectedSteps(orgId);

    // Build lookup: stepKey:batchNumber -> status
    const statusMap = new Map<string, any>();
    for (const row of rows || []) {
        statusMap.set(`${row.step_key}:${row.batch_number}`, row);
    }

    // Build full plan
    return JOURNEY_STEPS.map((step) => {
        const batches: Record<number, StepStatus> = {};
        for (let b = 1; b <= 6; b++) {
            const key = `${step.key}:${b}`;
            const manual = statusMap.get(key);
            const isAutoDetected = autoDetected.get(step.key)?.has(b) ?? false;

            batches[b] = {
                step_key: step.key,
                batch_number: b,
                status: manual?.status || (isAutoDetected ? "done" : "pending"),
                completed_at: manual?.completed_at || null,
                completed_by: manual?.completed_by || null,
                notes: manual?.notes || null,
                auto_detected: isAutoDetected && !manual,
            };
        }
        return { step, batches };
    });
}

export async function toggleStep(
    orgId: number,
    stepKey: string,
    batchNumber: number,
    status: "pending" | "done" | "skipped",
    userId?: string,
) {
    // Validate step key
    if (!JOURNEY_STEPS.find((s) => s.key === stepKey)) {
        throw new BadRequestError(`Unknown step key: ${stepKey}`);
    }
    if (batchNumber < 1 || batchNumber > 6) {
        throw new BadRequestError("Batch number must be between 1 and 6");
    }

    if (status === "pending") {
        // Delete the row to reset to default
        await db
            .from("comms_plan_steps")
            .delete()
            .eq("org_id", orgId)
            .eq("step_key", stepKey)
            .eq("batch_number", batchNumber);
        return { step_key: stepKey, batch_number: batchNumber, status: "pending" };
    }

    // Upsert
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
