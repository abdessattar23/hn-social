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

// Export to Excel
commsPlanRouter.get("/export/excel", async (c) => {
    const user = resolveUserContext(c);
    const plan = await commsPlan.getFullPlan(user.orgId);
    const batchWindows = commsPlan.listBatchCommunicationWindows();

    // Use dynamic import for exceljs to avoid loading it if not used
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Hack Nation";
    workbook.lastModifiedBy = "Hack Nation";
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet("Comms Plan");

    // Define columns
    worksheet.columns = [
        { header: "#", key: "stepCode", width: 8 },
        { header: "Step", key: "stepLabel", width: 25 },
        { header: "Content", key: "content", width: 45 },
        { header: "Type", key: "type", width: 15 },
        { header: "Who", key: "who", width: 25 },
        ...batchWindows.map((batch) => ({
            header: batch.startDate && batch.endDate
                ? `B${batch.number}\n${formatShortDate(batch.startDate)} - ${formatShortDate(batch.endDate)}`
                : `B${batch.number}`,
            key: `b${batch.number}`,
            width: 16,
        })),
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    worksheet.getRow(1).height = 36;
    const now = new Date();

    // Populate rows
    plan.forEach((row) => {
        const rowData = {
            stepCode: row.step.code,
            stepLabel: row.step.label,
            content: row.step.content,
            type: row.step.templateType === "bulk" ? "Bulk" : "Personal",
            who: row.step.who,
        };

        const currentRow = worksheet.addRow(rowData);

        // Apply conditional formatting for B1-B6 (columns 6 to 11)
        for (let b = 1; b <= 6; b++) {
            const cell = currentRow.getCell(b + 5);
            const status = row.batches[b]?.status;
            const plannedDate = row.batches[b]?.planned_date;

            // Center align the status
            cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

            if (!plannedDate) {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF9FAFB" },
                };
                cell.font = { color: { argb: "FF9CA3AF" } };
                cell.value = "—";
                continue;
            }

            const plannedDateLabel = formatLongDate(plannedDate);

            if (status === "done") {
                // Green background for done
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFC6F6D5" }, // Light green, tailwind green-light-7 approx
                };
                cell.font = { color: { argb: "FF047857" }, bold: true }; // Darker green text
                cell.value = `${plannedDateLabel}\n✓ Done`;
            } else if (status === "skipped") {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF3F4F6" }, // Gray
                };
                cell.font = { color: { argb: "FF6B7280" } };
                cell.value = `${plannedDateLabel}\n⏭ Skipped`;
            } else {
                // pending
                const endDate = new Date(`${plannedDate}T23:59:59.999Z`);
                const isMissed = now > endDate;

                if (isMissed) {
                    // Red background for missed deadline
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "FFFEE2E2" }, // Light red
                    };
                    cell.font = { color: { argb: "FFB91C1C" }, bold: true }; // Dark red text
                    cell.value = `${plannedDateLabel}\n○ Missed`;
                } else {
                    // Normal pending
                    cell.font = { color: { argb: "FF9CA3AF" } };
                    cell.value = `${plannedDateLabel}\n○ Pending`;
                }
            }
        }
    });

    // Auto-filter for easy sorting
    worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: 11 }
    };

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Set headers
    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', 'attachment; filename="comms-plan.xlsx"');

    return c.body(buffer as any);
});

function formatShortDate(date: string): string {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
    });
}

function formatLongDate(date: string): string {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export default commsPlanRouter;
