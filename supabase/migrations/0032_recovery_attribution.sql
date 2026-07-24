-- ============================================================================
-- 0032_recovery_attribution.sql
--
-- Ties a recovered payment to a SIGNED payment-service-provider (PSP) webhook
-- so revenue-recovery fee stats are billed only on money a PSP actually
-- captured — never on a customer's "paid" text claim (which is a soft signal;
-- see DECISIONS.md 2026-07-22).
--
--   • recovery_ref (TZK-XXXXXX) is embedded in the PSP payment-link reference
--     and is the authoritative correlation key between an attempt and its
--     webhook. Fuzzy amount/phone matching is deliberately excluded from
--     fee-bearing numbers.
--   • webhook_confirmed_at / confirmed_amount / confirmed_currency are set ONLY
--     by the payment-webhook processor; getRecoveryStats and the revenue-leak
--     audit sum confirmed_amount over rows where webhook_confirmed_at IS NOT
--     NULL.
--   • heuristic_paid_signal_at records the soft customer-text signal, kept
--     separate so it can be surfaced ("claimed, awaiting confirmation") without
--     ever entering fee stats.
--
-- Applied manually post-merge (SQL editor). Highest applied migration before
-- this pair is 0030; 0031 (whatsapp_opt_outs) and this file are the new files.
-- ============================================================================

-- ── payment_recovery_attempts: attribution columns ─────────────────────────
ALTER TABLE payment_recovery_attempts
  ADD COLUMN IF NOT EXISTS provider                 TEXT,
  ADD COLUMN IF NOT EXISTS provider_payment_id      TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference       TEXT,
  ADD COLUMN IF NOT EXISTS webhook_confirmed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_amount          NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS confirmed_currency        TEXT,
  ADD COLUMN IF NOT EXISTS heuristic_paid_signal_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_ref              TEXT;

-- Backfill recovery_ref for pre-existing rows: 'TZK-' || 6 uppercase RFC-4648
-- base32 chars (alphabet A-Z2-7). random() is VOLATILE so it re-evaluates per
-- (row, position); GROUP BY reassembles 6 chars per row. Generated in code
-- (generateRecoveryRef) for all new rows going forward.
WITH gen AS (
  SELECT
    p.id,
    'TZK-' || string_agg(
      substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
             1 + floor(random() * 32)::int, 1),
      '' ORDER BY g.n
    ) AS ref
  FROM payment_recovery_attempts p
  CROSS JOIN generate_series(1, 6) AS g(n)
  WHERE p.recovery_ref IS NULL
  GROUP BY p.id
)
UPDATE payment_recovery_attempts p
SET recovery_ref = gen.ref
FROM gen
WHERE p.id = gen.id;

-- Unique correlation key. Nullable is fine (Postgres treats NULLs as distinct),
-- but all rows are backfilled above and code always sets it, so in practice it
-- is always present.
ALTER TABLE payment_recovery_attempts
  ADD CONSTRAINT payment_recovery_attempts_recovery_ref_key UNIQUE (recovery_ref);

-- Correlation lookups from the webhook processor.
CREATE INDEX IF NOT EXISTS payment_recovery_attempts_provider_payment_id_idx
  ON payment_recovery_attempts (provider_payment_id);

-- ── payment_webhook_events: append-only signed-webhook ledger ───────────────
-- Every accepted webhook (signature-valid) is recorded here for idempotency and
-- audit. No UPDATE/DELETE path exists in code — insert-only. (signature-invalid
-- requests are rejected 401 and store nothing.)
CREATE TABLE payment_webhook_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            TEXT NOT NULL,
  provider_event_id   TEXT NOT NULL,
  operator_id         UUID REFERENCES operators(id),
  recovery_attempt_id UUID REFERENCES payment_recovery_attempts(id),
  signature_valid     BOOLEAN NOT NULL,
  payload             JSONB NOT NULL,
  processed_at        TIMESTAMPTZ,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency: a redelivered (provider, event id) is dropped by the processor
  -- via ON CONFLICT, returning 200 without double-processing.
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX ON payment_webhook_events (recovery_attempt_id);

-- Accessed for WRITES via createAdminClient() (service-role) only. RLS enabled
-- with a SELECT-only policy so operators can read their own webhook events;
-- there is no INSERT/UPDATE/DELETE policy (append-only, admin-client writes).
ALTER TABLE payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_webhook_events_select ON payment_webhook_events FOR SELECT
  USING (operator_id IN (SELECT current_user_operator_ids()));
