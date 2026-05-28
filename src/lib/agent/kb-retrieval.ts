/**
 * KB retrieval for the agent runtime.
 *
 * Strategy:
 *   1. Fetch event-specific sections (kb_sections WHERE event_id = X).
 *   2. Fetch operator-level sections (operator_kb_sections WHERE operator_id = Y)
 *      when operatorId is supplied — uses admin client to bypass RLS in the
 *      agent runtime path where only the user-scoped client is available.
 *   3. Merge: event sections take precedence over operator sections on
 *      section_id conflict, so event-specific overrides always win.
 *   4. Score the merged set: intent match (boost) + keyword overlap.
 *   5. FTS fallback — when intent match yields zero from event rows, fall back
 *      to intent-only on event rows (operator rows have no intent field).
 *
 * RLS applies to the user-scoped event-KB read; admin client is used only for
 * the operator-KB query where session context is absent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';
import type { Language, RetrievedKBSection } from './types';

const SELECT_COLUMNS =
  'section_id, category, intent, escalation_needed, question_en, answer_en, question_ar, answer_ar';

interface SelectedKBRow {
  section_id: string;
  category: string | null;
  intent: string | null;
  escalation_needed: boolean;
  question_en: string | null;
  answer_en: string;
  question_ar: string | null;
  answer_ar: string | null;
}

function rowToSection(
  row: SelectedKBRow,
  source: RetrievedKBSection['source'],
): RetrievedKBSection {
  return {
    section_id: row.section_id,
    category: row.category,
    intent: row.intent,
    escalation_needed: row.escalation_needed,
    question_en: row.question_en,
    answer_en: row.answer_en,
    question_ar: row.question_ar,
    answer_ar: row.answer_ar,
    source,
  };
}

// Words that add noise without discriminative value.
const STOPWORDS_EN = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does',
  'for', 'from', 'has', 'have', 'how', 'i', 'if', 'in', 'is', 'it', 'me', 'my',
  'no', 'not', 'of', 'on', 'or', 'so', 'that', 'the', 'this', 'to', 'too',
  'was', 'we', 'were', 'what', 'when', 'where', 'who', 'why', 'will', 'with',
  'you', 'your', 'about', 'just', 'please', 'thanks', 'thank', 'hi', 'hello',
  'hey', 'sir', 'maam', 'madam',
]);

/**
 * Tokenize a message into search terms (lowercase, ≥3 chars, non-stopword).
 * Falls back to substring matching for very short queries.
 */
function tokenize(text: string): string[] {
  // Replace anything that isn't a letter/digit/whitespace with a space.
  // Uses ASCII+Latin1+Arabic+Cyrillic ranges instead of \p{L}\p{N} so we
  // don't depend on the unicode-property-escape flag (target=es3 default).
  return text
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ؀-ۿЀ-ӿ\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS_EN.has(w));
}

/**
 * Score a section against a tokenized query.
 * Counts how many query tokens appear anywhere in the section's text fields.
 */
function scoreSection(row: SelectedKBRow, tokens: string[], language: Language): number {
  if (tokens.length === 0) return 0;
  const haystackEn = [
    row.section_id,
    row.category ?? '',
    row.intent ?? '',
    row.question_en ?? '',
    row.answer_en,
  ]
    .join(' ')
    .toLowerCase();
  const haystackAr = [row.question_ar ?? '', row.answer_ar ?? ''].join(' ');
  let score = 0;
  for (const t of tokens) {
    if (haystackEn.includes(t)) score += 2;
    // For Arabic / mixed messages also try matching against AR fields.
    if ((language === 'ar' || language === 'mixed') && haystackAr.includes(t)) {
      score += 2;
    }
  }
  return score;
}

export interface RetrievalOptions {
  /** Hint from classifier. */
  intent: string | null;
  /** Raw message — used for FTS fallback ranking. */
  messageText: string;
  /** Language hint — biases AR matching when needed. */
  language: Language;
  /** Cap on returned sections (default 3). */
  limit?: number;
  /**
   * Operator ID — when provided, also queries operator_kb_sections and merges
   * results (event sections take precedence on section_id conflict).
   */
  operatorId?: string;
}

/**
 * Retrieve up to `limit` KB sections relevant to the message.
 *
 * Merges event-specific and operator-level KB sections, then ranks by
 * keyword score + intent-match boost. Event sections override operator
 * sections when the same section_id appears in both.
 */
export async function retrieveKB(
  supabase: SupabaseClient,
  eventId: string,
  opts: RetrievalOptions,
): Promise<RetrievedKBSection[]> {
  const limit = opts.limit ?? 3;
  const tokens = tokenize(opts.messageText);

  // ── 1. Fetch event-specific KB sections ───────────────────────────────────
  const { data: eventData } = await supabase
    .from('kb_sections')
    .select(SELECT_COLUMNS)
    .eq('event_id', eventId);

  const eventRows = (eventData ?? []) as SelectedKBRow[];

  // ── 2. Fetch operator-level KB sections ───────────────────────────────────
  let operatorRows: SelectedKBRow[] = [];
  if (opts.operatorId) {
    const admin = createAdminClient();
    const { data: opData } = await admin
      .from('operator_kb_sections')
      .select('section_id, title, content')
      .eq('operator_id', opts.operatorId);

    // Map operator sections to the common SelectedKBRow shape.
    // title → question_en (provides searchable context), content → answer_en.
    operatorRows = ((opData ?? []) as Array<{ section_id: string; title: string; content: string }>)
      .map((r) => ({
        section_id: r.section_id,
        category: null,
        intent: null,
        escalation_needed: false,
        question_en: r.title,
        answer_en: r.content,
        question_ar: null,
        answer_ar: null,
      }));
  }

  // ── 3. Merge: event sections override operator sections on section_id conflict ──
  const merged = new Map<string, SelectedKBRow>();
  for (const row of operatorRows) {
    merged.set(row.section_id, row);
  }
  for (const row of eventRows) {
    merged.set(row.section_id, row);
  }

  const rows = Array.from(merged.values());
  if (rows.length === 0) return [];

  // ── 4. Score merged rows ──────────────────────────────────────────────────
  const INTENT_BOOST = 3;
  const scored = rows
    .map((r) => {
      const base = scoreSection(r, tokens, opts.language);
      const matchedIntent = opts.intent != null && r.intent === opts.intent;
      const score = base + (matchedIntent ? INTENT_BOOST : 0);
      return { row: r, score, base, matchedIntent };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, matchedIntent }) =>
      rowToSection(row, matchedIntent ? 'intent_match' : 'fts_fallback'),
    );

  // ── 5. Fallback: intent-only from event rows ──────────────────────────────
  // No keyword overlap at all → fall back to intent-only matches on event rows
  // so the generator at least sees the right-category content.
  // Operator rows are excluded from the intent fallback because they have
  // no intent field and would never match.
  if (scored.length === 0 && opts.intent) {
    const intentRows = eventRows.filter((r) => r.intent === opts.intent).slice(0, limit);
    return intentRows.map((r) => rowToSection(r, 'intent_match'));
  }

  return scored;
}
