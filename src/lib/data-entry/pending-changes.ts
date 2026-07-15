/**
 * pending-changes.ts
 *
 * Manages the full lifecycle of a pending_changes row.
 * All database operations use createAdminClient() — RLS blocks
 * the webhook and cron routes from using the session-scoped client.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { EventSetupFormData } from '@/lib/schemas';
import type { DiffItem, DiffResult } from './whatsapp-change-diff';
import type { AmbiguousItem, ExtractionResult } from './whatsapp-change-extractor';
import { recordChangeEvent, propagateToKB } from './change-events';
import { pushEventToDato } from './dato-connector';

// Re-export so callers can import everything from one place.
export type { DiffItem, DiffResult, AmbiguousItem, ExtractionResult };

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PendingChange {
  id: string;
  operator_id: string;
  event_id: string;
  promoter_id: string;
  inbound_wamid: string;
  inbound_text: string;
  inbound_received_at: string;
  diff_items: DiffItem[];
  ambiguous_items: AmbiguousItem[];
  extraction_ambiguous: boolean;
  extraction_notes: string | null;
  extraction_input_tokens: number | null;
  extraction_output_tokens: number | null;
  confirmation_wamid: string | null;
  confirmation_sent_at: string | null;
  confirmation_send_error: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | 'superseded' | 'expired' | 'send_failed';
  expires_at: string;
  confirmed_by_user_id: string | null;
  confirmed_via: 'whatsapp' | 'dashboard' | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  change_event_ids: string[];
  dato_sync_status: 'skipped' | 'success' | 'failed' | null;
  dato_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

// ─── createPendingChange ──────────────────────────────────────────────────────

/**
 * Supersedes any existing pending rows for (event_id, promoter_id), then
 * inserts a new pending_changes row and returns it.
 *
 * @throws Error with message 'createPendingChange failed: <detail>'
 */
export async function createPendingChange(params: {
  operator_id: string;
  event_id: string;
  promoter_id: string;
  inbound_wamid: string;
  inbound_text: string;
  extraction: ExtractionResult;
  diff: DiffResult;
}): Promise<PendingChange> {
  const supabase = createAdminClient();

  // Step 1 — supersede any open pending rows for this (event_id, promoter_id).
  const { error: supersededError } = await supabase
    .from('pending_changes')
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('event_id', params.event_id)
    .eq('promoter_id', params.promoter_id)
    .eq('status', 'pending');

  if (supersededError) {
    throw new Error('createPendingChange failed: ' + supersededError.message);
  }

  // Step 2 — insert the new pending row.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data, error: insertError } = await supabase
    .from('pending_changes')
    .insert({
      operator_id: params.operator_id,
      event_id: params.event_id,
      promoter_id: params.promoter_id,
      inbound_wamid: params.inbound_wamid,
      inbound_text: params.inbound_text,
      diff_items: params.diff.items,
      ambiguous_items: params.extraction.ambiguous,
      extraction_ambiguous: params.extraction.ambiguous_flag,
      extraction_notes: params.extraction.notes,
      extraction_input_tokens: params.extraction.input_tokens,
      extraction_output_tokens: params.extraction.output_tokens,
      status: 'pending',
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (insertError || !data) {
    throw new Error(
      'createPendingChange failed: ' + (insertError?.message ?? 'no data returned'),
    );
  }

  return data as unknown as PendingChange;
}

// ─── updateConfirmationWamid ──────────────────────────────────────────────────

/**
 * Records the outbound WhatsApp message ID after the confirmation message
 * is successfully sent to the promoter.
 */
export async function updateConfirmationWamid(
  pendingChangeId: string,
  wamid: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('pending_changes')
    .update({
      confirmation_wamid: wamid,
      confirmation_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingChangeId);

  if (error) {
    throw new Error('updateConfirmationWamid failed: ' + error.message);
  }
}

// ─── updateConfirmationSendError ──────────────────────────────────────────────

/**
 * Records a WhatsApp send failure. Sets status → 'send_failed' so the row
 * is excluded from future lookups but remains visible for debugging.
 */
export async function updateConfirmationSendError(
  pendingChangeId: string,
  sendError: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('pending_changes')
    .update({
      confirmation_send_error: sendError,
      status: 'send_failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', pendingChangeId);

  if (error) {
    throw new Error('updateConfirmationSendError failed: ' + error.message);
  }
}

// ─── findPendingByConfirmationWamid ───────────────────────────────────────────

/**
 * Looks up a pending row by the outbound confirmation message ID.
 * Used to resolve a promoter's "yes/no" reply back to the original diff.
 *
 * Returns null if no matching pending row exists.
 */
export async function findPendingByConfirmationWamid(
  confirmationWamid: string,
): Promise<PendingChange | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('pending_changes')
    .select('*')
    .eq('confirmation_wamid', confirmationWamid)
    .eq('status', 'pending')
    .maybeSingle();

  if (error) {
    throw new Error('findPendingByConfirmationWamid failed: ' + error.message);
  }

  return data ? (data as unknown as PendingChange) : null;
}

// ─── findPendingByEvent ───────────────────────────────────────────────────────

/**
 * Returns paginated pending rows for an event, ordered newest-first.
 * Used by the dashboard confirmation UI (Issue 23).
 */
export async function findPendingByEvent(
  eventId: string,
  limit = 25,
  offset = 0,
): Promise<PendingChange[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('pending_changes')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error('findPendingByEvent failed: ' + error.message);
  }

  return (data ?? []) as unknown as PendingChange[];
}

// ─── expireStalePendingChanges ────────────────────────────────────────────────

/**
 * Moves all pending rows whose expires_at has passed to status = 'expired'.
 * Called by the /api/cron/expire-changes route (wired in Issue 22).
 *
 * @returns The number of rows expired.
 */
export async function expireStalePendingChanges(): Promise<number> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('pending_changes')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    throw new Error('expireStalePendingChanges failed: ' + error.message);
  }

  return data?.length ?? 0;
}

// ─── cancelPendingChange ──────────────────────────────────────────────────────

/**
 * Cancels a pending_changes row.
 *
 * Returns:
 *   { status: 'cancelled' }                           — success
 *   { status: 'not_found' }                           — row doesn't exist
 *   { status: 'already_resolved', current_status }    — row is not 'pending'
 */
export async function cancelPendingChange(params: {
  pending_change_id: string;
  actor_user_id: string | null;
  actor_promoter_id?: string;
  via: 'whatsapp' | 'dashboard';
}): Promise<
  | { status: 'cancelled' }
  | { status: 'not_found' }
  | { status: 'already_resolved'; current_status: string }
> {
  const supabase = createAdminClient();

  // Step 1 — fetch current row status.
  const { data: row, error: fetchError } = await supabase
    .from('pending_changes')
    .select('id, status')
    .eq('id', params.pending_change_id)
    .maybeSingle();

  if (fetchError) {
    throw new Error('cancelPendingChange failed: ' + fetchError.message);
  }

  if (!row) {
    return { status: 'not_found' };
  }

  const currentStatus = (row as Record<string, unknown>).status as string;

  if (currentStatus !== 'pending') {
    return { status: 'already_resolved', current_status: currentStatus };
  }

  // Step 2 — cancel.
  const { error: updateError } = await supabase
    .from('pending_changes')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.pending_change_id);

  if (updateError) {
    throw new Error('cancelPendingChange failed: ' + updateError.message);
  }

  return { status: 'cancelled' };
}

// ─── Internal helpers for confirmPendingChange ────────────────────────────────

/**
 * Mutates `obj` by setting `value` at the dot-separated `dotPath`.
 * Intermediate nodes are created as empty objects if missing.
 *
 * Example: setValueAtPath(config, 'refund_policy.shape', 'strict')
 *          sets config.refund_policy.shape = 'strict'
 */
function setValueAtPath(
  obj: Record<string, unknown>,
  dotPath: string,
  value: unknown,
): void {
  const parts = dotPath.split('.');
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!cursor[part] || typeof cursor[part] !== 'object') {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

// ─── confirmPendingChange ─────────────────────────────────────────────────────

/**
 * Atomically transitions a pending_changes row to 'confirmed' and applies
 * the diff to the events table, propagates to KB, records the audit trail,
 * and triggers DatoCMS sync.
 *
 * Returns one of four outcomes so callers can branch without catching.
 */
export async function confirmPendingChange(args: {
  pending_change_id: string;
  actor_user_id: string | null;
  actor_promoter_id?: string;
  via: 'whatsapp' | 'dashboard';
}): Promise<
  | {
      status: 'confirmed';
      change_event_ids: string[];
      dato: 'skipped' | 'success' | 'failed';
      kb_sections_updated: string[];
      kb_failed: Array<{ section_id: string; reason: string }>;
    }
  | { status: 'race_lost'; current: PendingChange }
  | { status: 'expired' }
  | { status: 'not_found' }
> {
  const supabase = createAdminClient();

  // ── Step 1: Fetch the row ────────────────────────────────────────────────
  const { data: rowData, error: fetchError } = await supabase
    .from('pending_changes')
    .select('*')
    .eq('id', args.pending_change_id)
    .maybeSingle();

  if (fetchError) {
    throw new Error('confirmPendingChange failed: ' + fetchError.message);
  }
  if (!rowData) return { status: 'not_found' };

  const pendingRow = rowData as unknown as PendingChange;

  // ── Step 2: Status pre-check ─────────────────────────────────────────────
  if (pendingRow.status === 'expired') return { status: 'expired' };
  if (pendingRow.status !== 'pending') {
    return { status: 'race_lost', current: pendingRow };
  }

  // ── Step 3: Atomic CAS-style UPDATE (fails silently if race lost) ────────
  const { data: updatedRows, error: casError } = await supabase
    .from('pending_changes')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by_user_id: args.actor_user_id,
      confirmed_via: args.via,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.pending_change_id)
    .eq('status', 'pending') // guard — only update if still pending
    .select('id');

  if (casError) {
    throw new Error('confirmPendingChange CAS failed: ' + casError.message);
  }

  if (!updatedRows || updatedRows.length === 0) {
    // Another actor confirmed/cancelled between our read and this write.
    const { data: current } = await supabase
      .from('pending_changes')
      .select('*')
      .eq('id', args.pending_change_id)
      .single();
    return { status: 'race_lost', current: current as unknown as PendingChange };
  }

  // ── Step 4: Fetch event row ──────────────────────────────────────────────
  const { data: eventData, error: eventError } = await supabase
    .from('events')
    .select('*')
    .eq('id', pendingRow.event_id)
    .single();

  if (eventError || !eventData) {
    throw new Error(
      'confirmPendingChange: event not found: ' + (eventError?.message ?? 'no data'),
    );
  }

  const eventRow = eventData as Record<string, unknown>;

  // ── Step 5: Apply diff items to event ────────────────────────────────────
  const meaningfulItems = (pendingRow.diff_items as DiffItem[]).filter(
    (item) => !item.is_noop && item.coercion_error === null && !item.tier_not_found,
  );

  const topLevelUpdates: Record<string, unknown> = {};
  // Deep-clone config JSONB to avoid mutations leaking back into eventRow.
  const mergedConfig: Record<string, unknown> =
    typeof eventRow.config === 'object' && eventRow.config !== null
      ? JSON.parse(JSON.stringify(eventRow.config))
      : {};

  const previousValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  // Bare field names for propagateToKB (strip "config." prefix).
  const changedBareNames: string[] = [];

  for (const item of meaningfulItems) {
    if (item.field.startsWith('config.')) {
      const subPath = item.field.slice('config.'.length); // e.g. "doors_open_local"
      const topKey = subPath.split('.')[0];              // e.g. "refund_policy"

      // Collect previous value from the cloned config.
      let prevCursor: unknown = mergedConfig;
      for (const part of subPath.split('.')) {
        prevCursor =
          prevCursor && typeof prevCursor === 'object'
            ? (prevCursor as Record<string, unknown>)[part]
            : undefined;
      }
      previousValues[item.field] = prevCursor ?? null;

      // Write new value into config at the correct path.
      setValueAtPath(mergedConfig, subPath, item.coerced_value);
      newValues[item.field] = item.coerced_value;
      changedBareNames.push(topKey);
    } else {
      previousValues[item.field] = eventRow[item.field] ?? null;
      topLevelUpdates[item.field] = item.coerced_value;
      newValues[item.field] = item.coerced_value;
      changedBareNames.push(item.field);
    }
  }

  // ── Step 6: UPDATE events ────────────────────────────────────────────────
  if (meaningfulItems.length > 0) {
    const hasConfigChanges = meaningfulItems.some((i) => i.field.startsWith('config.'));
    const eventUpdate: Record<string, unknown> = {
      ...topLevelUpdates,
      updated_at: new Date().toISOString(),
      ...(hasConfigChanges ? { config: mergedConfig } : {}),
    };

    const { error: eventUpdateError } = await supabase
      .from('events')
      .update(eventUpdate)
      .eq('id', pendingRow.event_id);

    if (eventUpdateError) {
      throw new Error(
        'confirmPendingChange: event update failed: ' + eventUpdateError.message,
      );
    }
  }

  // ── Step 7: propagateToKB ────────────────────────────────────────────────
  // Non-fatal to the change confirmation, but KB failures are surfaced in the
  // return value (audit 1.2) rather than silently swallowed.
  // Deduplicate bare names (e.g. two config.refund_policy.* changes → one 'refund_policy').
  const uniqueBareNames = Array.from(new Set(changedBareNames));
  let kbSectionsUpdated: string[] = [];
  let kbFailed: Array<{ section_id: string; reason: string }> = [];
  try {
    const kbResult = await propagateToKB(
      pendingRow.event_id,
      uniqueBareNames,
      newValues,
    );
    kbSectionsUpdated = kbResult.updated;
    kbFailed = kbResult.failed;
  } catch (err) {
    console.error('[confirmPendingChange] propagateToKB failed:', err);
    kbFailed = [{ section_id: '*', reason: err instanceof Error ? err.message : String(err) }];
  }

  // ── Step 8: recordChangeEvent (non-fatal) ────────────────────────────────
  let changeEventId: string | null = null;
  try {
    changeEventId = await recordChangeEvent({
      event_id: pendingRow.event_id,
      operator_id: pendingRow.operator_id,
      changed_by: args.actor_user_id ?? args.actor_promoter_id ?? 'system',
      channel: 'whatsapp',
      previous_values: previousValues,
      new_values: newValues,
      systems_updated: ['supabase'],
      kb_sections_updated: kbSectionsUpdated,
    });
  } catch (err) {
    console.error('[confirmPendingChange] recordChangeEvent failed:', err);
  }

  // ── Step 9: pushEventToDato (non-fatal) ──────────────────────────────────
  // Build the partial EventSetupFormData the connector recognises.
  const datoPayload: Partial<EventSetupFormData> = {};
  for (const item of meaningfulItems) {
    switch (item.field) {
      case 'name':
        datoPayload.name = item.coerced_value as string;
        break;
      case 'start_date':
        datoPayload.start_date = item.coerced_value as string;
        break;
      case 'venue_name':
        datoPayload.venue_name = item.coerced_value as string;
        break;
      case 'venue_city':
        datoPayload.venue_city = item.coerced_value as string;
        break;
    }
  }

  let datoStatus: 'skipped' | 'success' | 'failed' = 'skipped';
  let datoError: string | null = null;

  try {
    const datoResult = await pushEventToDato(pendingRow.event_id, datoPayload);
    if (datoResult.skipped) {
      datoStatus = 'skipped';
    } else if (datoResult.success) {
      datoStatus = 'success';
    } else {
      datoStatus = 'failed';
      datoError = datoResult.error ?? null;
    }
  } catch (err) {
    datoStatus = 'failed';
    datoError = err instanceof Error ? err.message : String(err);
    console.error('[confirmPendingChange] pushEventToDato failed:', err);
  }

  // ── Step 10: UPDATE pending_changes with downstream linkage ──────────────
  const changeEventIds = changeEventId ? [changeEventId] : [];
  await supabase
    .from('pending_changes')
    .update({
      change_event_ids: changeEventIds,
      dato_sync_status: datoStatus,
      dato_sync_error: datoError,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.pending_change_id);

  return {
    status: 'confirmed',
    change_event_ids: changeEventIds,
    dato: datoStatus,
    kb_sections_updated: kbSectionsUpdated,
    kb_failed: kbFailed,
  };
}
