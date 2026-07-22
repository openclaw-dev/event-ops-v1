/**
 * /api/whatsapp/inbound
 *
 * GET  — Meta webhook verification (hub challenge handshake).
 *         360dialog does not use this endpoint.
 * POST — Inbound message receiver for both Meta and 360dialog.
 *         Always returns HTTP 200 — WhatsApp retries on any non-200 response.
 *
 * Two parallel flows for text messages:
 *   1. Promoter (known phone) → data-entry / change-confirmation flow (unchanged)
 *   2. Customer (unknown phone) → customer-support agent flow
 */

import { timingSafeEqual } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { trackUsage } from '@/lib/billing/track-usage';
import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';
import type { InboundMessage, InboundTextMessage, WhatsAppAdapter } from '@/lib/whatsapp/types';
import { extractChanges } from '@/lib/data-entry/whatsapp-change-extractor';
import { generateDiff, formatFieldLabel, formatValue } from '@/lib/data-entry/whatsapp-change-diff';
import {
  createPendingChange,
  updateConfirmationWamid,
  updateConfirmationSendError,
  findPendingByConfirmationWamid,
  confirmPendingChange,
  cancelPendingChange,
  type PendingChange,
} from '@/lib/data-entry/pending-changes';
import { runAgent } from '@/lib/agent/state-machine';
import { notifyEscalationContacts } from '@/lib/agent/escalation-notifier';
import type { ConversationSnapshot, Language, OrderContext } from '@/lib/agent/types';
import type { EventConfig } from '@/lib/types';
import {
  getOperatorByPhoneNumberId,
  getSingleOperatorFallback,
  resolveEventForOperator,
} from '@/lib/agent/whatsapp-router';
import { getOrCreateWhatsAppConversation } from '@/lib/agent/whatsapp-conversation';
import { markMessageProcessed } from '@/lib/whatsapp/message-dedup';
import { preRouteInbound } from '@/lib/whatsapp/inbound-pre-router';
import { writeAuditLog } from '@/lib/audit/write-audit-log';
import { optionalEnv } from '@/lib/env';
import {
  getPendingEventSelection,
  setPendingEventSelection,
  clearPendingEventSelection,
} from '@/lib/agent/whatsapp-session-state';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ─── GET — Meta webhook verification ─────────────────────────────────────────

/** Constant-time string equality with a length guard (audit 7.1). */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const verifyToken = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  // Trim the configured token so a trailing newline in META_WEBHOOK_VERIFY_TOKEN
  // cannot 403 the verification handshake forever (audit 2.3). Compare in
  // constant time (buffers from the trimmed values), consistent with the POST
  // signature path (audit 7.1).
  const expectedToken = optionalEnv('META_WEBHOOK_VERIFY_TOKEN');
  if (
    mode === 'subscribe' &&
    expectedToken !== undefined &&
    verifyToken !== null &&
    constantTimeEquals(verifyToken.trim(), expectedToken)
  ) {
    return new Response(challenge ?? '', { status: 200 });
  }

  return new Response('forbidden', { status: 403 });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_LANGUAGES = new Set<Language>(['en', 'ar', 'ru', 'mixed']);

function coerceLanguage(v: unknown): Language {
  return typeof v === 'string' && VALID_LANGUAGES.has(v as Language)
    ? (v as Language)
    : 'en';
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

function buildEventSelectionPrompt(
  events: Array<{ id: string; name: string }>,
): string {
  const lines = events.map((e, i) => `${i + 1}. ${e.name}`).join('\n');
  return `Which event are you asking about?\n\n${lines}`;
}

function parseEventSelection(
  text: string,
  events: Array<{ id: string; name: string }>,
): number | null {
  const trimmed = text.trim();

  // Western digits
  const western = parseInt(trimmed, 10);
  if (!isNaN(western) && western >= 1 && western <= events.length) return western - 1;

  // Arabic-Indic digits ١٢٣٤٥٦٧٨٩٠
  const arabicMap: Record<string, string> = {
    '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5',
    '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٠': '0',
  };
  const converted = trimmed.replace(/[٠-٩]/g, (d) => arabicMap[d] ?? d);
  const arabic = parseInt(converted, 10);
  if (!isNaN(arabic) && arabic >= 1 && arabic <= events.length) return arabic - 1;

  // Emoji digits 1️⃣ 2️⃣ etc.
  const emojiMap: Record<string, number> = {
    '1️⃣': 0, '2️⃣': 1, '3️⃣': 2, '4️⃣': 3, '5️⃣': 4,
  };
  if (emojiMap[trimmed] !== undefined) return emojiMap[trimmed]!;

  // Fuzzy name match — must be a FULL-name match or a high-similarity, single
  // unambiguous match. We must NEVER select on one leading token (the previous
  // `lowerText.includes(name.split(' ')[0])` did exactly that, so a follow-up
  // like "what's the difference between them?" containing a common first word
  // silently picked an event and answered the persisted question against it —
  // audit 5.4). The numbered-reply paths above are unchanged.
  const lowerText = trimmed.toLowerCase();

  // 1. Exact name match wins outright.
  const exactIdx = events.findIndex((e) => e.name.toLowerCase() === lowerText);
  if (exactIdx !== -1) return exactIdx;

  // 2. Strong containment: either the reply contains the FULL event name, or the
  //    event name contains the reply AND the reply is specific enough (>= 60% of
  //    the name and >= 4 chars) to be a deliberate choice rather than a shared
  //    token. Only accept if exactly ONE event matches (no ambiguity).
  const matches: number[] = [];
  events.forEach((e, i) => {
    const name = e.name.toLowerCase();
    const replyContainsName = lowerText.includes(name);
    const nameContainsReply =
      name.includes(lowerText) &&
      lowerText.length >= Math.max(4, Math.floor(name.length * 0.6));
    if (replyContainsName || nameContainsReply) matches.push(i);
  });
  if (matches.length === 1) return matches[0]!;

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ensures phone is E.164 (+prefix). Adapters already do this; this is a safety net. */
function normalisePhone(phone: string): string {
  return phone.startsWith('+') ? phone : `+${phone}`;
}

// ─── Customer support flow ────────────────────────────────────────────────────

async function handleCustomerSupportMessage(
  message: InboundTextMessage,
  adapter: WhatsAppAdapter,
  phoneNumberId: string,
): Promise<void> {
  const phone = normalisePhone(message.from_phone_e164);
  const admin = createAdminClient();

  // Step 1: Identify operator via the receiving phone number (from webhook payload).
  let operator = await getOperatorByPhoneNumberId(phoneNumberId);
  console.log('[inbound] operator lookup result', { found: !!operator, phoneNumberId });

  if (!operator) {
    // Fallback for single-tenant deployments where whatsapp_business_phone_number_id
    // has not yet been saved in the operator row (Settings → WhatsApp not saved).
    operator = await getSingleOperatorFallback();
    if (operator) {
      console.warn(
        '[inbound] whatsapp_business_phone_number_id not configured in DB — using single-tenant fallback operator:',
        operator.operator_id,
        '(configure it at Settings → WhatsApp to remove this warning)',
      );
    } else {
      console.error(
        '[inbound] No operator found for phoneNumberId:', phoneNumberId,
        '— set whatsapp_business_phone_number_id on the operator row via Settings → WhatsApp',
      );
      return;
    }
  }

  // Step 1.5: Inbound pre-router — STOP/opt-out + recovery/CRM reply context.
  // Runs before ANY AI classification/generation (audit 5.3): STOP must never
  // be answered by the agent (compliance), and a recovery-completion reply must
  // transition the attempt rather than dropping into the generic agent. If it
  // fully handles the message we owe no further reply.
  const preRoute = await preRouteInbound({
    adapter,
    operatorId: operator.operator_id,
    phone,
    text: message.text,
  });
  if (preRoute.handled) {
    console.log('[inbound] pre-router handled message — not passing to AI', {
      branch: preRoute.branch,
    });
    return;
  }

  // Step 2: Check for a pending event selection from a previous turn.
  // effectiveMessageText starts as the current message but is overridden with
  // the customer's ORIGINAL question when we resolve a multi-event selection.
  // This ensures the agent sees "what time do doors open?" not "1".
  let resolvedEventId: string | null = null;
  let effectiveMessageText = message.text;
  const pendingSelection = await getPendingEventSelection(phone);

  if (pendingSelection) {
    const idx = parseEventSelection(message.text, pendingSelection.events);
    if (idx !== null) {
      const chosen = pendingSelection.events[idx];
      if (chosen) {
        await clearPendingEventSelection(phone);
        resolvedEventId = chosen.id;
        // Re-inject the original question so the KB/agent pipeline answers it,
        // not the "1" / "2" selection reply.
        if (pendingSelection.original_message) {
          effectiveMessageText = pendingSelection.original_message;
        }
        console.log('[inbound] resolved event selection', { event_id: chosen.id, event_name: chosen.name });
        console.log('[inbound] re-processing original message after event selection', { original_message: effectiveMessageText });
      }
    } else {
      // Parse failed. The message is almost always a NEW question rather than a
      // valid selection, and previously it was neither answered nor stored —
      // only the list was re-sent — so the new question was permanently lost
      // (audit 5.5). Persist it as the current original_message (refreshing the
      // TTL) so that when the customer finally picks an event we re-inject THIS
      // question, not the stale one.
      const stored = await setPendingEventSelection(
        phone,
        pendingSelection.events,
        message.text,
      );
      if (!stored) {
        // Same failure mode as the multi-event branch (audit 5.6): if we cannot
        // persist state, do not keep the customer in a broken selection loop.
        // Degrade to a single-turn answer against the first offered event.
        console.error('[inbound] session-state update failed on invalid selection — degrading to single-turn answer', {
          phone,
        });
        resolvedEventId = pendingSelection.events[0]!.id;
        // effectiveMessageText stays as the current (new) message; fall through.
      } else {
        const reSendResult = await adapter.sendText({
          to_phone_e164: phone,
          text: buildEventSelectionPrompt(pendingSelection.events),
        });
        console.log('[inbound] updated original_message + re-sent selection prompt (invalid choice)', {
          success: reSendResult.success,
          error: reSendResult.error ?? null,
        });
        return;
      }
    }
  }

  // Step 3: Resolve event if not already set from pending selection.
  let eventRecentlyEnded = false;
  if (!resolvedEventId) {
    const routeResult = await resolveEventForOperator(operator.operator_id);
    console.log('[inbound] event routing result', { type: routeResult.type });

    if (routeResult.type === 'none') {
      console.warn('[inbound] no active events for operator:', operator.operator_id,
        '— ensure at least one event has status=live');
      const noEventsSendResult = await adapter.sendText({
        to_phone_e164: phone,
        text: 'There are no active events at the moment.',
      });
      console.log('[inbound] sent "no active events" reply', {
        success: noEventsSendResult.success,
        error: noEventsSendResult.error ?? null,
      });
      return;
    }

    if (routeResult.type === 'multiple') {
      // Store the original question alongside the event list so it can be
      // re-injected on the next turn once the customer picks an event.
      const stored = await setPendingEventSelection(phone, routeResult.events, message.text);
      if (stored) {
        const selectionSendResult = await adapter.sendText({
          to_phone_e164: phone,
          text: buildEventSelectionPrompt(routeResult.events),
        });
        console.log('[inbound] sent event-selection prompt', {
          success: selectionSendResult.success,
          error: selectionSendResult.error ?? null,
        });
        return;
      }
      // Session-state write failed. Sending the numbered prompt now would set up
      // the exact migration-0029 bug via the failure path: the customer's "1"
      // reply would arrive with no stored state and be persisted as
      // original_message:"1". Skip the prompt and degrade to a single-turn
      // answer against the first active event instead (audit 5.6).
      console.error('[inbound] session-state write failed — skipping numbered prompt, degrading to single-turn answer', {
        phone,
        event_count: routeResult.events.length,
      });
      resolvedEventId = routeResult.events[0]!.id;
      // effectiveMessageText stays as the current message; fall through to Step 4.
    } else {
      resolvedEventId = routeResult.event_id;
      eventRecentlyEnded = routeResult.recently_ended;
    }
  }

  console.log('[inbound] resolved event_id:', resolvedEventId);

  // Step 4: Get or create the customer conversation.
  const conv = await getOrCreateWhatsAppConversation({
    event_id: resolvedEventId,
    operator_id: operator.operator_id,
    phone_e164: phone,
    wa_message_id: message.wamid,
    language: 'en',
  });

  // Step 5: Fetch event config (needed by the state machine).
  const { data: eventRow } = await admin
    .from('events')
    .select('config, operator_id, timezone, end_date, is_demo')
    .eq('id', resolvedEventId)
    .single();

  if (!eventRow) {
    throw new Error(`Event ${resolvedEventId} not found`);
  }

  const rawEventRow = eventRow as Record<string, unknown>;
  const eventConfig: EventConfig = {
    ...(rawEventRow.config as EventConfig),
    timezone: rawEventRow.timezone as string | undefined,
    // Inject the top-level end_date (authoritative for existing events whose
    // persisted config predates event_end_date_iso) so the generator's "ended"
    // branch is correct for multi-day events (audit 4.7).
    event_end_date_iso: (rawEventRow.end_date as string | null) ?? undefined,
    event_recently_ended: eventRecentlyEnded,
  };

  // Step 6: Hydrate matched order if conversation has one.
  let matchedOrder: OrderContext | null = null;
  if (conv.matched_order_id) {
    const { data: orderRow } = await admin
      .from('orders')
      .select(
        'id, order_id, customer_phone_e164, customer_name, ticket_type, quantity, amount_paid, currency, status, vip_flag, transfer_eligible',
      )
      .eq('id', conv.matched_order_id)
      .single();
    if (orderRow) matchedOrder = rowToOrderContext(orderRow as OrderRow);
  }

  // Build the conversation snapshot for the state machine.
  const snapshot: ConversationSnapshot = {
    conversation_id: conv.conversation_id,
    event_id: resolvedEventId,
    customer_phone_e164: phone,
    state: conv.state,
    matched_order: matchedOrder,
    classified_reason: null,
    alternative_offered: null,
    language: conv.language,
    refund_case_id: null,
    message_history: [
      ...conv.history,
      {
        role: 'user',
        text: effectiveMessageText,
        created_at: new Date().toISOString(),
      },
    ],
    consecutive_no_progress_turns: conv.consecutive_no_progress_turns,
  };

  // Step 6: Run the agent state machine.
  // We pass the admin client as the supabase parameter — the state machine
  // uses it for KB retrieval and order lookup, both of which work without RLS.
  const result = await runAgent({
    supabase: admin,
    snapshot,
    message: effectiveMessageText,
    eventConfig,
    operatorId: operator.operator_id,
  });

  const newLanguage = result.classification
    ? coerceLanguage(result.classification.language)
    : conv.language;

  // Step 7: Persist the user message then the agent reply.
  const { error: userMsgError } = await admin.from('messages').insert({
    conversation_id: conv.conversation_id,
    role: 'user',
    text: effectiveMessageText,
  });
  if (userMsgError) {
    console.error('[inbound] user message insert failed', {
      conversation_id: conv.conversation_id,
      error: userMsgError.message,
    });
  }

  const { error: agentMsgError } = await admin.from('messages').insert({
    conversation_id: conv.conversation_id,
    role: 'agent',
    text: result.reply_text,
    classified_intent: result.classified_intent,
    cited_section_ids:
      result.cited_section_ids.length > 0 ? result.cited_section_ids : null,
    source_section: result.source_section ?? null,
    deflection_offered: result.deflection_offer != null,
  });
  if (agentMsgError) {
    console.error('[inbound] agent message insert failed', {
      conversation_id: conv.conversation_id,
      error: agentMsgError.message,
    });
  }

  // Update conversation state.
  const nextNoProgress =
    result.new_state === 'order_lookup'
      ? conv.consecutive_no_progress_turns + 1
      : 0;

  const { data: convUpdated, error: convUpdateError } = await admin
    .from('conversations')
    .update({
      state: result.new_state,
      language: newLanguage,
      matched_order_id: result.matched_order_id ?? conv.matched_order_id,
      consecutive_no_progress_turns: nextNoProgress,
      closed_at:
        result.new_state === 'escalation_triggered' ||
        result.new_state === 'session_closed'
          ? new Date().toISOString()
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conv.conversation_id)
    .select('id');
  if (convUpdateError || !convUpdated || convUpdated.length === 0) {
    // Non-fatal (we still owe the customer a reply) but must not be silent —
    // a failed state update leaves the conversation state machine stuck.
    console.error('[inbound] conversation state update failed', {
      conversation_id: conv.conversation_id,
      new_state: result.new_state,
      error: convUpdateError?.message ?? 'zero rows affected',
    });
  }

  // Open an escalation row if the agent escalated.
  let escalationInsertFailed = false;
  if (result.escalation) {
    const { data: newEscalation, error: escalationError } = await admin
      .from('escalations')
      .insert({
        conversation_id: conv.conversation_id,
        event_id: resolvedEventId,
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
        { conversation_id: conv.conversation_id },
      );
      escalationInsertFailed = true;
      // Fall through — we still owe the customer a reply, and the conversation
      // state has already been updated to 'escalation_triggered' above.
    } else {
      // Notify escalation contacts via WhatsApp (best-effort, non-fatal).
      try {
        await notifyEscalationContacts({
          event: { ...rawEventRow, id: resolvedEventId },
          escalation_id: newEscalation?.id ?? 'unknown',
          customer_phone: phone,
          trigger_message: effectiveMessageText,
          intent: result.classified_intent ?? result.escalation.reason,
        });
      } catch (notifyErr) {
        console.warn('[whatsapp/inbound] escalation notification failed (non-fatal):', notifyErr);
      }
    }
  }

  // Audit log (non-fatal — writeAuditLog checks and logs its own error).
  await writeAuditLog({
    operator_id: operator.operator_id,
    event_id: resolvedEventId,
    actor_type: 'agent',
    action: result.escalation ? 'agent.escalated' : 'agent.replied',
    entity_type: 'conversation',
    entity_id: conv.conversation_id,
    metadata: {
      channel: 'whatsapp',
      classified_intent: result.classified_intent,
      cited_section_ids: result.cited_section_ids,
      escalation_reason: result.escalation?.reason ?? null,
      new_state: result.new_state,
      is_new_conversation: conv.is_new,
    },
  });

  // Step 8: Send the reply.
  // If the escalation row failed to insert above, fall back to a safe message
  // so the customer is never left without an acknowledgement.
  const outboundText = escalationInsertFailed
    ? 'Your request has been escalated. Our team will follow up shortly.'
    : result.reply_text;

  const finalSendResult = await adapter.sendText({
    to_phone_e164: phone,
    text: outboundText,
  });
  console.log('[inbound] customer reply send result', {
    success: finalSendResult.success,
    error: finalSendResult.error ?? null,
  });
}

// ─── Per-message handler ──────────────────────────────────────────────────────

async function handleInboundMessage(
  message: InboundMessage,
  adapter: WhatsAppAdapter,
  phoneNumberId: string,
): Promise<void> {
  const admin = createAdminClient();

  // ── Idempotency: drop Meta webhook redeliveries ───────────────────────────
  // Meta delivers webhooks at-least-once. An insert-first dedup on the wamid
  // prevents double classifier/generator spend, duplicate `messages` rows, and
  // double replies to the customer. Covers every message type (text, button,
  // unsupported). Race-safe via the unique PRIMARY KEY (see message-dedup.ts).
  const dedup = await markMessageProcessed(message.wamid);
  if (dedup === 'duplicate') {
    console.log('[inbound] duplicate message dropped', {
      wamid: message.wamid,
      type: message.type,
    });
    return;
  }

  // ── Text messages ─────────────────────────────────────────────────────────
  if (message.type === 'text') {
    const fromPhone = normalisePhone(message.from_phone_e164);
    console.log('[inbound] message received', { type: message.type, from: fromPhone });

    // 1. Resolve the operator that owns THIS WhatsApp number first, so the
    //    promoter lookup can be scoped by (operator_id, phone_e164) — the actual
    //    UNIQUE constraint on promoters. Without this scope, a phone whitelisted
    //    by two operators makes .maybeSingle() error on multiple rows → null →
    //    the promoter silently falls into the customer-support flow; and a
    //    promoter of operator A texting operator B's number would otherwise
    //    enter A's change-management flow (audit 4.1). Mirrors the resolution in
    //    handleCustomerSupportMessage (which re-resolves for the customer path).
    let promoterOperator = await getOperatorByPhoneNumberId(phoneNumberId);
    if (!promoterOperator) promoterOperator = await getSingleOperatorFallback();

    let promoterData:
      | { id: string; operator_id: string; event_id: string | null; preferred_language: string }
      | null = null;
    if (promoterOperator) {
      const { data, error: promoterLookupError } = await admin
        .from('promoters')
        .select('id, operator_id, event_id, preferred_language')
        .eq('operator_id', promoterOperator.operator_id)
        .eq('phone_e164', fromPhone)
        .eq('is_active', true)
        .maybeSingle();
      if (promoterLookupError) {
        console.error('[inbound] promoter lookup failed', {
          operator_id: promoterOperator.operator_id,
          from: fromPhone,
          error: promoterLookupError.message,
        });
      }
      promoterData =
        (data as { id: string; operator_id: string; event_id: string | null; preferred_language: string } | null) ??
        null;
    } else {
      console.warn('[inbound] promoter lookup skipped — no operator resolved for phoneNumberId', { phoneNumberId });
    }

    console.log('[inbound] promoter lookup result', { found: !!promoterData, event_id: promoterData?.event_id ?? null });

    // ── Promoter flow (unchanged below this point) ──────────────────────────
    if (promoterData) {
      const promoter = promoterData;

      if (!promoter.event_id) {
        await adapter.sendText({
          to_phone_e164: fromPhone,
          text: 'Your account is not linked to an event. Contact the operator.',
        });
        return;
      }

      // Fetch event row.
      const { data: eventData } = await admin
        .from('events')
        .select('*')
        .eq('id', promoter.event_id)
        .single();

      if (!eventData) {
        await adapter.sendText({
          to_phone_e164: fromPhone,
          text: 'The linked event could not be found. Contact the operator.',
        });
        return;
      }

      const eventRow = eventData as Record<string, unknown>;

      // Extract structured changes via Haiku.
      const language = promoter.preferred_language as 'en' | 'ar' | 'ru';
      const extraction = await extractChanges(message.text, eventRow, language);
      console.log('[inbound] extraction result', { changes: extraction.changes.length, ambiguous: extraction.ambiguous.length });

      // Fire-and-forget usage tracking (non-blocking).
      void trackUsage({
        operator_id: promoter.operator_id,
        event_id: promoter.event_id ?? undefined,
        event_type: 'change_extraction',
        model: 'claude-haiku-4-5-20251001',
        input_tokens: extraction.input_tokens,
        output_tokens: extraction.output_tokens,
      });

      // Generate diff against current event state.
      const diff = generateDiff(extraction.changes, eventRow);
      console.log('[inbound] diff result', { meaningful: diff.meaningful.length, has_errors: diff.has_errors });

      // If nothing actionable, reply with a summary and stop.
      if (diff.meaningful.length === 0) {
        let replyText = 'No changes detected.';
        if (extraction.ambiguous.length > 0) {
          const ambigList = extraction.ambiguous
            .map((a) => `"${a.raw_text}" (${a.reason})`)
            .join('; ');
          replyText = `Could not parse: ${ambigList}. Please resend with clearer wording.`;
        }
        await adapter.sendText({ to_phone_e164: fromPhone, text: replyText });
        return;
      }

      // Persist the pending change (supersedes any prior open row).
      const pendingChange = await createPendingChange({
        operator_id: promoter.operator_id,
        event_id: promoter.event_id,
        promoter_id: promoter.id,
        inbound_wamid: message.wamid,
        inbound_text: message.text,
        extraction,
        diff,
      });

      // Build confirmation interactive message body.
      const changeLines = diff.meaningful
        .map(
          (item) =>
            `- ${formatFieldLabel(item.field)}: ${formatValue(item.field, item.current_value)} → ${formatValue(item.field, item.coerced_value)}`,
        )
        .join('\n');

      const ambigBlock =
        extraction.ambiguous.length > 0
          ? `\n⚠️ Could not parse: ${extraction.ambiguous.map((a) => a.raw_text).join(', ')}`
          : '';

      const eventName = String(eventRow.name ?? 'your event');
      const bodyText =
        `Here's what I'll update for ${eventName}:\n\n${changeLines}${ambigBlock}\n\nReply to confirm or cancel.`;

      // Send interactive message with Confirm / Cancel buttons.
      const sendResult = await adapter.sendInteractive({
        to_phone_e164: fromPhone,
        body_text: bodyText,
        buttons: [
          { id: `confirm_pc_${pendingChange.id}`, title: 'Confirm' },
          { id: `cancel_pc_${pendingChange.id}`, title: 'Cancel' },
        ],
      });

      console.log('[inbound] send interactive result', { success: sendResult.success, error: sendResult.error ?? null });

      // Record send outcome on the pending_changes row.
      if (sendResult.success && sendResult.wamid) {
        await updateConfirmationWamid(pendingChange.id, sendResult.wamid);
      } else {
        await updateConfirmationSendError(
          pendingChange.id,
          sendResult.error ?? 'Unknown send error',
        );
      }
      return;
    }

    // ── Customer support flow ────────────────────────────────────────────────
    try {
      await handleCustomerSupportMessage(message, adapter, phoneNumberId);
    } catch (err) {
      console.error('[whatsapp/inbound] customer support error:', err);
      await adapter.sendText({
        to_phone_e164: message.from_phone_e164,
        text: 'Sorry, something went wrong. Please try again.',
      });
    }
    return;
  }

  // ── Button replies: confirm or cancel a pending diff ──────────────────────
  if (message.type === 'button_reply') {
    const fromPhone = normalisePhone(message.from_phone_e164);
    console.log('[inbound] message received', { type: message.type, from: fromPhone });

    // 1. Resolve the pending change from the message we sent.
    let pendingChange: PendingChange | null = null;
    try {
      pendingChange = await findPendingByConfirmationWamid(message.context_wamid);
    } catch (lookupErr) {
      console.log('[inbound] button-reply: pending-change lookup failed — ignoring', {
        context_wamid: message.context_wamid,
        error: lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
      });
      return;
    }
    if (!pendingChange) {
      console.log('[inbound] button-reply: no pending change for context_wamid — ignoring', {
        context_wamid: message.context_wamid,
      });
      return;
    }

    // 2. Verify the sender is the promoter who originated the request.
    const { data: promoterData, error: promoterLookupError } = await admin
      .from('promoters')
      .select('id, phone_e164')
      .eq('id', pendingChange.promoter_id)
      .maybeSingle();

    if (promoterLookupError || !promoterData) {
      console.log('[inbound] button-reply: promoter not found for pending change — ignoring', {
        promoter_id: pendingChange.promoter_id,
        error: promoterLookupError?.message ?? null,
      });
      return;
    }
    const promoter = promoterData as { id: string; phone_e164: string };
    // Normalise BOTH sides — a raw stored value with a leading '+' or spaces
    // must not fail an exact-match against the normalised sender (audit 6.9).
    if (normalisePhone(promoter.phone_e164) !== fromPhone) {
      console.log('[inbound] button-reply: sender does not match promoter phone — ignoring', {
        pending_change_id: pendingChange.id,
      });
      return;
    }

    // 3. Handle "Confirm" reply.
    if (message.button_id.startsWith('confirm_pc_')) {
      const result = await confirmPendingChange({
        pending_change_id: pendingChange.id,
        actor_user_id: null,
        actor_promoter_id: promoter.id,
        via: 'whatsapp',
      });

      if (result.status === 'confirmed') {
        const { data: eventData } = await admin
          .from('events')
          .select('name')
          .eq('id', pendingChange.event_id)
          .maybeSingle();
        const eventName = eventData
          ? String((eventData as Record<string, unknown>).name ?? 'your event')
          : 'your event';
        const count = pendingChange.diff_items.filter(
          (i) => !i.is_noop && i.coercion_error === null && !i.tier_not_found,
        ).length;
        await adapter.sendText({
          to_phone_e164: fromPhone,
          text: `✓ Done. ${count} change(s) applied to ${eventName}.`,
        });
      } else if (result.status === 'race_lost') {
        await adapter.sendText({
          to_phone_e164: fromPhone,
          text: 'Already processed.',
        });
      } else if (result.status === 'expired') {
        await adapter.sendText({
          to_phone_e164: fromPhone,
          text: 'This change request has expired. Please resend.',
        });
      }
      return;
    }

    // 4. Handle "Cancel" reply.
    if (message.button_id.startsWith('cancel_pc_')) {
      await cancelPendingChange({
        pending_change_id: pendingChange.id,
        actor_user_id: null,
        actor_promoter_id: promoter.id,
        via: 'whatsapp',
      });
      const cancelSend = await adapter.sendText({
        to_phone_e164: fromPhone,
        text: 'Cancelled.',
      });
      console.log('[inbound] button-reply: cancelled', {
        pending_change_id: pendingChange.id,
        send_success: cancelSend.success,
      });
      return;
    }

    // 5. Unrecognised button id — neither confirm nor cancel.
    console.log('[inbound] button-reply: unrecognised button_id — ignoring', {
      button_id: message.button_id,
    });
    return;
  }

  // ── Unsupported message types ─────────────────────────────────────────────
  if (message.type === 'unsupported') {
    await adapter.sendText({
      to_phone_e164: normalisePhone(message.from_phone_e164),
      text: 'Sorry, I can only process text messages.',
    });
  }
}

// ─── Extract receiving phone_number_id from Meta webhook payload ──────────────

function extractPhoneNumberId(body: unknown): string {
  try {
    const b = body as Record<string, unknown>;
    const entry = (b.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
    const changes = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined;
    const value = changes?.value as Record<string, unknown> | undefined;
    const metadata = value?.metadata as Record<string, unknown> | undefined;
    const id = metadata?.phone_number_id as string | undefined;
    if (id) return id;
  } catch { /* ignore */ }
  // Trim the env fallback so a trailing newline in META_PHONE_NUMBER_ID cannot
  // corrupt the operator lookup (carry-over from the 2026-07-15 env-var sweep).
  return optionalEnv('META_PHONE_NUMBER_ID') ?? '';
}

// ─── POST — Inbound message receiver ─────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return Response.json({ status: 'ignored' }, { status: 200 });
    }

    let adapter: ReturnType<typeof createWhatsAppAdapter>;
    try {
      adapter = createWhatsAppAdapter();
    } catch (err) {
      console.error('[whatsapp/inbound] adapter init failed:', err);
      return Response.json({ status: 'ignored' }, { status: 200 });
    }

    try {
      adapter.verifySignature(rawBody, Object.fromEntries(req.headers));
    } catch (sigErr) {
      console.error('[inbound] signature verification failed — request ignored:', sigErr);
      return Response.json({ status: 'ignored' }, { status: 200 });
    }

    const messages: InboundMessage[] = adapter.parseInbound(body);
    const phoneNumberId = extractPhoneNumberId(body);

    for (const message of messages) {
      try {
        await handleInboundMessage(message, adapter, phoneNumberId);
      } catch (err) {
        console.error(
          '[whatsapp/inbound] message processing failed:',
          message.wamid,
          err,
        );
      }
    }

    return Response.json({ status: 'ok', count: messages.length }, { status: 200 });
  } catch (err) {
    console.error('[whatsapp/inbound] unhandled error:', err);
    return Response.json({ status: 'ignored' }, { status: 200 });
  }
}
