'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/write-audit-log';
import { type EventSetupFormData } from '@/lib/schemas';
import { type EventConfig } from '@/lib/types';

/**
 * Update an existing event's configuration.
 *
 * - Verifies the user owns (via RLS) the event before writing.
 * - Writes top-level fields + recomposed EventConfig JSONB atomically.
 * - Appends an audit_log row (service-role).
 *
 * Returns `{ error: string }` on failure; `undefined` on success (the
 * client shows an inline success toast rather than navigating away).
 */
export async function updateEvent(
  eventId: string,
  data: EventSetupFormData,
): Promise<{ error: string } | undefined> {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  // Build the EventConfig blob.
  const config: EventConfig = {
    event_id: eventId,
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

  const { data: event, error: updateError } = await supabase
    .from('events')
    .update({
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
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .select('operator_id')
    .single();

  if (updateError || !event) {
    const msg = updateError?.message ?? 'Failed to update event.';
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return {
        error: `The slug "${data.slug}" is already used by another event. Choose a different one.`,
      };
    }
    return { error: msg };
  }

  // Audit log (service-role).
  await writeAuditLog({
    operator_id: event.operator_id,
    event_id: eventId,
    actor_type: 'user',
    actor_id: user.id,
    action: 'event.updated',
    entity_type: 'event',
    entity_id: eventId,
    metadata: { name: data.name, slug: data.slug },
  });

  return undefined; // success
}

/**
 * Set an event's status to 'live'.
 *
 * Only the operator that owns the event can publish it (RLS-enforced).
 * Returns `{ error: string }` on failure; `undefined` on success.
 */
export async function endEvent(
  eventId: string,
): Promise<{ error: string } | undefined> {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  const { data: event, error: updateError } = await supabase
    .from('events')
    .update({ status: 'draft', updated_at: new Date().toISOString() })
    .eq('id', eventId)
    .select('operator_id')
    .single();

  if (updateError || !event) {
    return { error: updateError?.message ?? 'Failed to end event.' };
  }

  await writeAuditLog({
    operator_id: (event as { operator_id: string }).operator_id,
    event_id: eventId,
    actor_type: 'user',
    actor_id: user.id,
    action: 'event.unpublished',
    entity_type: 'event',
    entity_id: eventId,
    metadata: {},
  });

  revalidatePath(`/admin/events/${eventId}/setup`);
  return undefined;
}

export async function deleteEvent(
  eventId: string,
): Promise<{ error: string } | undefined> {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  // RLS ownership check — only succeeds if the user belongs to the operator that owns this event.
  const { data: event, error: selectError } = await supabase
    .from('events')
    .select('name, operator_id')
    .eq('id', eventId)
    .single();

  if (selectError || !event) return { error: 'Event not found.' };

  const admin = createAdminClient();

  // Audit with event_id = null so the row is NOT cascade-deleted when the event is removed.
  await writeAuditLog({
    operator_id: event.operator_id,
    event_id: null,
    actor_type: 'user',
    actor_id: user.id,
    action: 'event.deleted',
    entity_type: 'event',
    entity_id: eventId,
    metadata: { name: event.name },
  });

  const { error: deleteError } = await admin.from('events').delete().eq('id', eventId);

  if (deleteError) return { error: deleteError.message };

  revalidatePath('/admin/events');
  redirect('/admin/events');
}

export async function publishEvent(
  eventId: string,
): Promise<{ error: string } | undefined> {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  const { data: event, error: updateError } = await supabase
    .from('events')
    .update({ status: 'live', updated_at: new Date().toISOString() })
    .eq('id', eventId)
    .select('operator_id')
    .single();

  if (updateError || !event) {
    return { error: updateError?.message ?? 'Failed to publish event.' };
  }

  // Audit log.
  await writeAuditLog({
    operator_id: (event as { operator_id: string }).operator_id,
    event_id: eventId,
    actor_type: 'user',
    actor_id: user.id,
    action: 'event.published',
    entity_type: 'event',
    entity_id: eventId,
    metadata: {},
  });

  revalidatePath(`/admin/events/${eventId}/setup`);
  return undefined;
}
