import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { BadRequestError } from "../lib/errors";
import { resolveUserContext } from "../lib/route-helpers";
import * as commsPlan from "../services/comms-plan";

const VALID_STATUSES = ["pending", "done", "skipped"] as const;
type StepStatusValue = (typeof VALID_STATUSES)[number];

const commsPlanRouter = new Hono();
commsPlanRouter.use("*", authMiddleware);

commsPlanRouter.get("/", async (c) => {
    const user = resolveUserContext(c);
    const plan = await commsPlan.getFullPlan(user.orgId);
    return c.json(plan);
});

commsPlanRouter.get("/steps", (c) => {
    return c.json(commsPlan.listJourneySteps());
});

commsPlanRouter.get("/metadata", (c) => {
    return c.json({
        batches: commsPlan.listBatchScheduleDetails(),
        milestones: commsPlan.listPlanMilestones(),
    });
});

commsPlanRouter.put("/:stepKey/template", async (c) => {
    const user = resolveUserContext(c);
    const stepKey = c.req.param("stepKey");

    let body: { name?: string; subject?: string | null; body?: string } = {};
    try {
        body = await c.req.json<{ name?: string; subject?: string | null; body?: string }>();
    } catch { }

    const template = await commsPlan.upsertJourneyTemplate(
        user.orgId,
        user.id,
        stepKey,
        body,
    );
    return c.json(template);
});

commsPlanRouter.delete("/:stepKey/template", async (c) => {
    const user = resolveUserContext(c);
    const stepKey = c.req.param("stepKey");
    const result = await commsPlan.deleteJourneyTemplate(user.orgId, stepKey);
    return c.json(result);
});

commsPlanRouter.patch("/:stepKey/:batchNumber", async (c) => {
    const user = resolveUserContext(c);
    const stepKey = c.req.param("stepKey");
    const batchNumber = Number(c.req.param("batchNumber"));

    if (isNaN(batchNumber) || !Number.isInteger(batchNumber)) {
        throw new BadRequestError("Batch number must be a valid integer");
    }

    let body: { status?: string } = {};
    try {
        body = await c.req.json<{ status?: string }>();
    } catch { }
    const status = (body.status ?? "done") as string;

    if (!VALID_STATUSES.includes(status as StepStatusValue)) {
        throw new BadRequestError(`Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(", ")}`);
    }

    const result = await commsPlan.toggleStep(
        user.orgId,
        stepKey,
        batchNumber,
        status as StepStatusValue,
        user.id,
    );
    return c.json(result);
});

commsPlanRouter.get("/export/excel", async (c) => {
    const user = resolveUserContext(c);
    const plan = await commsPlan.getFullPlan(user.orgId);
    const batchSchedules = commsPlan.listBatchScheduleDetails();
    const milestones = commsPlan.listPlanMilestones();
    const hackathonDate = milestones.find((milestone) => milestone.key === "hackathon_date")?.date || null;
    const hubPrioCutoffDate = milestones.find((milestone) => milestone.key === "hub_prio_cutoff")?.date || null;

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Hack Nation";
    workbook.lastModifiedBy = "Hack Nation";
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet("Comms Plan");
    worksheet.columns = [
        { key: "a", width: 16 },
        { key: "b", width: 22 },
        { key: "c", width: 42 },
        { key: "d", width: 28 },
        { key: "e", width: 18 },
        { key: "f", width: 26 },
        { key: "g", width: 16 },
        { key: "h", width: 16 },
        { key: "i", width: 16 },
        { key: "j", width: 16 },
        { key: "k", width: 16 },
        { key: "l", width: 16 },
        { key: "m", width: 12 },
    ];

    const outline = {
        top: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
        left: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
        right: { style: "thin" as const, color: { argb: "FFE5E7EB" } },
    };

    const applyOutline = (row: any) => {
        row.eachCell((cell) => {
            cell.border = outline;
        });
    };

    const hackathonRow = worksheet.addRow(["Hackathon Date", hackathonDate ? formatLongDate(hackathonDate) : "-"]);
    applyOutline(hackathonRow);
    worksheet.addRow([]);

    const batchHeaderRow = worksheet.addRow(["Batch", "Application Deadline", "Comms Deadline decision"]);
    batchHeaderRow.font = { bold: true };
    batchHeaderRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
    };
    applyOutline(batchHeaderRow);

    batchSchedules.forEach((batch) => {
        const row = worksheet.addRow([
            batch.label,
            formatLongDate(batch.applicationDeadline),
            formatLongDate(batch.commsDecisionDate),
        ]);
        applyOutline(row);
    });

    worksheet.addRow([]);
    const hubRow = worksheet.addRow(["Hub prio cut-off", hubPrioCutoffDate ? formatLongDate(hubPrioCutoffDate) : "-"]);
    applyOutline(hubRow);

    worksheet.addRow([]);
    const titleRow = worksheet.addRow(["Communication journey"]);
    worksheet.mergeCells(`A${titleRow.number}:M${titleRow.number}`);
    titleRow.font = { bold: true };
    titleRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE5E7EB" },
    };

    const planHeaderRow = worksheet.addRow([
        "Journey step",
        "Journey name",
        "Content",
        "Templates",
        "Personalization",
        "Who",
        "When Batch 1",
        "When Batch 2",
        "When Batch 3",
        "When Batch 4",
        "When Batch 5",
        "When Batch 6",
        "Global Luma",
    ]);
    planHeaderRow.font = { bold: true };
    planHeaderRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    planHeaderRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
    };
    applyOutline(planHeaderRow);

    const now = new Date();

    plan.forEach((row) => {
        const currentRow = worksheet.addRow([
            row.step.code,
            row.step.label,
            row.step.content,
            row.template?.name || "-",
            row.step.templateType === "bulk" ? "Bulk" : "Personal",
            row.step.who,
            "",
            "",
            "",
            "",
            "",
            "",
            row.step.globalLuma,
        ]);
        currentRow.alignment = { vertical: "top", wrapText: true };

        currentRow.eachCell((cell, columnNumber) => {
            if (columnNumber < 7 || columnNumber > 12) {
                cell.border = outline;
            }
        });

        for (let batchNumber = 1; batchNumber <= 6; batchNumber++) {
            const cell = currentRow.getCell(batchNumber + 6);
            const batchStatus = row.batches[batchNumber];
            const plannedDate = batchStatus?.planned_date;

            cell.border = outline;
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

            if (!plannedDate) {
                cell.value = "-";
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF9FAFB" },
                };
                cell.font = { color: { argb: "FF9CA3AF" } };
                continue;
            }

            cell.value = formatLongDate(plannedDate);

            if (batchStatus.status === "done") {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFC6F6D5" },
                };
                cell.font = { color: { argb: "FF047857" }, bold: true };
                if (batchStatus.auto_detected) {
                    cell.note = "Auto-detected";
                }
                continue;
            }

            if (batchStatus.status === "skipped") {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF3F4F6" },
                };
                cell.font = { color: { argb: "FF6B7280" } };
                continue;
            }

            const endDate = new Date(`${plannedDate}T23:59:59.999Z`);
            const isMissed = now > endDate;

            if (isMissed) {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFFEE2E2" },
                };
                cell.font = { color: { argb: "FFB91C1C" }, bold: true };
            } else {
                cell.font = { color: { argb: "FF111827" } };
            }
        }
    });

    worksheet.autoFilter = {
        from: { row: planHeaderRow.number, column: 1 },
        to: { row: planHeaderRow.number, column: 13 },
    };
    worksheet.views = [{ state: "frozen", ySplit: planHeaderRow.number }];

    const buffer = await workbook.xlsx.writeBuffer();

    c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    c.header("Content-Disposition", 'attachment; filename="comms-plan.xlsx"');

    return c.body(buffer as any);
});

function formatLongDate(date: string): string {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export default commsPlanRouter;
