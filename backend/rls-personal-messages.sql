-- ============================================================
-- RLS policies for personal_messages and personal_message_items
-- ============================================================
-- DB is shared across multiple apps. These tables should only
-- be accessible by service_role (backend) and nobody else.
-- RLS is enabled with NO permissive policies, effectively
-- blocking all access from authenticated/anon roles.
-- The backend service_role key bypasses RLS automatically.

-- -------------------------------------------------------
-- 1. personal_messages
-- -------------------------------------------------------
ALTER TABLE personal_messages ENABLE ROW LEVEL SECURITY;

-- Revoke direct access from public roles
REVOKE ALL ON personal_messages FROM anon, authenticated;

-- Grant only to service_role (backend) — this is the default,
-- but being explicit ensures no drift
GRANT ALL ON personal_messages TO service_role;

-- -------------------------------------------------------
-- 2. personal_message_items
-- -------------------------------------------------------
ALTER TABLE personal_message_items ENABLE ROW LEVEL SECURITY;

-- Revoke direct access from public roles
REVOKE ALL ON personal_message_items FROM anon, authenticated;

-- Grant only to service_role (backend)
GRANT ALL ON personal_message_items TO service_role;
