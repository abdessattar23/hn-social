import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware } from "../middleware/auth";
import {
  linkedinSearchSchema,
  linkedinPostSchema,
  linkedinInviteSchema,
  linkedinBulkInviteSchema,
  linkedinMessageSchema,
  linkedinSearchParamsSchema,
} from "../lib/validation";
import * as networkOrchestrator from "../services/linkedin";

type NetworkIntent =
  | "search"
  | "exportPage"
  | "exportAll"
  | "searchParams"
  | "profile"
  | "invite"
  | "bulkInvite"
  | "message"
  | "post"
  | "listPosts";

import { resolveUserContext } from "../lib/route-helpers";

const constructCsvResponseHeaders = (c: any, filenamePrefix: string) => {
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="${filenamePrefix}-${Date.now()}.csv"`,
  );
};

const linkedin = new Hono();
linkedin.use("*", authMiddleware);

linkedin.post(
  "/search",
  zValidator("json", linkedinSearchSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, ...params } = c.req.valid("json");
    const result = await networkOrchestrator.search(
      user.orgId,
      accountId,
      params,
    );
    return c.json(result);
  },
);

linkedin.post(
  "/search/export-csv",
  zValidator("json", linkedinSearchSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, exportFields, exportMaxResults, ...params } =
      c.req.valid("json") as any;
    const csv = await networkOrchestrator.searchExportCsv(
      user.orgId,
      accountId,
      params,
      exportFields as string[] | undefined,
      exportMaxResults as number | undefined,
    );
    constructCsvResponseHeaders(c, "linkedin-export");
    return c.body(csv);
  },
);

linkedin.post(
  "/search/export-all-csv",
  zValidator("json", linkedinSearchSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, exportFields, exportMaxResults, ...params } =
      c.req.valid("json") as any;
    const csv = await networkOrchestrator.searchExportAllCsv(
      user.orgId,
      accountId,
      params,
      exportFields as string[] | undefined,
      exportMaxResults as number | undefined,
    );
    constructCsvResponseHeaders(c, "linkedin-export-all");
    return c.body(csv);
  },
);

linkedin.get("/search/parameters", async (c) => {
  const user = resolveUserContext(c);
  const accountId = c.req.query("accountId");
  const type = c.req.query("type");
  const keywords = c.req.query("keywords");

  if (!accountId || !type) {
    return c.json(
      { error: "accountId and type are required" },
      400,
    );
  }

  const result = await networkOrchestrator.getSearchParams(
    user.orgId,
    accountId,
    type,
    keywords,
  );
  return c.json(result);
});

linkedin.get("/profile/:profileId", async (c) => {
  const user = resolveUserContext(c);
  const profileId = c.req.param("profileId");
  const accountId = c.req.query("accountId");

  if (!accountId)
    return c.json(
      { error: "accountId query param is required" },
      400,
    );

  const result = await networkOrchestrator.getProfile(
    user.orgId,
    accountId,
    profileId,
  );
  return c.json(result);
});

linkedin.post(
  "/invite",
  zValidator("json", linkedinInviteSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, providerId, message } = c.req.valid("json");
    const result = await networkOrchestrator.sendInvite(
      user.orgId,
      accountId,
      providerId,
      message,
    );
    return c.json(result);
  },
);

linkedin.post(
  "/invite/bulk",
  zValidator("json", linkedinBulkInviteSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, invites, message } = c.req.valid("json");
    const result = await networkOrchestrator.bulkInvite(
      user.orgId,
      accountId,
      invites,
      message,
    );
    return c.json(result);
  },
);

linkedin.post(
  "/message",
  zValidator("json", linkedinMessageSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, chatId, text } = c.req.valid("json");
    const result = await networkOrchestrator.sendMessage(
      user.orgId,
      accountId,
      chatId,
      text,
    );
    return c.json(result);
  },
);

linkedin.post(
  "/post",
  zValidator("json", linkedinPostSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, text } = c.req.valid("json");
    const result = await networkOrchestrator.createPost(
      user.orgId,
      accountId,
      text,
    );
    return c.json(result);
  },
);

linkedin.get("/posts", async (c) => {
  const user = resolveUserContext(c);
  const accountId = c.req.query("accountId");
  if (!accountId)
    return c.json(
      { error: "accountId query param is required" },
      400,
    );
  const result = await networkOrchestrator.listPosts(
    user.orgId,
    accountId,
  );
  return c.json(result);
});

export default linkedin;
