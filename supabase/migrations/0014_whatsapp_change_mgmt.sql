-- ============================================================================
-- 0014_whatsapp_change_mgmt.sql
-- WhatsApp change management surface (v1.6)
-- Adds: promoters, pending_changes tables
-- Alters: operators table with WhatsApp config columns
-- ============================================================================

-- WhatsApp config on operators
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT
    CHECK (whatsapp_provider IN ('meta', '360dialog', NULL)),
  ADD COLUMN IF NOT EXISTS whatsapp_business_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_display_phone_e164 TEXT;

-- Promoters: phone whitelist per event
CREATE TABLE promoters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  display_name TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en', 'ar', 'ru')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, phone_e164)
);
CREATE INDEX ON promoters (operator_id);
CREATE INDEX ON promoters (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX ON promoters (phone_e164) WHERE is_active = true;

-- Pending changes: pre-confirmation diffs
CREATE TABLE pending_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  promoter_id UUID NOT NULL REFERENCES promoters(id) ON DELETE CASCADE,

  -- Inbound message
  inbound_wamid TEXT NOT NULL UNIQUE,
  inbound_text TEXT NOT NULL,
  inbound_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Extraction results
  diff_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ambiguous_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  extraction_model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  extraction_input_tokens INT,
  extraction_output_tokens INT,
  extraction_ambiguous BOOLEAN NOT NULL DEFAULT false,
  extraction_notes TEXT,

  -- Outbound confirmation message
  confirmation_wamid TEXT,
  confirmation_sent_at TIMESTAMPTZ,
  confirmation_send_error TEXT,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','cancelled','superseded','expired','send_failed')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  confirmed_by_user_id UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  confirmed_via TEXT CHECK (confirmed_via IN ('whatsapp','dashboard',NULL)),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  -- Downstream linkage
  change_event_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  dato_sync_status TEXT CHECK (dato_sync_status IN ('skipped','success','failed',NULL)),
  dato_sync_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON pending_changes (event_id, status) WHERE status = 'pending';
CREATE INDEX ON pending_changes (operator_id, created_at DESC);
CREATE INDEX ON pending_changes (confirmation_wamid) WHERE confirmation_wamid IS NOT NULL;
CREATE INDEX ON pending_changes (expires_at) WHERE status = 'pending';

-- RLS
ALTER TABLE promoters ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY promoters_all ON promoters FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));

CREATE POLICY pending_changes_all ON pending_changes FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));
