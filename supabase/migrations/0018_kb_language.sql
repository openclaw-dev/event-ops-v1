-- ============================================================================
-- 0018_kb_language.sql
-- Adds a language tag to kb_sections and operator_kb_sections so that
-- per-language KB content can be uploaded and retrieved separately.
--
-- language = 'all'  → served to every conversation regardless of detected language
-- language = 'en'   → served only to English conversations (DEFAULT for new uploads)
-- language = 'ar'   → served only to Arabic conversations
-- language = 'ru'   → served only to Russian conversations
-- ============================================================================

ALTER TABLE kb_sections
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'ar', 'ru', 'all'));

ALTER TABLE operator_kb_sections
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'ar', 'ru', 'all'));
