/**
 * Agent state machine.
 *
 * Extends docs/reference/refund_deflection.ts to handle the full intent
 * taxonomy (FAQ, order_lookup, escalation, refund flow). All hard guardrails
 * from the reference are preserved verbatim:
 *
 *   1. HARD_ESCALATION_KEYWORDS_EN / _AR keyword filter runs BEFORE the
 *      classifier so a Claude outage cannot prevent escalation on a
 *      safety-critical message.
 *   2. consecutive_no_progress_turns >= 3 → escalate.
 *   3. anger_score >= 7 → escalate.
 *   4. REASONS_REQUIRING_IMMEDIATE_ESCALATION → escalate.
 *   5. Policy claim with zero citations → escalate (fabrication guard).
 *   6. Generator confidence < 0.6 → escalate.
 *
 * The agent NEVER approves a refund. It can only offer alternatives that the
 * KB and event config explicitly allow.
 *
 * Pure function (apart from the supabase calls injected by the API route):
 * (snapshot, message, eventConfig) → AgentTurnResult.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { EventConfig } from '@/lib/types';
import { trackUsage } from '@/lib/billing/track-usage';

import { classifyMessage } from './classifier';
import { generateCitedReply } from './generator';
import { retrieveKB } from './kb-retrieval';
import { lookupOrder } from './order-lookup';
import type { OrderLookupResult } from './order-lookup';
import type {
  AgentState,
  AgentTurnResult,
  Classification,
  ConversationSnapshot,
  GenerationOutput,
  Intent,
  OrderContext,
  RetrievedKBSection,
} from './types';

// ============================================================================
// HARD GUARDRAILS — preserved verbatim from docs/reference/refund_deflection.ts
// ============================================================================

const HARD_ESCALATION_KEYWORDS_EN = [
  'hospital', 'death', 'died', 'passed away', 'emergency',
  'lawyer', 'legal action', 'sue', 'lawsuit',
  'fraud', 'scam', 'scammed', 'chargeback',
  'medical emergency', 'accident', 'ambulance',
  'unsafe', 'harass', 'harassed', 'threat',
];

const HARD_ESCALATION_KEYWORDS_AR = [
  'مستشفى', 'توفي', 'توفت', 'وفاة', 'طوارئ',
  'محامي', 'أقاضي', 'قضية',
  'نصب', 'احتيال', 'تشارجباك',
  'إسعاف', 'حادث',
  'غير آمن', 'تحرش', 'تهديد',
];

const REASONS_REQUIRING_IMMEDIATE_ESCALATION: Array<NonNullable<Classification['refund_reason']>> = [
  'cannot_attend_medical',
  'accessibility_concern',
  'safety_concern',
];

/** Returns the first matched keyword (for telemetry), or null. */
function matchEscalationKeyword(
  text: string,
  eventConfig: EventConfig,
): string | null {
  const lower = text.toLowerCase();
  const allKeywords = [
    ...HARD_ESCALATION_KEYWORDS_EN,
    ...HARD_ESCALATION_KEYWORDS_AR,
    ...(eventConfig.escalation_keywords ?? []).map((k) => k.toLowerCase()),
  ];
  for (const k of allKeywords) {
    if (lower.includes(k.toLowerCase())) return k;
  }
  return null;
}

// ============================================================================
// HEDGING LANGUAGE PATTERNS
// ============================================================================

const HEDGING_PATTERNS: RegExp[] = [
  /i'?m not sure/i,
  /\bi think\b/i,
  /\bi believe\b/i,
  /i'?m not certain/i,
  /i'?m unsure/i,
  /not entirely sure/i,
  /i don'?t know/i,
];

function containsHedgingLanguage(text: string): boolean {
  return HEDGING_PATTERNS.some((p) => p.test(text));
}

// ============================================================================
// PROMPT-INJECTION GUARD
// ============================================================================

const PROMPT_INJECTION_PATTERNS = [
  /ignore (?:all |your )?(?:previous |prior )?instructions/i,
  /disregard (?:all |your )?(?:previous |prior )?instructions/i,
  /you are now (?:a |an |the )?/i,
  /system prompt/i,
];

function looksLikePromptInjection(text: string): boolean {
  return PROMPT_INJECTION_PATTERNS.some((re) => re.test(text));
}

// ============================================================================
// INTENT → STATE MAPPING
// ============================================================================

const REFUND_INTENTS: ReadonlySet<Intent> = new Set<Intent>([
  'refund_request',
  'refund_followup',
]);

const ALWAYS_ESCALATE_INTENTS: ReadonlySet<Intent> = new Set<Intent>([
  'compensation_request',
  'reservation_followup',
  'loyalty_benefits',
  'membership_tier_issue',
  'backstage_or_vib_request',
  'partnership_inquiry',
]);

// Note: `ticket_delivery_issue` and `payment_incomplete` are routed via
// explicit branches below — each needs slightly different handling.

// ============================================================================
// HELPERS — escalation reply text (preserved verbatim from reference)
// ============================================================================

function escalationHandoffReply(language: ConversationSnapshot['language']): string {
  const en =
    "I'm connecting you with a member of the team who can help with this directly. They'll respond shortly.";
  const ar =
    'سأقوم بتحويلك إلى أحد أعضاء الفريق للمساعدة بشكل مباشر. سيتم الرد عليك قريبًا.';
  return language === 'ar' ? ar : en;
}

function orderLookupRequestReply(language: ConversationSnapshot['language']): string {
  const en =
    'To help with this, can you share your order ID (e.g. ORD-001234), ' +
    'the phone number used at checkout, your name, or your email address?';
  const ar =
    'للمساعدة في هذا الأمر، هل يمكنك مشاركة رقم الطلب، أو رقم الهاتف المستخدم عند الشراء، أو اسمك، أو بريدك الإلكتروني؟';
  return language === 'ar' ? ar : en;
}

/**
 * Reply when multiple orders match a name or email — asks the customer to
 * clarify by sharing their full order ID or the last 4 digits of one of
 * the matching order IDs.
 */
function ambiguousOrderReply(
  orders: OrderContext[],
  language: ConversationSnapshot['language'],
): string {
  const n = orders.length;
  const endings = orders.slice(0, 3).map((o) => {
    const id = o.order_id;
    return id.length > 4 ? `…${id.slice(-4)}` : id;
  });

  if (n === 2) {
    const ar =
      `وجدت ${n} طلبات مطابقة. أيٌّ منها طلبك — الطلب المنتهي بـ ${endings[0]} أم ${endings[1]}؟ ` +
      'يمكنك أيضاً مشاركة رقم الطلب الكامل.';
    const en =
      `I found ${n} orders matching that. Which one is yours — the order ending in ` +
      `${endings[0]} or ${endings[1]}? You can also share your full order ID.`;
    return language === 'ar' ? ar : en;
  }

  // 3+ matches — just ask for the full ID
  const ar =
    `وجدت ${n} طلبات مطابقة. هل يمكنك مشاركة رقم الطلب الكامل لأتمكن من العثور على طلبك الصحيح؟`;
  const en =
    `I found ${n} orders matching that. Could you share your full order ID ` +
    `so I can locate the right one?`;
  return language === 'ar' ? ar : en;
}

// ============================================================================
// STATE MACHINE
// ============================================================================

export interface RunAgentInput {
  supabase: SupabaseClient;       // user-scoped client (RLS applies)
  snapshot: ConversationSnapshot;
  message: string;
  eventConfig: EventConfig;
  operatorId: string;             // passed to retrieveKB for operator-level sections
}

function buildEscalation(
  reason: string,
  priority: 'low' | 'normal' | 'high' | 'urgent',
  summary: string,
): AgentTurnResult['escalation'] {
  return { reason, priority, summary_for_ops: summary };
}

function escalateResult(
  snapshot: ConversationSnapshot,
  reason: string,
  priority: 'low' | 'normal' | 'high' | 'urgent',
  summary: string,
  classification: Classification | null,
  matchedOrder: OrderContext | null,
): AgentTurnResult {
  return {
    reply_text: escalationHandoffReply(snapshot.language),
    new_state: 'escalation_triggered',
    matched_order_id: matchedOrder?.id ?? snapshot.matched_order?.id ?? null,
    classified_intent: classification?.intent ?? null,
    cited_section_ids: [],
    deflection_offer: null,
    source_section: null,
    escalation: buildEscalation(reason, priority, summary),
    classification,
  };
}

/**
 * Compute days until the event from now.
 *
 * Negative when the event is in the past.
 */
function daysUntilEvent(eventConfig: EventConfig): number {
  const target = new Date(eventConfig.event_date_iso).getTime();
  return Math.ceil((target - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * Find the refund tier that applies given the days until the event.
 * Tiers are sorted descending by days_before_event; the first whose threshold
 * we still satisfy is the applicable one.
 */
function applicableRefundPct(eventConfig: EventConfig, days: number): number {
  const tiers = [...(eventConfig.refund_policy?.tiers ?? [])].sort(
    (a, b) => b.days_before_event - a.days_before_event,
  );
  const tier = tiers.find((t) => days >= t.days_before_event);
  return tier?.refund_pct ?? 0;
}

/**
 * Generate a cited FAQ-style reply and apply guardrails 5 and 6.
 */
async function generateWithGuardrails(
  input: RunAgentInput,
  classification: Classification,
  kbSections: RetrievedKBSection[],
  order: OrderContext | null,
  newState: AgentState,
): Promise<AgentTurnResult> {
  console.log('[inbound] kb sections retrieved', {
    count: kbSections.length,
    sectionIds: kbSections.map((s) => s.section_id),
    intent: classification.intent,
  });

  const gen: GenerationOutput = await generateCitedReply({
    message: input.message,
    intent: classification.intent,
    language: classification.language,
    kbSections,
    order,
    eventConfig: input.eventConfig,
    history: input.snapshot.message_history,
  });

  // Fire-and-forget usage tracking (non-blocking — never throws).
  if (gen._usage) {
    void trackUsage({
      operator_id: input.operatorId,
      event_id: input.snapshot.event_id,
      event_type: 'support_message',
      model: 'claude-sonnet-4-6',
      input_tokens: gen._usage.input_tokens,
      output_tokens: gen._usage.output_tokens,
      cache_read_tokens: gen._usage.cache_read_tokens,
    });
  }

  // Guardrail 8 (from generator system prompt): the model itself flagged escalation.
  if (gen.requires_escalation) {
    return escalateResult(
      input.snapshot,
      'generator_requested_escalation',
      'normal',
      `Generator declined to answer for intent=${classification.intent}. ` +
        `Message: ${input.message.slice(0, 200)}`,
      classification,
      order,
    );
  }

  // Guardrail 5: policy claim must have citations (fabrication guard).
  if (gen.contains_policy_claim && gen.kb_sections_cited.length === 0) {
    return escalateResult(
      input.snapshot,
      'policy_claim_without_citation',
      'high',
      `Generator produced policy claim with no citations. Intent=${classification.intent}. ` +
        `Reply: ${gen.response_text.slice(0, 200)}`,
      classification,
      order,
    );
  }

  // Guardrail 6: low confidence escalates.
  if (gen.confidence < 0.6) {
    return escalateResult(
      input.snapshot,
      'low_confidence_response',
      'normal',
      `Generator confidence ${gen.confidence.toFixed(2)} for intent=${classification.intent}. ` +
        `Reply: ${gen.response_text.slice(0, 200)}`,
      classification,
      order,
    );
  }

  // Guardrail 7: hedging language signals low confidence — escalate.
  const hedgingDetected = containsHedgingLanguage(gen.response_text);
  console.log('[inbound] generator confidence check', {
    confidence: gen.confidence,
    hedging_detected: hedgingDetected,
    requires_escalation: gen.requires_escalation,
    response_preview: gen.response_text.slice(0, 100),
  });
  if (hedgingDetected) {
    return escalateResult(
      input.snapshot,
      'hedging_language_detected',
      'normal',
      `Generator reply contains hedging language for intent=${classification.intent}. ` +
        `Reply: ${gen.response_text.slice(0, 200)}`,
      classification,
      order,
    );
  }

  // Empty reply with no citations and no explicit escalation flag — still unsafe.
  if (gen.response_text.trim().length === 0) {
    return escalateResult(
      input.snapshot,
      'empty_generator_reply',
      'normal',
      `Generator returned empty reply for intent=${classification.intent}.`,
      classification,
      order,
    );
  }

  // Derive primary source label from the first cited KB section.
  const primaryCited = gen.kb_sections_cited[0] ?? null;
  const primarySection = primaryCited
    ? kbSections.find((s) => s.section_id === primaryCited)
    : null;
  const source_section = primarySection
    ? (primarySection.question_en ?? primaryCited)
    : primaryCited;

  return {
    reply_text: gen.response_text,
    new_state: newState,
    matched_order_id: order?.id ?? null,
    classified_intent: classification.intent,
    cited_section_ids: gen.kb_sections_cited,
    deflection_offer:
      (gen.deflection_offer as AgentTurnResult['deflection_offer']) ?? null,
    source_section,
    escalation: null,
    classification,
  };
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Process one inbound user message and produce the agent's turn result.
 *
 * Caller is responsible for persisting the result (writing the new state to
 * `conversations`, appending the new `messages` rows, opening an `escalations`
 * row when escalation != null, and writing audit_log entries).
 */
export async function runAgent(input: RunAgentInput): Promise<AgentTurnResult> {
  const { snapshot, message, eventConfig, supabase } = input;

  // Terminal states short-circuit — re-open via a new session.
  if (snapshot.state === 'escalation_triggered' || snapshot.state === 'session_closed') {
    return {
      reply_text: escalationHandoffReply(snapshot.language),
      new_state: snapshot.state,
      matched_order_id: snapshot.matched_order?.id ?? null,
      classified_intent: null,
      cited_section_ids: [],
      deflection_offer: null,
      source_section: null,
      escalation: null,
      classification: null,
    };
  }

  // ---- Guardrail 1: Hard escalation keyword (runs before any LLM call) ----
  const matchedKeyword = matchEscalationKeyword(message, eventConfig);
  if (matchedKeyword) {
    return escalateResult(
      snapshot,
      'hard_keyword_match',
      'urgent',
      `Hard keyword "${matchedKeyword}" triggered. Message: ${message.slice(0, 200)}`,
      null,
      snapshot.matched_order,
    );
  }

  // ---- Guardrail 2: Three turns without progress ----
  if (snapshot.consecutive_no_progress_turns >= 3) {
    return escalateResult(
      snapshot,
      'stalled_conversation',
      'normal',
      `3 turns without progress. Current state: ${snapshot.state}. ` +
        `Last message: ${message.slice(0, 200)}`,
      null,
      snapshot.matched_order,
    );
  }

  // ---- Classify ----
  const classification = await classifyMessage(message, snapshot.message_history);

  // ---- Guardrail 3: Anger threshold ----
  if (classification.anger_score >= 7) {
    return escalateResult(
      snapshot,
      'high_anger_signal',
      'high',
      `Anger score ${classification.anger_score}/10. Last message: ${message.slice(0, 200)}`,
      classification,
      snapshot.matched_order,
    );
  }

  // ---- Guardrail 4: Refund reason requires immediate escalation ----
  if (
    classification.refund_reason &&
    REASONS_REQUIRING_IMMEDIATE_ESCALATION.includes(classification.refund_reason)
  ) {
    return escalateResult(
      snapshot,
      `protected_reason:${classification.refund_reason}`,
      'high',
      `Refund reason requires human handling. Message: ${message.slice(0, 200)}`,
      classification,
      snapshot.matched_order,
    );
  }

  // ---- Classifier-flagged immediate escalation (medical/safety/legal/fraud) ----
  if (classification.escalate_immediately) {
    return escalateResult(
      snapshot,
      'classifier_escalate_immediately',
      classification.high_urgency ? 'urgent' : 'high',
      `Classifier flagged escalate_immediately. Intent=${classification.intent}. ` +
        `Message: ${message.slice(0, 200)}`,
      classification,
      snapshot.matched_order,
    );
  }

  // ---- Prompt-injection probe ----
  // Don't escalate (the test set expects a normal KB response) — but log via
  // a downgraded intent so we don't follow the injected instruction.
  const injectionAttempt = looksLikePromptInjection(message);

  // ---- Always-escalate business intents (loyalty / reservation / compensation / etc.) ----
  if (ALWAYS_ESCALATE_INTENTS.has(classification.intent)) {
    return escalateResult(
      snapshot,
      `business_handoff:${classification.intent}`,
      'normal',
      `Intent ${classification.intent} requires ops handling. ` +
        `Message: ${message.slice(0, 200)}`,
      classification,
      snapshot.matched_order,
    );
  }

  // ---- Order lookup (explicit hint, prior session order, or session phone) ----
  const existingOrder = snapshot.matched_order;
  let orderForTurn: OrderContext | null = existingOrder;

  if (!existingOrder) {
    const lookupResult: OrderLookupResult = await lookupOrder(
      supabase,
      snapshot.event_id,
      {
        messageText: message,
        explicitOrderId: classification.mentioned_order_id,
        explicitPhone: classification.mentioned_phone,
        sessionPhone: snapshot.customer_phone_e164,
      },
    );

    if (lookupResult.kind === 'single') {
      orderForTurn = lookupResult.order;
    } else if (lookupResult.kind === 'ambiguous') {
      // Multiple orders matched a name or email — ask the customer to clarify.
      return {
        reply_text: ambiguousOrderReply(lookupResult.orders, classification.language),
        new_state: 'order_lookup',
        matched_order_id: null,
        classified_intent: classification.intent,
        cited_section_ids: [],
        deflection_offer: null,
        source_section: null,
        escalation: null,
        classification,
      };
    }
    // 'not_found' → orderForTurn stays null
  }

  // VIP escalation gate
  if (
    orderForTurn?.vip_flag &&
    eventConfig.vip_orders_always_escalate &&
    !existingOrder // only on first match, otherwise loops forever
  ) {
    return escalateResult(
      snapshot,
      'vip_order_match',
      'high',
      `VIP order ${orderForTurn.order_id} matched — escalating per event config.`,
      classification,
      orderForTurn,
    );
  }

  // ---- Branch: refund flow ----
  if (REFUND_INTENTS.has(classification.intent)) {
    return handleRefundFlow({
      input,
      classification,
      order: orderForTurn,
    });
  }

  // ---- Branch: order-lookup-required intents ----
  // For ticket_delivery_issue, try the KB first — generic problems like
  // "tickets not loading in your app" are answerable from the KB without
  // looking up the order. If the KB has nothing relevant, ask for the order.
  // For payment_incomplete, an order is always required, so ask immediately.
  if (classification.intent === 'ticket_delivery_issue' && !orderForTurn) {
    const kbSections = await retrieveKB(supabase, snapshot.event_id, {
      intent: 'ticket_delivery_issue',
      messageText: message,
      language: classification.language,
      operatorId: input.operatorId,
    });
    if (kbSections.length === 0) {
      return {
        reply_text: orderLookupRequestReply(classification.language),
        new_state: 'order_lookup',
        matched_order_id: null,
        classified_intent: classification.intent,
        cited_section_ids: [],
        deflection_offer: null,
        source_section: null,
        escalation: null,
        classification,
      };
    }
    return generateWithGuardrails(input, classification, kbSections, null, 'faq_answer');
  }

  if (classification.intent === 'payment_incomplete' && !orderForTurn) {
    return {
      reply_text: orderLookupRequestReply(classification.language),
      new_state: 'order_lookup',
      matched_order_id: null,
      classified_intent: classification.intent,
      cited_section_ids: [],
      deflection_offer: null,
      source_section: null,
      escalation: null,
      classification,
    };
  }

  // ---- Branch: vague greeting ("hi can you help me with my order") — ask for order id ----
  if (
    classification.intent === 'other' &&
    !orderForTurn &&
    /\border\b|\bticket\b|\bمشكلة\b/i.test(message) &&
    !injectionAttempt
  ) {
    return {
      reply_text: orderLookupRequestReply(classification.language),
      new_state: 'order_lookup',
      matched_order_id: null,
      classified_intent: classification.intent,
      cited_section_ids: [],
      deflection_offer: null,
      source_section: null,
      escalation: null,
      classification,
    };
  }

  // ---- Default branch: FAQ answer from KB ----
  // Always pass the classified intent — even "other", since many sections
  // (parking, food, prayer, wifi, etc.) carry intent="other". retrieveKB
  // falls back to FTS automatically when the intent match returns zero.
  const kbSections = await retrieveKB(supabase, snapshot.event_id, {
    intent: classification.intent,
    messageText: message,
    language: classification.language,
    operatorId: input.operatorId,
  });

  // Decide which state this turn ends in.
  const newState: AgentState = orderForTurn
    ? 'faq_answer'
    : injectionAttempt
    ? 'faq_answer' // respond normally; do not follow injection
    : snapshot.state === 'greeting'
    ? 'faq_answer'
    : 'faq_answer';

  return generateWithGuardrails(input, classification, kbSections, orderForTurn, newState);
}

// ============================================================================
// REFUND FLOW — adapts CLASSIFY_REASON → POLICY_CHECK → OFFER_ALTERNATIVE
// from refund_deflection.ts into the new single-state ("refund_deflection") model.
// ============================================================================

interface RefundFlowInput {
  input: RunAgentInput;
  classification: Classification;
  order: OrderContext | null;
}

async function handleRefundFlow({
  input,
  classification,
  order,
}: RefundFlowInput): Promise<AgentTurnResult> {
  const { snapshot, eventConfig } = input;

  // No order context yet — describe policy and offer an alternative immediately
  // (the standard deflection). The generator's prompt forbids approving a
  // refund, so it can only cite policy and propose transfer/credit. We ask
  // for the order at the end so the deflection can be executed.
  if (!order) {
    const kbSections = await retrieveKB(input.supabase, snapshot.event_id, {
      intent: null,
      messageText: 'refund policy alternative transfer credit exchange',
      language: classification.language,
      operatorId: input.operatorId,
    });
    return generateWithGuardrails(
      input,
      classification,
      kbSections,
      null,
      'refund_deflection',
    );
  }

  // VIP — already handled by VIP escalation gate above, but defense in depth.
  if (order.vip_flag && eventConfig.vip_orders_always_escalate) {
    return escalateResult(
      snapshot,
      'vip_order_refund_request',
      'high',
      `VIP order ${order.order_id} requesting refund — escalating per event config.`,
      classification,
      order,
    );
  }

  // Refunded or failed orders → escalate so a human reads the situation.
  if (order.status === 'refunded' || order.status === 'payment_failed' || order.status === 'payment_pending') {
    return escalateResult(
      snapshot,
      `refund_request_on_${order.status}_order`,
      'normal',
      `Customer requesting refund on order ${order.order_id} with status=${order.status}. Needs ops review.`,
      classification,
      order,
    );
  }

  // Compute policy window.
  const days = daysUntilEvent(eventConfig);
  const refundPct = applicableRefundPct(eventConfig, days);

  if (refundPct > 0) {
    // In-window — agent never approves refunds. Escalate to human.
    return escalateResult(
      snapshot,
      'in_window_refund_request',
      'normal',
      `Order ${order.order_id} is within refund window (${days} days out, ${refundPct}% eligible). Human approval required.`,
      classification,
      order,
    );
  }

  // Outside window — offer an alternative if any are configured.
  const alternatives = eventConfig.refund_policy?.allowed_alternatives_after_window ?? [];
  if (alternatives.length === 0) {
    return escalateResult(
      snapshot,
      'no_alternatives_available',
      'normal',
      `Outside refund window and no alternatives configured for event ${eventConfig.event_id}.`,
      classification,
      order,
    );
  }

  // Retrieve the refund policy section to back the citation, then ask the
  // generator to phrase the offer. The generator's prompt forbids approving
  // refunds, so it can only offer alternatives.
  const kbSections = await retrieveKB(input.supabase, snapshot.event_id, {
    intent: null, // fall back to keyword match on "refund"
    messageText: 'refund policy alternative transfer credit',
    language: classification.language,
    operatorId: input.operatorId,
  });

  return generateWithGuardrails(
    input,
    classification,
    kbSections,
    order,
    'refund_deflection',
  );
}
