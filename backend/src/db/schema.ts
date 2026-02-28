// Schema is managed in Supabase.
// See the SQL migration for table definitions.
// This file is kept as a reference for the table structure.

export const TABLES = {
  organizations: "organizations",
  orgMembers: "org_members",
  connectedAccounts: "connected_accounts",
  contactLists: "contact_lists",
  contacts: "contacts",
  messageTemplates: "message_templates",
  campaigns: "campaigns",
  campaignLists: "campaign_lists",
  campaignLogs: "campaign_logs",
} as const;
