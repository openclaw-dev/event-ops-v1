'use server';

import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';
import { writeAuditLog } from '@/lib/audit/write-audit-log';

/**
 * sendHumanReply
 *
 * Called from the HumanReplyForm client component.
 * 1. Inserts a human_operator message into the conversation.
 * 2. Marks the conversation session_closed.
 * 3. If channel=whatsapp, delivers the reply to the customer via the WhatsApp adapter.
 */
export async function sendHumanReply(
  eventId: string,
  conversationId: string,
  replyText: string,
): Promise<{ success: boolean; error?: string }> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated.' };

  const text = replyText.trim();
  if (!text) return { success: false, error: 'Reply cannot be empty.' };

  // ── Ownership check (RLS-scoped) ─────────────────────────────────────────
  // The user must belong to the operator that owns this event.
  const { data: event } = await supabase
    .from('events')
    .select('id, operator_id, is_demo')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();
  if (!event) return { success: false, error: 'forbidden' };

  const { data: membership } = await supabase
    .from('operator_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('operator_id', (event as { operator_id: string }).operator_id)
    .maybeSingle();
  if (!membership) return { success: false, error: 'forbidden' };

  const admin = createAdminClient();

  // ── Verify conversation belongs to this event ─────────────────────────────
  const { data: convoData } = await admin
    .from('conversations')
    .select('id, channel, customer_phone_e164')
    .eq('id', conversationId)
    .eq('event_id', eventId)
    .single();

  if (!convoData) return { success: false, error: 'Conversation not found.' };

  const convo = convoData as {
    id: string;
    channel: string;
    customer_phone_e164: string;
  };

  // ── Insert human operator message ─────────────────────────────────────────
  const { error: msgError } = await admin.from('messages').insert({
    conversation_id: conversationId,
    role: 'human_operator',
    text,
  });

  if (msgError) return { success: false, error: msgError.message };

  // ── Mark conversation closed (zero-rows guard) ────────────────────────────
  const { data: closedRows, error: closeError } = await admin
    .from('conversations')
    .update({ state: 'session_closed', closed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .select('id');

  if (closeError) return { success: false, error: closeError.message };
  if (!closedRows || closedRows.length === 0) {
    return { success: false, error: 'Conversation could not be closed — it may have been deleted.' };
  }

  // ── Deliver via WhatsApp if applicable ────────────────────────────────────
  // A delivery failure MUST surface to the operator: the reply is saved in the
  // DB, but the customer never received it (audit 6.1 — previously a warn-only
  // path that still returned success: true).
  if (convo.channel === 'whatsapp' && convo.customer_phone_e164) {
    // Demo guard (audit 8.2): never deliver a demo conversation's reply to a
    // real WhatsApp number. The reply is already saved and the conversation
    // closed above; we simply skip the outbound send and report success.
    if ((event as { is_demo?: boolean }).is_demo) {
      console.warn('[sendHumanReply] demo event — WhatsApp delivery skipped', {
        conversationId,
        eventId,
      });
      revalidatePath(`/admin/events/${eventId}/conversations/${conversationId}`);
      return { success: true };
    }

    let deliveryError: string | null = null;
    try {
      const adapter = createWhatsAppAdapter();
      const result = await adapter.sendText({
        to_phone_e164: convo.customer_phone_e164,
        text,
      });
      if (!result.success) {
        deliveryError = result.error ?? 'unknown delivery error';
        console.warn('[sendHumanReply] WhatsApp delivery failed:', deliveryError);
      }
    } catch (err) {
      // Fires when WHATSAPP_PROVIDER is unset or the adapter throws.
      deliveryError = err instanceof Error ? err.message : String(err);
      console.warn('[sendHumanReply] WhatsApp adapter unavailable:', err);
    }

    if (deliveryError) {
      revalidatePath(`/admin/events/${eventId}/conversations/${conversationId}`);
      return {
        success: false,
        error: `Reply saved, but WhatsApp delivery failed: ${deliveryError}. The customer did NOT receive it.`,
      };
    }
  }

  revalidatePath(`/admin/events/${eventId}/conversations/${conversationId}`);
  return { success: true };
}

/**
 * closeConversation
 *
 * Standalone resolve: marks a conversation closed WITHOUT messaging the
 * customer (previously the only way to close one was to send a human reply).
 * Follows the escalations claim/resolve/reopen pattern — RLS-scoped write
 * (conversations has a FOR ALL policy, migration 0009), zero-rows guard, error
 * surfaced to the UI, audit trail via writeAuditLog.
 *
 * "Closed" reuses the existing `state = 'session_closed'` + `closed_at` columns
 * (migration 0006) that sendHumanReply and the agent state machine already use —
 * no schema change.
 */
export async function closeConversation(
  eventId: string,
  conversationId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated.' };

  // Ownership: the RLS-scoped event SELECT doubles as the operator-membership
  // check (a row only returns if the user belongs to the event's operator).
  const { data: event } = await supabase
    .from('events')
    .select('id, operator_id')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();
  if (!event) return { success: false, error: 'forbidden' };

  const { data: convo } = await supabase
    .from('conversations')
    .select('id, state')
    .eq('id', conversationId)
    .eq('event_id', eventId)
    .single();
  if (!convo) return { success: false, error: 'Conversation not found.' };

  if ((convo as { state: string }).state === 'session_closed') {
    return { success: false, error: 'Conversation is already closed.' };
  }

  const { data: updated, error } = await supabase
    .from('conversations')
    .update({
      state: 'session_closed',
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
    .eq('event_id', eventId)
    .select('id');

  if (error) return { success: false, error: error.message };
  if (!updated || updated.length === 0) {
    return {
      success: false,
      error: 'Close affected no rows — the conversation may have changed. Refresh and retry.',
    };
  }

  await writeAuditLog({
    operator_id: (event as { operator_id: string }).operator_id,
    event_id: eventId,
    actor_type: 'user',
    actor_id: user.id,
    action: 'conversation.closed',
    entity_type: 'conversation',
    entity_id: conversationId,
    metadata: { previous_state: (convo as { state: string }).state },
  });

  revalidatePath(`/admin/events/${eventId}/conversations/${conversationId}`);
  revalidatePath(`/admin/events/${eventId}/conversations`);
  return { success: true };
}
