-- ============================================================================
-- 0015_operator_kb.sql
-- Operator-level knowledge base (two-tier KB)
-- Operator KB applies to all events; event KB overrides on section_id conflict.
-- ============================================================================

CREATE TABLE operator_kb_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_file TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operator_id, section_id)
);

CREATE INDEX ON operator_kb_sections (operator_id);

ALTER TABLE operator_kb_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY operator_kb_sections_all ON operator_kb_sections FOR ALL
  USING (operator_id IN (SELECT current_user_operator_ids()))
  WITH CHECK (operator_id IN (SELECT current_user_operator_ids()));
