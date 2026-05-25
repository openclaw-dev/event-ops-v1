'use server';

import { revalidatePath } from 'next/cache';

import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

interface ActionResult {
  error?: string;
}

/**
 * Resolve the operator_user row for the current authenticated user against
 * the operator that owns the given event. Returns null when the user can't
 * act on this event.
 */
async function resolveActor(
  eventId: string,
): Promise<
  | { operatorUserId: string; operatorId: string; userId: string }
  | null
> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: event } = await supabase
    .from('events')
    .select('id, operator_id')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();
  if (!event) return null;

  const { data: operatorUser } = await supabase
    .from('operator_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('operator_id', event.operator_id)
    .single();
  if (!operatorUser) return null;

  return {
    operatorUserId: operatorUser.id,
    operatorId: event.operator_id,
    userId: user.id,
  };
}

async function fetchEscalation(
  eventId: string,
  escalationId: string,
): Promise<{ id: string; status: string; reason: string; conversation_id: string } | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from('escalations')
    .select('id, status, reason, conversation_id')
    .eq('id', escalationId)
    .eq('event_id', eventId)
    .single();
  return data;
}

function pathsToRevalidate(eventId: string): string[] {
  return [
    `/admin/events/${eventId}/escalations`,
    `/admin/events/${eventId}/conversations`,
    `/admin/events/${eventId}/report`,
  ];
}

async function writeAudit(
  eventId: string,
  action: 'escalation.claimed' | 'escalation.resolved' | 'escalation.reopened',
  operatorId: string,
  userId: string,
  escalationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  await admin.from('audit_log').insert({
    operator_id: operatorId,
    event_id: eventId,
    actor_type: 'user',
    actor_id: userId,
    action,
    entity_type: 'escalation',
    entity_id: escalationId,
    metadata,
  });
}

// ─── Claim ───────────────────────────────────────────────────────────────────

export async function claimEscalation(
  eventId: string,
  escalationId: string,
): Promise<ActionResult> {
  const actor = await resolveActor(eventId);
  if (!actor) return { error: 'Not authorized.' };

  const escalation = await fetchEscalation(eventId, escalationId);
  if (!escalation) return { error: 'Escalation not found.' };
  if (escalation.status !== 'open' && escalation.status !== 'reopened') {
    return {
      error: `Cannot claim an escalation in "${escalation.status}" state.`,
    };
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from('escalations')
    .update({
      status: 'claimed',
      claimed_by: actor.operatorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', escalationId)
    .eq('event_id', eventId);

  if (error) return { error: error.message };

  await writeAudit(
    eventId,
    'escalation.claimed',
    actor.operatorId,
    actor.userId,
    escalationId,
    { reason: escalation.reason, conversation_id: escalation.conversation_id },
  );

  for (const p of pathsToRevalidate(eventId)) revalidatePath(p);
  return {};
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

export async function resolveEscalation(
  eventId: string,
  escalationId: string,
): Promise<ActionResult> {
  const actor = await resolveActor(eventId);
  if (!actor) return { error: 'Not authorized.' };

  const escalation = await fetchEscalation(eventId, escalationId);
  if (!escalation) return { error: 'Escalation not found.' };
  if (escalation.status === 'resolved') {
    return { error: 'Escalation is already resolved.' };
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from('escalations')
    .update({
      status: 'resolved',
      resolved_by: actor.operatorUserId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', escalationId)
    .eq('event_id', eventId);

  if (error) return { error: error.message };

  await writeAudit(
    eventId,
    'escalation.resolved',
    actor.operatorId,
    actor.userId,
    escalationId,
    {
      reason: escalation.reason,
      conversation_id: escalation.conversation_id,
      previous_status: escalation.status,
    },
  );

  for (const p of pathsToRevalidate(eventId)) revalidatePath(p);
  return {};
}

// ─── Reopen ──────────────────────────────────────────────────────────────────

export async function reopenEscalation(
  eventId: string,
  escalationId: string,
): Promise<ActionResult> {
  const actor = await resolveActor(eventId);
  if (!actor) return { error: 'Not authorized.' };

  const escalation = await fetchEscalation(eventId, escalationId);
  if (!escalation) return { error: 'Escalation not found.' };
  if (escalation.status !== 'resolved') {
    return {
      error: `Only resolved escalations can be reopened (current: "${escalation.status}").`,
    };
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from('escalations')
    .update({
      status: 'reopened',
      claimed_by: null,
      resolved_by: null,
      resolved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', escalationId)
    .eq('event_id', eventId);

  if (error) return { error: error.message };

  await writeAudit(
    eventId,
    'escalation.reopened',
    actor.operatorId,
    actor.userId,
    escalationId,
    { reason: escalation.reason, conversation_id: escalation.conversation_id },
  );

  for (const p of pathsToRevalidate(eventId)) revalidatePath(p);
  return {};
}
