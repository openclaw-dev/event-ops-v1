'use server';

import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { type EventSetupFormData } from '@/lib/schemas';
import { type EventConfig } from '@/lib/types';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';

/**
 * Create a new event under the active operator.
 *
 * - Writes top-level event fields to the `events` table (via user JWT / RLS).
 * - Composes and stores the EventConfig JSONB in `events.config`.
 * - Appends an `audit_log` row via the service-role client (audit_log has no
 *   user INSERT policy).
 *
 * Returns `{ error: string }` on failure; redirects to the setup page on
 * success so the user can continue configuring the event.
 */
export async function createEvent(
  data: EventSetupFormData,
): Promise<{ error: string } | undefined> {
  const supabase = createServerClient();

  // Verify session.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  // Resolve active operator.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operatorId = resolveActiveOperatorId(
    (memberships ?? []).map((m) => m.operator_id as string),
  );
  if (!operatorId) return { error: 'No operator found. Complete onboarding first.' };

  // Build the EventConfig blob.
  const config: EventConfig = {
    event_id: '',          // filled in after insert
    event_name: data.name,
    event_date_iso: data.start_date,
    refund_policy: {
      shape: data.refund_policy.shape,
      tiers: data.refund_policy.tiers,
      allowed_alternatives_after_window: data.refund_policy.allowed_alternatives_after_window,
      credit_validity_months: data.refund_policy.credit_validity_months,
      medical_exception_section_id: data.refund_policy.medical_exception_section_id,
    },
    escalation_keywords: data.escalation_keywords,
    vip_orders_always_escalate: data.vip_orders_always_escalate,
    dress_code: data.dress_code,
    age_minimum: data.age_minimum,
    doors_open_local: data.doors_open_local,
    doors_close_local: data.doors_close_local,
    last_entry_local: data.last_entry_local,
    parking_info: data.parking_info,
    escalation_contacts: data.escalation_contacts,
    ticket_tiers: data.ticket_tiers,
  };

  // Insert the event row (RLS allows writes for operators the user belongs to).
  const { data: event, error: insertError } = await supabase
    .from('events')
    .insert({
      operator_id: operatorId,
      name: data.name,
      slug: data.slug,
      event_type: data.event_type,
      start_date: data.start_date,
      end_date: data.end_date,
      timezone: data.timezone,
      venue_name: data.venue_name,
      venue_city: data.venue_city,
      capacity: data.capacity,
      age_minimum: data.age_minimum,
      config,
    })
    .select('id')
    .single();

  if (insertError || !event) {
    const msg = insertError?.message ?? 'Failed to create event.';
    // Surface slug uniqueness violation with a friendly message.
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return { error: `The slug "${data.slug}" is already used by another event. Choose a different one.` };
    }
    return { error: msg };
  }

  // Patch config.event_id now that we have the real UUID.
  const finalConfig: EventConfig = { ...config, event_id: event.id };
  await supabase.from('events').update({ config: finalConfig }).eq('id', event.id);

  // Write audit log (service-role — audit_log has no user INSERT policy).
  const admin = createAdminClient();
  await admin.from('audit_log').insert({
    operator_id: operatorId,
    event_id: event.id,
    actor_type: 'user',
    actor_id: user.id,
    action: 'event.created',
    entity_type: 'event',
    entity_id: event.id,
    metadata: { name: data.name, slug: data.slug },
  });

  redirect(`/admin/events/${event.id}/setup`);
}
