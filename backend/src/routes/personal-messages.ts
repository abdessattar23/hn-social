import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { createPersonalMessageSchema } from "../lib/validation";
import * as service from "../services/personal-messages";
import { BadRequestError } from "../lib/errors";
import { resolveUserContext, extractNumericParam } from "../lib/route-helpers";

const personalMessagesRouter = new Hono();
personalMessagesRouter.use("*", authMiddleware);

// List all personal message batches
personalMessagesRouter.get("/", async (c) => {
    const user = resolveUserContext(c);
    const batches = await service.findAll(user.orgId);
    return c.json(batches);
});

// List hackathon events for sync selector (MUST be before /:id)
personalMessagesRouter.get("/hackathon-events", (c) => {
    return c.json(service.listHackathonEvents());
});

// List admission batches for batch selector (MUST be before /:id)
personalMessagesRouter.get("/admission-batches", (c) => {
    return c.json(service.listAdmissionBatches());
});

// Get single batch with items
personalMessagesRouter.get("/:id", async (c) => {
    const user = resolveUserContext(c);
    const id = extractNumericParam(c);
    const batch = await service.findOne(id, user.orgId);
    return c.json(batch);
});

// Create a new batch
personalMessagesRouter.post(
    "/",
    zValidator("json", createPersonalMessageSchema),
    async (c) => {
        const user = resolveUserContext(c);
        const data = c.req.valid("json");
        const batch = await service.create(data, user.orgId, user.id);
        return c.json(batch, 201);
    },
);

// Sync applications from hackathon_applications table
personalMessagesRouter.post("/sync-applications", async (c) => {
    const user = resolveUserContext(c);
    const body = await c.req.json();
    const statusValue = body.statusValue || body.preStatus;
    const statusField: "pre_status" | "status" = body.statusField || "pre_status";
    const accountId = body.accountId;
    const eventId = body.eventId ? Number(body.eventId) : undefined;
    const batchNumbers: number[] = Array.isArray(body.batchNumbers) ? body.batchNumbers.map(Number) : [];
    if (!statusValue) {
        throw new BadRequestError("statusValue is required");
    }
    if (!accountId) throw new BadRequestError("accountId is required");
    const batch = await service.syncFromApplications(statusValue, statusField, accountId, user.orgId, user.id, eventId, batchNumbers.length > 0 ? batchNumbers : undefined);
    return c.json(batch, 201);
});

// Stop a sending batch
personalMessagesRouter.post("/:id/stop", async (c) => {
    const id = extractNumericParam(c);
    service.stopBatch(id);
    return c.json({ stopped: true });
});

// Update subject for all items in a batch
personalMessagesRouter.patch("/:id/subject", async (c) => {
    const user = resolveUserContext(c);
    const id = extractNumericParam(c);
    const { subject } = await c.req.json();
    if (!subject || !subject.trim()) throw new BadRequestError("Subject is required");
    const result = await service.updateBatchSubject(id, subject.trim(), user.orgId);
    return c.json(result);
});

// Import CSV into a batch
personalMessagesRouter.post("/:id/import-csv", async (c) => {
    const user = resolveUserContext(c);
    const id = extractNumericParam(c);

    const formData = await c.req.formData();
    const file = formData.get("file");

    let csvContent: string;
    if (file instanceof File) {
        csvContent = await file.text();
    } else if (typeof file === "string") {
        csvContent = file;
    } else {
        throw new BadRequestError("CSV file is required");
    }

    const result = await service.importCsv(id, user.orgId, csvContent);
    return c.json(result);
});

// Get batch dispatch logs
personalMessagesRouter.get("/:id/logs", async (c) => {
    const id = extractNumericParam(c);
    const logs = service.getBatchLogs(id);
    return c.json({ logs });
});

// Send all items in a batch
personalMessagesRouter.post("/:id/send", async (c) => {
    let delayMinMs: number | undefined;
    let delayMaxMs: number | undefined;
    let excludeItemIds: number[] | undefined;
    let emergencyMode: boolean | undefined;
    try {
        const body = await c.req.json();
        delayMinMs = body.delayMinMs;
        delayMaxMs = body.delayMaxMs;
        excludeItemIds = body.excludeItemIds;
        emergencyMode = body.emergencyMode;
    } catch { }

    const user = resolveUserContext(c);
    const id = extractNumericParam(c);
    const result = await service.send(id, user.orgId, delayMinMs, delayMaxMs, excludeItemIds, emergencyMode);
    return c.json(result);
});

// Delete a batch
personalMessagesRouter.delete("/:id", async (c) => {
    const user = resolveUserContext(c);
    const id = extractNumericParam(c);
    const result = await service.remove(id, user.orgId);
    return c.json(result);
});

export default personalMessagesRouter;
