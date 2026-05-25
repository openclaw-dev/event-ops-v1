-- ============================================================================
-- 0006_conversations_messages.sql
-- Stub tables for the agent loop. RLS, FKs, and migrations are correct from
-- day one; issues #7+ wire application logic.
--
-- conversations.refund_case_id FK is added in 0007 (after refund_cases exists).
-- ============================================================================

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  customer_phone_e164 TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'simulator' CHECK (channel IN ('simulator', 'whatsapp', 'email')),
  language TEXT NOT NULL DEFAULT 'en',
  state TEXT NOT NULL DEFAULT 'START',
  matched_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  refund_case_id UUID,                    -- FK added in 0007 after refund_cases exists
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON conversations (event_id);
CREATE INDEX ON conversations (event_id, state);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'human_operator')),
  text TEXT NOT NULL,
  classified_intent TEXT,
  cited_section_ids TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (conversation_id, created_at);
