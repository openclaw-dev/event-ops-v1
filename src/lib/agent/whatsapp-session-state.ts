/**
 * whatsapp-session-state.ts
 *
 * In-memory store for pending event-selection prompts.
 *
 * When a customer's operator has multiple live events, the inbound webhook
 * sends a numbered list and waits for a "1", "2", etc. reply. This module
 * tracks that pending state so the next message can be matched back to the
 * operator's chosen event.
 *
 * NOTE: In-memory state is per-process, not shared across Vercel serverless
 * invocations. For multi-instance deployments, replace this with a Redis or
 * Supabase-based store (e.g. a `whatsapp_session_state` table or Upstash Redis).
 * For single-instance / demo use this is sufficient.
 */

interface PendingSelection {
  events: Array<{ id: string; name: string }>;
  expires_at: number; // Unix ms
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes

// Map: customer phone → pending event selection
const pendingSelections = new Map<string, PendingSelection>();

/**
 * Store a pending event selection for the given phone number.
 * Overwrites any previous pending selection.
 */
export function setPendingEventSelection(
  phone: string,
  events: Array<{ id: string; name: string }>,
): void {
  pendingSelections.set(phone, {
    events,
    expires_at: Date.now() + TTL_MS,
  });
}

/**
 * Retrieve the pending event selection for a phone number.
 * Returns null if none exists or if the entry has expired (expired entries
 * are cleaned up on access).
 */
export function getPendingEventSelection(
  phone: string,
): Array<{ id: string; name: string }> | null {
  const entry = pendingSelections.get(phone);
  if (!entry) return null;

  if (Date.now() > entry.expires_at) {
    pendingSelections.delete(phone);
    return null;
  }

  return entry.events;
}

/**
 * Clear the pending event selection for a phone number after a successful
 * selection or when the session should be reset.
 */
export function clearPendingEventSelection(phone: string): void {
  pendingSelections.delete(phone);
}
