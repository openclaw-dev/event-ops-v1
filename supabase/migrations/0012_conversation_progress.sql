-- ============================================================================
-- 0012_conversation_progress.sql
-- Adds the "consecutive_no_progress_turns" counter the agent state machine
-- uses for the stalled-conversation guardrail.
-- ============================================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS consecutive_no_progress_turns INT NOT NULL DEFAULT 0;
