-- ============================================================================
-- 0004_kb.sql
-- KB documents (one per file uploaded) and parsed KB sections (one per Q/A).
-- ============================================================================

CREATE TABLE kb_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_format TEXT NOT NULL CHECK (file_format IN ('markdown', 'json', 'pdf')),
  storage_path TEXT NOT NULL,             -- Supabase Storage path: events/{event_id}/kb/{filename}
  uploaded_by UUID NOT NULL REFERENCES operator_users(id) ON DELETE CASCADE,
  section_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON kb_documents (event_id);

CREATE TABLE kb_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kb_document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,               -- Human-readable, e.g. 'policy.refund.standard'
  category TEXT,
  intent TEXT,                            -- One of the intent taxonomy values
  escalation_needed BOOLEAN NOT NULL DEFAULT false,
  question_en TEXT,
  answer_en TEXT NOT NULL,
  question_ar TEXT,
  answer_ar TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, section_id)
);
CREATE INDEX ON kb_sections (event_id);
CREATE INDEX ON kb_sections (event_id, intent);
-- Full-text search indexes for keyword retrieval (no vector DB in v1).
CREATE INDEX kb_sections_fts_en_idx ON kb_sections
  USING GIN (to_tsvector('english', coalesce(question_en, '') || ' ' || answer_en));
CREATE INDEX kb_sections_fts_ar_idx ON kb_sections
  USING GIN (to_tsvector('arabic', coalesce(question_ar, '') || ' ' || coalesce(answer_ar, '')));
