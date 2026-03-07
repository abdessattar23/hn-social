import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { createPersonalMessageSchema } from "../lib/validation";
import * as service from "../services/personal-messages";
import { BadRequestError } from "../lib/errors";

const resolveUserContext = (c: any) => c.get("user");
const extractNumericParam = (c: any, key = "id") =>
    Number(c.req.param(key));

const personalMessagesRouter = new Hono();
personalMessagesRouter.use("*", authMiddleware);

// List all personal message batches
personalMessagesRouter.get("/", async (c) => {
    const user = resolveUserContext(c);
    const batches = await service.findAll(user.orgId);
    return c.json(batches);
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
    const preStatus = body.preStatus;
    const accountId = body.accountId;
    if (!preStatus || !["pre_accepted", "pre_rejected"].includes(preStatus)) {
        throw new BadRequestError("preStatus must be 'pre_accepted' or 'pre_rejected'");
    }
    if (!accountId) throw new BadRequestError("accountId is required");
    const batch = await service.syncFromApplications(preStatus, accountId, user.orgId, user.id);
    return c.json(batch, 201);
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
