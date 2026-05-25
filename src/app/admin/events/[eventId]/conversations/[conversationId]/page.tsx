import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Star, ChevronDown } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const STATE_LABELS: Record<string, string> = {
  greeting: 'Greeting',
  faq_answer: 'FAQ',
  order_lookup: 'Order lookup',
  refund_deflection: 'Refund deflection',
  escalation_triggered: 'Escalated',
  session_closed: 'Closed',
};

const STATE_COLORS: Record<string, string> = {
  greeting:              'bg-slate-50 text-slate-700 border-slate-200',
  faq_answer:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  order_lookup:          'bg-amber-50 text-amber-700 border-amber-200',
  refund_deflection:     'bg-blue-50 text-blue-700 border-blue-200',
  escalation_triggered:  'bg-red-50 text-red-700 border-red-200',
  session_closed:        'bg-zinc-100 text-zinc-700 border-zinc-200',
};

interface ConversationDetailPageProps {
  params: { eventId: string; conversationId: string };
}

interface MessageRow {
  id: string;
  role: 'user' | 'agent' | 'human_operator';
  text: string;
  classified_intent: string | null;
  cited_section_ids: string[] | null;
  created_at: string;
}

export default async function ConversationDetailPage({
  params,
}: ConversationDetailPageProps) {
  const supabase = createServerClient();

  // Verify event access first.
  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();
  if (!event) notFound();

  // Fetch the conversation row.
  const { data: convo } = await supabase
    .from('conversations')
    .select(
      'id, customer_phone_e164, language, state, channel, matched_order_id, refund_case_id, closed_at, created_at, updated_at, consecutive_no_progress_turns',
    )
    .eq('id', params.conversationId)
    .eq('event_id', params.eventId)
    .single();
  if (!convo) notFound();

  // Fetch everything else in parallel.
  const [messagesRes, orderRes, escalationsRes, sectionsRes] = await Promise.all([
    supabase
      .from('messages')
      .select('id, role, text, classified_intent, cited_section_ids, created_at')
      .eq('conversation_id', params.conversationId)
      .order('created_at', { ascending: true }),
    convo.matched_order_id
      ? supabase
          .from('orders')
          .select(
            'id, order_id, customer_name, customer_email, ticket_type, quantity, amount_paid, currency, status, vip_flag, transfer_eligible',
          )
          .eq('id', convo.matched_order_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from('escalations')
      .select('id, reason, summary_for_ops, priority, status, created_at, resolved_at')
      .eq('conversation_id', params.conversationId)
      .order('created_at', { ascending: false }),
    supabase
      .from('kb_sections')
      .select('section_id, question_en, answer_en')
      .eq('event_id', params.eventId),
  ]);

  const messages = (messagesRes.data ?? []) as MessageRow[];
  const order = orderRes.data as
    | {
        id: string;
        order_id: string;
        customer_name: string | null;
        customer_email: string | null;
        ticket_type: string | null;
        quantity: number;
        amount_paid: number | string | null;
        currency: string;
        status: string;
        vip_flag: boolean;
        transfer_eligible: boolean;
      }
    | null;
  const escalations = (escalationsRes.data ?? []) as Array<{
    id: string;
    reason: string;
    summary_for_ops: string;
    priority: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
  }>;
  const sections = (sectionsRes.data ?? []) as Array<{
    section_id: string;
    question_en: string | null;
    answer_en: string;
  }>;
  const sectionLookup = new Map(sections.map((s) => [s.section_id, s]));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-8 py-8">
      {/* Back link */}
      <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1 text-xs">
        <Link href={`/admin/events/${params.eventId}/conversations`}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to conversations
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold font-mono">
              {convo.customer_phone_e164}
            </h2>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                STATE_COLORS[convo.state] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'
              }`}
            >
              {convo.state === 'escalation_triggered' && (
                <AlertTriangle className="h-3 w-3" />
              )}
              {STATE_LABELS[convo.state] ?? convo.state}
            </span>
            <span className="text-xs uppercase text-muted-foreground">
              {convo.language}
            </span>
            <span className="text-xs text-muted-foreground">
              · {convo.channel}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Started {formatDateTime(convo.created_at)}
            {convo.closed_at && (
              <> · Closed {formatDateTime(convo.closed_at)}</>
            )}
            {convo.consecutive_no_progress_turns > 0 && (
              <> · {convo.consecutive_no_progress_turns} no-progress turns</>
            )}
          </p>
        </div>
      </div>

      <Separator />

      {/* Linked order + escalations side-by-side on wide screens */}
      {(order || escalations.length > 0) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {order && (
            <section className="space-y-2 rounded-lg border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Matched order
              </h3>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-medium">{order.order_id}</span>
                {order.vip_flag && (
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                )}
                <span className="text-xs uppercase text-muted-foreground">
                  {order.status.replace('_', ' ')}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Customer</dt>
                <dd>{order.customer_name ?? '—'}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate">{order.customer_email ?? '—'}</dd>
                <dt className="text-muted-foreground">Tier</dt>
                <dd>{order.ticket_type ?? '—'}</dd>
                <dt className="text-muted-foreground">Quantity</dt>
                <dd>{order.quantity}</dd>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="tabular-nums">
                  {order.amount_paid != null
                    ? `${Number(order.amount_paid).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                      })} ${order.currency}`
                    : '—'}
                </dd>
                <dt className="text-muted-foreground">Transferable</dt>
                <dd>{order.transfer_eligible ? 'Yes' : 'No'}</dd>
              </dl>
            </section>
          )}

          {escalations.length > 0 && (
            <section className="space-y-2 rounded-lg border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Escalations
              </h3>
              {escalations.map((e) => (
                <div
                  key={e.id}
                  className="space-y-1.5 rounded-md border bg-background px-3 py-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px]">{e.reason}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] uppercase ${
                        e.status === 'open'
                          ? 'bg-red-100 text-red-800'
                          : e.status === 'claimed'
                          ? 'bg-amber-100 text-amber-800'
                          : e.status === 'resolved'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {e.status}
                    </span>
                  </div>
                  <p className="text-muted-foreground leading-snug">
                    {e.summary_for_ops}
                  </p>
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>Priority: {e.priority}</span>
                    <span>{formatDateTime(e.created_at)}</span>
                  </div>
                </div>
              ))}
              <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                <Link href={`/admin/events/${params.eventId}/escalations`}>
                  Manage in queue →
                </Link>
              </Button>
            </section>
          )}
        </div>
      )}

      {/* Transcript */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Transcript ({messages.length} messages)
        </h3>
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            No messages recorded for this conversation.
          </div>
        ) : (
          <ol className="space-y-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] space-y-1.5 rounded-lg px-3 py-2.5 ${
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : m.role === 'human_operator'
                      ? 'bg-amber-50 text-amber-900 border border-amber-200'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</p>

                  {(m.classified_intent ||
                    (m.cited_section_ids && m.cited_section_ids.length > 0)) && (
                    <div className="flex flex-wrap items-center gap-1 text-[10px]">
                      {m.role === 'human_operator' && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium uppercase">
                          Human operator
                        </span>
                      )}
                      {m.classified_intent && (
                        <span className="rounded bg-background/60 px-1.5 py-0.5 font-mono">
                          {m.classified_intent}
                        </span>
                      )}
                      {m.cited_section_ids && m.cited_section_ids.length > 0 && (
                        <CitationDisclosure
                          ids={m.cited_section_ids}
                          sectionLookup={sectionLookup}
                        />
                      )}
                    </div>
                  )}

                  <div className="text-[10px] opacity-60">
                    {formatTime(m.created_at)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CitationDisclosure({
  ids,
  sectionLookup,
}: {
  ids: string[];
  sectionLookup: Map<string, { section_id: string; question_en: string | null; answer_en: string }>;
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none rounded bg-background/60 px-1.5 py-0.5 font-medium text-foreground hover:bg-background/80">
        <span className="inline-flex items-center gap-0.5">
          <ChevronDown className="h-2.5 w-2.5 transition-transform group-open:rotate-180" />
          {ids.length} citation{ids.length !== 1 ? 's' : ''}
        </span>
      </summary>
      <ul className="mt-1 space-y-1 border-l-2 border-foreground/20 pl-2">
        {ids.map((id) => {
          const section = sectionLookup.get(id);
          return (
            <li key={id} className="text-[10px]">
              <span className="font-mono font-medium">{id}</span>
              {section && (
                <span className="block opacity-70">
                  {section.question_en ?? section.answer_en.slice(0, 100)}
                </span>
              )}
              {!section && (
                <span className="block italic opacity-70">(not found in KB)</span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
