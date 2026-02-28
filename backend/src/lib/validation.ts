import { z } from "zod";

// ---------- Auth ----------
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ---------- Org ----------
export const updateOrgNameSchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateAccountAliasSchema = z.object({
  accountId: z.string().min(1),
  alias: z.string().max(100),
});

export const updateAccountSignatureSchema = z.object({
  accountId: z.string().min(1),
  signature: z.string().max(5000),
});

// ---------- Lists ----------
export const createListSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN"]),
  tags: z.array(z.string()).optional(),
});

export const addContactSchema = z.object({
  name: z.string().max(200),
  identifier: z.string().min(1).max(500),
});

export const addChatsSchema = z.object({
  chats: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().nullable(),
    })
  ),
});

export const updateTagsSchema = z.object({
  tags: z.array(z.string().max(50)).max(20),
});

// ---------- Messages ----------
export const createMessageSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["EMAIL", "WHATSAPP", "LINKEDIN"]),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(50000),
  tags: z.array(z.string()).optional(),
  attachments: z.array(z.any()).optional(),
});

export const updateMessageSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(50000).optional(),
});

// ---------- Campaigns ----------
export const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  messageId: z.number().int().positive(),
  listIds: z.array(z.number().int().positive()).min(1),
  accountId: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
});

// ---------- Unipile ----------
export const connectAccountSchema = z.object({
  type: z.string().min(1),
});

// ---------- LinkedIn ----------
export const linkedinSearchSchema = z.object({
  accountId: z.string().min(1),
  api: z.enum(["classic", "sales_navigator", "recruiter"]).optional(),
  category: z.enum(["people", "companies", "jobs", "posts"]).optional(),
  keywords: z.string().optional(),
  url: z.string().url().optional(),
  start: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).passthrough(); // allow additional Unipile-specific filters

export const linkedinPostSchema = z.object({
  accountId: z.string().min(1),
  text: z.string().min(1).max(3000),
});

export const linkedinInviteSchema = z.object({
  accountId: z.string().min(1),
  providerId: z.string().min(1),
  message: z.string().max(300).optional(),
});

export const linkedinMessageSchema = z.object({
  accountId: z.string().min(1),
  chatId: z.string().min(1),
  text: z.string().min(1).max(5000),
});

export const linkedinSearchParamsSchema = z.object({
  accountId: z.string().min(1),
  type: z.string().min(1),
  keywords: z.string().optional(),
});

// ---------- Common ----------
export const idParam = z.object({
  id: z.coerce.number().int().positive(),
});
