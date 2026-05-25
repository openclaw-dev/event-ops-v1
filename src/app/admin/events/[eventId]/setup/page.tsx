import { notFound, redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { updateEvent } from './actions';
import { EventSetupForm } from '../../_components/event-setup-form';
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
      'id, name, slug, event_type, start_date, end_date, timezone, venue_name, venue_city, capacity, age_minimum, config',
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
        ? config.escalation_contacts
        : [{ name: '', hours: '', method: '' }],

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

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold">Event Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes are saved immediately. The agent runtime reads this config on every conversation.
        </p>
      </div>

      <EventSetupForm
        defaultValues={defaultValues}
        onSubmit={handleUpdate}
        submitLabel="Save event"
      />
    </div>
  );
}
