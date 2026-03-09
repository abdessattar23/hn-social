ALTER TABLE personal_messages
ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN personal_messages.attachments IS
'Static batch-level attachments sent with every personal message item.';
