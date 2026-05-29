-- ============================================================================
-- 0025_whatsapp_session_state.sql
-- Replaces the in-memory whatsapp-session-state Map with a durable table so
-- pending event-selection prompts survive Vercel cold starts and work across
-- serverless invocations.
--
-- No RLS — this table is only ever accessed via createAdminClient() from the
-- WhatsApp inbound webhook handler.
-- ============================================================================

CREATE TABLE whatsapp_session_state (
  phone_e164 TEXT PRIMARY KEY,
  pending_event_selection JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plain index on expires_at so the cleanup query (`WHERE expires_at < now()`)
-- can scan only the small expired tail. A partial-index predicate using now()
-- is not allowed because now() is STABLE, not IMMUTABLE.
CREATE INDEX ON whatsapp_session_state (expires_at);
