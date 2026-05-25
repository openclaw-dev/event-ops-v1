-- ============================================================================
-- 0008_audit_log.sql
-- Append-only audit log. Every operator action and every agent decision lands here.
-- Writes via service role only (no user policy created); reads scoped via RLS.
-- ============================================================================

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID REFERENCES operators(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (event_id, created_at DESC);
CREATE INDEX ON audit_log (operator_id, created_at DESC);
