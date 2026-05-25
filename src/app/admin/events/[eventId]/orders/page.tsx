import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { OrdersUploadForm } from './_components/orders-upload-form';
import { OrdersFilters } from './_components/orders-filters';

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<string, string> = {
  completed:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  payment_failed:  'bg-red-50 text-red-700 border-red-200',
  payment_pending: 'bg-amber-50 text-amber-700 border-amber-200',
  refunded:        'bg-blue-50 text-blue-700 border-blue-200',
};

interface OrdersPageProps {
  params: { eventId: string };
  searchParams: { page?: string; status?: string; vip?: string };
}

export default async function OrdersPage({ params, searchParams }: OrdersPageProps) {
  const supabase = createServerClient();

  // Verify event access (RLS).
  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();
  if (!event) notFound();

  const page         = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const statusFilter = searchParams.status ?? '';
  const vipFilter    = searchParams.vip ?? '';
  const rangeFrom    = (page - 1) * PAGE_SIZE;
  const rangeTo      = rangeFrom + PAGE_SIZE - 1;

  // Fetch recent imports and orders in parallel.
  const [importsResult, ordersResult] = await Promise.all([
    supabase
      .from('order_imports')
      .select('id, filename, row_count, error_count, status, created_at')
      .eq('event_id', params.eventId)
      .order('created_at', { ascending: false })
      .limit(10),

    (() => {
      let q = supabase
        .from('orders')
        .select(
          'id, order_id, customer_phone_e164, customer_name, ticket_type, quantity, amount_paid, currency, status, vip_flag, purchase_date',
          { count: 'exact' },
        )
        .eq('event_id', params.eventId)
        .order('created_at', { ascending: false })
        .range(rangeFrom, rangeTo);

      if (statusFilter) q = q.eq('status', statusFilter);
      if (vipFilter === 'true')  q = q.eq('vip_flag', true);
      if (vipFilter === 'false') q = q.eq('vip_flag', false);

      return q;
    })(),
  ]);

  const imports      = importsResult.data ?? [];
  const orders       = ordersResult.data  ?? [];
  const totalOrders  = ordersResult.count ?? 0;
  const totalPages   = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-8 py-8">

      {/* ── Upload ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Import orders CSV</h2>
        <OrdersUploadForm eventId={params.eventId} />
      </section>

      <Separator />

      {/* ── Recent imports ─────────────────────────────────────────── */}
      {imports.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent imports
          </h2>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">File</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Rows</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Errors</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden md:table-cell">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {imports.map((imp) => (
                  <tr key={imp.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{imp.filename}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{imp.row_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {imp.error_count > 0 ? (
                        <span className="text-amber-600">{imp.error_count}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <ImportStatusBadge status={imp.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground hidden md:table-cell">
                      {new Date(imp.created_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}{' '}
                      {new Date(imp.created_at).toLocaleTimeString('en-GB', {
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Separator />

      {/* ── Orders list ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Orders — {totalOrders} total
          </h2>
          <Suspense>
            <OrdersFilters currentStatus={statusFilter} currentVip={vipFilter} />
          </Suspense>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            {imports.length === 0
              ? 'No orders yet. Import a CSV above to get started.'
              : 'No orders match the current filters.'}
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                        Order ID
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                        Phone
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                        Name
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell">
                        Tier
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium text-muted-foreground hidden lg:table-cell">
                        Amount
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-xs">{order.order_id}</span>
                          {order.vip_flag && (
                            <Star
                              className="ml-1.5 inline h-3 w-3 fill-amber-400 text-amber-400"
                              aria-label="VIP"
                            />
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground hidden sm:table-cell">
                          {order.customer_phone_e164}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                          {order.customer_name ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground hidden lg:table-cell">
                          {order.ticket_type ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                          {order.amount_paid != null
                            ? `${Number(order.amount_paid).toLocaleString('en-US', { minimumFractionDigits: 2 })} ${order.currency}`
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_COLORS[order.status] ?? ''}`}
                          >
                            {order.status?.replace(/_/g, ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
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
                    vip={vipFilter}
                    label="Previous"
                    before={<ChevronLeft className="h-4 w-4" />}
                  />
                  <PageLink
                    eventId={params.eventId}
                    page={page + 1}
                    disabled={page >= totalPages}
                    status={statusFilter}
                    vip={vipFilter}
                    label="Next"
                    after={<ChevronRight className="h-4 w-4" />}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ImportStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    completed:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    failed:     'bg-red-50 text-red-700 border-red-200',
    processing: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs capitalize ${cfg[status] ?? ''}`}
    >
      {status}
    </span>
  );
}

function PageLink({
  eventId,
  page,
  disabled,
  status,
  vip,
  label,
  before,
  after,
}: {
  eventId: string;
  page: number;
  disabled: boolean;
  status: string;
  vip: string;
  label: string;
  before?: React.ReactNode;
  after?: React.ReactNode;
}) {
  const params = new URLSearchParams();
  if (page > 1)  params.set('page', String(page));
  if (status)    params.set('status', status);
  if (vip)       params.set('vip', vip);
  const href = `/admin/events/${eventId}/orders?${params.toString()}`;

  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1 text-xs">
        {before}{label}{after}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" asChild className="gap-1 text-xs">
      <Link href={href}>
        {before}{label}{after}
      </Link>
    </Button>
  );
}
