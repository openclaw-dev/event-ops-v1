-- ============================================================================
-- 0017_conversation_whatsapp.sql
-- Extends conversations for WhatsApp customer support routing, and adds
-- WhatsApp configuration fields to operators.
-- ============================================================================

-- conversations: add wa_message_id and operator_id
-- channel and customer_phone_e164 already exist from 0006.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS wa_message_id   TEXT,
  ADD COLUMN IF NOT EXISTS operator_id     UUID REFERENCES operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_customer_phone
  ON conversations (event_id, customer_phone_e164)
  WHERE customer_phone_e164 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_wa_message_id
  ON conversations (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

-- operators: WhatsApp business credentials
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS whatsapp_business_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_display_phone_e164       TEXT;

CREATE INDEX IF NOT EXISTS idx_operators_wa_phone_number_id
  ON operators (whatsapp_business_phone_number_id)
  WHERE whatsapp_business_phone_number_id IS NOT NULL;
