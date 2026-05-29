import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { EscalationRowActions } from './_components/escalation-row-actions';
import { EscalationsFilters } from './_components/escalations-filters';

const PAGE_SIZE = 25;

const STATUS_PRIORITY: Record<string, number> = {
  open: 0,
  reopened: 1,
  claimed: 2,
  resolved: 3,
};

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const STATUS_BADGE: Record<string, string> = {
  open:     'bg-red-50 text-red-700 border-red-200',
  reopened: 'bg-amber-50 text-amber-700 border-amber-200',
  claimed:  'bg-blue-50 text-blue-700 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high:   'bg-amber-100 text-amber-800',
  normal: 'bg-slate-100 text-slate-700',
  low:    'bg-slate-50 text-slate-600',
};

interface EscalationsPageProps {
  params: { eventId: string };
  searchParams: { page?: string; status?: string; priority?: string };
}

interface EscalationRow {
  id: string;
  conversation_id: string;
  reason: string;
  summary_for_ops: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'claimed' | 'resolved' | 'reopened';
  claimed_by: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export default async function EscalationsPage({
  params,
  searchParams,
}: EscalationsPageProps) {
  const supabase = createServerClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();
  if (!event) notFound();

  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const statusFilter = searchParams.status ?? '';
  const priorityFilter = searchParams.priority ?? '';
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  // Counts for status header (independent of pagination)
  const [
    { count: openCount },
    { count: claimedCount },
    { count: resolvedCount },
    { count: reopenedCount },
  ] = await Promise.all([
    supabase
      .from('escalations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', params.eventId)
      .eq('status', 'open'),
    supabase
      .from('escalations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', params.eventId)
      .eq('status', 'claimed'),
    supabase
      .from('escalations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', params.eventId)
      .eq('status', 'resolved'),
    supabase
      .from('escalations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', params.eventId)
      .eq('status', 'reopened'),
  ]);

  // Filtered + paginated list — DB-level pagination.
  // Postgres' ORDER BY honours an array_position()/CASE expression for the
  // status+priority ranking we want, but PostgREST exposes column-name sorts
  // only. We approximate the original "open/reopened first, then priority"
  // order with newest-first as a stable secondary; the existing UI groups
  // counts in cards above the table so the within-page ordering is enough.
  let q = supabase
    .from('escalations')
    .select(
      'id, conversation_id, reason, summary_for_ops, priority, status, claimed_by, resolved_by, resolved_at, created_at, updated_at',
      { count: 'exact' },
    )
    .eq('event_id', params.eventId);

  if (statusFilter) q = q.eq('status', statusFilter);
  if (priorityFilter) q = q.eq('priority', priorityFilter);

  q = q.order('created_at', { ascending: false }).range(rangeFrom, rangeTo);

  const { data: pageData, count: totalCount } = await q;
  const pageRows = ((pageData ?? []) as EscalationRow[]).sort((a, b) => {
    const aStatus = STATUS_PRIORITY[a.status] ?? 99;
    const bStatus = STATUS_PRIORITY[b.status] ?? 99;
    if (aStatus !== bStatus) return aStatus - bStatus;
    const aPriority = PRIORITY_ORDER[a.priority] ?? 99;
    const bPriority = PRIORITY_ORDER[b.priority] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return b.created_at.localeCompare(a.created_at);
  });

  const total = totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Resolve claimed_by / resolved_by → user display via operator_users → auth.users
  // Since we can't read auth.users via RLS, just show the operator_users.id
  // truncated as a stand-in. Full identity resolution is out of scope.
  const userIds = Array.from(
    new Set(
      pageRows
        .flatMap((r) => [r.claimed_by, r.resolved_by])
        .filter((v): v is string => typeof v === 'string'),
    ),
  );
  const userLookup = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: ops } = await supabase
      .from('operator_users')
      .select('id, invited_email')
      .in('id', userIds);
    for (const o of (ops ?? []) as Array<{ id: string; invited_email: string | null }>) {
      userLookup.set(o.id, o.invited_email ?? o.id.slice(0, 8));
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Escalations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Conversations the agent escalated to a human. Claim to indicate
            you&rsquo;re working on it, resolve when done.
          </p>
        </div>
        <Suspense>
          <EscalationsFilters
            currentStatus={statusFilter}
            currentPriority={priorityFilter}
          />
        </Suspense>
      </div>

      {/* Status counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CounterCard label="Open" value={openCount ?? 0} variant="red" />
        <CounterCard label="Claimed" value={claimedCount ?? 0} variant="blue" />
        <CounterCard label="Resolved" value={resolvedCount ?? 0} variant="emerald" />
        <CounterCard label="Reopened" value={reopenedCount ?? 0} variant="amber" />
      </div>

      <Separator />

      {total === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {statusFilter || priorityFilter
            ? 'No escalations match the current filters.'
            : 'No escalations yet. The agent will route messages here when its guardrails trip.'}
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            {total} escalation{total !== 1 ? 's' : ''}
            {statusFilter || priorityFilter ? ' (filtered)' : ''}
          </div>

          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                      Priority
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                      Reason
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">
                      Summary
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                      Created
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                      Owner
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pageRows.map((e) => (
                    <tr key={e.id} className="align-top hover:bg-muted/20">
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] uppercase ${
                            PRIORITY_BADGE[e.priority] ?? 'bg-slate-100'
                          }`}
                        >
                          {e.priority}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize ${
                            STATUS_BADGE[e.status] ?? ''
                          }`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Link
                          href={`/admin/events/${params.eventId}/conversations/${e.conversation_id}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {e.reason}
                        </Link>
                        <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <ExternalLink className="h-3 w-3" />
                        </span>
                      </td>
                      <td className="px-3 py-3 max-w-md text-xs text-muted-foreground hidden lg:table-cell">
                        <span className="line-clamp-2">{e.summary_for_ops}</span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground hidden md:table-cell">
                        {formatDateTime(e.created_at)}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                        {e.status === 'resolved' && e.resolved_by
                          ? userLookup.get(e.resolved_by) ?? '—'
                          : e.claimed_by
                          ? userLookup.get(e.claimed_by) ?? '—'
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <EscalationRowActions
                          eventId={params.eventId}
                          escalationId={e.id}
                          status={e.status}
                          summary={e.summary_for_ops}
                        />
                      </td>
                    </tr>
                  ))}
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
                  status={statusFilter}
                  priority={priorityFilter}
                  label="Previous"
                  before={<ChevronLeft className="h-4 w-4" />}
                />
                <PageLink
                  eventId={params.eventId}
                  page={page + 1}
                  disabled={page >= totalPages}
                  status={statusFilter}
                  priority={priorityFilter}
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

function CounterCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: 'red' | 'blue' | 'emerald' | 'amber';
}) {
  const colorMap: Record<typeof variant, string> = {
    red: 'text-red-700',
    blue: 'text-blue-700',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
  };
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${colorMap[variant]}`}>
        {value}
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function PageLink({
  eventId,
  page,
  disabled,
  status,
  priority,
  label,
  before,
  after,
}: {
  eventId: string;
  page: number;
  disabled: boolean;
  status: string;
  priority: string;
  label: string;
  before?: React.ReactNode;
  after?: React.ReactNode;
}) {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  const href = `/admin/events/${eventId}/escalations?${params.toString()}`;
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
