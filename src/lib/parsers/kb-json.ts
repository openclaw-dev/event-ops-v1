import type { ParsedSection, ParseResult } from './kb-types';

/**
 * Shape of each entry in the KB JSON fixture files.
 * Fields match `kb_coastline_festival.json` and `kb_nightline_club.json`.
 */
interface KBJsonEntry {
  section_id: string;
  category?: string | null;
  intent?: string | null;
  escalation_needed?: boolean | null;
  question_en?: string | null;
  /** Mapped to kb_sections.answer_en */
  answer_en_neutral: string;
  question_ar?: string | null;
  /** Mapped to kb_sections.answer_ar */
  answer_ar_neutral?: string | null;
}

interface KBJsonDoc {
  event_metadata?: Record<string, unknown>;
  entries: KBJsonEntry[];
}

/**
 * Parse a KB JSON document.
 *
 * Expected shape (spec §6.2):
 * ```json
 * {
 *   "event_metadata": { ... },
 *   "entries": [
 *     {
 *       "section_id": "policy.refund.standard",
 *       "category": "Ticketing",
 *       "intent": "refund",
 *       "escalation_needed": false,
 *       "question_en": "...",
 *       "answer_en_neutral": "...",
 *       "question_ar": "...",
 *       "answer_ar_neutral": "..."
 *     }
 *   ]
 * }
 * ```
 */
export function parseJson(content: string): ParseResult {
  const sections: ParsedSection[] = [];
  const errors: string[] = [];

  let doc: KBJsonDoc;
  try {
    doc = JSON.parse(content) as KBJsonDoc;
  } catch {
    return { sections: [], errors: ['Invalid JSON: could not parse file.'] };
  }

  if (!doc || !Array.isArray(doc.entries)) {
    return {
      sections: [],
      errors: ['JSON must have a top-level "entries" array.'],
    };
  }

  doc.entries.forEach((entry, i) => {
    try {
      if (!entry.section_id || typeof entry.section_id !== 'string') {
        errors.push(`Entry ${i + 1}: missing or invalid "section_id", skipped.`);
        return;
      }
      if (!entry.answer_en_neutral || typeof entry.answer_en_neutral !== 'string') {
        errors.push(`Entry ${i + 1} (${entry.section_id}): missing "answer_en_neutral", skipped.`);
        return;
      }

      sections.push({
        section_id: entry.section_id.trim(),
        category: entry.category ?? null,
        intent: entry.intent ?? null,
        escalation_needed: entry.escalation_needed ?? false,
        question_en: entry.question_en ?? null,
        answer_en: entry.answer_en_neutral,
        question_ar: entry.question_ar ?? null,
        answer_ar: entry.answer_ar_neutral ?? null,
        sort_order: i,
      });
    } catch (err) {
      errors.push(
        `Entry ${i + 1}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  return { sections, errors };
}
