/**
 * whatsapp-change-extractor.ts
 *
 * Extracts structured field changes from a free-text WhatsApp message
 * using Claude Haiku. Designed for deterministic extraction: temperature 0,
 * prompt cache on the system block, strict field allowlist.
 *
 * Callers are responsible for:
 *   - Persisting the result to pending_changes
 *   - Sending the confirmation message via the WhatsApp adapter
 *   - Applying confirmed changes via the confirm route
 */

import { claude } from '@/lib/agent/anthropic-client';

// ─── Allowlist ────────────────────────────────────────────────────────────────

const VALID_FIELD_KEYPATHS = new Set([
  'name',
  'slug',
  'venue_name',
  'venue_city',
  'start_date',
  'end_date',
  'timezone',
  'event_type',
  'capacity',
  'age_minimum',
  'config.doors_open_local',
  'config.doors_close_local',
  'config.last_entry_local',
  'config.dress_code',
  'config.parking_info',
  'config.refund_policy.shape',
  'config.ticket_tiers',
  'config.vip_orders_always_escalate',
]);

// ─── System prompt (cached) ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You extract event field changes from a promoter's WhatsApp message.

Return ONLY valid JSON. No prose, no markdown fences, no explanation.

Valid target fields (use exact keypaths):
name, slug, venue_name, venue_city, start_date, end_date, timezone,
event_type, capacity, age_minimum,
config.doors_open_local, config.doors_close_local, config.last_entry_local,
config.dress_code, config.parking_info,
config.refund_policy.shape, config.ticket_tiers,
config.vip_orders_always_escalate

JSON shape to return:
{
  "changes": [
    { "field": "<keypath>", "new_value": "<string>", "confidence": <0-1> }
  ],
  "ambiguous": [
    { "raw_text": "<fragment>", "reason": "<why unclear>" }
  ],
  "ambiguous_flag": <true|false>,
  "notes": "<string or null>"
}

Rules:
- Map only fields in the valid list above. Anything else goes to ambiguous.
- new_value is always a string. Times as "HH:MM". Dates as "YYYY-MM-DD". Numbers as numeric strings.
- If a change is a price for a named ticket tier, put it in ambiguous with the tier name and new price clearly stated — the diff module handles tier lookups.
- confidence below 0.7 goes to ambiguous, not changes.
- If nothing actionable found, return empty changes array and set ambiguous_flag false.
- Do not invent changes not stated in the message.`;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExtractedChange {
  field: string;       // keypath e.g. "venue_name" or "config.doors_open_local"
  new_value: string;   // always a string from Haiku; coercion happens in diff module
  confidence: number;  // 0-1 self-reported
}

export interface AmbiguousItem {
  raw_text: string;    // the fragment Haiku could not map
  reason: string;      // why it is ambiguous
}

export interface ExtractionResult {
  changes: ExtractedChange[];
  ambiguous: AmbiguousItem[];
  ambiguous_flag: boolean;
  notes: string | null;
  input_tokens: number;
  output_tokens: number;
}

// ─── Internal Haiku response shape ────────────────────────────────────────────

interface RawExtractedChange {
  field: unknown;
  new_value: unknown;
  confidence: unknown;
}

interface RawAmbiguousItem {
  raw_text: unknown;
  reason: unknown;
}

interface RawHaikuResponse {
  changes: unknown;
  ambiguous: unknown;
  ambiguous_flag: unknown;
  notes: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FAILED_RESULT: ExtractionResult = {
  changes: [],
  ambiguous: [],
  ambiguous_flag: true,
  notes: 'extraction failed',
  input_tokens: 0,
  output_tokens: 0,
};

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
}

function isValidChange(item: unknown): item is RawExtractedChange {
  if (!item || typeof item !== 'object') return false;
  const c = item as Record<string, unknown>;
  return (
    typeof c.field === 'string' &&
    typeof c.new_value === 'string' &&
    typeof c.confidence === 'number'
  );
}

function isValidAmbiguous(item: unknown): item is RawAmbiguousItem {
  if (!item || typeof item !== 'object') return false;
  const a = item as Record<string, unknown>;
  return typeof a.raw_text === 'string' && typeof a.reason === 'string';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extracts structured field changes from a free-text WhatsApp message.
 *
 * @param inboundText   The raw message text from the promoter.
 * @param currentEvent  The current event row (used as context for Haiku).
 * @param language      Detected message language.
 */
export async function extractChanges(
  inboundText: string,
  currentEvent: Record<string, unknown>,
  language: 'en' | 'ar' | 'ru' | 'mixed',
): Promise<ExtractionResult> {
  const userContent = JSON.stringify({
    language,
    message: inboundText,
    current_event_summary: {
      name: currentEvent.name,
      venue_name: currentEvent.venue_name,
      start_date: currentEvent.start_date,
    },
  });

  let response: Awaited<ReturnType<typeof claude.messages.create>>;
  try {
    response = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0,
      system: [
        {
          type: 'text' as const,
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    console.error('[extractChanges] Haiku API call failed:', err);
    return FAILED_RESULT;
  }

  // Extract text from the first content block.
  const firstBlock = response.content[0];
  const rawText = firstBlock?.type === 'text' ? firstBlock.text : '';

  if (!rawText) {
    console.error('[extractChanges] Haiku returned no text content');
    return { ...FAILED_RESULT, input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens };
  }

  // Parse JSON — strip accidental fences before parsing.
  let parsed: RawHaikuResponse;
  try {
    parsed = JSON.parse(stripMarkdownFences(rawText)) as RawHaikuResponse;
  } catch {
    console.error('[extractChanges] JSON parse failed:', rawText);
    return {
      ...FAILED_RESULT,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  }

  // Validate and filter changes.
  const rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];
  const changes: ExtractedChange[] = rawChanges
    .filter(isValidChange)
    .filter((c) => VALID_FIELD_KEYPATHS.has(c.field as string))
    .map((c) => ({
      field: c.field as string,
      new_value: c.new_value as string,
      confidence: c.confidence as number,
    }));

  // Validate ambiguous items.
  const rawAmbiguous = Array.isArray(parsed.ambiguous) ? parsed.ambiguous : [];
  const ambiguous: AmbiguousItem[] = rawAmbiguous
    .filter(isValidAmbiguous)
    .map((a) => ({
      raw_text: a.raw_text as string,
      reason: a.reason as string,
    }));

  const ambiguous_flag =
    typeof parsed.ambiguous_flag === 'boolean' ? parsed.ambiguous_flag : ambiguous.length > 0;

  const notes =
    typeof parsed.notes === 'string' ? parsed.notes : null;

  return {
    changes,
    ambiguous,
    ambiguous_flag,
    notes,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
  };
}
