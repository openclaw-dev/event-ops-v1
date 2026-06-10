import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { Separator } from '@/components/ui/separator';
import { CrmQuickActions } from './_components/crm-quick-actions';

// ─── Display helpers ──────────────────────────────────────────────────────────

const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  no_show_remarket: 'No-show re-market',
  past_buyer_remarket: 'Past buyer re-market',
  abandoned_cart: 'Abandoned cart',
  vip_upsell: 'VIP upsell',
  custom: 'Custom',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  sending: 'bg-amber-50 text-amber-700 border-amber-200',
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  send_failed: 'bg-red-50 text-red-700 border-red-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  paused: 'bg-sky-50 text-sky-700 border-sky-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CrmPage() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Resolve operator.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operator_id = resolveActiveOperatorId(
    (memberships ?? []).map((m) => m.operator_id as string),
  );

  // Fetch events for the quick-action dropdowns (all events, sorted by date desc).
  const { data: eventsData } = operator_id
    ? await supabase
        .from('events')
        .select('id, name, start_date')
        .eq('operator_id', operator_id)
        .is('deleted_at', null)
        .order('start_date', { ascending: false })
    : { data: [] };

  const events = ((eventsData ?? []) as Array<{
    id: string;
    name: string;
    start_date: string;
  }>).map((e) => ({ id: e.id, name: e.name, start_date: e.start_date }));

  // Fetch campaign history for this operator.
  const { data: campaignsData } = operator_id
    ? await supabase
        .from('crm_campaigns')
        .select(
          'id, name, campaign_type, status, total_recipients, sent_count, converted_count, revenue_attributed_sar, created_at',
        )
        .eq('operator_id', operator_id)
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [] };

  const campaigns = (campaignsData ?? []) as Array<{
    id: string;
    name: string;
    campaign_type: string;
    status: string;
    total_recipients: number;
    sent_count: number;
    converted_count: number;
    revenue_attributed_sar: number | string;
    created_at: string;
  }>;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-8 py-8">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">CRM &amp; Re-marketing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Re-engage past customers and recover no-show revenue via targeted WhatsApp campaigns.
        </p>
      </div>

      <Separator />

      {/* Section 1 — Quick actions */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h3>
        <CrmQuickActions events={events} />
      </section>

      <Separator />

      {/* Section 2 — Campaign history */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Campaign history
        </h3>

        {campaigns.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            No campaigns yet. Use a quick action above to send your first campaign.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                    Type
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                    Recipients
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground hidden md:table-cell">
                    Sent
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium text-muted-foreground hidden md:table-cell">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-medium text-sm">
                      <span className="line-clamp-1">{c.name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                      {CAMPAIGN_TYPE_LABELS[c.campaign_type] ?? c.campaign_type}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      {c.total_recipients.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground hidden md:table-cell">
                      {c.sent_count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
                          STATUS_STYLES[c.status] ?? STATUS_STYLES['draft']
                        }`}
                      >
                        {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground hidden md:table-cell">
                      {formatDate(c.created_at)}
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
