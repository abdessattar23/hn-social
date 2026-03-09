import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";
import { BadRequestError } from "../lib/errors";
import * as emailAdapter from "../services/email";

type EmailIntent =
  | "list"
  | "folders"
  | "detail"
  | "send"
  | "reply"
  | "update"
  | "remove";

import { resolveUserContext } from "../lib/route-helpers";

const requireAccountId = (c: any): string => {
  const accountId = c.req.query("accountId");
  if (!accountId)
    throw new BadRequestError("accountId query param is required");
  return accountId;
};

const OutboundMessageSchema = z.object({
  accountId: z.string().min(1),
  to: z
    .array(
      z.object({
        display_name: z.string(),
        identifier: z.string().email(),
      }),
    )
    .min(1),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(100_000),
});

const ReplyCompositionSchema = z.object({
  accountId: z.string().min(1),
  emailId: z.string().min(1),
  body: z.string().min(1).max(100_000),
});

const MessageStateMutationSchema = z.object({
  accountId: z.string().min(1),
  unread: z.boolean().optional(),
  starred: z.boolean().optional(),
  folders: z.array(z.string()).optional(),
});

const emailRouter = new Hono();
emailRouter.use("*", authMiddleware);

emailRouter.get("/", async (c) => {
  const user = resolveUserContext(c);
  const accountId = requireAccountId(c);

  const result = await emailAdapter.listEmails(
    user.orgId,
    accountId,
    {
      limit: Number(c.req.query("limit")) || 20,
      cursor: c.req.query("cursor") || undefined,
      folder: c.req.query("folder") || undefined,
      from: c.req.query("from") || undefined,
      to: c.req.query("to") || undefined,
      any_email: c.req.query("any_email") || undefined,
      before: c.req.query("before") || undefined,
      after: c.req.query("after") || undefined,
    },
  );
  return c.json(result);
});

emailRouter.get("/folders", async (c) => {
  const user = resolveUserContext(c);
  const accountId = requireAccountId(c);
  const result = await emailAdapter.listFolders(
    user.orgId,
    accountId,
  );
  return c.json(result);
});

emailRouter.get("/:emailId", async (c) => {
  const user = resolveUserContext(c);
  const accountId = requireAccountId(c);
  const emailId = c.req.param("emailId");
  const result = await emailAdapter.getEmail(
    user.orgId,
    accountId,
    emailId,
  );
  return c.json(result);
});

emailRouter.post(
  "/send",
  zValidator("json", OutboundMessageSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, to, subject, body } = c.req.valid("json");
    const result = await emailAdapter.send(
      user.orgId,
      accountId,
      to,
      subject,
      body,
    );
    return c.json(result, 201);
  },
);

emailRouter.post(
  "/reply",
  zValidator("json", ReplyCompositionSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const { accountId, emailId, body } = c.req.valid("json");
    const result = await emailAdapter.reply(
      user.orgId,
      accountId,
      emailId,
      body,
    );
    return c.json(result, 201);
  },
);

emailRouter.patch(
  "/:emailId",
  zValidator("json", MessageStateMutationSchema),
  async (c) => {
    const user = resolveUserContext(c);
    const emailId = c.req.param("emailId");
    const { accountId, ...updates } = c.req.valid("json");
    const result = await emailAdapter.update(
      user.orgId,
      accountId,
      emailId,
      updates,
    );
    return c.json(result);
  },
);

emailRouter.delete("/:emailId", async (c) => {
  const user = resolveUserContext(c);
  const accountId = requireAccountId(c);
  const emailId = c.req.param("emailId");
  const result = await emailAdapter.remove(
    user.orgId,
    accountId,
    emailId,
  );
  return c.json(result);
});

export default emailRouter;
