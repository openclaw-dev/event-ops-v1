-- ============================================================================
-- 0031_whatsapp_opt_outs.sql
--
-- Durable, cross-flow WhatsApp opt-out registry. Closes two gaps documented in
-- CLAUDE.md / AUDIT_2026-07:
--   • recovery opt-out was behavioural-only (payment_recovery_attempts has no
--     opt-out status) — a STOP stopped only the current inbound turn;
--   • CRM re-add gap — a phone marked 'opted_out' on one campaign could be
--     re-added as 'pending' on a NEW campaign and messaged again.
--
-- This table is now the AUTHORITATIVE opt-out record. The outbound chokepoint
-- (src/lib/whatsapp/outbound-guard.ts) consults it before every
-- business-initiated send (recovery, CRM, future campaigns). Reply-to-inbound
-- messages inside a customer-initiated conversation are exempt by design.
--
-- Scope is PER OPERATOR: an opt-out for operator A does not silence operator B.
-- STOP is permanent until manual removal; there is no START re-subscribe flow
-- yet (see DECISIONS.md 2026-07-22).
--
-- Accessed for WRITES only via createAdminClient() (service-role). RLS is
-- enabled with a SELECT-only policy so operators can read their own opt-outs
-- in the dashboard, but no anon/user path can INSERT/UPDATE/DELETE — every
-- mutation goes through the guard / pre-router using the admin client.
-- ============================================================================

CREATE TABLE whatsapp_opt_outs (
  operator_id     UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  phone_e164      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'stop_keyword'
    CHECK (source IN ('stop_keyword', 'manual', 'crm_unsubscribe', 'import')),
  conversation_id UUID REFERENCES conversations(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (operator_id, phone_e164),

  -- Canonical E.164 (leading '+', 7-15 digits) — identical to the recovery
  -- bulk-upload validation regex (src/app/api/recovery/bulk/route.ts) and the
  -- normalizePhone() helper output. Guarantees the guard's lookup key and the
  -- STOP writer's key are byte-identical.
  CONSTRAINT whatsapp_opt_outs_phone_e164_format
    CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

-- Reverse-lookup by phone (e.g. "which operators has this number opted out
-- of?" / cross-operator diagnostics).
CREATE INDEX ON whatsapp_opt_outs (phone_e164);

ALTER TABLE whatsapp_opt_outs ENABLE ROW LEVEL SECURITY;

-- SELECT only. No INSERT/UPDATE/DELETE policies: all writes are via the
-- service-role admin client (guard + inbound pre-router), which bypasses RLS.
CREATE POLICY whatsapp_opt_outs_select ON whatsapp_opt_outs FOR SELECT
  USING (operator_id IN (SELECT current_user_operator_ids()));

-- ── Backfill from existing CRM opt-out records ──────────────────────────────
-- crm_campaign_recipients.status = 'opted_out' is the only durable opt-out
-- signal that existed before this table. Normalise each phone to canonical
-- E.164 ('+' || digits-only) so the CHECK constraint passes even if a legacy
-- row was stored without the leading '+'. Distinct on (operator_id, phone) to
-- satisfy the composite PK; ON CONFLICT DO NOTHING is defensive.
INSERT INTO whatsapp_opt_outs (operator_id, phone_e164, source)
SELECT DISTINCT
  operator_id,
  '+' || regexp_replace(customer_phone_e164, '[^0-9]', '', 'g') AS phone_e164,
  'crm_unsubscribe'
FROM crm_campaign_recipients
WHERE status = 'opted_out'
  AND customer_phone_e164 IS NOT NULL
  AND regexp_replace(customer_phone_e164, '[^0-9]', '', 'g') ~ '^[1-9][0-9]{6,14}$'
ON CONFLICT (operator_id, phone_e164) DO NOTHING;
