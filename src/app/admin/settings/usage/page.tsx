import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { Separator } from '@/components/ui/separator';
import { MonthSelect } from './_components/month-select';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsageEventRow {
  id: string;
  event_id: string | null;
  event_type: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: string; // NUMERIC comes back as string from Supabase
}

interface EventRow {
  id: string;
  name: string;
}

interface TypeBreakdown {
  event_type: string;
  call_count: number;
  total_input: number;
  total_output: number;
  total_cost: number;
}

interface EventBreakdown {
  event_id: string | null;
  event_name: string;
  call_count: number;
  total_cost: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  support_message:  'Support (Sonnet)',
  change_extraction:'Change extraction (Haiku)',
  field_mapping:    'Field mapping (Haiku)',
  kb_conversion:    'KB conversion (Haiku)',
  report_generation:'Report generation',
};

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Build an array of the last 12 YYYY-MM strings, newest first. */
function last12Months(): string[] {
  const result: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    );
  }
  return result;
}

function formatUsd(value: number): string {
  if (value < 0.01 && value > 0) return '< $0.01';
  return `$${value.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface UsagePageProps {
  searchParams: { month?: string };
}

export default async function UsagePage({ searchParams }: UsagePageProps) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operatorIds = (memberships ?? []).map((m) => m.operator_id as string);
  const operatorId = resolveActiveOperatorId(operatorIds);
  if (!operatorId) redirect('/admin/onboarding');

  // ── Month selection ───────────────────────────────────────────────────────
  const months = last12Months();
  const selectedMonth = searchParams.month && months.includes(searchParams.month)
    ? searchParams.month
    : currentYearMonth();

  const [year, mon] = selectedMonth.split('-').map(Number);
  const rangeStart = new Date(year, mon - 1, 1).toISOString();
  const rangeEnd   = new Date(year, mon, 1).toISOString();       // exclusive

  // ── Fetch usage_events for selected month ─────────────────────────────────
  const admin = createAdminClient();
  const { data: rawEvents } = await admin
    .from('usage_events')
    .select('id, event_id, event_type, model, input_tokens, output_tokens, cache_read_tokens, cost_usd')
    .eq('operator_id', operatorId)
    .gte('created_at', rangeStart)
    .lt('created_at', rangeEnd)
    .limit(10000);

  const events = (rawEvents ?? []) as UsageEventRow[];

  // ── Fetch event names for breakdown ──────────────────────────────────────
  const eventIds = Array.from(
    new Set(events.map((e) => e.event_id).filter((id): id is string => id !== null)),
  );
  let eventNames: Map<string, string> = new Map();
  if (eventIds.length > 0) {
    const { data: eventRows } = await admin
      .from('events')
      .select('id, name')
      .in('id', eventIds);
    eventNames = new Map(
      ((eventRows ?? []) as EventRow[]).map((r) => [r.id, r.name]),
    );
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const totalCost = events.reduce((sum, e) => sum + parseFloat(e.cost_usd), 0);
  const totalCalls = events.length;
  const totalInputTokens = events.reduce((sum, e) => sum + e.input_tokens, 0);
  const totalOutputTokens = events.reduce((sum, e) => sum + e.output_tokens, 0);

  // By event_type
  const byTypeMap = new Map<string, TypeBreakdown>();
  for (const e of events) {
    const existing = byTypeMap.get(e.event_type) ?? {
      event_type: e.event_type,
      call_count: 0,
      total_input: 0,
      total_output: 0,
      total_cost: 0,
    };
    existing.call_count += 1;
    existing.total_input += e.input_tokens;
    existing.total_output += e.output_tokens;
    existing.total_cost += parseFloat(e.cost_usd);
    byTypeMap.set(e.event_type, existing);
  }
  const byType = Array.from(byTypeMap.values()).sort((a, b) => b.total_cost - a.total_cost);

  // By event
  const byEventMap = new Map<string | null, EventBreakdown>();
  for (const e of events) {
    const key = e.event_id;
    const existing = byEventMap.get(key) ?? {
      event_id: key,
      event_name: key ? (eventNames.get(key) ?? 'Unknown event') : '(No event)',
      call_count: 0,
      total_cost: 0,
    };
    existing.call_count += 1;
    existing.total_cost += parseFloat(e.cost_usd);
    byEventMap.set(key, existing);
  }
  const byEvent = Array.from(byEventMap.values()).sort((a, b) => b.total_cost - a.total_cost);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-8 py-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Usage &amp; Billing</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Anthropic API costs for your account. Pricing is based on API consumption.
          </p>
        </div>
        <MonthSelect months={months} current={selectedMonth} />
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard label="Total cost" value={formatUsd(totalCost)} highlight />
        <SummaryCard label="API calls" value={totalCalls.toLocaleString()} />
        <SummaryCard label="Input tokens" value={formatTokens(totalInputTokens)} />
        <SummaryCard label="Output tokens" value={formatTokens(totalOutputTokens)} />
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No usage recorded for this month.
        </div>
      ) : (
        <>
          <Separator />

          {/* ── By event type ──────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Breakdown by type
            </h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                    <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                    <th className="px-4 py-2.5 text-right font-medium">Input</th>
                    <th className="px-4 py-2.5 text-right font-medium">Output</th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {byType.map((row) => (
                    <tr key={row.event_type} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium">
                        {EVENT_TYPE_LABELS[row.event_type] ?? row.event_type}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {row.call_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatTokens(row.total_input)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {formatTokens(row.total_output)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {formatUsd(row.total_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/20 text-xs font-semibold">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {totalCalls.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatTokens(totalInputTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatTokens(totalOutputTokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatUsd(totalCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <Separator />

          {/* ── By event ───────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Breakdown by event
            </h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium">Event</th>
                    <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {byEvent.map((row) => (
                    <tr
                      key={row.event_id ?? '__none__'}
                      className="border-b last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-2.5 font-medium">{row.event_name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {row.call_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {formatUsd(row.total_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Pricing note ───────────────────────────────────────────── */}
          <p className="text-xs text-muted-foreground">
            Costs reflect Anthropic API rates: Haiku ($0.80/$4.00 per 1M input/output tokens),
            Sonnet ($3.00/$15.00 per 1M input/output tokens). Cache read tokens billed at 10% of
            input rate. Figures are estimates — see your Anthropic dashboard for exact invoices.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? 'border-primary/20 bg-primary/5' : 'bg-card'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          highlight ? 'text-primary' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}
