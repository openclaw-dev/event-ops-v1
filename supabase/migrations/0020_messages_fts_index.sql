-- ============================================================================
-- 0020_messages_fts_index.sql
-- GIN index on messages.text for full-text search from the conversations list.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_messages_content_fts
  ON messages USING gin(to_tsvector('english', text));
