/**
 * KB retrieval for the agent runtime.
 *
 * Strategy:
 *   1. Intent match — query kb_sections WHERE event_id = X AND intent = Y.
 *   2. FTS fallback — when intent match yields zero, fetch the event's KB and
 *      keyword-rank against the message text. Postgres `to_tsvector` exists as
 *      an expression index, but invoking it via PostgREST without a stored
 *      tsvector column doesn't hit the index. With ~65 sections per event,
 *      in-memory keyword ranking is fast enough and avoids an RPC.
 *
 * RLS applies to every read — pass a user-scoped Supabase client.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
}

/**
 * Retrieve up to `limit` KB sections relevant to the message.
 *
 * Returns sections in descending relevance:
 *   - intent matches first (already filtered by classifier intent), ordered by
 *     keyword score against the message;
 *   - then FTS fallback if intent path yielded zero hits.
 */
export async function retrieveKB(
  supabase: SupabaseClient,
  eventId: string,
  opts: RetrievalOptions,
): Promise<RetrievedKBSection[]> {
  const limit = opts.limit ?? 3;
  const tokens = tokenize(opts.messageText);

  // Single-pass approach: pull the event's full KB (≤ a few hundred rows for v1),
  // score every section against the message tokens, and apply an intent-match
  // boost. Using intent as a hard filter caused parking-style queries to
  // surface a narrow intent's wrong-but-keyword-overlapping section
  // (e.g. venue_location.venue.location matches "venue" but doesn't answer
  // "parking"). Boosting instead of filtering lets the keyword-match override
  // when it's clearly stronger.
  const { data: all } = await supabase
    .from('kb_sections')
    .select(SELECT_COLUMNS)
    .eq('event_id', eventId);

  const rows = (all ?? []) as SelectedKBRow[];
  if (rows.length === 0) return [];

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

  // No keyword overlap at all → fall back to intent-only matches so the
  // generator at least sees the right-category content.
  if (scored.length === 0 && opts.intent) {
    const intentRows = rows.filter((r) => r.intent === opts.intent).slice(0, limit);
    return intentRows.map((r) => rowToSection(r, 'intent_match'));
  }

  return scored;
}
