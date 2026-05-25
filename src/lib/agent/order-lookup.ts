/**
 * Order lookup for the agent runtime.
 *
 * Resolves an order by:
 *   1. An order_id extracted from the message (e.g., "ORD-001023"),
 *   2. A phone number extracted from the message (any E.164-ish format),
 *   3. The conversation's own customer_phone_e164 (set when the simulator
 *      session was opened).
 *
 * All reads go through the user-scoped supabase client, so RLS applies.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { OrderContext } from './types';

// Permissive order ID regex: captures ORD-xxx, BB-xxxx, TKT-xxx, etc.
// The capturing group is the full token.
const ORDER_ID_RE = /\b([A-Z]{2,5}[-_][A-Z0-9]{3,15})\b/i;

// E.164: + then 7-15 digits.
const PHONE_RE = /\+\d{7,15}/;

// Loose 7-15 digit run (without +) — last resort.
const LOOSE_DIGITS_RE = /\b\d{7,15}\b/;

interface SelectedOrderRow {
  id: string;
  order_id: string;
  customer_phone_e164: string;
  customer_name: string | null;
  ticket_type: string | null;
  quantity: number;
  amount_paid: number | string | null;
  currency: string;
  status: OrderContext['status'];
  vip_flag: boolean;
  transfer_eligible: boolean;
}

function rowToContext(row: SelectedOrderRow): OrderContext {
  return {
    id: row.id,
    order_id: row.order_id,
    customer_phone_e164: row.customer_phone_e164,
    customer_name: row.customer_name,
    ticket_type: row.ticket_type,
    quantity: row.quantity,
    amount_paid:
      row.amount_paid == null
        ? null
        : typeof row.amount_paid === 'string'
        ? parseFloat(row.amount_paid)
        : row.amount_paid,
    currency: row.currency,
    status: row.status,
    vip_flag: row.vip_flag,
    transfer_eligible: row.transfer_eligible,
  };
}

/**
 * Best-effort normalization of a phone-like string to E.164.
 * Leaves a leading + alone; strips all other non-digits.
 */
export function normalizePhoneE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return hasPlus ? `+${digits}` : `+${digits}`;
}

export function extractOrderId(text: string): string | null {
  const m = text.match(ORDER_ID_RE);
  return m ? m[1].toUpperCase() : null;
}

export function extractPhone(text: string): string | null {
  const e164 = text.match(PHONE_RE);
  if (e164) return e164[0];
  const loose = text.match(LOOSE_DIGITS_RE);
  if (loose) {
    const norm = normalizePhoneE164(loose[0]);
    if (norm) return norm;
  }
  return null;
}

const SELECT_COLUMNS =
  'id, order_id, customer_phone_e164, customer_name, ticket_type, quantity, ' +
  'amount_paid, currency, status, vip_flag, transfer_eligible';

/**
 * Look up an order for an event by extracted order_id or phone.
 *
 * Search order (first match wins):
 *   1. Explicit order_id in the message
 *   2. Phone in the message
 *   3. Session phone (conversation's customer_phone_e164)
 *
 * @returns OrderContext if found, null otherwise.
 */
export async function lookupOrder(
  supabase: SupabaseClient,
  eventId: string,
  opts: {
    messageText?: string;
    explicitOrderId?: string | null;
    explicitPhone?: string | null;
    sessionPhone?: string | null;
  },
): Promise<OrderContext | null> {
  const orderIdHint =
    opts.explicitOrderId ??
    (opts.messageText ? extractOrderId(opts.messageText) : null);

  if (orderIdHint) {
    const { data } = await supabase
      .from('orders')
      .select(SELECT_COLUMNS)
      .eq('event_id', eventId)
      .eq('order_id', orderIdHint)
      .maybeSingle();
    if (data) return rowToContext(data as unknown as SelectedOrderRow);
  }

  const phoneHint =
    (opts.explicitPhone ? normalizePhoneE164(opts.explicitPhone) : null) ??
    (opts.messageText ? extractPhone(opts.messageText) : null);

  if (phoneHint) {
    const { data } = await supabase
      .from('orders')
      .select(SELECT_COLUMNS)
      .eq('event_id', eventId)
      .eq('customer_phone_e164', phoneHint)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return rowToContext(data as unknown as SelectedOrderRow);
  }

  if (opts.sessionPhone) {
    const sessionPhoneNorm = normalizePhoneE164(opts.sessionPhone) ?? opts.sessionPhone;
    const { data } = await supabase
      .from('orders')
      .select(SELECT_COLUMNS)
      .eq('event_id', eventId)
      .eq('customer_phone_e164', sessionPhoneNorm)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return rowToContext(data as unknown as SelectedOrderRow);
  }

  return null;
}
