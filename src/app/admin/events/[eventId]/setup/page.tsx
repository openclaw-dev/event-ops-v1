import { notFound, redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { updateEvent } from './actions';
import { EventSetupForm } from '../../_components/event-setup-form';
import { PublishButton } from './_components/publish-button';
import { EndEventButton } from './_components/end-event-button';
import { ReadinessChecklist } from './_components/readiness-checklist';
import { DeleteEventButton } from './_components/delete-event-button';
import { getEventReadiness } from '@/lib/agent/event-readiness';
import { type EventSetupFormData } from '@/lib/schemas';
import { type EventConfig } from '@/lib/types';

interface SetupPageProps {
  params: { eventId: string };
}

/**
 * /admin/events/[eventId]/setup
 *
 * Loads the event row from Supabase (RLS-scoped) and renders the setup form
 * pre-populated with the existing data.
 */
export default async function SetupPage({ params }: SetupPageProps) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: event } = await supabase
    .from('events')
    .select(
      'id, name, slug, event_type, start_date, end_date, timezone, venue_name, venue_city, capacity, age_minimum, config, status, is_demo',
    )
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();

  if (!event) notFound();

  // Cast config to EventConfig (stored as JSONB).
  const config = (event.config ?? {}) as Partial<EventConfig>;

  // Compose defaultValues that match EventSetupFormData.
  const defaultValues: Partial<EventSetupFormData> = {
    name: event.name,
    slug: event.slug,
    event_type: event.event_type as EventSetupFormData['event_type'],
    start_date: event.start_date,
    end_date: event.end_date,
    timezone: event.timezone,
    venue_name: event.venue_name,
    venue_city: event.venue_city,
    capacity: event.capacity ?? null,
    age_minimum: event.age_minimum,

    refund_policy: {
      shape: config.refund_policy?.shape ?? 'tiered',
      tiers:
        config.refund_policy?.tiers && config.refund_policy.tiers.length > 0
          ? config.refund_policy.tiers
          : [
              { days_before_event: 30, refund_pct: 100 },
              { days_before_event: 14, refund_pct: 50 },
              { days_before_event: 0, refund_pct: 0 },
            ],
      allowed_alternatives_after_window: (
        config.refund_policy?.allowed_alternatives_after_window ?? []
      ) as EventSetupFormData['refund_policy']['allowed_alternatives_after_window'],
      credit_validity_months: config.refund_policy?.credit_validity_months ?? 12,
      medical_exception_section_id:
        config.refund_policy?.medical_exception_section_id ?? 'policy.refund.medical',
    },

    doors_open_local: config.doors_open_local ?? '20:00',
    doors_close_local: config.doors_close_local ?? '02:00',
    last_entry_local: config.last_entry_local ?? '01:00',
    dress_code: config.dress_code ?? '',
    parking_info: config.parking_info ?? '',

    vip_orders_always_escalate: config.vip_orders_always_escalate ?? true,
    escalation_keywords: config.escalation_keywords ?? [],
    escalation_contacts:
      config.escalation_contacts && config.escalation_contacts.length > 0
        ? config.escalation_contacts.map((c) => ({
            name: c.name,
            hours: c.hours,
            method: (c.method === 'whatsapp' ? 'whatsapp' : 'in-app handoff') as
              'in-app handoff' | 'whatsapp',
            phone: c.phone ?? '',
          }))
        : [{ name: '', hours: '', method: 'in-app handoff' as const, phone: '' }],

    ticket_tiers:
      config.ticket_tiers && config.ticket_tiers.length > 0
        ? config.ticket_tiers
        : [{ name: '', price: undefined, description: '' }],
  };

  // Bind the eventId into the action.
  async function handleUpdate(data: EventSetupFormData) {
    'use server';
    return updateEvent(params.eventId, data);
  }

  const eventStatus = (event as Record<string, unknown>).status as string;
  const isDemo = (event as Record<string, unknown>).is_demo as boolean ?? false;
  const today = new Date().toISOString().slice(0, 10);
  const isPast = (event.start_date as string) < today;

  // Fetch readiness only for draft events that haven't ended.
  const isDraft = eventStatus === 'draft';
  const readiness = isDraft && !isPast ? await getEventReadiness(params.eventId) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Event Setup</h1>
          {isDemo && (
            <span className="rounded bg-violet-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-violet-300">
              Demo
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes are saved immediately. The agent runtime reads this config on every conversation.
        </p>
      </div>

      {/* ── Status banner ──────────────────────────────────────────────────── */}
      {isPast ? (
        <div className="banner-neutral mb-6 flex items-center gap-3 px-4 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" />
          <p className="text-sm">This event has ended.</p>
        </div>
      ) : eventStatus === 'live' ? (
        <div className="banner-success mb-6 flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-green-400" />
            <p className="text-sm font-medium">Event is live. Support agent is active.</p>
          </div>
          <EndEventButton eventId={params.eventId} />
        </div>
      ) : (
        <div className="banner-warning mb-6 flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
            <p className="text-sm">
              This event is not published. Customers cannot reach the support agent.
            </p>
          </div>
          <PublishButton
            eventId={params.eventId}
            canPublish={readiness?.can_publish ?? true}
          />
        </div>
      )}

      <EventSetupForm
        defaultValues={defaultValues}
        onSubmit={handleUpdate}
        submitLabel="Save event"
      />

      {/* ── Readiness checklist — draft, non-past events only ─────────────── */}
      {readiness && <ReadinessChecklist result={readiness} />}

      {/* ── Danger zone ───────────────────────────────────────────────────── */}
      <div className="mt-10 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <h2 className="text-base font-semibold text-destructive">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Deleting an event is permanent. All conversations, orders, KB sections, gate scans,
          escalations, and payment recovery records will be removed.
        </p>
        <div className="mt-4">
          <DeleteEventButton eventId={params.eventId} eventName={event.name} />
        </div>
      </div>
    </div>
  );
}
