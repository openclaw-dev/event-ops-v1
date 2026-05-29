-- ============================================================================
-- 0019_demo_flag.sql
-- Adds is_demo flag to events table so demo events can be distinguished
-- from real events in the UI and excluded from production metrics.
-- ============================================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_events_is_demo
  ON events (operator_id, is_demo)
  WHERE deleted_at IS NULL;
