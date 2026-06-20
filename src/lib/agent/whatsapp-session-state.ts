/**
 * whatsapp-session-state.ts
 *
 * Durable store for pending event-selection prompts, backed by the
 * `whatsapp_session_state` table (migration 0025). All access goes through
 * createAdminClient() — the table has no RLS.
 *
 * When a customer's operator has multiple live events, the inbound webhook
 * sends a numbered list and waits for a "1", "2", etc. reply. This module
 * tracks that pending state so the next message can be matched back to the
 * operator's chosen event.
 *
 * State expires after 10 minutes; expired rows are filtered out on read and
 * overwritten on next set.
 */

import { createAdminClient } from '@/lib/supabase/admin';

const TTL_MS = 10 * 60 * 1000; // 10 minutes

type PendingEvents = Array<{ id: string; name: string }>;

export interface PendingEventSelection {
  events: PendingEvents;
  /** The customer's original question before they were asked to pick an event. */
  original_message: string | null;
}

/**
 * Store a pending event selection for the given phone number.
 * Also persists the customer's original message so it can be re-injected
 * after they reply with a selection number.
 * Overwrites any previous pending selection. Resets the TTL.
 */
export async function setPendingEventSelection(
  phone: string,
  events: PendingEvents,
  originalMessage: string | null,
): Promise<void> {
  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  const { error } = await admin
    .from('whatsapp_session_state')
    .upsert(
      {
        phone_e164: phone,
        pending_event_selection: events,
        original_message: originalMessage,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'phone_e164' },
    );

  if (error) {
    console.warn('[whatsapp-session-state] setPendingEventSelection failed:', error);
  }
}

/**
 * Retrieve the pending event selection for a phone number.
 * Returns null if no live entry exists (missing or already expired).
 */
export async function getPendingEventSelection(
  phone: string,
): Promise<PendingEventSelection | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('whatsapp_session_state')
    .select('pending_event_selection, original_message, expires_at')
    .eq('phone_e164', phone)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.warn('[whatsapp-session-state] getPendingEventSelection failed:', error);
    return null;
  }
  if (!data) return null;

  const row = data as { pending_event_selection: unknown; original_message: string | null };
  if (!Array.isArray(row.pending_event_selection)) return null;

  return {
    events: row.pending_event_selection as PendingEvents,
    original_message: row.original_message ?? null,
  };
}

/**
 * Clear the pending event selection for a phone number after a successful
 * selection or when the session should be reset.
 */
export async function clearPendingEventSelection(phone: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('whatsapp_session_state')
    .delete()
    .eq('phone_e164', phone);
  if (error) {
    console.warn('[whatsapp-session-state] clearPendingEventSelection failed:', error);
  }
}
