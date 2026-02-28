import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import { createMessageSchema, updateMessageSchema, updateTagsSchema } from "../lib/validation";
import { NotFoundError, BadRequestError } from "../lib/errors";
import { saveUpload, deleteUpload } from "../lib/upload";

const messages = new Hono();
messages.use("*", authMiddleware);

async function getMessage(id: number, orgId: number) {
  const { data } = await db
    .from("message_templates")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .single();
  if (!data) throw new NotFoundError("Message not found");
  return data;
}

messages.get("/", async (c) => {
  const user = c.get("user");
  const { data } = await db
    .from("message_templates")
    .select("*")
    .eq("org_id", user.orgId)
    .order("created_at", { ascending: false });
  return c.json(data || []);
});

messages.get("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  return c.json(await getMessage(id, user.orgId));
});

messages.post("/", zValidator("json", createMessageSchema), async (c) => {
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
});

messages.put("/:id", zValidator("json", updateMessageSchema), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await getMessage(id, user.orgId);

  const data = c.req.valid("json");
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.subject !== undefined) updates.subject = data.subject;
  if (data.body !== undefined) updates.body = data.body;

  if (Object.keys(updates).length) {
    await db.from("message_templates").update(updates).eq("id", id);
  }
  return c.json(await getMessage(id, user.orgId));
});

messages.patch("/:id/tags", zValidator("json", updateTagsSchema), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await getMessage(id, user.orgId);
  await db.from("message_templates").update({ tags: c.req.valid("json").tags }).eq("id", id);
  return c.json({ id, tags: c.req.valid("json").tags });
});

messages.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const msg = await getMessage(id, user.orgId);

  if (msg.attachments?.length) {
    for (const att of msg.attachments) {
      await deleteUpload(att.path);
    }
  }

  // Cascade delete campaigns referencing this template (org-scoped)
  const { data: relatedCampaigns } = await db
    .from("campaigns")
    .select("id")
    .eq("message_id", id)
    .eq("org_id", user.orgId);

  if (relatedCampaigns?.length) {
    const ids = relatedCampaigns.map((c: any) => c.id);
    await db.from("campaign_lists").delete().in("campaign_id", ids);
    await db.from("campaign_logs").delete().in("campaign_id", ids);
    await db.from("campaigns").delete().in("id", ids);
  }

  await db.from("message_templates").delete().eq("id", id);
  return c.json({ deleted: true });
});

messages.post("/upload-attachment", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new BadRequestError("File is required");
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
  const msg = await getMessage(id, user.orgId);

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new BadRequestError("File is required");

  const saved = await saveUpload(file);
  const attachment = {
    filename: saved.filename,
    originalName: saved.originalName,
    path: saved.path,
    mimeType: saved.mimeType,
  };

  const updatedAttachments = [...(msg.attachments || []), attachment];
  await db.from("message_templates").update({ attachments: updatedAttachments }).eq("id", id);
  return c.json(await getMessage(id, user.orgId));
});

messages.delete("/:id/attachments/:filename", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const filename = c.req.param("filename");
  const msg = await getMessage(id, user.orgId);

  const att = msg.attachments?.find((a: any) => a.filename === filename);
  if (att) {
    await deleteUpload(att.path);
    const updated = (msg.attachments || []).filter((a: any) => a.filename !== filename);
    await db.from("message_templates").update({ attachments: updated }).eq("id", id);
  }
  return c.json({ deleted: true });
});

export default messages;
