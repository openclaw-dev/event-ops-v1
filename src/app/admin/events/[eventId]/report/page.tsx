import { notFound } from 'next/navigation';
import { ExternalLink, FileText, Printer, TrendingDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { generateReportData } from '@/lib/report/generate-report-data';
import { getKBGaps } from '@/lib/kb/gap-analysis';
import { AddToKbModal } from '@/components/add-to-kb-modal';
import { createServerClient } from '@/lib/supabase/server';

interface ReportPageProps {
  params: { eventId: string };
}

function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  const withCommas = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${withCommas}`;
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

export default async function ReportPage({ params }: ReportPageProps) {
  const supabase = createServerClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();
  if (!event) notFound();

  const data = await generateReportData(supabase, params.eventId);
  if (!data) notFound();

  const gaps = await getKBGaps(params.eventId);

  const reportUrl = `/api/events/${params.eventId}/report`;
  const auditUrl = `/api/events/${params.eventId}/audit`;
  const isEmpty = data.is_empty;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Post-event report</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A printable 4-page summary of customer support performance, refund
            deflection, and recommendations. Use the browser print dialog to
            save as PDF.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="gap-2">
            <a href={auditUrl} download>
              <TrendingDown className="h-4 w-4" />
              Download Revenue Leak Audit
            </a>
          </Button>
          <Button asChild variant="default" className="gap-2">
            <a href={reportUrl} target="_blank" rel="noopener noreferrer">
              <FileText className="h-4 w-4" />
              Generate report
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </a>
          </Button>
        </div>
      </div>

      <Separator />

      {isEmpty && (
        <section className="rounded-lg border border-dashed bg-muted/30 px-6 py-10 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
          <h3 className="text-base font-medium">No conversations recorded yet</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            The report will populate after the agent handles its first
            conversation. Run a few sessions in the{' '}
            <a
              href={`/admin/events/${params.eventId}/simulator`}
              className="underline hover:text-foreground"
            >
              Simulator
            </a>{' '}
            to get started. You can still generate the report below — it will
            render with a zero state and the seeded order data.
          </p>
        </section>
      )}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Key numbers
        </h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryStat
            label="Conversations"
            value={data.conversations.total.toLocaleString()}
            sublabel={`${data.conversations.escalated} escalated`}
          />
          <SummaryStat
            label="Deflection rate"
            value={formatPct(data.conversations.deflection_rate)}
            sublabel={`${data.conversations.deflected} of ${data.conversations.total || 0}`}
            accent
          />
          <SummaryStat
            label="Revenue protected"
            value={formatMoney(
              data.refund.estimated_revenue_protected,
              data.event.default_currency,
            )}
            sublabel={`${data.refund.deflected_count} deflected / ${data.refund.total_cases} cases`}
            accent
          />
          <SummaryStat
            label="Team hours saved"
            value={`${data.performance.estimated_team_hours_saved.toFixed(0)} hrs`}
            sublabel="Est. 5 min per resolved"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Orders
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Tickets sold</div>
              <div className="text-lg font-medium tabular-nums">
                {data.orders.total_tickets_sold.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Revenue</div>
              <div className="text-lg font-medium tabular-nums">
                {formatMoney(data.orders.total_revenue, data.orders.currency)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Failed payments</div>
              <div className="text-base font-medium tabular-nums text-amber-700">
                {data.orders.payment_failed_orders}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Pending</div>
              <div className="text-base font-medium tabular-nums">
                {data.orders.payment_pending_orders}
              </div>
            </div>
          </div>
          {data.orders.by_tier.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">By tier</div>
              {data.orders.by_tier.slice(0, 5).map((t) => (
                <div
                  key={t.ticket_type}
                  className="flex items-center justify-between border-t py-1.5 text-xs"
                >
                  <span className="truncate pr-2">{t.ticket_type}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {t.tickets} × {formatMoney(t.revenue, data.orders.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Escalations
          </h3>
          {data.escalations.total === 0 ? (
            <p className="text-sm text-muted-foreground">No escalations yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Total</div>
                  <div className="text-lg font-medium tabular-nums">
                    {data.escalations.total}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Resolved</div>
                  <div className="text-lg font-medium tabular-nums text-emerald-700">
                    {data.escalations.by_status.resolved}{' '}
                    <span className="text-xs text-muted-foreground">
                      ({formatPct(data.escalations.resolution_rate)})
                    </span>
                  </div>
                </div>
              </div>
              {data.escalations.by_reason.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">By reason</div>
                  {data.escalations.by_reason.slice(0, 5).map((r) => (
                    <div
                      key={r.reason}
                      className="flex items-center justify-between border-t py-1.5 text-xs"
                    >
                      <span className="truncate pr-2 font-mono">{r.reason}</span>
                      <span className="tabular-nums text-muted-foreground">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Top KB sections
          </h3>
          {data.kb.top_sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No KB citations yet ({data.kb.total_citations} total).
            </p>
          ) : (
            <ol className="space-y-2">
              {data.kb.top_sections.map((s, i) => (
                <li
                  key={s.section_id}
                  className="flex items-start gap-3 border-t pt-2 text-sm first:border-t-0 first:pt-0"
                >
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {(i + 1).toString().padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-mono text-xs">{s.section_id}</div>
                    {s.question_en && (
                      <div className="truncate text-xs text-muted-foreground">
                        {s.question_en}
                      </div>
                    )}
                  </div>
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {s.citation_count}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Conversations by day
          </h3>
          {data.conversations.by_day.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.conversations.by_day.map((d) => (
                <div key={d.date} className="flex items-center gap-3 text-xs">
                  <span className="w-20 font-mono text-muted-foreground">{d.date}</span>
                  <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-foreground"
                      style={{
                        width: `${
                          (d.count /
                            Math.max(...data.conversations.by_day.map((x) => x.count))) *
                          100
                        }%`,
                      }}
                    />
                  </div>
                  <span className="tabular-nums text-muted-foreground">{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── KB Gap Analysis ───────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Knowledge Base Coverage
        </h3>

        {/* Coverage score — big number */}
        <div className="flex items-end gap-3">
          <span
            className={`text-4xl font-bold tabular-nums ${
              gaps.coverage_score >= 80
                ? 'text-emerald-600'
                : gaps.coverage_score >= 50
                ? 'text-amber-600'
                : 'text-red-600'
            }`}
          >
            {gaps.coverage_score}%
          </span>
          <span className="mb-1 text-sm text-muted-foreground">
            Questions resolved without escalation
          </span>
        </div>

        {/* Coverage bar */}
        <div className="space-y-1">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${
                gaps.coverage_score >= 80
                  ? 'bg-emerald-500'
                  : gaps.coverage_score >= 50
                  ? 'bg-amber-500'
                  : 'bg-red-500'
              }`}
              style={{ width: `${gaps.coverage_score}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {gaps.total_conversations - gaps.escalated_count} of{' '}
            {gaps.total_conversations} conversations handled without escalation
          </p>
        </div>

        {gaps.unanswered.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No escalations recorded — KB coverage looks complete.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Unanswered topic
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                    Example question
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground w-16">
                    Count
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground w-28">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {gaps.unanswered.slice(0, 5).map((gap) => (
                  <tr key={gap.intent} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-mono text-xs">{gap.intent}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                      <span className="line-clamp-1">
                        {gap.example_message || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-xs text-muted-foreground">
                      {gap.count}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <AddToKbModal
                        eventId={params.eventId}
                        defaultTitle={gap.intent}
                        triggerLabel="Add to KB"
                        triggerClassName="h-7 gap-1 px-2 text-[11px]"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="rounded-md border border-dashed bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <Printer className="h-3.5 w-3.5" />
          The generated report is laid out for A4 print. Open the report in a
          new tab, then use your browser&rsquo;s print dialog (⌘P / Ctrl+P) and
          choose &ldquo;Save as PDF&rdquo;.
        </p>
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          accent ? 'text-emerald-700' : 'text-foreground'
        }`}
      >
        {value}
      </div>
      {sublabel && (
        <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>
      )}
    </div>
  );
}
