-- ============================================================================
-- 0013_data_entry.sql
-- Two new tables for the data entry surface:
--   change_events  — audit trail of every confirmed field change
--   mastersheet_mappings — stored field mapping per client format
-- ============================================================================

CREATE TABLE change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  changed_by TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'dashboard' CHECK (channel IN ('dashboard', 'whatsapp', 'system', 'mastersheet')),
  fields_changed TEXT[] NOT NULL,
  previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_values JSONB NOT NULL,
  systems_updated TEXT[] NOT NULL DEFAULT '{}',
  kb_sections_updated TEXT[] NOT NULL DEFAULT '{}',
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON change_events (event_id, created_at DESC);
CREATE INDEX ON change_events (operator_id, created_at DESC);

CREATE TABLE mastersheet_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  mapping_name TEXT NOT NULL,
  source_columns JSONB NOT NULL,
  field_map JSONB NOT NULL,
  confidence_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, mapping_name)
);
CREATE INDEX ON mastersheet_mappings (operator_id);

ALTER TABLE change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastersheet_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY change_events_all ON change_events FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));

CREATE POLICY mastersheet_mappings_all ON mastersheet_mappings FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));
