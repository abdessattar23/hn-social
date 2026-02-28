import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import { createCampaignSchema, updateTagsSchema } from "../lib/validation";
import * as campaignsService from "../services/campaigns";

const campaignsRouter = new Hono();
campaignsRouter.use("*", authMiddleware);

campaignsRouter.get("/", async (c) => {
  const user = c.get("user");
  return c.json(await campaignsService.findAll(user.orgId));
});

campaignsRouter.get("/schedule", async (c) => {
  const user = c.get("user");
  return c.json(await campaignsService.getScheduleHeatmap(user.orgId));
});

campaignsRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  return c.json(await campaignsService.findOne(id, user.orgId));
});

campaignsRouter.post("/", zValidator("json", createCampaignSchema), async (c) => {
  const user = c.get("user");
  const data = c.req.valid("json");
  const campaign = await campaignsService.create(data, user.orgId, user.id);
  return c.json(campaign, 201);
});

campaignsRouter.patch("/:id/tags", zValidator("json", updateTagsSchema), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const { tags } = c.req.valid("json");
  return c.json(await campaignsService.updateTags(id, tags, user.orgId));
});

campaignsRouter.post("/:id/cancel", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  return c.json(await campaignsService.cancel(id, user.orgId));
});

campaignsRouter.post("/:id/send", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  return c.json(await campaignsService.send(id, user.orgId));
});

campaignsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  return c.json(await campaignsService.remove(id, user.orgId));
});

export default campaignsRouter;
