/**
 * Order lookup for the agent runtime.
 *
 * Resolves an order by (in priority order):
 *   1. An order_id extracted from the message (e.g., "ORD-001023"),
 *   2. A phone number extracted from the message (any E.164-ish format),
 *   3. The conversation's own customer_phone_e164 (set when the session was opened),
 *   4. An email address extracted from the message (exact match),
 *   5. A customer name extracted from the message (ILIKE — can return multiple).
 *
 * When multiple orders match (name / email) the caller gets an 'ambiguous' result
 * and should ask the customer to clarify which order is theirs.
 *
 * All reads go through the user-scoped supabase client, so RLS applies.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { OrderContext } from './types';

// ─── Regex ────────────────────────────────────────────────────────────────────

// Permissive order ID regex: ORD-xxx, BB-xxxx, TKT-xxx, etc.
const ORDER_ID_RE = /\b([A-Z]{2,5}[-_][A-Z0-9]{3,15})\b/i;

// E.164: + then 7-15 digits.
const PHONE_RE = /\+\d{7,15}/;

// Loose 7-15 digit run (without +) — last resort.
const LOOSE_DIGITS_RE = /\b\d{7,15}\b/;

// RFC 5321-ish email extraction.
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/;

// Name patterns: "my name is X Y" or Arabic "اسمي X"
const NAME_PATTERNS: RegExp[] = [
  /(?:my name is|i am|i'm|this is|booking (?:is )?under)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,})+)/i,
  /(?:اسمي|أنا|باسم|اسم الحجز|الاسم|حجزت باسم|التذكرة باسم|الحجز باسم)\s+([؀-ۿݐ-ݿ]{2,}(?:\s+[؀-ۿݐ-ݿ]{2,})*)/,
  /(?:اسمي|باسم|الاسم)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,})+)/i,
];

// ─── Shared result type ────────────────────────────────────────────────────────

export type OrderLookupResult =
  | { kind: 'single';    order: OrderContext }
  | { kind: 'ambiguous'; orders: OrderContext[] }
  | { kind: 'not_found' };

// ─── DB columns ───────────────────────────────────────────────────────────────

interface SelectedOrderRow {
  id: string;
  order_id: string;
  customer_phone_e164: string;
  customer_name: string | null;
  customer_email: string | null;
  ticket_type: string | null;
  quantity: number;
  amount_paid: number | string | null;
  currency: string;
  status: OrderContext['status'];
  vip_flag: boolean;
  transfer_eligible: boolean;
}

const SELECT_COLUMNS =
  'id, order_id, customer_phone_e164, customer_name, customer_email, ticket_type, quantity, ' +
  'amount_paid, currency, status, vip_flag, transfer_eligible';

// ─── Converters ───────────────────────────────────────────────────────────────

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

// ─── Extraction helpers ───────────────────────────────────────────────────────

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

/** Extracts an email address from a message, lowercased. */
export function extractEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Extracts a customer name from common self-introduction phrases.
 * Returns null when no confident name phrase is detected.
 */
export function extractName(text: string): string | null {
  for (const pattern of NAME_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

// ─── Main lookup ──────────────────────────────────────────────────────────────

/**
 * Look up an order for an event.
 *
 * Search priority (first match wins — except name/email which can be ambiguous):
 *   1. Explicit order_id in the message → single result
 *   2. Phone in the message → single result (most recent)
 *   3. Session phone (conversation's customer_phone_e164) → single result (most recent)
 *   4. Email in the message → single if unique; ambiguous if multiple
 *   5. Name phrase in the message → single if unique; ambiguous if multiple
 *
 * @returns OrderLookupResult — 'single', 'ambiguous', or 'not_found'.
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
): Promise<OrderLookupResult> {
  const text = opts.messageText ?? '';

  // ── 1. Order ID (exact) ────────────────────────────────────────────────────
  const orderIdHint =
    opts.explicitOrderId ??
    (text ? extractOrderId(text) : null);

  if (orderIdHint) {
    const { data } = await supabase
      .from('orders')
      .select(SELECT_COLUMNS)
      .eq('event_id', eventId)
      .eq('order_id', orderIdHint)
      .maybeSingle();
    if (data) return { kind: 'single', order: rowToContext(data as unknown as SelectedOrderRow) };
  }

  // ── 2. Phone in message ────────────────────────────────────────────────────
  const phoneHint =
    (opts.explicitPhone ? normalizePhoneE164(opts.explicitPhone) : null) ??
    (text ? extractPhone(text) : null);

  if (phoneHint) {
    const { data } = await supabase
      .from('orders')
      .select(SELECT_COLUMNS)
      .eq('event_id', eventId)
      .eq('customer_phone_e164', phoneHint)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { kind: 'single', order: rowToContext(data as unknown as SelectedOrderRow) };
  }

  // ── 3. Session phone ───────────────────────────────────────────────────────
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
    if (data) return { kind: 'single', order: rowToContext(data as unknown as SelectedOrderRow) };
  }

  // ── 4. Email in message ────────────────────────────────────────────────────
  const emailHint = text ? extractEmail(text) : null;

  if (emailHint) {
    const { data: emailRows } = await supabase
      .from('orders')
      .select(SELECT_COLUMNS)
      .eq('event_id', eventId)
      .eq('customer_email', emailHint)
      .order('created_at', { ascending: false })
      .limit(5);

    const rows = (emailRows ?? []) as unknown as SelectedOrderRow[];
    if (rows.length === 1) return { kind: 'single', order: rowToContext(rows[0]) };
    if (rows.length > 1) return { kind: 'ambiguous', orders: rows.map(rowToContext) };
  }

  // ── 5. Customer name in message ────────────────────────────────────────────
  const nameHint = text ? extractName(text) : null;

  if (nameHint) {
    // Use ILIKE for case-insensitive partial match on customer_name.
    const { data: nameRows } = await supabase
      .from('orders')
      .select(SELECT_COLUMNS)
      .eq('event_id', eventId)
      .ilike('customer_name', `%${escapeLike(nameHint)}%`)
      .order('created_at', { ascending: false })
      .limit(5);

    const rows = (nameRows ?? []) as unknown as SelectedOrderRow[];
    if (rows.length === 1) return { kind: 'single', order: rowToContext(rows[0]) };
    if (rows.length > 1) return { kind: 'ambiguous', orders: rows.map(rowToContext) };
  }

  return { kind: 'not_found' };
}
