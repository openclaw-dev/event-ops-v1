/**
 * whatsapp-conversation.ts
 *
 * Gets or creates a WhatsApp customer-support conversation, fetches its message
 * history, and returns everything the agent state machine needs to process the
 * next turn.
 *
 * All DB writes use createAdminClient() — this runs inside the inbound webhook
 * handler where there is no user session (no RLS context).
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { AgentState, Language } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape that matches ConversationSnapshot.message_history */
type MessageHistoryItem = {
  role: 'user' | 'agent' | 'human_operator';
  text: string;
  created_at: string;
};

export interface WhatsAppConversation {
  conversation_id: string;
  is_new: boolean;
  /** Last 10 messages ready to pass as ConversationSnapshot.message_history */
  history: MessageHistoryItem[];
  state: AgentState;
  language: Language;
  matched_order_id: string | null;
  consecutive_no_progress_turns: number;
}

const VALID_STATES = new Set<string>([
  'greeting',
  'faq_answer',
  'order_lookup',
  'refund_deflection',
  'escalation_triggered',
  'session_closed',
]);

const VALID_LANGUAGES = new Set<string>(['en', 'ar', 'ru', 'mixed']);

function coerceState(v: unknown): AgentState {
  return typeof v === 'string' && VALID_STATES.has(v) ? (v as AgentState) : 'greeting';
}

function coerceLanguage(v: unknown): Language {
  return typeof v === 'string' && VALID_LANGUAGES.has(v) ? (v as Language) : 'en';
}

function coerceRole(v: unknown): 'user' | 'agent' | 'human_operator' {
  if (v === 'user' || v === 'agent' || v === 'human_operator') return v;
  return 'agent';
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Finds the most-recent open WhatsApp conversation for this customer+event, or
 * creates a new one.
 *
 * "Open" means: channel = 'whatsapp', closed_at IS NULL.
 *
 * @param params.language  Initial language hint (e.g. 'en'); overwritten on
 *                         subsequent turns by the classifier's detection.
 */
export async function getOrCreateWhatsAppConversation(params: {
  event_id: string;
  operator_id: string;
  phone_e164: string;
  wa_message_id: string;
  language: string;
}): Promise<WhatsAppConversation> {
  const admin = createAdminClient();

  // ── Look for an open conversation ─────────────────────────────────────────
  const { data: existing } = await admin
    .from('conversations')
    .select(
      'id, state, language, matched_order_id, consecutive_no_progress_turns',
    )
    .eq('event_id', params.event_id)
    .eq('customer_phone_e164', params.phone_e164)
    .eq('channel', 'whatsapp')
    .is('closed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const row = existing as {
      id: string;
      state: string;
      language: string;
      matched_order_id: string | null;
      consecutive_no_progress_turns: number;
    };

    // Fetch last 10 messages for history
    const { data: msgs } = await admin
      .from('messages')
      .select('role, text, created_at')
      .eq('conversation_id', row.id)
      .order('created_at', { ascending: true })
      .limit(10);

    const history: MessageHistoryItem[] = (msgs ?? []).map((m) => ({
      role: coerceRole((m as Record<string, unknown>).role),
      text: String((m as Record<string, unknown>).text ?? ''),
      created_at: String((m as Record<string, unknown>).created_at ?? ''),
    }));

    return {
      conversation_id: row.id,
      is_new: false,
      history,
      state: coerceState(row.state),
      language: coerceLanguage(row.language),
      matched_order_id: row.matched_order_id,
      consecutive_no_progress_turns: row.consecutive_no_progress_turns ?? 0,
    };
  }

  // ── Create a new conversation ─────────────────────────────────────────────
  const { data: newConv, error } = await admin
    .from('conversations')
    .insert({
      event_id: params.event_id,
      operator_id: params.operator_id,
      customer_phone_e164: params.phone_e164,
      channel: 'whatsapp',
      language: coerceLanguage(params.language),
      state: 'greeting',
      wa_message_id: params.wa_message_id,
      consecutive_no_progress_turns: 0,
    })
    .select('id')
    .single();

  if (error || !newConv) {
    throw new Error(`Failed to create conversation: ${error?.message ?? 'unknown'}`);
  }

  return {
    conversation_id: (newConv as { id: string }).id,
    is_new: true,
    history: [],
    state: 'greeting',
    language: coerceLanguage(params.language),
    matched_order_id: null,
    consecutive_no_progress_turns: 0,
  };
}
