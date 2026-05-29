-- ============================================================================
-- 0021_messages_source_section.sql
-- Adds source_section TEXT to messages for primary KB citation display.
-- Populated by the agent runtime for 'agent' role messages.
-- ============================================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS source_section TEXT;
