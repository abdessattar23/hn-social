-- ONE-TIME CLEANUP: Remove all wrongly auto-assigned rows from connected_accounts.
--
-- The old sync logic auto-inserted every Unipile account into connected_accounts
-- for whichever org hit the GET /accounts endpoint. This script wipes the table
-- so users can re-link their accounts through the proper OAuth flow.
--
-- Run this ONCE in the Supabase SQL Editor before (or right after) deploying the fix.
-- After running, each user will need to re-connect their accounts from Settings.

BEGIN;

DELETE FROM connected_accounts;

COMMIT;
