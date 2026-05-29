import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getConversationMetrics } from '@/lib/agent/conversation-metrics';
import type { EventConfig } from '@/lib/types';

import { ConversationsFilters } from './_components/conversations-filters';

const PAGE_SIZE = 25;

// ─── Display maps ─────────────────────────────────────────────────────────────

const STATE_LABELS: Record<string, string> = {
  greeting: 'Greeting',
  faq_answer: 'FAQ',
  order_lookup: 'Order lookup',
  refund_deflection: 'Refund deflection',
  escalation_triggered: 'Escalated',
  session_closed: 'Closed',
  START: 'New',
  INTAKE: 'Intake',
};

const STATE_COLORS: Record<string, string> = {
  greeting:             'bg-slate-50 text-slate-700 border-slate-200',
  faq_answer:           'bg-emerald-50 text-emerald-700 border-emerald-200',
  order_lookup:         'bg-amber-50 text-amber-700 border-amber-200',
  refund_deflection:    'bg-blue-50 text-blue-700 border-blue-200',
  escalation_triggered: 'bg-red-50 text-red-700 border-red-200',
  session_closed:       'bg-zinc-100 text-zinc-700 border-zinc-200',
};

// Maps the user-friendly intent filter value to one or more conversation states.
const INTENT_TO_STATES: Record<string, string[]> = {
  faq:       ['faq_answer'],
  order:     ['order_lookup'],
  refund:    ['refund_deflection'],
  escalation:['escalation_triggered'],
  other:     ['greeting', 'session_closed', 'START', 'INTAKE'],
};

/** Returns the ISO timestamp corresponding to the start of the chosen range. */
function getRangeSince(range: string): string | null {
  if (range === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (range === '7d') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationsPageProps {
  params: { eventId: string };
  searchParams: {
    page?: string;
    state?: string;
    language?: string;
    q?: string;
    intent?: string;
    range?: string;
  };
}

interface ConversationRow {
  id: string;
  customer_phone_e164: string;
  language: string;
  state: string;
  channel: string;
  matched_order_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function ConversationsPage({
  params,
  searchParams,
}: ConversationsPageProps) {
  const supabase = createServerClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, name, config')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();
  if (!event) notFound();

  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const stateFilter  = searchParams.state ?? '';
  const languageFilter = searchParams.language ?? '';
  const intentFilter = searchParams.intent ?? '';
  const rangeFilter  = searchParams.range ?? '';
  const query        = (searchParams.q ?? '').trim();

  const since = getRangeSince(rangeFilter);

  // Fetch metrics (uses same since value so the bar stays in sync with range).
  const metricsPromise = getConversationMetrics(params.eventId, since ? { since } : undefined);

  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo   = rangeFrom + PAGE_SIZE - 1;

  // ── Resolve search → conversation IDs ────────────────────────────────────
  // Three search modes (mutually exclusive, in priority order):
  //   1. Looks like an order ID   → match via orders table
  //   2. Non-empty query          → phone ILIKE + FTS on messages
  //   3. No query                 → no ID pre-filter

  let searchConvoIds: string[] | null = null; // null = no filter; [] = no results

  if (query) {
    if (/^[A-Z]{2,5}[-_][A-Z0-9]{3,15}$/i.test(query)) {
      // Mode 1: order ID
      const { data: orderRows } = await supabase
        .from('orders')
        .select('id')
        .eq('event_id', params.eventId)
        .eq('order_id', query.toUpperCase())
        .limit(50);
      const matchedOrderIds = (orderRows ?? []).map((r) => r.id as string);

      if (matchedOrderIds.length > 0) {
        // Resolve order → conversation via matched_order_id
        const { data: convoRows } = await supabase
          .from('conversations')
          .select('id')
          .eq('event_id', params.eventId)
          .in('matched_order_id', matchedOrderIds);
        searchConvoIds = (convoRows ?? []).map((r) => r.id as string);
      } else {
        searchConvoIds = []; // force empty result
      }
    } else {
      // Mode 2: phone ILIKE + FTS on message content (run in parallel)
      const [phoneResult, ftsResult] = await Promise.all([
        supabase
          .from('conversations')
          .select('id')
          .eq('event_id', params.eventId)
          .ilike('customer_phone_e164', `%${query}%`),
        // Only do FTS when query is long enough to be meaningful.
        query.length >= 3
          ? supabase
              .from('messages')
              .select('conversation_id')
              .textSearch('text', query, { type: 'plain', config: 'english' })
              .limit(500)
          : Promise.resolve({ data: null }),
      ]);

      const phoneIds = (phoneResult.data ?? []).map((r) => r.id as string);
      const ftsIds   = ((ftsResult as { data: Array<{ conversation_id: string }> | null }).data ?? [])
        .map((r) => r.conversation_id);

      // Merge and deduplicate.
      searchConvoIds = Array.from(new Set(phoneIds.concat(ftsIds)));
    }
  }

  // ── Build main conversations query ────────────────────────────────────────
  // Short-circuit: if the search produced zero matching IDs there is nothing
  // to look up — skip the DB round-trip entirely.
  const searchYieldedEmpty = searchConvoIds !== null && searchConvoIds.length === 0;

  let rows: ConversationRow[] = [];
  let total = 0;

  if (!searchYieldedEmpty) {
    let q = supabase
      .from('conversations')
      .select(
        'id, customer_phone_e164, language, state, channel, matched_order_id, closed_at, created_at, updated_at',
        { count: 'exact' },
      )
      .eq('event_id', params.eventId)
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo);

    // Intent filter (maps to one or more state values).
    if (intentFilter && INTENT_TO_STATES[intentFilter]) {
      q = q.in('state', INTENT_TO_STATES[intentFilter]);
    } else if (stateFilter) {
      // Legacy state param — keep backward compat.
      q = q.eq('state', stateFilter);
    }

    if (languageFilter) q = q.eq('language', languageFilter);
    if (since)          q = q.gte('created_at', since);

    if (searchConvoIds !== null) {
      q = q.in('id', searchConvoIds);
    }

    const { data: conversations, count } = await q;
    rows = (conversations ?? []) as ConversationRow[];
    total = count ?? 0;
  }

  // Metrics always loads — it isn't gated by the search, so users still see
  // their event-wide performance numbers above an empty result table.
  const metrics = await metricsPromise;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── Lowest ticket price for savings estimate ─────────────────────────────
  const eventConfig = (event.config ?? {}) as Partial<EventConfig>;
  const prices = (eventConfig.ticket_tiers ?? [])
    .map((t) => t.price ?? 0)
    .filter((p) => p > 0);
  const lowestTicketPrice = prices.length > 0 ? Math.min(...prices) : 150;
  const estimatedSavings = metrics.refunds_deflected * lowestTicketPrice;

  // ── Bulk fetch messages for the page ─────────────────────────────────────
  const convoIds = rows.map((r) => r.id);
  const messagesByConvo = new Map<
    string,
    { count: number; lastUserText: string | null; lastAt: string | null }
  >();
  if (convoIds.length > 0) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('conversation_id, role, text, created_at')
      .in('conversation_id', convoIds)
      .order('created_at', { ascending: true });

    for (const m of (msgs ?? []) as Array<{
      conversation_id: string;
      role: string;
      text: string;
      created_at: string;
    }>) {
      const entry = messagesByConvo.get(m.conversation_id) ?? {
        count: 0,
        lastUserText: null,
        lastAt: null,
      };
      entry.count += 1;
      if (m.role === 'user') entry.lastUserText = m.text;
      entry.lastAt = m.created_at;
      messagesByConvo.set(m.conversation_id, entry);
    }
  }

  const isFiltered = !!(query || intentFilter || stateFilter || languageFilter || rangeFilter);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Conversations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every customer conversation the agent has handled for this event.
            Click a row to see the full transcript.
          </p>
        </div>
        <Suspense>
          <ConversationsFilters
            eventId={params.eventId}
            currentLanguage={languageFilter}
            currentQuery={query}
            currentIntent={intentFilter}
            currentRange={rangeFilter}
          />
        </Suspense>
      </div>

      <Separator />

      {/* ── Metrics bar ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Total conversations" value={metrics.total} />
        <MetricCard
          label="Resolved by AI"
          value={metrics.resolved_by_ai}
          badge={metrics.total > 0 ? `${metrics.resolution_rate}%` : undefined}
          accent="emerald"
        />
        <MetricCard
          label="Escalated"
          value={metrics.escalated}
          badge={
            metrics.total > 0
              ? `${Math.round((metrics.escalated / metrics.total) * 100)}%`
              : undefined
          }
          accent="red"
        />
        <MetricCard
          label="Refunds deflected"
          value={metrics.refunds_deflected}
          accent="blue"
        />
      </div>

      {/* ── Savings estimate ─────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">
        <span className="font-medium">Estimated savings: </span>
        <span className="font-semibold tabular-nums">
          SAR {estimatedSavings.toLocaleString()}
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          (estimated based on ticket price × refunds deflected
          {prices.length > 0
            ? ` — SAR ${lowestTicketPrice.toLocaleString()} lowest tier`
            : ' — SAR 150 default'}
          )
        </span>
      </div>

      <div className="text-sm text-muted-foreground">
        {total === 0 ? (
          <span>No conversations match the current filters.</span>
        ) : (
          <span>
            {total.toLocaleString()} conversation{total !== 1 ? 's' : ''}
            {isFiltered ? ' (filtered)' : ''}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {total === 0 && !isFiltered
            ? 'No conversations recorded yet. Start one in the Simulator tab.'
            : 'No conversations match the current filters.'}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Started
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Phone
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                      Lang
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      State
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                      Last message
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                      Msgs
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((c) => {
                    const meta = messagesByConvo.get(c.id);
                    return (
                      <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                          <Link
                            href={`/admin/events/${params.eventId}/conversations/${c.id}`}
                            className="hover:underline"
                          >
                            {formatDateTime(c.created_at)}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          <Link
                            href={`/admin/events/${params.eventId}/conversations/${c.id}`}
                            className="hover:underline"
                          >
                            {c.customer_phone_e164}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs uppercase text-muted-foreground hidden sm:table-cell">
                          {c.language}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                              STATE_COLORS[c.state] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'
                            }`}
                          >
                            {c.state === 'escalation_triggered' && (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            {STATE_LABELS[c.state] ?? c.state}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 max-w-xs truncate text-xs text-muted-foreground hidden md:table-cell">
                          {meta?.lastUserText ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                          {meta?.count ?? 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <PageLink
                  eventId={params.eventId}
                  page={page - 1}
                  disabled={page <= 1}
                  intent={intentFilter}
                  language={languageFilter}
                  q={query}
                  range={rangeFilter}
                  label="Previous"
                  before={<ChevronLeft className="h-4 w-4" />}
                />
                <PageLink
                  eventId={params.eventId}
                  page={page + 1}
                  disabled={page >= totalPages}
                  intent={intentFilter}
                  language={languageFilter}
                  q={query}
                  range={rangeFilter}
                  label="Next"
                  after={<ChevronRight className="h-4 w-4" />}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  badge,
  accent,
}: {
  label: string;
  value: number;
  badge?: string;
  accent?: 'emerald' | 'red' | 'blue';
}) {
  const accentClass =
    accent === 'emerald'
      ? 'text-emerald-700'
      : accent === 'red'
      ? 'text-red-700'
      : accent === 'blue'
      ? 'text-blue-700'
      : 'text-foreground';

  const badgeBg =
    accent === 'emerald'
      ? 'bg-emerald-100 text-emerald-700'
      : accent === 'red'
      ? 'bg-red-100 text-red-700'
      : 'bg-slate-100 text-slate-700';

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${accentClass}`}>
          {value.toLocaleString()}
        </span>
        {badge && (
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeBg}`}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function PageLink({
  eventId,
  page,
  disabled,
  intent,
  language,
  q,
  range,
  label,
  before,
  after,
}: {
  eventId: string;
  page: number;
  disabled: boolean;
  intent: string;
  language: string;
  q: string;
  range: string;
  label: string;
  before?: React.ReactNode;
  after?: React.ReactNode;
}) {
  const p = new URLSearchParams();
  if (page > 1) p.set('page', String(page));
  if (intent)   p.set('intent', intent);
  if (language) p.set('language', language);
  if (q)        p.set('q', q);
  if (range)    p.set('range', range);
  const href = `/admin/events/${eventId}/conversations?${p.toString()}`;

  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1 text-xs">
        {before}
        {label}
        {after}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" asChild className="gap-1 text-xs">
      <Link href={href}>
        {before}
        {label}
        {after}
      </Link>
    </Button>
  );
}
