/**
 * Builds the ReportData payload for an event.
 *
 * Reads through the provided supabase client — pass a user-scoped client so
 * RLS applies (the route handler does this). All aggregations happen in
 * JS rather than via Postgres RPCs because the data volume per event is
 * small (low thousands of rows max in v1) and we don't want to maintain a
 * parallel set of SQL functions.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ReportConversations,
  ReportData,
  ReportEscalations,
  ReportEventMeta,
  ReportIntents,
  ReportKB,
  ReportOrders,
  ReportPerformance,
  ReportRefund,
} from './types';

const FIVE_MINUTES_HOURS = 5 / 60;

interface RawOrder {
  ticket_type: string | null;
  quantity: number;
  amount_paid: number | string | null;
  currency: string;
  status: 'completed' | 'payment_failed' | 'payment_pending' | 'refunded';
}

interface RawConversation {
  id: string;
  language: string;
  state: string;
  created_at: string;
}

interface RawMessage {
  conversation_id: string;
  role: string;
  classified_intent: string | null;
  cited_section_ids: string[] | null;
  created_at: string;
}

interface RawEscalation {
  status: 'open' | 'claimed' | 'resolved' | 'reopened';
  reason: string;
}

interface RawRefundCase {
  outcome: string | null;
  estimated_value_saved: number | string | null;
  reason: string | null;
}

function toNumber(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ─── Event metadata ─────────────────────────────────────────────────────────

async function fetchEvent(
  supabase: SupabaseClient,
  eventId: string,
): Promise<ReportEventMeta | null> {
  const { data, error } = await supabase
    .from('events')
    .select(
      'id, name, slug, start_date, end_date, venue_name, venue_city, timezone, ' +
        'operators(name, default_currency)',
    )
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();
  if (error || !data) {
    if (error) console.error('[report] fetchEvent error:', error.message);
    return null;
  }

  const row = data as unknown as {
    id: string;
    name: string;
    slug: string;
    start_date: string;
    end_date: string;
    venue_name: string;
    venue_city: string;
    timezone: string;
    operators: { name: string; default_currency: string } | null;
  };

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    start_date: row.start_date,
    end_date: row.end_date,
    venue_name: row.venue_name,
    venue_city: row.venue_city,
    timezone: row.timezone,
    operator_name: row.operators?.name ?? 'Unknown operator',
    default_currency: row.operators?.default_currency ?? 'AED',
  };
}

// ─── Orders / revenue ───────────────────────────────────────────────────────

function buildOrders(rows: RawOrder[], defaultCurrency: string): ReportOrders {
  const completed = rows.filter((r) => r.status === 'completed');
  const byTier = new Map<
    string,
    { ticket_type: string; orders: number; tickets: number; revenue: number }
  >();

  let totalTickets = 0;
  let totalRevenue = 0;
  for (const r of completed) {
    const key = r.ticket_type ?? '(unspecified)';
    const amount = toNumber(r.amount_paid);
    totalTickets += r.quantity;
    totalRevenue += amount;
    const existing = byTier.get(key);
    if (existing) {
      existing.orders += 1;
      existing.tickets += r.quantity;
      existing.revenue += amount;
    } else {
      byTier.set(key, {
        ticket_type: key,
        orders: 1,
        tickets: r.quantity,
        revenue: amount,
      });
    }
  }

  return {
    total_tickets_sold: totalTickets,
    total_orders: completed.length,
    total_revenue: totalRevenue,
    currency: rows[0]?.currency ?? defaultCurrency,
    by_tier: Array.from(byTier.values()).sort((a, b) => b.revenue - a.revenue),
    payment_failed_orders: rows.filter((r) => r.status === 'payment_failed').length,
    payment_pending_orders: rows.filter((r) => r.status === 'payment_pending').length,
    refunded_orders: rows.filter((r) => r.status === 'refunded').length,
  };
}

// ─── Conversations ──────────────────────────────────────────────────────────

function buildConversations(rows: RawConversation[]): ReportConversations {
  const total = rows.length;
  const deflected = rows.filter(
    (r) =>
      r.state === 'faq_answer' ||
      r.state === 'refund_deflection' ||
      r.state === 'session_closed',
  ).length;
  const escalated = rows.filter((r) => r.state === 'escalation_triggered').length;

  const langMap = new Map<string, number>();
  for (const r of rows) {
    langMap.set(r.language, (langMap.get(r.language) ?? 0) + 1);
  }

  const dayMap = new Map<string, number>();
  for (const r of rows) {
    const day = r.created_at.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }

  return {
    total,
    deflected,
    escalated,
    deflection_rate: total === 0 ? 0 : deflected / total,
    by_language: Array.from(langMap.entries())
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count),
    by_day: Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ─── Refund cases ───────────────────────────────────────────────────────────

function buildRefund(rows: RawRefundCase[]): ReportRefund {
  const total = rows.length;
  const deflected = rows.filter((r) => r.outcome === 'resolved_deflected').length;
  const escalated = rows.filter(
    (r) =>
      r.outcome === 'escalated_unresolved' ||
      r.outcome === 'resolved_refund_approved_by_human',
  ).length;
  const revenueProtected = rows
    .filter((r) => r.outcome === 'resolved_deflected')
    .reduce((sum, r) => sum + toNumber(r.estimated_value_saved), 0);

  const reasonMap = new Map<string, { reason: string; count: number; deflected: number }>();
  for (const r of rows) {
    const key = r.reason ?? '(unspecified)';
    const existing = reasonMap.get(key);
    if (existing) {
      existing.count += 1;
      if (r.outcome === 'resolved_deflected') existing.deflected += 1;
    } else {
      reasonMap.set(key, {
        reason: key,
        count: 1,
        deflected: r.outcome === 'resolved_deflected' ? 1 : 0,
      });
    }
  }

  return {
    total_cases: total,
    deflected_count: deflected,
    escalated_count: escalated,
    deflection_rate: total === 0 ? 0 : deflected / total,
    estimated_revenue_protected: revenueProtected,
    by_reason: Array.from(reasonMap.values()).sort((a, b) => b.count - a.count),
  };
}

// ─── Escalations ────────────────────────────────────────────────────────────

function buildEscalations(rows: RawEscalation[]): ReportEscalations {
  const total = rows.length;
  const counts = { open: 0, claimed: 0, resolved: 0, reopened: 0 };
  for (const r of rows) {
    counts[r.status] += 1;
  }
  const reasonMap = new Map<string, number>();
  for (const r of rows) {
    reasonMap.set(r.reason, (reasonMap.get(r.reason) ?? 0) + 1);
  }
  return {
    total,
    by_status: counts,
    resolution_rate: total === 0 ? 0 : counts.resolved / total,
    by_reason: Array.from(reasonMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ─── KB citations (top sections) ────────────────────────────────────────────

async function buildKB(
  supabase: SupabaseClient,
  eventId: string,
  messages: RawMessage[],
): Promise<ReportKB> {
  const counts = new Map<string, number>();
  for (const m of messages) {
    if (m.role !== 'agent' || !m.cited_section_ids) continue;
    for (const id of m.cited_section_ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const ranked = Array.from(counts.entries())
    .map(([section_id, count]) => ({ section_id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (ranked.length === 0) {
    return { top_sections: [], total_citations: 0 };
  }

  // Hydrate question_en for context.
  const { data: sections } = await supabase
    .from('kb_sections')
    .select('section_id, question_en')
    .eq('event_id', eventId)
    .in(
      'section_id',
      ranked.map((r) => r.section_id),
    );

  const questionMap = new Map(
    (sections ?? []).map((s) => [s.section_id as string, (s.question_en as string | null) ?? null]),
  );

  return {
    total_citations: Array.from(counts.values()).reduce((a, b) => a + b, 0),
    top_sections: ranked.map((r) => ({
      section_id: r.section_id,
      question_en: questionMap.get(r.section_id) ?? null,
      citation_count: r.count,
    })),
  };
}

// ─── Intents ─────────────────────────────────────────────────────────────────

function buildIntents(messages: RawMessage[]): ReportIntents {
  const counts = new Map<string, number>();
  let total = 0;
  for (const m of messages) {
    if (m.role !== 'agent' || !m.classified_intent) continue;
    counts.set(m.classified_intent, (counts.get(m.classified_intent) ?? 0) + 1);
    total += 1;
  }
  return {
    total,
    by_intent: Array.from(counts.entries())
      .map(([intent, count]) => ({
        intent,
        count,
        percentage: total === 0 ? 0 : count / total,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

// ─── Performance ────────────────────────────────────────────────────────────

function buildPerformance(
  conversations: RawConversation[],
  messages: RawMessage[],
  deflectedCount: number,
): ReportPerformance {
  // Compute time-to-agent-reply for each user->agent pair within a
  // conversation. Group messages by conversation, sort by created_at, and
  // measure the seconds between a user message and the next agent message.
  const byConvo = new Map<string, RawMessage[]>();
  for (const m of messages) {
    const list = byConvo.get(m.conversation_id);
    if (list) list.push(m);
    else byConvo.set(m.conversation_id, [m]);
  }

  const aiSeconds: number[] = [];
  const humanSeconds: number[] = [];
  const escalatedIds = new Set(
    conversations.filter((c) => c.state === 'escalation_triggered').map((c) => c.id),
  );

  for (const [convoId, msgs] of Array.from(byConvo.entries())) {
    const sorted = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      if (cur.role === 'user' && next.role === 'agent') {
        const dt =
          (new Date(next.created_at).getTime() - new Date(cur.created_at).getTime()) / 1000;
        if (dt >= 0 && dt < 600) {
          if (escalatedIds.has(convoId)) {
            humanSeconds.push(dt);
          } else {
            aiSeconds.push(dt);
          }
        }
      }
    }
  }

  return {
    median_response_seconds_ai: median(aiSeconds),
    median_response_seconds_human: median(humanSeconds),
    estimated_team_hours_saved: deflectedCount * FIVE_MINUTES_HOURS,
  };
}

// ─── Entry point ────────────────────────────────────────────────────────────

export async function generateReportData(
  supabase: SupabaseClient,
  eventId: string,
): Promise<ReportData | null> {
  const event = await fetchEvent(supabase, eventId);
  if (!event) return null;

  // Step 1: fetch conversation ids (needed to scope messages query).
  const { data: convoIdRows } = await supabase
    .from('conversations')
    .select('id')
    .eq('event_id', eventId);
  const conversationIds = (convoIdRows ?? []).map((c) => c.id as string);

  // Step 2: fetch everything else in parallel.
  const [
    { data: ordersData },
    { data: conversationsData },
    { data: messagesData },
    { data: escalationsData },
    { data: refundCasesData },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('ticket_type, quantity, amount_paid, currency, status')
      .eq('event_id', eventId),
    supabase
      .from('conversations')
      .select('id, language, state, created_at')
      .eq('event_id', eventId),
    conversationIds.length === 0
      ? Promise.resolve({ data: [] })
      : supabase
          .from('messages')
          .select(
            'conversation_id, role, classified_intent, cited_section_ids, created_at',
          )
          .in('conversation_id', conversationIds),
    supabase.from('escalations').select('status, reason').eq('event_id', eventId),
    supabase
      .from('refund_cases')
      .select('outcome, estimated_value_saved, reason')
      .eq('event_id', eventId),
  ]);

  const orders = buildOrders(
    (ordersData ?? []) as RawOrder[],
    event.default_currency,
  );
  const conversations = buildConversations((conversationsData ?? []) as RawConversation[]);
  const refund = buildRefund((refundCasesData ?? []) as RawRefundCase[]);
  const escalations = buildEscalations((escalationsData ?? []) as RawEscalation[]);
  const kb = await buildKB(supabase, eventId, (messagesData ?? []) as RawMessage[]);
  const intents = buildIntents((messagesData ?? []) as RawMessage[]);
  const performance = buildPerformance(
    (conversationsData ?? []) as RawConversation[],
    (messagesData ?? []) as RawMessage[],
    conversations.deflected,
  );

  return {
    event,
    generated_at: new Date().toISOString(),
    is_empty: conversations.total === 0,
    conversations,
    orders,
    refund,
    escalations,
    kb,
    intents,
    performance,
  };
}
