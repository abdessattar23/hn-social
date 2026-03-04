import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import {
  createMessageSchema,
  updateMessageSchema,
  updateTagsSchema,
} from "../lib/validation";
import { NotFoundError, BadRequestError } from "../lib/errors";
import { saveUpload, deleteUpload } from "../lib/upload";
import { AsyncResult } from "../core/monad";

interface ContentTemplateProjection {
  id: number;
  name: string;
  type: string;
  subject: string | null;
  body: string;
  org_id: number;
  user_id: string;
  attachments: Array<{
    filename: string;
    originalName: string;
    path: string;
    mimeType: string;
  }>;
  tags: string[];
  [key: string]: any;
}

interface AttachmentManifest {
  filename: string;
  originalName: string;
  path: string;
  mimeType: string;
}

const materializeTemplate = (
  id: number,
  orgId: number,
): AsyncResult<ContentTemplateProjection> =>
  AsyncResult.from(async () => {
    const { data, error } = await db
      .from("message_templates")
      .select("*")
      .eq("id", id)
      .eq("org_id", orgId)
      .single();
    if (error || !data) throw new NotFoundError("Message not found");
    return data as ContentTemplateProjection;
  }, "content.materializeTemplate");

const purgeAttachmentAssets = async (
  attachments: AttachmentManifest[],
): Promise<void> => {
  for (const att of attachments) {
    await deleteUpload(att.path);
  }
};

const cascadeDeleteRelatedCampaigns = async (
  messageId: number,
  orgId: number,
): Promise<void> => {
  const { data: relatedCampaigns, error: rcErr } = await db
    .from("campaigns")
    .select("id")
    .eq("message_id", messageId)
    .eq("org_id", orgId);
  if (rcErr) throw new BadRequestError(rcErr.message);

  if (relatedCampaigns?.length) {
    const ids = relatedCampaigns.map((c: any) => c.id);

    const cascadeOps = [
      db.from("campaign_lists").delete().in("campaign_id", ids),
      db.from("campaign_logs").delete().in("campaign_id", ids),
    ];

    for (const op of cascadeOps) {
      const { error } = await op;
      if (error) throw new BadRequestError(error.message);
    }

    const { error: e3 } = await db
      .from("campaigns")
      .delete()
      .in("id", ids);
    if (e3) throw new BadRequestError(e3.message);
  }
};

const messages = new Hono();
messages.use("*", authMiddleware);

messages.get("/", async (c) => {
  const user = c.get("user");
  const { data, error } = await db
    .from("message_templates")
    .select("*")
    .eq("org_id", user.orgId)
    .order("created_at", { ascending: false });
  if (error) throw new BadRequestError(error.message);
  return c.json(data || []);
});

messages.get("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const template = await materializeTemplate(id, user.orgId).resolve();
  return c.json(template);
});

messages.post(
  "/",
  zValidator("json", createMessageSchema),
  async (c) => {
    const user = c.get("user");
    const data = c.req.valid("json");
    const { data: msg, error } = await db
      .from("message_templates")
      .insert({
        name: data.name,
        type: data.type,
        subject: data.subject || null,
        body: data.body,
        org_id: user.orgId,
        user_id: user.id,
        attachments: data.attachments || [],
        tags: data.tags || [],
      })
      .select()
      .single();
    if (error) throw new BadRequestError(error.message);
    return c.json(msg, 201);
  },
);

messages.put(
  "/:id",
  zValidator("json", updateMessageSchema),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    await materializeTemplate(id, user.orgId).resolve();

    const data = c.req.valid("json");
    const mutations: Record<string, unknown> = {};
    if (data.name !== undefined) mutations.name = data.name;
    if (data.subject !== undefined) mutations.subject = data.subject;
    if (data.body !== undefined) mutations.body = data.body;

    if (Object.keys(mutations).length) {
      const { error } = await db
        .from("message_templates")
        .update(mutations)
        .eq("id", id);
      if (error) throw new BadRequestError(error.message);
    }

    const refreshed = await materializeTemplate(id, user.orgId).resolve();
    return c.json(refreshed);
  },
);

messages.patch(
  "/:id/tags",
  zValidator("json", updateTagsSchema),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    await materializeTemplate(id, user.orgId).resolve();
    const { tags } = c.req.valid("json");
    const { error } = await db
      .from("message_templates")
      .update({ tags })
      .eq("id", id);
    if (error) throw new BadRequestError(error.message);
    return c.json({ id, tags });
  },
);

messages.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const template = await materializeTemplate(id, user.orgId).resolve();

  if (template.attachments?.length) {
    await purgeAttachmentAssets(template.attachments);
  }

  await cascadeDeleteRelatedCampaigns(id, user.orgId);

  const { error: delErr } = await db
    .from("message_templates")
    .delete()
    .eq("id", id);
  if (delErr) throw new BadRequestError(delErr.message);

  return c.json({ deleted: true });
});

messages.post("/upload-attachment", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File))
    throw new BadRequestError("File is required");

  const saved = await saveUpload(file);
  return c.json({
    filename: saved.filename,
    originalName: saved.originalName,
    path: saved.path,
    mimeType: saved.mimeType,
  });
});

messages.post("/:id/attachments", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const template = await materializeTemplate(id, user.orgId).resolve();

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File))
    throw new BadRequestError("File is required");

  const saved = await saveUpload(file);
  const attachmentDescriptor: AttachmentManifest = {
    filename: saved.filename,
    originalName: saved.originalName,
    path: saved.path,
    mimeType: saved.mimeType,
  };

  const reconciledAttachments = [
    ...(template.attachments || []),
    attachmentDescriptor,
  ];
  const { error } = await db
    .from("message_templates")
    .update({ attachments: reconciledAttachments })
    .eq("id", id);
  if (error) throw new BadRequestError(error.message);

  const refreshed = await materializeTemplate(id, user.orgId).resolve();
  return c.json(refreshed);
});

messages.delete("/:id/attachments/:filename", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const filename = c.req.param("filename");
  const template = await materializeTemplate(id, user.orgId).resolve();

  const targetAttachment = template.attachments?.find(
    (a: any) => a.filename === filename,
  );
  if (targetAttachment) {
    await deleteUpload(targetAttachment.path);
    const reconciledAttachments = (template.attachments || []).filter(
      (a: any) => a.filename !== filename,
    );
    const { error } = await db
      .from("message_templates")
      .update({ attachments: reconciledAttachments })
      .eq("id", id);
    if (error) throw new BadRequestError(error.message);
  }

  return c.json({ deleted: true });
});

export default messages;
