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

// ─── Event routing ────────────────────────────────────────────────────────────

/**
 * Finds all live events for an operator that are within a 12-hour window of
 * their start date (i.e. starting soon or started very recently).
 *
 * 0 results  → { type: 'none' }
 * 1 result   → { type: 'single', event_id, event }
 * 2+ results → { type: 'multiple', events }
 */
export async function resolveEventForOperator(
  operatorId: string,
): Promise<EventRouteResult> {
  const admin = createAdminClient();

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data } = await admin
    .from('events')
    .select('id, name, start_date, end_date, status, config')
    .eq('operator_id', operatorId)
    // Include live events, and draft events ended within the last 48 hours for post-event support.
    .or(`status.eq.live,and(status.eq.draft,end_date.gte.${cutoff})`)
    .gte('start_date', cutoff)
    .is('deleted_at', null)
    .order('start_date', { ascending: true })
    .limit(5);

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
