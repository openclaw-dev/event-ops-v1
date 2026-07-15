/**
 * change-events.ts
 *
 * Writes to the change_events audit table and propagates relevant field
 * changes into kb_sections.
 *
 * All writes use createAdminClient() because RLS blocks user-scoped writes to
 * these tables.
 */

import { createAdminClient } from '@/lib/supabase/admin';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordChangeEventParams {
  event_id: string;
  operator_id: string;
  changed_by: string;
  channel: 'dashboard' | 'whatsapp' | 'system' | 'mastersheet';
  previous_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  systems_updated: string[];
  kb_sections_updated: string[];
}

// ─── KB field → section_id map ────────────────────────────────────────────────

const KB_FIELD_MAP: Record<string, string> = {
  doors_open_local: 'event.timing',
  last_entry_local: 'event.timing',
  doors_close_local: 'event.timing',
  venue_name: 'venue.location',
  venue_city: 'venue.location',
  dress_code: 'event.dress_code',
  age_minimum: 'event.age_policy',
  refund_policy: 'policy.refund.standard',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the set of keys that differ between previous and new values.
 * A key is "changed" if it appears in either object.
 */
function computeChangedFields(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const allKeys = Array.from(new Set([...Object.keys(previous), ...Object.keys(next)]));
  const changed: string[] = [];
  for (const key of allKeys) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      changed.push(key);
    }
  }
  return changed;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Inserts a row into change_events and returns the created row's id.
 */
export async function recordChangeEvent(params: RecordChangeEventParams): Promise<string> {
  const admin = createAdminClient();
  const fields_changed = computeChangedFields(params.previous_values, params.new_values);

  const { data, error } = await admin
    .from('change_events')
    .insert({
      event_id: params.event_id,
      operator_id: params.operator_id,
      changed_by: params.changed_by,
      channel: params.channel,
      fields_changed,
      previous_values: params.previous_values,
      new_values: params.new_values,
      systems_updated: params.systems_updated,
      kb_sections_updated: params.kb_sections_updated,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[recordChangeEvent] Insert failed:', error?.message ?? 'no data returned', {
      event_id: params.event_id,
      operator_id: params.operator_id,
      fields_changed,
      new_values_keys: Object.keys(params.new_values),
    });
    throw new Error(`Failed to record change event: ${error?.message ?? 'unknown'}`);
  }

  return data.id as string;
}

export interface PropagateToKBResult {
  /** section_ids whose answer_en was successfully updated. */
  updated: string[];
  /**
   * Sections that were found but whose update failed (DB error or zero rows
   * affected). A section that simply does not exist is NOT a failure — it is a
   * legitimate skip (the operator must create it first).
   */
  failed: Array<{ section_id: string; reason: string }>;
}

/**
 * Updates kb_sections rows for fields that have KB implications.
 *
 * Only updates existing rows — does not create new sections. A missing section
 * is skipped silently; a section that exists but whose write fails is reported
 * in `failed` so callers can surface it instead of reporting a false success
 * (audit 1.2 — the previous version selected/updated non-existent `version` and
 * `updated_at` columns, so every update errored 42703 and was silently
 * swallowed, making KB propagation a total no-op).
 */
export async function propagateToKB(
  event_id: string,
  changedFields: string[],
  newValues: Record<string, unknown>,
): Promise<PropagateToKBResult> {
  const admin = createAdminClient();
  const updated: string[] = [];
  const failed: Array<{ section_id: string; reason: string }> = [];

  // Collect the unique section_ids that need updating.
  const sectionIds = new Set<string>();
  const fieldsBySectionId: Record<string, string[]> = {};

  for (const field of changedFields) {
    const sectionId = KB_FIELD_MAP[field];
    if (!sectionId) continue;
    sectionIds.add(sectionId);
    if (!fieldsBySectionId[sectionId]) fieldsBySectionId[sectionId] = [];
    fieldsBySectionId[sectionId].push(field);
  }

  for (const sectionId of Array.from(sectionIds)) {
    // Fetch existing row. maybeSingle() distinguishes "section absent" (data
    // null, no error → legit skip) from a real DB error (surface it).
    const { data: existing, error: fetchError } = await admin
      .from('kb_sections')
      .select('id, answer_en')
      .eq('event_id', event_id)
      .eq('section_id', sectionId)
      .maybeSingle();

    if (fetchError) {
      console.error('[propagateToKB] fetch failed', {
        event_id,
        section_id: sectionId,
        error: fetchError.message,
      });
      failed.push({ section_id: sectionId, reason: `fetch failed: ${fetchError.message}` });
      continue;
    }

    if (!existing) {
      // Section does not exist — operator must create it first. Legit skip.
      continue;
    }

    // Build an append sentence from the changed fields in this section.
    const fields = fieldsBySectionId[sectionId] ?? [];
    const sentences = fields
      .map((f) => {
        const val = newValues[f];
        if (val === undefined || val === null) return null;
        const valStr =
          typeof val === 'object' ? JSON.stringify(val) : String(val);
        return `${f} updated to: ${valStr}`;
      })
      .filter((s): s is string => s !== null);

    if (sentences.length === 0) continue;

    // Strip any existing [Updated …] lines before prepending a fresh one.
    const baseAnswer = (existing.answer_en ?? '')
      .split('\n')
      .filter((line: string) => !line.startsWith('[Updated'))
      .join('\n')
      .trimEnd();

    const updateDate = new Date().toLocaleDateString('en-GB');
    const updateLine = `[Updated ${updateDate}] ${sentences.join('; ')}`;
    const newAnswer = `${baseAnswer}\n\n${updateLine}`;

    // Zero-rows guard: .select() the affected row so a silent no-op surfaces as
    // a failure instead of a false success (CLAUDE.md pattern).
    const { data: updatedRows, error: updateError } = await admin
      .from('kb_sections')
      .update({ answer_en: newAnswer })
      .eq('id', existing.id)
      .select('id');

    if (updateError) {
      console.error('[propagateToKB] update failed', {
        event_id,
        section_id: sectionId,
        error: updateError.message,
      });
      failed.push({ section_id: sectionId, reason: `update failed: ${updateError.message}` });
      continue;
    }

    if (!updatedRows || updatedRows.length === 0) {
      console.error('[propagateToKB] update affected zero rows', {
        event_id,
        section_id: sectionId,
      });
      failed.push({ section_id: sectionId, reason: 'update affected zero rows' });
      continue;
    }

    updated.push(sectionId);
  }

  return { updated, failed };
}
