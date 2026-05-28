-- ============================================================================
-- 0016_mastersheet_fingerprint.sql
-- Adds format_fingerprint to mastersheet_mappings so the upload route can
-- skip Haiku inference when the same column layout has been seen before.
-- Also adds operator_id FK in case it was missing (IF NOT EXISTS is a no-op
-- when the column already exists from 0013).
-- ============================================================================

ALTER TABLE mastersheet_mappings
  ADD COLUMN IF NOT EXISTS format_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS operator_id UUID REFERENCES operators(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mastersheet_mappings_fingerprint
  ON mastersheet_mappings (operator_id, format_fingerprint)
  WHERE format_fingerprint IS NOT NULL;
