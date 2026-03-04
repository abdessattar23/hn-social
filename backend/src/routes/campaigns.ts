import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { createCampaignSchema, updateTagsSchema } from "../lib/validation";
import * as orchestrator from "../services/campaigns";

type CampaignIntent =
  | "list"
  | "detail"
  | "schedule"
  | "create"
  | "updateTags"
  | "stop"
  | "cancel"
  | "send"
  | "remove";

const resolveUserContext = (c: any) => c.get("user");
const extractNumericParam = (c: any, key = "id") =>
  Number(c.req.param(key));

const campaignsRouter = new Hono();
campaignsRouter.use("*", authMiddleware);

campaignsRouter.get("/", async (c) => {
  const user = resolveUserContext(c);
  const projections = await orchestrator.findAll(user.orgId);
  return c.json(projections);
});

campaignsRouter.get("/schedule", async (c) => {
  const user = resolveUserContext(c);
  const heatmap = await orchestrator.getScheduleHeatmap(user.orgId);
  return c.json(heatmap);
});

campaignsRouter.get("/:id", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const projection = await orchestrator.findOne(id, user.orgId);
  return c.json(projection);
});

campaignsRouter.post(
  "/",
  zValidator("json", createCampaignSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const data = c.req.valid("json");
    const campaign = await orchestrator.create(data, user.orgId, user.id);
    return c.json(campaign, 201);
  },
);

campaignsRouter.patch(
  "/:id/tags",
  zValidator("json", updateTagsSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const id = extractNumericParam(c);
    const { tags } = c.req.valid("json");
    const result = await orchestrator.updateTags(id, tags, user.orgId);
    return c.json(result);
  },
);

campaignsRouter.post("/:id/stop", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const result = await orchestrator.emergencyStop(id, user.orgId);
  return c.json(result);
});

campaignsRouter.post("/:id/cancel", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const result = await orchestrator.cancel(id, user.orgId);
  return c.json(result);
});

campaignsRouter.post("/:id/send", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const result = await orchestrator.send(id, user.orgId);
  return c.json(result);
});

campaignsRouter.delete("/:id", async (c) => {
  const user = resolveUserContext(c);
  const id = extractNumericParam(c);
  const result = await orchestrator.remove(id, user.orgId);
  return c.json(result);
});

export default campaignsRouter;
