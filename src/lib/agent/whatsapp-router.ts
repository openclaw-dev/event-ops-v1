/**
 * whatsapp-router.ts
 *
 * Resolves which event(s) a customer WhatsApp message should be routed to,
 * and looks up the operator that owns a given WhatsApp phone number.
 *
 * Uses createAdminClient() — called from the inbound webhook route handler
 * where there is no user session.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { localDateStringInTz, DEFAULT_EVENT_TZ } from '@/lib/dates';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventRouteResult =
  | { type: 'single'; event_id: string; event: Record<string, unknown>; recently_ended: boolean }
  | { type: 'multiple'; events: Array<{ id: string; name: string }> }
  | { type: 'none' };

// ─── Operator lookup ─────────────────────────────────────────────────────────

/**
 * Returns the operators row for the given WhatsApp phone number ID, or null
 * if no operator has configured this number.
 *
 * `phoneNumberId` is the `whatsapp_business_phone_number_id` configured in
 * Operator Settings (matches META_PHONE_NUMBER_ID env var in single-tenant
 * deployments).
 */
export async function getOperatorByPhoneNumberId(
  phoneNumberId: string,
): Promise<{ id: string; operator_id: string } | null> {
  if (!phoneNumberId) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from('operators')
    .select('id')
    .eq('whatsapp_business_phone_number_id', phoneNumberId)
    .maybeSingle();

  if (!data) return null;

  const row = data as { id: string };
  // The operators table IS the operator — id = operator_id (self-referential alias
  // kept for clarity in the routing layer).
  return { id: row.id, operator_id: row.id };
}

/**
 * Single-tenant fallback: returns the sole operator in the system, or null
 * when there are zero or multiple operators (multi-tenant safety check).
 *
 * Used when `whatsapp_business_phone_number_id` has not been saved on the
 * operator row (e.g. Settings → WhatsApp page was never saved).
 */
export async function getSingleOperatorFallback(): Promise<{ id: string; operator_id: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin.from('operators').select('id').limit(2);
  const rows = (data ?? []) as { id: string }[];
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  return { id: row.id, operator_id: row.id };
}

// ─── Event routing ────────────────────────────────────────────────────────────

/**
 * Finds all active events for an operator:
 *   - Any event with status = 'live' (regardless of start date).
 *   - Draft events whose end_date is within the last 48 hours (post-event support window).
 *
 * 0 results  → { type: 'none' }
 * 1 result   → { type: 'single', event_id, event }
 * 2+ results → { type: 'multiple', events }
 */
export async function resolveEventForOperator(
  operatorId: string,
): Promise<EventRouteResult> {
  const admin = createAdminClient();

  const now = new Date();
  // Compute the date-string bounds in the operator/customer timezone, not UTC:
  // from 21:00 UTC to midnight (00:00–03:00 in Saudi) a UTC calendar date is a
  // day behind local, which silently dropped recently-ended events from routing
  // every night (audit 4.5). No single event exists at this operator-level step,
  // so fall back to the market default timezone. Query bounds/logic unchanged.
  const recentCutoff = localDateStringInTz(
    new Date(now.getTime() - 48 * 60 * 60 * 1000),
    DEFAULT_EVENT_TZ,
  );
  const today = localDateStringInTz(now, DEFAULT_EVENT_TZ);

  const { data, error } = await admin
    .from('events')
    .select('id, name, start_date, end_date, status, config')
    .eq('operator_id', operatorId)
    // Live events: always included.
    // Draft events: only those that have ALREADY ENDED (end_date < today) within the
    // last 48 hours (end_date >= recentCutoff). A draft event with a future end_date
    // is NOT yet ended and must never appear in the customer-support routing.
    .or(
      `status.eq.live,` +
      `and(status.eq.draft,end_date.gte.${recentCutoff},end_date.lt.${today})`,
    )
    .is('deleted_at', null)
    .order('start_date', { ascending: true })
    .limit(5);

  // Throw on a real DB error so the inbound route's catch sends the generic
  // error reply — a swallowed error must never masquerade as "no active
  // events" (audit 6.3). Error-checking only; the routing query is unchanged.
  if (error) {
    console.error('[whatsapp-router] resolveEventForOperator query failed:', error.message);
    throw new Error(`resolveEventForOperator failed: ${error.message}`);
  }

  const events = (data ?? []) as Array<{
    id: string;
    name: string;
    start_date: string;
    end_date: string | null;
    status: string;
    config: Record<string, unknown>;
  }>;

  if (events.length === 0) return { type: 'none' };

  if (events.length === 1) {
    const ev = events[0]!;
    const recently_ended = ev.status === 'draft';
    return {
      type: 'single',
      event_id: ev.id,
      event: ev as Record<string, unknown>,
      recently_ended,
    };
  }

  return {
    type: 'multiple',
    events: events.map((e) => ({ id: e.id, name: e.name })),
  };
}
