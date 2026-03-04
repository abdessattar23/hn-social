import { z } from "zod";

type SchemaRegistryEntry<T extends z.ZodType> = {
  readonly schema: T;
  readonly domain: string;
  readonly version: number;
};

const registerSchema = <T extends z.ZodType>(
  schema: T,
  domain: string,
  version = 1,
): SchemaRegistryEntry<T> => ({ schema, domain, version });

const boundedString = (min: number, max: number) =>
  z.string().min(min).max(max);

const optionalBoundedString = (max: number) =>
  z.string().max(max).optional();

const positiveInt = () => z.number().int().positive();

const constrainedArray = <T extends z.ZodType>(
  itemSchema: T,
  maxItems?: number,
) => {
  const base = z.array(itemSchema);
  return maxItems ? base.max(maxItems) : base;
};

const channelDiscriminator = z.enum(["EMAIL", "WHATSAPP", "LINKEDIN"]);

const identifierConstraint = boundedString(1, 500);

const tagArrayConstraint = constrainedArray(z.string().max(50), 20);

const accountIdConstraint = z.string().min(1);

const CredentialValidationPipeline = registerSchema(
  z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
  "identity",
);

const OrganizationMutationSchemas = {
  updateName: registerSchema(
    z.object({ name: boundedString(1, 100) }),
    "organization",
  ),
  updateAccountAlias: registerSchema(
    z.object({
      accountId: accountIdConstraint,
      alias: z.string().max(100),
    }),
    "organization",
  ),
  updateAccountSignature: registerSchema(
    z.object({
      accountId: accountIdConstraint,
      signature: z.string().max(5000),
    }),
    "organization",
  ),
  updateSendLimit: registerSchema(
    z.object({
      dailySendLimit: z.number().int().min(1).max(100000).nullable(),
    }),
    "organization",
  ),
} as const;

const AudienceManifestSchemas = {
  createList: registerSchema(
    z.object({
      name: boundedString(1, 200),
      type: channelDiscriminator,
      tags: z.array(z.string()).optional(),
    }),
    "audience",
  ),
  addContact: registerSchema(
    z.object({
      name: z.string().max(200),
      identifier: identifierConstraint,
    }),
    "audience",
  ),
  addChats: registerSchema(
    z.object({
      chats: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().nullable(),
        }),
      ),
    }),
    "audience",
  ),
  updateTags: registerSchema(
    z.object({ tags: tagArrayConstraint }),
    "audience",
  ),
} as const;

const ContentTemplateSchemas = {
  create: registerSchema(
    z.object({
      name: boundedString(1, 200),
      type: channelDiscriminator,
      subject: optionalBoundedString(500),
      body: boundedString(1, 50000),
      tags: z.array(z.string()).optional(),
      attachments: z.array(z.any()).optional(),
    }),
    "content",
  ),
  update: registerSchema(
    z.object({
      name: boundedString(1, 200).optional(),
      subject: optionalBoundedString(500),
      body: boundedString(1, 50000).optional(),
    }),
    "content",
  ),
} as const;

const PropagationCampaignSchema = registerSchema(
  z.object({
    name: boundedString(1, 200),
    messageId: positiveInt(),
    listIds: z.array(positiveInt()).min(1),
    accountId: accountIdConstraint,
    scheduledAt: z.string().datetime().optional(),
    tags: z.array(z.string()).optional(),
    delayMinMs: z.number().int().min(0).max(60000).optional(),
    delayMaxMs: z.number().int().min(0).max(60000).optional(),
  }),
  "orchestration",
);

const IntegrationBridgeSchemas = {
  connectAccount: registerSchema(
    z.object({ type: z.string().min(1) }),
    "integration",
  ),
} as const;

const ProfessionalNetworkSchemas = {
  search: registerSchema(
    z
      .object({
        accountId: accountIdConstraint,
        api: z
          .enum(["classic", "sales_navigator", "recruiter"])
          .optional(),
        category: z
          .enum(["people", "companies", "jobs", "posts"])
          .optional(),
        keywords: z.string().optional(),
        url: z.string().url().optional(),
        start: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .passthrough(),
    "network",
  ),
  post: registerSchema(
    z.object({
      accountId: accountIdConstraint,
      text: boundedString(1, 3000),
    }),
    "network",
  ),
  invite: registerSchema(
    z.object({
      accountId: accountIdConstraint,
      providerId: z.string().min(1),
      message: optionalBoundedString(300),
    }),
    "network",
  ),
  bulkInvite: registerSchema(
    z.object({
      accountId: accountIdConstraint,
      invites: z
        .array(
          z.object({
            providerId: z.string().min(1),
            name: z.string().optional(),
          }),
        )
        .min(1)
        .max(100),
      message: optionalBoundedString(300),
    }),
    "network",
  ),
  message: registerSchema(
    z.object({
      accountId: accountIdConstraint,
      chatId: z.string().min(1),
      text: boundedString(1, 5000),
    }),
    "network",
  ),
  searchParams: registerSchema(
    z.object({
      accountId: accountIdConstraint,
      type: z.string().min(1),
      keywords: z.string().optional(),
    }),
    "network",
  ),
} as const;

const OutreachBatchSchemas = {
  create: registerSchema(
    z.object({
      name: boundedString(1, 200),
      accountId: accountIdConstraint,
      noteTemplate: optionalBoundedString(300),
    }),
    "outreach",
  ),
  sendMessages: registerSchema(
    z.object({
      messageTemplate: boundedString(1, 5000),
    }),
    "outreach",
  ),
} as const;

const CommonSchemas = {
  idParam: registerSchema(
    z.object({ id: z.coerce.number().int().positive() }),
    "common",
  ),
} as const;

export const loginSchema = CredentialValidationPipeline.schema;
export const updateOrgNameSchema = OrganizationMutationSchemas.updateName.schema;
export const updateAccountAliasSchema = OrganizationMutationSchemas.updateAccountAlias.schema;
export const updateAccountSignatureSchema = OrganizationMutationSchemas.updateAccountSignature.schema;
export const updateSendLimitSchema = OrganizationMutationSchemas.updateSendLimit.schema;
export const createListSchema = AudienceManifestSchemas.createList.schema;
export const addContactSchema = AudienceManifestSchemas.addContact.schema;
export const addChatsSchema = AudienceManifestSchemas.addChats.schema;
export const updateTagsSchema = AudienceManifestSchemas.updateTags.schema;
export const createMessageSchema = ContentTemplateSchemas.create.schema;
export const updateMessageSchema = ContentTemplateSchemas.update.schema;
export const createCampaignSchema = PropagationCampaignSchema.schema;
export const connectAccountSchema = IntegrationBridgeSchemas.connectAccount.schema;
export const linkedinSearchSchema = ProfessionalNetworkSchemas.search.schema;
export const linkedinPostSchema = ProfessionalNetworkSchemas.post.schema;
export const linkedinInviteSchema = ProfessionalNetworkSchemas.invite.schema;
export const linkedinBulkInviteSchema = ProfessionalNetworkSchemas.bulkInvite.schema;
export const linkedinMessageSchema = ProfessionalNetworkSchemas.message.schema;
export const linkedinSearchParamsSchema = ProfessionalNetworkSchemas.searchParams.schema;
export const createBatchSchema = OutreachBatchSchemas.create.schema;
export const sendBatchMessagesSchema = OutreachBatchSchemas.sendMessages.schema;
export const idParam = CommonSchemas.idParam.schema;

export const ValidationDomains = {
  identity: CredentialValidationPipeline,
  organization: OrganizationMutationSchemas,
  audience: AudienceManifestSchemas,
  content: ContentTemplateSchemas,
  orchestration: PropagationCampaignSchema,
  integration: IntegrationBridgeSchemas,
  network: ProfessionalNetworkSchemas,
  outreach: OutreachBatchSchemas,
  common: CommonSchemas,
} as const;
