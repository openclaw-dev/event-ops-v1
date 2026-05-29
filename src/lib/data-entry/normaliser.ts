/**
 * normaliser.ts
 *
 * Accepts a Buffer of an .xlsx file and uses Claude Haiku to map spreadsheet
 * columns to EventSetupFormData field keypaths.
 *
 * Handles two sheet formats:
 *   - Horizontal: row 1 = column headers, rows 2..N = data (standard table)
 *   - Vertical KV: column A = field name, column B = value (e.g. YellowPlus)
 *
 * Format detection (per sheet):
 *   1. If cell A1 matches a KV meta-header keyword ("Field Name", "Key", …)
 *      → vertical with a header row (skip row 1, read from row 2)
 *   2. Else if row 1 has 3+ non-empty cells → horizontal
 *   3. Else (1–2 cells in row 1, no keyword) → vertical without header row
 *      (A1 is itself the first field name, not a meta-label)
 *
 * Cache behaviour:
 *   When operatorId is supplied to normaliseSheet(), the function computes a
 *   SHA-256 fingerprint of the sheet's field names (not values) and checks
 *   mastersheet_mappings for a cached result that is less than 30 days old.
 *   On a cache hit the Haiku call is skipped entirely. On a miss the result
 *   is stored for future uploads.
 */

import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { claude } from '@/lib/agent/anthropic-client';
import { createAdminClient } from '@/lib/supabase/admin';
import { trackUsage } from '@/lib/billing/track-usage';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface FieldMapping {
  source_sheet: string;
  source_column: string; // column header (horizontal) or field_name (vertical)
  target_field: string;  // keypath into EventSetupFormData
  sample_value: string;
  confidence: number;    // 0-1
  needs_review: boolean; // true if confidence < 0.85
}

export interface MappingResult {
  success: boolean;
  error?: string;
  mappings: FieldMapping[];
  unmapped_columns: string[];
  high_confidence_count: number;
  needs_review_count: number;
  raw_data: Record<string, unknown>[];
  /** True when the mapping came from the mastersheet_mappings cache, not Haiku. */
  from_cache?: boolean;
}

// ─── Valid EventSetupFormData keypaths ────────────────────────────────────────
// Extracted from src/lib/schemas.ts — keep in sync if schema changes.
// Ordered with the most commonly populated fields first for prompt clarity.

const VALID_KEYPATHS = [
  'name',
  'slug',
  'event_type',
  'start_date',
  'end_date',
  'timezone',
  'venue_name',
  'venue_city',
  'capacity',
  'age_minimum',
  'doors_open_local',
  'doors_close_local',
  'last_entry_local',
  'dress_code',
  'parking_info',
  'ticket_tiers',
  'refund_policy.shape',
  'refund_policy.tiers',
  'refund_policy.allowed_alternatives_after_window',
  'refund_policy.credit_validity_months',
  'refund_policy.medical_exception_section_id',
  'vip_orders_always_escalate',
  'escalation_keywords',
  'escalation_contacts',
] as const;

// ─── Internal types ───────────────────────────────────────────────────────────

type SheetFormat = 'horizontal' | 'vertical';

interface KVPair {
  field_name: string;
  value: string;
}

/** Unified shape sent to Haiku — format-aware. */
interface SheetSample {
  sheetName: string;
  format: SheetFormat;
  // horizontal only
  columns: string[];
  rows: Record<string, unknown>[];
  // vertical only
  kv_pairs: KVPair[];
}

interface HaikuMapping {
  source_sheet: string;
  source_column: string;
  target_field: string;
  sample_value: string;
  confidence: number;
}

interface HaikuResponse {
  mappings: HaikuMapping[];
  unmapped_columns: string[];
}

// ─── Format detection ─────────────────────────────────────────────────────────

/**
 * Keywords that, when found in cell A1 (case-insensitive, trimmed), signal
 * that this sheet uses a vertical key-value layout with a meta-header row.
 */
const KV_A1_KEYWORDS = [
  'field name',
  'fieldname',
  'field_name',
  'field',
  'key',
  'label',
  'property',
  'attribute',
  'parameter',
];

function detectFormat(ws: XLSX.WorkSheet): { format: SheetFormat; hasHeaderRow: boolean } {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
  if (rawRows.length === 0) return { format: 'horizontal', hasHeaderRow: false };

  const firstRow = rawRows[0] as unknown[];
  const cellA1 = String(firstRow[0] ?? '').trim().toLowerCase();

  // 1. Explicit KV meta-header in A1 ("Field Name", "Key", etc.)
  const isKVHeader = KV_A1_KEYWORDS.some(
    (kw) => cellA1 === kw || cellA1.startsWith(kw + ' ') || cellA1.startsWith(kw + '_'),
  );
  if (isKVHeader) {
    return { format: 'vertical', hasHeaderRow: true };
  }

  // 2. Count non-empty cells in row 1 — 3+ → horizontal table
  const nonEmpty = firstRow.filter(
    (c) => c !== null && c !== undefined && String(c).trim() !== '',
  ).length;
  if (nonEmpty >= 3) {
    return { format: 'horizontal', hasHeaderRow: false };
  }

  // 3. 1–2 populated cells, no keyword → vertical without a meta-header row
  //    (A1 is itself the first field name)
  return { format: 'vertical', hasHeaderRow: false };
}

// ─── Sheet extraction ─────────────────────────────────────────────────────────

function extractVerticalKVPairs(ws: XLSX.WorkSheet, hasHeaderRow: boolean): KVPair[] {
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) as unknown[][];
  const startRow = hasHeaderRow ? 1 : 0;
  const pairs: KVPair[] = [];

  for (let i = startRow; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const fieldName = String(row[0] ?? '').trim();
    const value = String(row[1] ?? '').trim();
    if (fieldName) {
      pairs.push({ field_name: fieldName, value });
    }
  }
  return pairs;
}

function extractHorizontalRows(ws: XLSX.WorkSheet): {
  columns: string[];
  rows: Record<string, unknown>[];
} {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
  }) as Record<string, unknown>[];

  if (rows.length === 0) return { columns: [], rows: [] };
  return { columns: Object.keys(rows[0]), rows: rows.slice(0, 5) };
}

/**
 * Reads up to 3 sheets, detects format per sheet, and returns structured
 * samples plus raw data suitable for the confirm route's resolveValue().
 *
 * raw_data contract:
 *   - horizontal: array of row objects keyed by column header
 *   - vertical: array with a single merged record keyed by field_name
 *     so that resolveValue(field, mappings, raw_data) works for both formats.
 */
function extractSheetSamples(buf: Buffer): {
  samples: SheetSample[];
  raw: Record<string, unknown>[];
} {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const samples: SheetSample[] = [];
  const raw: Record<string, unknown>[] = [];

  for (const sheetName of wb.SheetNames.slice(0, 3)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const { format, hasHeaderRow } = detectFormat(ws);

    if (format === 'vertical') {
      const kvPairs = extractVerticalKVPairs(ws, hasHeaderRow);
      if (kvPairs.length === 0) continue;

      // Build a single merged record so resolveValue can look up by field_name.
      const merged: Record<string, unknown> = {};
      for (const { field_name, value } of kvPairs) {
        merged[field_name] = value;
      }

      samples.push({
        sheetName,
        format: 'vertical',
        columns: [],
        rows: [],
        kv_pairs: kvPairs,
      });
      raw.push(merged);
    } else {
      const { columns, rows } = extractHorizontalRows(ws);
      if (columns.length === 0) continue;

      // All rows go into raw for resolveValue.
      const allRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: '',
      }) as Record<string, unknown>[];

      samples.push({
        sheetName,
        format: 'horizontal',
        columns,
        rows,
        kv_pairs: [],
      });
      raw.push(...allRows);
    }
  }

  return { samples, raw };
}

// ─── Haiku call ───────────────────────────────────────────────────────────────

interface HaikuMappingResult {
  response: HaikuResponse;
  usage: { input_tokens: number; output_tokens: number; cache_read_tokens: number };
}

async function callHaikuForMappings(samples: SheetSample[]): Promise<HaikuMappingResult> {
  const systemPrompt = `You are a data mapping assistant. Your job is to map event data to standard field names.

Valid target field keypaths — use ONLY these exact strings, no others:
${VALID_KEYPATHS.join('\n')}

You will receive one or more sheets. Each sheet has a "format" field:
- "horizontal": standard table. "columns" contains the header row; map each column to a target field.
  Use the column header as source_column.
- "vertical": key-value layout. "kv_pairs" is an array of {field_name, value} pairs.
  Map each field_name to a target field. Use field_name as source_column and value as sample_value.

Rules:
- Map only when confident the source represents that field.
- Set confidence 0.0–1.0 (1.0 = certain match, 0.5 = plausible but unclear).
- For start_date / end_date: sample_value should be YYYY-MM-DD if possible.
- For time fields (doors_open_local, doors_close_local, last_entry_local): HH:MM format.
- If a column or field_name cannot be mapped to any valid field, add it to unmapped_columns.
- Return ONLY valid JSON. No markdown fences, no preamble, no explanation.

Response format (strict JSON):
{
  "mappings": [
    {
      "source_sheet": "<sheet name>",
      "source_column": "<column header or field_name>",
      "target_field": "<valid keypath from list above>",
      "sample_value": "<first non-empty value as string>",
      "confidence": 0.95
    }
  ],
  "unmapped_columns": ["<column or field_name>", ...]
}`;

  const userContent = JSON.stringify(
    samples.map((s) =>
      s.format === 'vertical'
        ? { sheet: s.sheetName, format: 'vertical', kv_pairs: s.kv_pairs }
        : { sheet: s.sheetName, format: 'horizontal', columns: s.columns, sample_rows: s.rows },
    ),
  );

  const msg = await claude.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  return {
    response: parseHaikuJson(text),
    usage: {
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
      cache_read_tokens:
        ((msg.usage as unknown) as Record<string, unknown>).cache_read_input_tokens as number ?? 0,
    },
  };
}

function parseHaikuJson(raw: string): HaikuResponse {
  // Strip markdown fences if the model ignores the instruction.
  const stripped = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  return JSON.parse(stripped) as HaikuResponse;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

/** 30 days in milliseconds — mappings older than this are considered stale. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Builds a flat array of { sheet, field_name, value } from SheetSample[].
 * Used as input to computeFormatFingerprint.
 *   - vertical sheets: each kv_pair contributes its field_name
 *   - horizontal sheets: each column header is the field_name
 */
function buildFingerprintInput(
  samples: SheetSample[],
): Array<{ sheet: string; field_name: string; value: string }> {
  const result: Array<{ sheet: string; field_name: string; value: string }> = [];
  for (const sample of samples) {
    if (sample.format === 'vertical') {
      for (const { field_name, value } of sample.kv_pairs) {
        result.push({ sheet: sample.sheetName, field_name, value });
      }
    } else {
      for (const col of sample.columns) {
        result.push({ sheet: sample.sheetName, field_name: col, value: '' });
      }
    }
  }
  return result;
}

/**
 * Overlays current sample values onto cached mappings.
 * Cached mappings may have stale sample_values from a previous upload;
 * this refreshes them from the current extraction so the confirm screen
 * shows values the operator actually recognises.
 */
function reconstructMappingsFromCache(
  cached: FieldMapping[],
  samples: SheetSample[],
): FieldMapping[] {
  const valueLookup: Record<string, string> = {};
  for (const sample of samples) {
    if (sample.format === 'vertical') {
      for (const { field_name, value } of sample.kv_pairs) {
        valueLookup[field_name] = value;
      }
    } else {
      const firstRow = sample.rows[0] ?? {};
      for (const col of sample.columns) {
        valueLookup[col] = String(firstRow[col] ?? '');
      }
    }
  }

  return cached.map((m) => ({
    ...m,
    sample_value: valueLookup[m.source_column] ?? m.sample_value,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes a stable fingerprint for a mastersheet format from its field names.
 *
 * Values are intentionally excluded — field names (column headers or KV keys)
 * are stable across events that use the same template, while values change
 * every event. This lets the cache survive re-uploads with different data.
 *
 * @param kv_pairs  Flat list of { sheet, field_name, value } from all sheets.
 * @returns         SHA-256 hex string of the sorted, pipe-joined field names.
 */
export function computeFormatFingerprint(
  kv_pairs: Array<{ sheet: string; field_name: string; value: string }>,
): string {
  const fieldNames = kv_pairs.map((p) => p.field_name).sort();
  const joined = fieldNames.join('|');
  return createHash('sha256').update(joined).digest('hex');
}

/**
 * Parses an xlsx buffer, auto-detects sheet format (horizontal table or vertical
 * key-value), and maps columns/fields to EventSetupFormData keypaths.
 *
 * When operatorId is supplied:
 *   1. Computes a SHA-256 fingerprint of the sheet's field names.
 *   2. Checks mastersheet_mappings for a cached result < 30 days old.
 *   3. If found: returns cached mappings immediately (from_cache: true),
 *      skipping the Haiku call entirely.
 *   4. If not found: calls Haiku, then stores the result for next time.
 *
 * @param buf         xlsx file buffer
 * @param operatorId  optional — enables cache check/store when provided
 */
export async function normaliseSheet(buf: Buffer, operatorId?: string): Promise<MappingResult> {
  let samples: SheetSample[];
  let raw: Record<string, unknown>[];

  try {
    ({ samples, raw } = extractSheetSamples(buf));
  } catch (err) {
    return {
      success: false,
      error: `Failed to parse xlsx: ${err instanceof Error ? err.message : String(err)}`,
      mappings: [],
      unmapped_columns: [],
      high_confidence_count: 0,
      needs_review_count: 0,
      raw_data: [],
    };
  }

  if (samples.length === 0) {
    return {
      success: false,
      error: 'No readable sheets found in the uploaded file.',
      mappings: [],
      unmapped_columns: [],
      high_confidence_count: 0,
      needs_review_count: 0,
      raw_data: [],
    };
  }

  // ── Fingerprint — computed once, used for cache-check and cache-store ─────
  const fingerprintInput = buildFingerprintInput(samples);
  const fingerprint = operatorId ? computeFormatFingerprint(fingerprintInput) : undefined;

  // ── Cache check ───────────────────────────────────────────────────────────
  if (operatorId && fingerprint) {
    try {
      const admin = createAdminClient();
      const { data: cached } = await admin
        .from('mastersheet_mappings')
        .select('source_columns, created_at')
        .eq('operator_id', operatorId)
        .eq('format_fingerprint', fingerprint)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (cached) {
        const ageMs = Date.now() - new Date(cached.created_at as string).getTime();
        if (ageMs < CACHE_TTL_MS) {
          const cachedMappings = (cached.source_columns ?? []) as FieldMapping[];
          const mappings = reconstructMappingsFromCache(cachedMappings, samples);
          const high_confidence_count = mappings.filter((m) => !m.needs_review).length;
          const needs_review_count = mappings.filter((m) => m.needs_review).length;

          // Update last_used_at to track recency.
          await admin
            .from('mastersheet_mappings')
            .update({ last_used_at: new Date().toISOString() })
            .eq('operator_id', operatorId)
            .eq('format_fingerprint', fingerprint);

          return {
            success: true,
            mappings,
            unmapped_columns: [],
            high_confidence_count,
            needs_review_count,
            raw_data: raw,
            from_cache: true,
          };
        }
      }
    } catch {
      // Non-fatal: proceed to Haiku if cache is unavailable.
    }
  }

  // ── Haiku inference ───────────────────────────────────────────────────────
  let haikuResponse: HaikuResponse;
  try {
    const mappingResult = await callHaikuForMappings(samples);
    haikuResponse = mappingResult.response;

    // Fire-and-forget usage tracking (non-blocking — never throws).
    if (operatorId) {
      void trackUsage({
        operator_id: operatorId,
        event_type: 'field_mapping',
        model: 'claude-haiku-4-5',
        input_tokens: mappingResult.usage.input_tokens,
        output_tokens: mappingResult.usage.output_tokens,
        cache_read_tokens: mappingResult.usage.cache_read_tokens,
      });
    }
  } catch (err) {
    console.error('[normaliser] Haiku call failed:', err);
    return {
      success: false,
      error: 'AI mapping failed',
      mappings: [],
      unmapped_columns: [],
      high_confidence_count: 0,
      needs_review_count: 0,
      raw_data: raw,
    };
  }

  // Build a lookup of actual cell-B values for vertical sheets.
  // Haiku is instructed to echo sample_value back but doesn't do so reliably —
  // so for vertical KV sheets we always use the value we already extracted.
  const verticalValueLookup: Record<string, Record<string, string>> = {};
  for (const sample of samples) {
    if (sample.format === 'vertical') {
      const lookup: Record<string, string> = {};
      for (const { field_name, value } of sample.kv_pairs) {
        lookup[field_name] = value;
      }
      verticalValueLookup[sample.sheetName] = lookup;
    }
  }

  let mappings: FieldMapping[];
  try {
    mappings = (haikuResponse.mappings ?? []).map((m) => {
      const confidence = typeof m.confidence === 'number' ? m.confidence : 0;

      // For vertical sheets use the known cell-B value; fall back to whatever
      // Haiku returned (which covers horizontal sheets correctly).
      const kvLookup = verticalValueLookup[m.source_sheet];
      const sample_value = kvLookup
        ? (kvLookup[m.source_column] ?? String(m.sample_value ?? ''))
        : String(m.sample_value ?? '');

      return {
        source_sheet: m.source_sheet,
        source_column: m.source_column,
        target_field: m.target_field,
        sample_value,
        confidence,
        needs_review: confidence < 0.85,
      };
    });
  } catch (err) {
    console.error('[normaliser] Failed to build mappings from Haiku response:', err);
    return {
      success: false,
      error: 'AI mapping failed',
      mappings: [],
      unmapped_columns: [],
      high_confidence_count: 0,
      needs_review_count: 0,
      raw_data: raw,
    };
  }

  const high_confidence_count = mappings.filter((m) => !m.needs_review).length;
  const needs_review_count = mappings.filter((m) => m.needs_review).length;

  // ── Store result in cache ─────────────────────────────────────────────────
  if (operatorId && fingerprint) {
    try {
      const admin = createAdminClient();
      const fieldMap: Record<string, string> = {};
      const confidenceScores: Record<string, number> = {};
      for (const m of mappings) {
        fieldMap[m.source_column] = m.target_field;
        confidenceScores[m.source_column] = m.confidence;
      }

      await admin.from('mastersheet_mappings').upsert(
        {
          operator_id: operatorId,
          mapping_name: fingerprint,
          format_fingerprint: fingerprint,
          source_columns: mappings,       // full FieldMapping[] for cache reconstruction
          field_map: fieldMap,            // kept for backward-compat with upload route step 6
          confidence_scores: confidenceScores,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'operator_id,mapping_name' },
      );
    } catch {
      // Non-fatal: proceed without caching.
    }
  }

  return {
    success: true,
    mappings,
    unmapped_columns: haikuResponse.unmapped_columns ?? [],
    high_confidence_count,
    needs_review_count,
    raw_data: raw,
  };
}
