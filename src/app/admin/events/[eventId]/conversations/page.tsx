import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { ConversationsFilters } from './_components/conversations-filters';

const PAGE_SIZE = 25;

const STATE_LABELS: Record<string, string> = {
  greeting: 'Greeting',
  faq_answer: 'FAQ',
  order_lookup: 'Order lookup',
  refund_deflection: 'Refund deflection',
  escalation_triggered: 'Escalated',
  session_closed: 'Closed',
  START: 'New',           // legacy
  INTAKE: 'Intake',       // legacy
};

const STATE_COLORS: Record<string, string> = {
  greeting:              'bg-slate-50 text-slate-700 border-slate-200',
  faq_answer:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  order_lookup:          'bg-amber-50 text-amber-700 border-amber-200',
  refund_deflection:     'bg-blue-50 text-blue-700 border-blue-200',
  escalation_triggered:  'bg-red-50 text-red-700 border-red-200',
  session_closed:        'bg-zinc-100 text-zinc-700 border-zinc-200',
};

interface ConversationsPageProps {
  params: { eventId: string };
  searchParams: {
    page?: string;
    state?: string;
    language?: string;
    q?: string;
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

export default async function ConversationsPage({
  params,
  searchParams,
}: ConversationsPageProps) {
  const supabase = createServerClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();
  if (!event) notFound();

  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const stateFilter = searchParams.state ?? '';
  const languageFilter = searchParams.language ?? '';
  const query = (searchParams.q ?? '').trim();
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  // Build conversations query.
  let q = supabase
    .from('conversations')
    .select(
      'id, customer_phone_e164, language, state, channel, matched_order_id, closed_at, created_at, updated_at',
      { count: 'exact' },
    )
    .eq('event_id', params.eventId)
    .order('created_at', { ascending: false })
    .range(rangeFrom, rangeTo);

  if (stateFilter) q = q.eq('state', stateFilter);
  if (languageFilter) q = q.eq('language', languageFilter);
  if (query) {
    // If the query looks like an order id, resolve to matching conversation ids
    // via the orders table; otherwise treat as a phone substring.
    if (/^[A-Z]{2,5}[-_][A-Z0-9]{3,15}$/i.test(query)) {
      const { data: orderRows } = await supabase
        .from('orders')
        .select('id')
        .eq('event_id', params.eventId)
        .eq('order_id', query.toUpperCase())
        .limit(50);
      const orderIds = (orderRows ?? []).map((r) => r.id);
      if (orderIds.length > 0) {
        q = q.in('matched_order_id', orderIds);
      } else {
        // Force empty result if no matching order
        q = q.eq('id', '00000000-0000-0000-0000-000000000000');
      }
    } else {
      q = q.ilike('customer_phone_e164', `%${query}%`);
    }
  }

  const { data: conversations, count } = await q;
  const rows = (conversations ?? []) as ConversationRow[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Bulk fetch message counts and last user text per conversation (cheaper
  // than N+1 queries — fetch all messages for these convos in one go).
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
            currentState={stateFilter}
            currentLanguage={languageFilter}
            currentQuery={query}
          />
        </Suspense>
      </div>

      <Separator />

      <div className="text-sm text-muted-foreground">
        {total === 0 ? (
          <span>No conversations match the current filters.</span>
        ) : (
          <span>
            {total} conversation{total !== 1 ? 's' : ''}
            {query || stateFilter || languageFilter ? ' (filtered)' : ''}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {total === 0 && !query && !stateFilter && !languageFilter
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
                  state={stateFilter}
                  language={languageFilter}
                  q={query}
                  label="Previous"
                  before={<ChevronLeft className="h-4 w-4" />}
                />
                <PageLink
                  eventId={params.eventId}
                  page={page + 1}
                  disabled={page >= totalPages}
                  state={stateFilter}
                  language={languageFilter}
                  q={query}
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function PageLink({
  eventId,
  page,
  disabled,
  state,
  language,
  q,
  label,
  before,
  after,
}: {
  eventId: string;
  page: number;
  disabled: boolean;
  state: string;
  language: string;
  q: string;
  label: string;
  before?: React.ReactNode;
  after?: React.ReactNode;
}) {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (state) params.set('state', state);
  if (language) params.set('language', language);
  if (q) params.set('q', q);
  const href = `/admin/events/${eventId}/conversations?${params.toString()}`;

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
