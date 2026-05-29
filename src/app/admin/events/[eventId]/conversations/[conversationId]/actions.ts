'use server';

import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';

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

  // ── Mark conversation closed ──────────────────────────────────────────────
  await admin
    .from('conversations')
    .update({ state: 'session_closed', closed_at: new Date().toISOString() })
    .eq('id', conversationId);

  // ── Deliver via WhatsApp if applicable ────────────────────────────────────
  if (convo.channel === 'whatsapp' && convo.customer_phone_e164) {
    try {
      const adapter = createWhatsAppAdapter();
      const result = await adapter.sendText({
        to_phone_e164: convo.customer_phone_e164,
        text,
      });
      if (!result.success) {
        console.warn('[sendHumanReply] WhatsApp delivery failed:', result.error);
      }
    } catch (err) {
      // Non-fatal: the message is recorded in the DB regardless.
      // This fires when WHATSAPP_PROVIDER is unset or the adapter throws.
      console.warn('[sendHumanReply] WhatsApp adapter unavailable:', err);
    }
  }

  revalidatePath(`/admin/events/${eventId}/conversations/${conversationId}`);
  return { success: true };
}
