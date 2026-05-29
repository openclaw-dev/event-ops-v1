-- ============================================================================
-- 0024_messages_deflection_flag.sql
-- Adds a deflection_offered flag to messages so the conversation-metrics
-- refund_deflected count can be computed via a direct column query instead
-- of an ILIKE sequential scan on messages.text.
--
-- The agent runtime sets this to true on any agent message whose
-- result.deflection_offer is non-null (transfer_to_another_person,
-- credit_for_future_event, ticket_upgrade, or date_change_if_multi_day).
-- ============================================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deflection_offered BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_deflection_offered
  ON messages (conversation_id)
  WHERE deflection_offered = true;
