-- ============================================================================
-- 0022_usage_tracking.sql
-- Per-operator API usage events for billing and cost visibility.
-- ============================================================================

CREATE TABLE usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'support_message', 'change_extraction', 'field_mapping',
    'kb_conversion', 'report_generation'
  )),
  model TEXT NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cache_read_tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON usage_events (operator_id, created_at DESC);
CREATE INDEX ON usage_events (event_id) WHERE event_id IS NOT NULL;

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_events_select ON usage_events FOR SELECT
  USING (operator_id IN (SELECT current_user_operator_ids()));

-- Inserts go through the service-role client (admin) only.
-- No INSERT policy for authenticated users.
