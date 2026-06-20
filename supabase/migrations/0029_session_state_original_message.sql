-- ============================================================================
-- 0029_session_state_original_message.sql
-- Adds original_message column to whatsapp_session_state so the inbound
-- webhook can re-inject the customer's original question after they resolve
-- a multi-event selection prompt (e.g., reply "1" to pick Boho Beach Test).
-- Without this, the selection reply ("1") was passed to the KB/agent instead
-- of the real question, causing spurious escalations on simple FAQ turns.
-- ============================================================================

ALTER TABLE whatsapp_session_state
  ADD COLUMN IF NOT EXISTS original_message TEXT;
