/** A parsed KB section ready to be upserted into kb_sections. */
export interface ParsedSection {
  section_id: string;
  category: string | null;
  intent: string | null;
  escalation_needed: boolean;
  question_en: string | null;
  answer_en: string;
  question_ar: string | null;
  answer_ar: string | null;
  sort_order: number;
}

export interface ParseResult {
  sections: ParsedSection[];
  /** Recoverable per-section errors (section was skipped). */
  errors: string[];
}
