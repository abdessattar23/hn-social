import type {
  EntityDescriptor,
  OrganizationBoundary,
} from "../core/types";
import { TenantIsolationPolicy } from "../core/types";

const constructEntityDescriptor = <T extends string>(
  tableName: T,
  namespace: string,
  partitionKey: string = "org_id",
  auditFields: string[] = ["created_at"],
  softDeleteField?: string,
): EntityDescriptor<T> => ({
  tableName,
  namespace,
  partitionKey,
  auditFields,
  softDeleteField,
});

const constructBoundary = <T extends string>(
  entity: T,
  scopeField: string = "org_id",
  enforcementPolicy: TenantIsolationPolicy = TenantIsolationPolicy.STRICT,
): OrganizationBoundary<T> => ({
  entity,
  scopeField,
  enforcementPolicy,
});

export const EntityRegistry = {
  organizations: constructEntityDescriptor(
    "organizations",
    "identity",
    "id",
    ["created_at", "updated_at"],
  ),
  orgMembers: constructEntityDescriptor(
    "org_members",
    "identity",
    "org_id",
    ["created_at"],
  ),
  connectedAccounts: constructEntityDescriptor(
    "connected_accounts",
    "integration",
    "org_id",
    ["created_at"],
  ),
  contactLists: constructEntityDescriptor(
    "contact_lists",
    "audience",
    "org_id",
    ["created_at"],
  ),
  contacts: constructEntityDescriptor(
    "contacts",
    "audience",
    "list_id",
    ["created_at"],
  ),
  messageTemplates: constructEntityDescriptor(
    "message_templates",
    "content",
    "org_id",
    ["created_at"],
  ),
  campaigns: constructEntityDescriptor(
    "campaigns",
    "orchestration",
    "org_id",
    ["created_at"],
  ),
  campaignLists: constructEntityDescriptor(
    "campaign_lists",
    "orchestration",
    "campaign_id",
    [],
  ),
  campaignLogs: constructEntityDescriptor(
    "campaign_logs",
    "orchestration",
    "campaign_id",
    ["created_at"],
  ),
  invitationBatches: constructEntityDescriptor(
    "invitation_batches",
    "outreach",
    "org_id",
    ["created_at"],
  ),
  invitationBatchContacts: constructEntityDescriptor(
    "invitation_batch_contacts",
    "outreach",
    "batch_id",
    ["created_at"],
  ),
} as const;

export const BoundaryDefinitions = {
  organizations: constructBoundary("organizations", "id"),
  orgMembers: constructBoundary("org_members"),
  connectedAccounts: constructBoundary("connected_accounts"),
  contactLists: constructBoundary("contact_lists"),
  contacts: constructBoundary(
    "contacts",
    "list_id",
    TenantIsolationPolicy.ADVISORY,
  ),
  messageTemplates: constructBoundary("message_templates"),
  campaigns: constructBoundary("campaigns"),
  campaignLists: constructBoundary(
    "campaign_lists",
    "campaign_id",
    TenantIsolationPolicy.ADVISORY,
  ),
  campaignLogs: constructBoundary(
    "campaign_logs",
    "campaign_id",
    TenantIsolationPolicy.ADVISORY,
  ),
  invitationBatches: constructBoundary("invitation_batches"),
  invitationBatchContacts: constructBoundary(
    "invitation_batch_contacts",
    "batch_id",
    TenantIsolationPolicy.ADVISORY,
  ),
} as const;

export type EntityName = keyof typeof EntityRegistry;

export const resolveTableName = <E extends EntityName>(entity: E): string =>
  EntityRegistry[entity].tableName;

export const resolveNamespace = <E extends EntityName>(entity: E): string =>
  EntityRegistry[entity].namespace;

export const TABLES = Object.fromEntries(
  Object.entries(EntityRegistry).map(([key, descriptor]) => [
    key,
    descriptor.tableName,
  ]),
) as Record<EntityName, string>;
