import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/paginate';

export interface RevenueLeakAuditData {
  event_name: string;
  event_date: string;
  generated_at: string;
  currency: string;

  // Completed revenue
  completed_orders: number;
  completed_revenue_sar: number;
  average_order_value_sar: number;

  // Failed payment leak
  failed_payment_count: number;
  failed_payment_revenue_sar: number;
  failed_payment_rate_pct: number;

  // No-show analysis
  tickets_sold: number;
  tickets_scanned: number;
  no_show_count: number;
  no_show_rate_pct: number;
  no_show_revenue_sar: number;

  // Duplicate scan incidents (gate failures)
  total_scan_attempts: number;
  failed_scan_count: number;
  duplicate_scan_count: number;
  gate_failure_rate_pct: number;

  // Recovery estimate
  recoverable_revenue_sar: number;
  recovery_fee_sar: number;

  // Support load
  total_conversations: number;
  escalated_conversations: number;
  top_intents: Array<{ intent: string; count: number }>;
}

function toNumber(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getRevenueLeakAuditData(
  eventId: string,
): Promise<RevenueLeakAuditData> {
  const admin = createAdminClient();

  // ── Event metadata ─────────────────────────────────────────────────────────
  const { data: event } = await admin
    .from('events')
    .select('name, start_date, operators(default_currency)')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();

  const row = event as unknown as {
    name: string;
    start_date: string;
    operators: { default_currency: string } | null;
  } | null;

  const event_name = row?.name ?? 'Unknown Event';
  const event_date = row?.start_date ?? '';
  const currency = row?.operators?.default_currency ?? 'SAR';

  // ── Orders ─────────────────────────────────────────────────────────────────
  // Paginate: revenue and ticket sums must cover every order, not the first
  // ~1000 PostgREST returns by default — a large event would otherwise
  // under-report revenue (audit 4.14).
  const orders = await fetchAllRows<{
    status: string;
    quantity: number;
    amount_paid: number | string | null;
    currency: string;
  }>(async (from, to) => {
    const { data, error } = await admin
      .from('orders')
      .select('status, quantity, amount_paid, currency')
      .eq('event_id', eventId)
      .range(from, to);
    return {
      data: data as Array<{
        status: string;
        quantity: number;
        amount_paid: number | string | null;
        currency: string;
      }> | null,
      error,
    };
  });

  const completedOrders = orders.filter((o) => o.status === 'completed');
  const failedOrders = orders.filter((o) => o.status === 'payment_failed');

  const completed_orders = completedOrders.length;
  const completed_revenue_sar = completedOrders.reduce(
    (sum, o) => sum + toNumber(o.amount_paid),
    0,
  );
  const tickets_sold = completedOrders.reduce((sum, o) => sum + (o.quantity ?? 1), 0);
  const average_order_value_sar =
    completed_orders === 0 ? 0 : completed_revenue_sar / completed_orders;

  const failed_payment_count = failedOrders.length;
  const failed_payment_revenue_sar = failedOrders.reduce(
    (sum, o) => sum + toNumber(o.amount_paid),
    0,
  );
  const attempted_total = completed_orders + failed_payment_count;
  const failed_payment_rate_pct =
    attempted_total === 0 ? 0 : (failed_payment_count / attempted_total) * 100;

  // ── Scan data ──────────────────────────────────────────────────────────────
  // Paginate so scan-result counts are exact for high-volume gates (audit 4.14).
  const gateScanRows = await fetchAllRows<{ scan_result: string }>(async (from, to) => {
    const { data, error } = await admin
      .from('gate_scans')
      .select('scan_result')
      .eq('event_id', eventId)
      .range(from, to);
    return { data: data as Array<{ scan_result: string }> | null, error };
  });
  const total_scan_attempts = gateScanRows.length;
  const tickets_scanned = gateScanRows.filter((s) => s.scan_result === 'admitted').length;
  const duplicate_scan_count = gateScanRows.filter((s) => s.scan_result === 'duplicate').length;
  const failed_scan_count = gateScanRows.filter(
    (s) => s.scan_result === 'not_found' || s.scan_result === 'invalid',
  ).length;
  const gate_failure_rate_pct =
    total_scan_attempts === 0
      ? 0
      : ((duplicate_scan_count + failed_scan_count) / total_scan_attempts) * 100;

  const no_show_count = Math.max(0, tickets_sold - tickets_scanned);
  const avg_ticket_price_for_no_show =
    tickets_sold === 0 ? 0 : completed_revenue_sar / tickets_sold;
  const no_show_rate_pct =
    tickets_sold === 0 ? 0 : (no_show_count / tickets_sold) * 100;
  const no_show_revenue_sar = no_show_count * avg_ticket_price_for_no_show;

  // ── Conversations ──────────────────────────────────────────────────────────
  // Paginate: the id list feeds the top-intents message query below, and the
  // counts must be exact (audit 4.14).
  const convos = await fetchAllRows<{ id: string; state: string }>(async (from, to) => {
    const { data, error } = await admin
      .from('conversations')
      .select('id, state')
      .eq('event_id', eventId)
      .range(from, to);
    return { data: data as Array<{ id: string; state: string }> | null, error };
  });
  const total_conversations = convos.length;
  const escalated_conversations = convos.filter(
    (c) => c.state === 'escalation_triggered',
  ).length;

  // ── Top intents (from messages classified_intent) ──────────────────────────
  const convoIds = convos.map((c) => c.id);
  let top_intents: Array<{ intent: string; count: number }> = [];

  if (convoIds.length > 0) {
    const { data: messagesData } = await admin
      .from('messages')
      .select('classified_intent')
      .in('conversation_id', convoIds)
      .not('classified_intent', 'is', null);

    const intentCounts = new Map<string, number>();
    for (const m of (messagesData ?? []) as Array<{ classified_intent: string | null }>) {
      if (!m.classified_intent) continue;
      intentCounts.set(
        m.classified_intent,
        (intentCounts.get(m.classified_intent) ?? 0) + 1,
      );
    }

    top_intents = Array.from(intentCounts.entries())
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  // ── Recovery estimate ──────────────────────────────────────────────────────
  const recoverable_revenue_sar =
    failed_payment_revenue_sar + no_show_revenue_sar * 0.3;
  const recovery_fee_sar = recoverable_revenue_sar * 0.22;

  return {
    event_name,
    event_date,
    generated_at: new Date().toISOString(),
    currency,
    completed_orders,
    completed_revenue_sar,
    average_order_value_sar,
    failed_payment_count,
    failed_payment_revenue_sar,
    failed_payment_rate_pct,
    tickets_sold,
    tickets_scanned,
    no_show_count,
    no_show_rate_pct,
    no_show_revenue_sar,
    total_scan_attempts,
    failed_scan_count,
    duplicate_scan_count,
    gate_failure_rate_pct,
    recoverable_revenue_sar,
    recovery_fee_sar,
    total_conversations,
    escalated_conversations,
    top_intents,
  };
}
