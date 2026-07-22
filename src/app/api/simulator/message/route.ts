import { NextResponse } from 'next/server';

import { runAgent } from '@/lib/agent/state-machine';

// One turn = Haiku classify + KB retrieval + optional Sonnet generate +
// DB writes. Typical: 3-8s. The Vercel Hobby plan caps at 10s regardless of
// this value; Pro respects up to 60s. On free, expect occasional timeouts.
export const maxDuration = 30;
export const runtime = 'nodejs';
import type {
  AgentState,
  ConversationSnapshot,
  Language,
  OrderContext,
} from '@/lib/agent/types';
import { createServerClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/audit/write-audit-log';
import type { EventConfig } from '@/lib/types';
import { notifyEscalationContacts } from '@/lib/agent/escalation-notifier';
import { rateLimit } from '@/lib/rate-limit';

const MAX_MESSAGE_CHARS = 4000;

const VALID_LANGUAGES = new Set<Language>(['en', 'ar', 'ru', 'mixed']);
const VALID_AGENT_STATES = new Set<AgentState>([
  'greeting',
  'faq_answer',
  'order_lookup',
  'refund_deflection',
  'escalation_triggered',
  'session_closed',
]);

const DEFAULT_SIMULATOR_PHONE = '+971500000000';

interface SimulatorRequestBody {
  event_id?: string;
  session_id?: string | null;
  message?: string;
  language_hint?: string;
  customer_phone_e164?: string;
}

interface OrderRow {
  id: string;
  order_id: string;
  customer_phone_e164: string;
  customer_name: string | null;
  ticket_type: string | null;
  quantity: number;
  amount_paid: number | string | null;
  currency: string;
  status: OrderContext['status'];
  vip_flag: boolean;
  transfer_eligible: boolean;
}

function rowToOrderContext(row: OrderRow): OrderContext {
  return {
    id: row.id,
    order_id: row.order_id,
    customer_phone_e164: row.customer_phone_e164,
    customer_name: row.customer_name,
    ticket_type: row.ticket_type,
    quantity: row.quantity,
    amount_paid:
      row.amount_paid == null
        ? null
        : typeof row.amount_paid === 'string'
        ? parseFloat(row.amount_paid)
        : row.amount_paid,
    currency: row.currency,
    status: row.status,
    vip_flag: row.vip_flag,
    transfer_eligible: row.transfer_eligible,
  };
}

function coerceAgentState(value: string): AgentState {
  return VALID_AGENT_STATES.has(value as AgentState)
    ? (value as AgentState)
    : 'greeting';
}

function coerceLanguage(value: string | undefined): Language {
  return value && VALID_LANGUAGES.has(value as Language) ? (value as Language) : 'en';
}

export async function POST(request: Request) {
  // ── 1. Parse and validate body ───────────────────────────────────────────
  let body: SimulatorRequestBody;
  try {
    body = (await request.json()) as SimulatorRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const eventId = body.event_id;
  const message = body.message?.trim();
  const sessionId = body.session_id || null;
  const languageHint = coerceLanguage(body.language_hint);
  const simPhone = body.customer_phone_e164?.trim() || DEFAULT_SIMULATOR_PHONE;

  if (!eventId) {
    return NextResponse.json({ error: 'event_id is required.' }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: 'message is required.' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message exceeds ${MAX_MESSAGE_CHARS} character limit.` },
      { status: 413 },
    );
  }

  // ── 2. Auth + event access (RLS) ─────────────────────────────────────────
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, operator_id, config, timezone, end_date, is_demo')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();

  if (eventError || !event) {
    return NextResponse.json({ error: 'Event not found or access denied.' }, { status: 404 });
  }

  // Per-operator rate limit (audit 9.1b) — caps Anthropic spend from a single
  // operator looping the simulator. In-memory, per serverless instance; see
  // rate-limit.ts. Keyed by the verified event's operator.
  const rl = rateLimit(`simulator:${event.operator_id as string}`, 30, 60_000);
  if (!rl.allowed) {
    console.warn('[simulator] rate limit exceeded', {
      operator_id: event.operator_id,
      retry_after_ms: rl.retryAfterMs,
    });
    return NextResponse.json(
      { error: 'Too many simulator messages. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  const eventConfig: EventConfig = {
    ...(event.config as EventConfig),
    timezone: event.timezone as string | undefined,
    // Inject top-level end_date so the generator's "ended" branch is correct
    // for multi-day events (audit 4.7).
    event_end_date_iso: (event.end_date as string | null) ?? undefined,
  };

  // ── 3. Resolve or create the conversation ────────────────────────────────
  let conversationId: string;
  let conversationState: AgentState = 'greeting';
  let conversationLanguage: Language = languageHint;
  let matchedOrderId: string | null = null;
  let consecutiveNoProgress = 0;

  if (sessionId) {
    const { data: convo, error: convoError } = await supabase
      .from('conversations')
      .select('id, state, language, matched_order_id, consecutive_no_progress_turns, customer_phone_e164')
      .eq('id', sessionId)
      .eq('event_id', eventId)
      .single();

    if (convoError || !convo) {
      return NextResponse.json(
        { error: 'Session not found or access denied.' },
        { status: 404 },
      );
    }

    conversationId = convo.id;
    conversationState = coerceAgentState(convo.state);
    conversationLanguage = coerceLanguage(convo.language);
    matchedOrderId = convo.matched_order_id;
    consecutiveNoProgress = convo.consecutive_no_progress_turns ?? 0;
  } else {
    const { data: newConvo, error: newConvoError } = await supabase
      .from('conversations')
      .insert({
        event_id: eventId,
        customer_phone_e164: simPhone,
        channel: 'simulator',
        language: languageHint,
        state: 'greeting',
        consecutive_no_progress_turns: 0,
      })
      .select('id')
      .single();

    if (newConvoError || !newConvo) {
      return NextResponse.json(
        { error: `Failed to start session: ${newConvoError?.message ?? 'unknown'}` },
        { status: 500 },
      );
    }
    conversationId = newConvo.id;
  }

  // ── 4. Load recent messages for history ──────────────────────────────────
  const { data: history } = await supabase
    .from('messages')
    .select('role, text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(40);

  const messageHistory = (history ?? []) as ConversationSnapshot['message_history'];

  // ── 5. Hydrate matched order if any ──────────────────────────────────────
  let matchedOrder: OrderContext | null = null;
  if (matchedOrderId) {
    const { data: orderRow } = await supabase
      .from('orders')
      .select(
        'id, order_id, customer_phone_e164, customer_name, ticket_type, quantity, amount_paid, currency, status, vip_flag, transfer_eligible',
      )
      .eq('id', matchedOrderId)
      .single();
    if (orderRow) matchedOrder = rowToOrderContext(orderRow as OrderRow);
  }

  // ── 6. Persist the inbound user message ──────────────────────────────────
  const { error: userMsgError } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'user',
    text: message,
  });
  if (userMsgError) {
    return NextResponse.json(
      { error: `Failed to persist message: ${userMsgError.message}` },
      { status: 500 },
    );
  }

  // ── 7. Build snapshot and run the agent ──────────────────────────────────
  const snapshot: ConversationSnapshot = {
    conversation_id: conversationId,
    event_id: eventId,
    customer_phone_e164: simPhone,
    state: conversationState,
    matched_order: matchedOrder,
    classified_reason: null,
    alternative_offered: null,
    language: conversationLanguage,
    refund_case_id: null,
    message_history: [...messageHistory, { role: 'user', text: message, created_at: new Date().toISOString() }],
    consecutive_no_progress_turns: consecutiveNoProgress,
  };

  const result = await runAgent({
    supabase,
    snapshot,
    message,
    eventConfig,
    operatorId: event.operator_id as string,
  });

  // ── 8. Persist the agent reply ───────────────────────────────────────────
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'agent',
    text: result.reply_text,
    classified_intent: result.classified_intent,
    cited_section_ids: result.cited_section_ids.length > 0 ? result.cited_section_ids : null,
    source_section: result.source_section ?? null,
    deflection_offered: result.deflection_offer != null,
  });

  // ── 9. Update conversation state ─────────────────────────────────────────
  const nextNoProgress =
    result.new_state === 'order_lookup'
      ? consecutiveNoProgress + 1
      : 0;
  const newLanguage = result.classification?.language ?? conversationLanguage;

  await supabase
    .from('conversations')
    .update({
      state: result.new_state,
      language: newLanguage,
      matched_order_id: result.matched_order_id ?? matchedOrderId,
      consecutive_no_progress_turns: nextNoProgress,
      closed_at:
        result.new_state === 'escalation_triggered' || result.new_state === 'session_closed'
          ? new Date().toISOString()
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // ── 10. Open an escalation row if escalated ──────────────────────────────
  if (result.escalation) {
    const { data: newEscalation, error: escalationError } = await supabase
      .from('escalations')
      .insert({
        conversation_id: conversationId,
        event_id: eventId,
        reason: result.escalation.reason,
        priority: result.escalation.priority,
        summary_for_ops: result.escalation.summary_for_ops,
      })
      .select('id')
      .single();

    if (escalationError) {
      console.error(
        '[escalation] insert failed:',
        escalationError,
        { conversation_id: conversationId },
      );
      return NextResponse.json(
        { error: `Failed to record escalation: ${escalationError.message}` },
        { status: 500 },
      );
    }

    // Notify escalation contacts via WhatsApp (best-effort, non-fatal).
    try {
      await notifyEscalationContacts({
        event: { ...event },
        escalation_id: newEscalation?.id ?? 'unknown',
        customer_phone: simPhone,
        trigger_message: message,
        intent: result.classified_intent ?? result.escalation.reason,
      });
    } catch (notifyErr) {
      console.warn('[simulator] escalation notification failed (non-fatal):', notifyErr);
    }
  }

  // ── 11. Audit (admin client — RLS forbids user INSERT on audit_log) ──────
  await writeAuditLog({
    operator_id: event.operator_id,
    event_id: eventId,
    actor_type: 'agent',
    action: result.escalation ? 'agent.escalated' : 'agent.replied',
    entity_type: 'conversation',
    entity_id: conversationId,
    metadata: {
      classified_intent: result.classified_intent,
      cited_section_ids: result.cited_section_ids,
      deflection_offer: result.deflection_offer,
      escalation_reason: result.escalation?.reason ?? null,
      escalation_priority: result.escalation?.priority ?? null,
      classifier_confidence: result.classification?.confidence ?? null,
      anger_score: result.classification?.anger_score ?? null,
      new_state: result.new_state,
    },
  });

  // ── 12. Respond ──────────────────────────────────────────────────────────
  return NextResponse.json({
    session_id: conversationId,
    response: result.reply_text,
    state: result.new_state,
    escalated: result.escalation !== null,
    escalation_reason: result.escalation?.reason ?? null,
    deflection_offer: result.deflection_offer,
    kb_cited: result.cited_section_ids,
    classified_intent: result.classified_intent,
    language: newLanguage,
  });
}
