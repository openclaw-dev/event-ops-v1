-- ============================================================================
-- 0007_escalations_refund_cases.sql
-- Stub tables for escalation queue and refund case tracking.
-- Adds the deferred FK from conversations.refund_case_id → refund_cases.id.
-- ============================================================================

CREATE TABLE escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  summary_for_ops TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'resolved', 'reopened')),
  claimed_by UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  resolved_by UUID REFERENCES operator_users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON escalations (event_id, status);

CREATE TABLE refund_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  reason TEXT,
  outcome TEXT CHECK (outcome IN ('resolved_deflected', 'resolved_refund_approved_by_human', 'resolved_other', 'escalated_unresolved', NULL)),
  alternative_offered TEXT,
  alternative_accepted BOOLEAN,
  estimated_value_saved NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON refund_cases (event_id);

ALTER TABLE conversations ADD CONSTRAINT conversations_refund_case_fk
  FOREIGN KEY (refund_case_id) REFERENCES refund_cases(id) ON DELETE SET NULL;
