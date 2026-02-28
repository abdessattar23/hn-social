import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import {
  linkedinSearchSchema,
  linkedinPostSchema,
  linkedinInviteSchema,
  linkedinMessageSchema,
  linkedinSearchParamsSchema,
} from "../lib/validation";
import * as linkedinService from "../services/linkedin";

const linkedin = new Hono();
linkedin.use("*", authMiddleware);

// Search people, companies, jobs, posts
linkedin.post("/search", zValidator("json", linkedinSearchSchema), async (c) => {
  const user = c.get("user");
  const { accountId, ...params } = c.req.valid("json");
  return c.json(await linkedinService.search(user.orgId, accountId, params));
});

// Get search parameter options (locations, industries, etc.)
linkedin.get("/search/parameters", async (c) => {
  const user = c.get("user");
  const accountId = c.req.query("accountId");
  const type = c.req.query("type");
  const keywords = c.req.query("keywords");
  if (!accountId || !type) {
    return c.json({ error: "accountId and type are required" }, 400);
  }
  return c.json(
    await linkedinService.getSearchParams(user.orgId, accountId, type, keywords)
  );
});

// View a LinkedIn profile
linkedin.get("/profile/:profileId", async (c) => {
  const user = c.get("user");
  const profileId = c.req.param("profileId");
  const accountId = c.req.query("accountId");
  if (!accountId) return c.json({ error: "accountId query param is required" }, 400);
  return c.json(
    await linkedinService.getProfile(user.orgId, accountId, profileId)
  );
});

// Send a connection request
linkedin.post("/invite", zValidator("json", linkedinInviteSchema), async (c) => {
  const user = c.get("user");
  const { accountId, providerId, message } = c.req.valid("json");
  return c.json(
    await linkedinService.sendInvite(user.orgId, accountId, providerId, message)
  );
});

// Send a LinkedIn message
linkedin.post("/message", zValidator("json", linkedinMessageSchema), async (c) => {
  const user = c.get("user");
  const { accountId, chatId, text } = c.req.valid("json");
  return c.json(
    await linkedinService.sendMessage(user.orgId, accountId, chatId, text)
  );
});

// Create a LinkedIn post
linkedin.post("/post", zValidator("json", linkedinPostSchema), async (c) => {
  const user = c.get("user");
  const { accountId, text } = c.req.valid("json");
  return c.json(await linkedinService.createPost(user.orgId, accountId, text));
});

// List posts for an account
linkedin.get("/posts", async (c) => {
  const user = c.get("user");
  const accountId = c.req.query("accountId");
  if (!accountId) return c.json({ error: "accountId query param is required" }, 400);
  return c.json(await linkedinService.listPosts(user.orgId, accountId));
});

export default linkedin;
