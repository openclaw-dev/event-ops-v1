-- ============================================================================
-- 0026_payment_recovery.sql
-- Tracks outbound WhatsApp payment-recovery messages to customers whose
-- payment failed or abandoned checkout.
-- ============================================================================

CREATE TABLE payment_recovery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Customer details
  customer_phone_e164 TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,

  -- Order details
  original_order_id TEXT,
  ticket_type TEXT,
  quantity INT NOT NULL DEFAULT 1,
  amount_sar NUMERIC(10, 2) NOT NULL,

  -- Recovery attempt
  payment_link TEXT,
  payment_provider TEXT CHECK (payment_provider IN ('checkout', 'tabby', 'tamara', 'tap', 'manual')),
  whatsapp_message_wamid TEXT,

  -- Status lifecycle
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'opened', 'completed', 'failed', 'expired')),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),

  -- Tracking
  recovery_fee_sar NUMERIC(10, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON payment_recovery_attempts (operator_id, event_id);
CREATE INDEX ON payment_recovery_attempts (customer_phone_e164);
CREATE INDEX ON payment_recovery_attempts (status, expires_at) WHERE status = 'pending';

ALTER TABLE payment_recovery_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_recovery_attempts_all ON payment_recovery_attempts FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));
