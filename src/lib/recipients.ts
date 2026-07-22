/**
 * recipients.ts
 *
 * Recipient-ownership validation for business-initiated WhatsApp sends
 * (payment recovery, CRM campaigns). Without it, an authenticated operator can
 * put ARBITRARY phone numbers in the request body and have the shared WABA
 * message them — turning "can message my own customers" into "can bulk-message
 * anyone" (audit 9.1a).
 *
 * A phone is a valid recipient only if it appears on an `orders` row belonging
 * to one of the operator's events. Queries run through the passed RLS client, so
 * they are additionally scoped to what the caller may see.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Returns the subset of `phones` that belong to a customer order under one of
 * the operator's events. Fails CLOSED — on any DB error it returns an empty set
 * (all recipients treated as invalid) so a transient failure can never widen the
 * allowed recipient list.
 */
export async function filterPhonesToOperatorOrders(
  supabase: SupabaseClient,
  operatorId: string,
  phones: string[],
): Promise<Set<string>> {
  const unique = Array.from(new Set(phones));
  if (unique.length === 0) return new Set();

  // 1. Resolve the operator's (non-deleted) event ids.
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id')
    .eq('operator_id', operatorId)
    .is('deleted_at', null);

  if (eventsError) {
    console.error('[recipients] operator events lookup failed — rejecting all', {
      operator_id: operatorId,
      error: eventsError.message,
    });
    return new Set();
  }

  const eventIds = (events ?? []).map((e) => (e as { id: string }).id);
  if (eventIds.length === 0) return new Set();

  // 2. Which of the requested phones sit on an order under those events?
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('customer_phone_e164')
    .in('event_id', eventIds)
    .in('customer_phone_e164', unique);

  if (ordersError) {
    console.error('[recipients] order phone lookup failed — rejecting all', {
      operator_id: operatorId,
      error: ordersError.message,
    });
    return new Set();
  }

  const valid = new Set<string>();
  for (const row of (orders ?? []) as Array<{ customer_phone_e164: string }>) {
    valid.add(row.customer_phone_e164);
  }
  return valid;
}
