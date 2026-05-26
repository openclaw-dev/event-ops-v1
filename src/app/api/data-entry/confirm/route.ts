/**
 * POST /api/data-entry/confirm
 *
 * Applies confirmed field mappings to an event row, records a change_event,
 * propagates KB updates, fires DatoCMS sync, and upserts the mastersheet
 * mapping for future use.
 *
 * Body (JSON):
 *   event_id    — UUID
 *   mappings    — FieldMapping[]
 *   raw_data    — Record<string, unknown>[]
 *   changed_by  — display name / email of the person confirming
 *
 * Authorization: Supabase session cookie (RLS-enforced reads).
 * Writes use createAdminClient() because RLS blocks user-scoped writes to
 * change_events and kb_sections.
 */

import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordChangeEvent, propagateToKB } from '@/lib/data-entry/change-events';
import { pushEventToDato, type DatoSyncResult } from '@/lib/data-entry/dato-connector';
import type { FieldMapping } from '@/lib/data-entry/normaliser';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Fields that live inside events.config JSONB rather than top-level columns.
const CONFIG_FIELDS = new Set([
  'doors_open_local',
  'last_entry_local',
  'doors_close_local',
  'dress_code',
  'ticket_tiers',
  'refund_policy',
  'parking_info',
  'escalation_contacts',
  'vip_orders_always_escalate',
  'escalation_keywords',
]);

interface ConfirmBody {
  event_id: string;
  mappings: FieldMapping[];
  raw_data: Record<string, unknown>[];
  changed_by: string;
}

// ─── Helper: resolve raw value from the first data row ───────────────────────

function resolveValue(
  targetField: string,
  mappings: FieldMapping[],
  rawData: Record<string, unknown>[],
): unknown {
  const mapping = mappings.find((m) => m.target_field === targetField);
  if (!mapping) return undefined;
  const firstRow = rawData[0];
  if (!firstRow) return mapping.sample_value;
  return firstRow[mapping.source_column] ?? mapping.sample_value;
}

// ─── Helper: coerce raw spreadsheet values to DB-safe types ──────────────────

/**
 * Coerces a raw spreadsheet value to the correct type for a given target field.
 * Returns null when the value is empty or cannot be meaningfully coerced —
 * callers must skip null values rather than writing them to the database.
 */
function coerceFieldValue(targetField: string, value: unknown): unknown {
  if (value === '' || value === null || value === undefined) return null;

  switch (targetField) {
    case 'age_minimum':
    case 'capacity': {
      // Handle "18+", "18 and over", "21+", bare numbers, etc.
      const match = String(value).match(/\d+/);
      return match ? parseInt(match[0], 10) : null;
    }

    case 'start_date':
    case 'end_date': {
      // Excel serial dates arrive as numbers (days since 1900-01-01).
      if (typeof value === 'number') {
        const date = new Date((value - 25569) * 86400 * 1000);
        return date.toISOString().split('T')[0];
      }
      // String dates: parse and reformat as YYYY-MM-DD.
      const d = new Date(String(value));
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    }

    case 'doors_open_local':
    case 'last_entry_local':
    case 'doors_close_local': {
      // Normalise to HH:MM — handles "20:00", "8:30 PM", "20:00:00", etc.
      const timeMatch = String(value).match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
      return null;
    }

    default:
      return value;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  // ── 1. Parse JSON body ───────────────────────────────────────────────────
  let body: ConfirmBody;
  try {
    body = (await request.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { event_id, mappings, raw_data, changed_by } = body;

  if (!event_id || typeof event_id !== 'string') {
    return NextResponse.json({ error: 'event_id is required.' }, { status: 400 });
  }
  if (!Array.isArray(mappings)) {
    return NextResponse.json({ error: 'mappings must be an array.' }, { status: 400 });
  }

  // ── 2. Authenticate ──────────────────────────────────────────────────────
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // ── 3. Verify event belongs to this operator (RLS-enforced) ─────────────
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, operator_id, name, start_date, end_date, venue_name, venue_city, age_minimum, config')
    .eq('id', event_id)
    .is('deleted_at', null)
    .single();

  if (eventError || !event) {
    return NextResponse.json({ error: 'Event not found or access denied.' }, { status: 403 });
  }

  // Resolve operator_users row.
  const { data: operatorUser } = await supabase
    .from('operator_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('operator_id', event.operator_id)
    .single();

  if (!operatorUser) {
    return NextResponse.json({ error: 'No operator membership found.' }, { status: 403 });
  }

  // ── 4. Capture previous values ───────────────────────────────────────────
  const previousValues: Record<string, unknown> = {
    name: event.name,
    start_date: event.start_date,
    end_date: event.end_date,
    venue_name: event.venue_name,
    venue_city: event.venue_city,
    age_minimum: event.age_minimum,
    // Spread the existing config blob fields that we might change.
    ...(typeof event.config === 'object' && event.config !== null
      ? (event.config as Record<string, unknown>)
      : {}),
  };

  // ── 5. Build update objects ──────────────────────────────────────────────
  const topLevelUpdate: Record<string, unknown> = {};
  const configUpdate: Record<string, unknown> = {
    ...(typeof event.config === 'object' && event.config !== null
      ? (event.config as Record<string, unknown>)
      : {}),
  };
  const newValuesFlat: Record<string, unknown> = {};

  // Collect all target fields from confirmed mappings.
  const targetFields = Array.from(new Set(mappings.map((m) => m.target_field)));

  for (const field of targetFields) {
    // Handle nested keypaths like "refund_policy.shape" — top-level key is "refund_policy".
    const topKey = field.split('.')[0];
    const rawValue = resolveValue(field, mappings, raw_data ?? []);
    if (rawValue === undefined) continue;

    // Coerce to the correct DB type. Skip if the result is null (empty / unparseable).
    const value = coerceFieldValue(field, rawValue);
    if (value === null) continue;

    newValuesFlat[field] = value;

    if (CONFIG_FIELDS.has(topKey)) {
      // Merge into config blob. For nested paths we keep the top-level key only.
      if (field.includes('.')) {
        // e.g. "refund_policy.shape" → merge { shape: value } into config.refund_policy
        const subKey = field.slice(topKey.length + 1);
        const existing = (configUpdate[topKey] ?? {}) as Record<string, unknown>;
        configUpdate[topKey] = { ...existing, [subKey]: value };
      } else {
        configUpdate[topKey] = value;
      }
    } else {
      // Top-level column on the events table.
      topLevelUpdate[topKey] = value;
    }
  }

  // Merge updated config back.
  if (Object.keys(configUpdate).length > 0) {
    topLevelUpdate.config = configUpdate;
  }

  // ── 6. Update the events row ─────────────────────────────────────────────
  const admin = createAdminClient();

  if (Object.keys(topLevelUpdate).length > 0) {
    const { error: updateError } = await admin
      .from('events')
      .update(topLevelUpdate)
      .eq('id', event_id);

    if (updateError) {
      return NextResponse.json(
        { error: `Failed to update event: ${updateError.message}` },
        { status: 500 },
      );
    }
  }

  // ── 7. Record change event ───────────────────────────────────────────────
  const changedFieldKeys = Object.keys(newValuesFlat);

  // propagateToKB is best-effort — a KB error must never block the audit write.
  let kbUpdated: string[] = [];
  try {
    kbUpdated = await propagateToKB(event_id, changedFieldKeys, newValuesFlat);
  } catch (kbErr) {
    console.error('[confirm] propagateToKB threw — KB update skipped:', kbErr);
  }

  // recordChangeEvent uses createAdminClient() internally — RLS is bypassed.
  let changeEventId: string;
  try {
    changeEventId = await recordChangeEvent({
      event_id,
      operator_id: event.operator_id,
      changed_by: changed_by ?? user.email ?? 'unknown',
      channel: 'mastersheet',
      previous_values: previousValues,
      new_values: newValuesFlat,
      systems_updated: ['supabase'],
      kb_sections_updated: kbUpdated,
    });
  } catch (ceErr) {
    console.error('[confirm] recordChangeEvent failed:', ceErr, {
      event_id,
      operator_id: event.operator_id,
      fields_changed_count: changedFieldKeys.length,
    });
    return NextResponse.json(
      {
        error: `Event synced but audit log failed: ${
          ceErr instanceof Error ? ceErr.message : String(ceErr)
        }`,
      },
      { status: 500 },
    );
  }

  // ── 8. DatoCMS sync (fire-and-forget, non-fatal) ─────────────────────────
  let datoResult: DatoSyncResult = { success: false, skipped: true, reason: 'not attempted' };
  try {
    datoResult = await pushEventToDato(event_id, newValuesFlat as Parameters<typeof pushEventToDato>[1]);
  } catch {
    datoResult = { success: false, error: 'DatoCMS sync threw an exception' };
  }

  // ── 9. Upsert mastersheet_mappings ───────────────────────────────────────
  try {
    const fieldMap: Record<string, string> = {};
    const confidenceScores: Record<string, number> = {};

    for (const m of mappings) {
      fieldMap[m.source_column] = m.target_field;
      confidenceScores[m.source_column] = m.confidence;
    }

    const sourceColumns = Array.from(new Set(mappings.map((m) => m.source_column)));

    await admin
      .from('mastersheet_mappings')
      .upsert(
        {
          operator_id: event.operator_id,
          mapping_name: 'default',
          source_columns: sourceColumns,
          field_map: fieldMap,
          confidence_scores: confidenceScores,
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'operator_id,mapping_name' },
      );
  } catch {
    // Non-fatal — best-effort persistence of mapping metadata.
  }

  // ── 10. Return ────────────────────────────────────────────────────────────
  return NextResponse.json({
    success: true,
    change_event_id: changeEventId,
    kb_sections_updated: kbUpdated,
    dato: datoResult,
  });
}
