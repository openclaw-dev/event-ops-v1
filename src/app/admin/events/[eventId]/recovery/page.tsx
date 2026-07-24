import { notFound } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { Separator } from '@/components/ui/separator';
import { getRecoveryStats } from '@/lib/recovery/payment-recovery';
import { RecoveryUploader } from './_components/recovery-uploader';

interface RecoveryPageProps {
  params: { eventId: string };
}

// ─── Status badge config ──────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  sent: 'bg-blue-50 text-blue-700 border-blue-200',
  opened: 'bg-sky-50 text-sky-700 border-sky-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  expired: 'bg-zinc-100 text-zinc-600 border-zinc-200',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RecoveryPage({ params }: RecoveryPageProps) {
  const supabase = createServerClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();

  if (!event) notFound();

  const [stats, { data: rawAttempts }] = await Promise.all([
    getRecoveryStats(params.eventId),
    supabase
      .from('payment_recovery_attempts')
      .select(
        'id, customer_phone_e164, customer_name, ticket_type, quantity, amount_sar, status, sent_at, created_at',
      )
      .eq('event_id', params.eventId)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const attempts = (rawAttempts ?? []) as Array<{
    id: string;
    customer_phone_e164: string;
    customer_name: string | null;
    ticket_type: string | null;
    quantity: number;
    amount_sar: number | string;
    status: string;
    sent_at: string | null;
    created_at: string;
  }>;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-8 py-8">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Payment Recovery</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Recover revenue from failed and abandoned payments via automated WhatsApp messages.
        </p>
      </div>

      <Separator />

      {/* Metrics bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Total attempts" value={stats.total_attempts} />
        <MetricCard label="Messages sent" value={stats.sent} accent="blue" />
        <MetricCard label="Confirmed" value={stats.completed} accent="emerald" />
        <MetricCard
          label="Awaiting confirmation"
          value={stats.claimed_awaiting_confirmation}
        />
        <MetricCard
          label="Recovered"
          value={`SAR ${Math.round(stats.recovered_amount_sar).toLocaleString()}`}
          accent="emerald"
        />
        <MetricCard
          label="Recovery fee (22%)"
          value={`SAR ${Math.round(stats.recovery_fee_sar).toLocaleString()}`}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        &ldquo;Recovered&rdquo; and the 22% fee count only payments confirmed by a
        signed payment webhook. &ldquo;Awaiting confirmation&rdquo; are customers who
        replied that they paid but have not been confirmed by the provider yet.
      </p>

      <Separator />

      {/* CSV upload section */}
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Send Recovery Messages</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a CSV of failed or abandoned orders. Each customer receives a WhatsApp
            message with their payment link.
          </p>
        </div>
        <RecoveryUploader eventId={params.eventId} />
      </section>

      <Separator />

      {/* Results table */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Recovery Attempts</h3>

        {attempts.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            No recovery attempts yet. Upload a CSV above to get started.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Phone
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                    Name
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                    Ticket
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Amount
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground hidden lg:table-cell">
                    Sent
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {attempts.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {a.customer_phone_e164}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                      {a.customer_name ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                      {a.ticket_type
                        ? `${a.ticket_type} × ${a.quantity}`
                        : `${a.quantity} ticket${a.quantity !== 1 ? 's' : ''}`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      SAR {Number(a.amount_sar).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                          STATUS_STYLES[a.status] ?? STATUS_STYLES['pending']
                        }`}
                      >
                        {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground hidden lg:table-cell">
                      {a.sent_at ? formatDateTime(a.sent_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: 'emerald' | 'blue';
}) {
  const valueClass =
    accent === 'emerald'
      ? 'text-emerald-700'
      : accent === 'blue'
      ? 'text-blue-700'
      : 'text-foreground';

  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${valueClass}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
