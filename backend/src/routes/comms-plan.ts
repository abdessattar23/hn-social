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

    const body = await c.req.json<{ status?: string }>().catch(() => ({}));
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
        { header: "Order", key: "order", width: 8 },
        { header: "Step", key: "stepLabel", width: 25 },
        { header: "Content", key: "content", width: 45 },
        { header: "Type", key: "type", width: 15 },
        { header: "Who", key: "who", width: 25 },
        { header: "B1", key: "b1", width: 8 },
        { header: "B2", key: "b2", width: 8 },
        { header: "B3", key: "b3", width: 8 },
        { header: "B4", key: "b4", width: 8 },
        { header: "B5", key: "b5", width: 8 },
        { header: "B6", key: "b6", width: 8 },
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    worksheet.getRow(1).height = 25;

    // Batch end dates for determining missed deadlines
    // Dates from the UI: 
    // B1: Feb 27, 2026
    // B2: Mar 15, 2026
    // B3: Mar 25, 2026
    // B4: Apr 4, 2026
    // B5: Apr 18, 2026
    // B6: Apr 19, 2026
    const batchEndDates: Record<number, Date> = {
        1: new Date("2026-02-27T23:59:59Z"),
        2: new Date("2026-03-15T23:59:59Z"),
        3: new Date("2026-03-25T23:59:59Z"),
        4: new Date("2026-04-04T23:59:59Z"),
        5: new Date("2026-04-18T23:59:59Z"),
        6: new Date("2026-04-19T23:59:59Z"),
    };
    const now = new Date();

    // Populate rows
    plan.forEach((row) => {
        const rowData = {
            order: row.step.order,
            stepLabel: row.step.label,
            content: row.step.content,
            type: row.step.templateType === "bulk" ? "Bulk" : "Personal",
            who: row.step.who,
            b1: row.batches[1]?.status || "pending",
            b2: row.batches[2]?.status || "pending",
            b3: row.batches[3]?.status || "pending",
            b4: row.batches[4]?.status || "pending",
            b5: row.batches[5]?.status || "pending",
            b6: row.batches[6]?.status || "pending",
        };

        const currentRow = worksheet.addRow(rowData);

        // Apply conditional formatting for B1-B6 (columns 6 to 11)
        for (let b = 1; b <= 6; b++) {
            const cell = currentRow.getCell(b + 5);
            const status = row.batches[b]?.status;

            // Center align the status
            cell.alignment = { vertical: "middle", horizontal: "center" };

            if (status === "done") {
                // Green background for done
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFC6F6D5" }, // Light green, tailwind green-light-7 approx
                };
                cell.font = { color: { argb: "FF047857" }, bold: true }; // Darker green text
                cell.value = "✓ Done";
            } else if (status === "skipped") {
                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "FFF3F4F6" }, // Gray
                };
                cell.font = { color: { argb: "FF6B7280" } };
                cell.value = "⏭ Skipped";
            } else {
                // pending
                const endDate = batchEndDates[b];
                const isMissed = endDate && now > endDate;

                if (isMissed) {
                    // Red background for missed deadline
                    cell.fill = {
                        type: "pattern",
                        pattern: "solid",
                        fgColor: { argb: "FFFEE2E2" }, // Light red
                    };
                    cell.font = { color: { argb: "FFB91C1C" }, bold: true }; // Dark red text
                    cell.value = "○ Missed";
                } else {
                    // Normal pending
                    cell.font = { color: { argb: "FF9CA3AF" } };
                    cell.value = "○ Pending";
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

export default commsPlanRouter;
