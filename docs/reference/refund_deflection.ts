/**
 * Refund Deflection State Machine — Reference Implementation
 *
 * This is the v1 reference the contractor will adapt and extend.
 *
 * Design principles:
 *   1. Pure function: (state, message, eventConfig) -> { newState, action, agentReply }
 *      All side effects (DB writes, WhatsApp sends, escalation alerts) are
 *      handled by the caller, not the state machine.
 *   2. Hard guardrails are enforced in code, not in prompts. The LLM is
 *      classification + generation; the rules are deterministic.
 *   3. Every policy claim in an agent reply must cite a section_id from the
 *      event KB. Uncited policy claims are blocked and escalated.
 *   4. The agent NEVER approves a refund. It can only offer alternatives or
 *      escalate to a human.
 *   5. Defense in depth on safety-critical paths (medical, safety, legal,
 *      chargeback): keyword filter + LLM classifier + escalation default.
 *
 * Stack assumption:
 *   - TypeScript 5.x, Node 20+
 *   - Anthropic SDK (@anthropic-ai/sdk)
 *   - Sonnet 4.6 for generation, Haiku 4.5 for classification
 *
 * Not included here (caller's responsibility):
 *   - DB persistence of ConversationState, refund_cases, audit_log
 *   - WhatsApp send (channel adapter)
 *   - Escalation queue UI / Slack alert
 *   - PII redaction before logging to Sentry/Langfuse
 */

import Anthropic from "@anthropic-ai/sdk";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ============================================================================
// TYPES
// ============================================================================

export type ConversationStateName =
  | "START"
  | "INTAKE"
  | "VERIFY"
  | "CLASSIFY_REASON"
  | "POLICY_CHECK"
  | "OFFER_ALTERNATIVE"
  | "ESCALATED"
  | "RESOLVED_DEFLECTED"
  | "RESOLVED_ESCALATED";

export type RefundReason =
  | "cannot_attend_personal"
  | "cannot_attend_medical"
  | "dissatisfied_experience"
  | "event_change_or_cancellation"
  | "payment_issue"
  | "duplicate_purchase"
  | "wrong_ticket_purchased"
  | "accessibility_concern"
  | "safety_concern"
  | "other";

export type AlternativeOffered =
  | "transfer_to_another_person"
  | "credit_for_future_event"
  | "ticket_upgrade"
  | "date_change_if_multi_day";

export type Action =
  | { kind: "respond"; replyText: string; citedSectionIds: string[] }
  | { kind: "escalate"; reason: string; summaryForOps: string }
  | { kind: "request_order_lookup"; replyText: string }
  | { kind: "wait_for_user" };

export interface KBSection {
  section_id: string;
  category: string;
  intent: string;
  escalation_needed: boolean;
  question_en: string;
  answer_en_neutral: string;
  question_ar: string;
  answer_ar_neutral: string;
}

export interface EventConfig {
  event_id: string;
  event_name: string;
  event_date_iso: string;
  refund_policy: {
    shape: "strict" | "tiered" | "lenient";
    tiers: { days_before_event: number; refund_pct: number }[];
    allowed_alternatives_after_window: AlternativeOffered[];
    credit_validity_months: number;
    medical_exception_section_id: string;
  };
  kb_sections: KBSection[];
  escalation_keywords: string[];
  vip_orders_always_escalate: boolean;
}

export interface Order {
  order_id: string;
  customer_phone_e164: string;
  customer_name: string;
  ticket_type: string;
  quantity: number;
  amount_paid_aed: number;
  purchase_date: string;
  status: "completed" | "payment_failed" | "payment_pending" | "refunded";
  vip_flag: boolean;
  transfer_eligible: boolean;
}

export interface ConversationState {
  conversation_id: string;
  state: ConversationStateName;
  turn_count: number;
  consecutive_no_progress_turns: number;
  language: "en" | "ar" | "ru" | "mixed";
  matched_order: Order | null;
  classified_reason: RefundReason | null;
  alternative_offered: AlternativeOffered | null;
  refund_case_id: string | null;
  message_history: { role: "user" | "agent"; text: string; timestamp: string }[];
}

// ============================================================================
// HARD GUARDRAILS (deterministic, never bypassed by LLM)
// ============================================================================

const HARD_ESCALATION_KEYWORDS_EN = [
  "hospital", "death", "died", "passed away", "emergency",
  "lawyer", "legal action", "sue", "lawsuit",
  "fraud", "scam", "scammed", "chargeback",
  "medical emergency", "accident", "ambulance",
  "unsafe", "harass", "harassed", "threat",
];

const HARD_ESCALATION_KEYWORDS_AR = [
  "مستشفى", "توفي", "توفت", "وفاة", "طوارئ",
  "محامي", "أقاضي", "قضية",
  "نصب", "احتيال", "تشارجباك",
  "إسعاف", "حادث",
  "غير آمن", "تحرش", "تهديد",
];

const REASONS_REQUIRING_IMMEDIATE_ESCALATION: RefundReason[] = [
  "cannot_attend_medical",
  "accessibility_concern",
  "safety_concern",
];

function containsEscalationKeyword(text: string, eventConfig: EventConfig): boolean {
  const lower = text.toLowerCase();
  const allKeywords = [
    ...HARD_ESCALATION_KEYWORDS_EN,
    ...HARD_ESCALATION_KEYWORDS_AR,
    ...eventConfig.escalation_keywords.map(k => k.toLowerCase()),
  ];
  return allKeywords.some(k => lower.includes(k.toLowerCase()));
}

// ============================================================================
// CLASSIFIER (Haiku — cheap, fast, per-turn)
// ============================================================================

interface Classification {
  language: "en" | "ar" | "ru" | "mixed";
  intent: string;
  refund_reason: RefundReason | null;
  mentioned_order_id: string | null;
  anger_score: number; // 0-10
  high_urgency: boolean;
}

async function classifyMessage(text: string): Promise<Classification> {
  const resp = await claude.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: `Classify a customer support message for a live-event ticketing agent.
Output strict JSON with keys: language ("en"|"ar"|"ru"|"mixed"), intent,
refund_reason (null if not refund-related), mentioned_order_id (string or null),
anger_score (0-10 integer), high_urgency (boolean).

Intents: event_timing, venue_location, age_eligibility, dress_code, last_entry_time,
ticket_delivery_issue, ticket_upgrade_request, ticket_availability_sold_out,
backstage_or_vib_request, refund_request, refund_followup, compensation_request,
payment_incomplete, reservation_followup, loyalty_benefits, lineup_question,
membership_tier_issue, partnership_inquiry, other.

Refund reasons (only if intent is refund_request): cannot_attend_personal,
cannot_attend_medical, dissatisfied_experience, event_change_or_cancellation,
payment_issue, duplicate_purchase, wrong_ticket_purchased, accessibility_concern,
safety_concern, other. Null otherwise.

Return JSON only, no prose.`,
    messages: [{ role: "user", content: text }],
  });

  const content = resp.content[0];
  if (content.type !== "text") throw new Error("Classifier returned non-text content");
  const parsed = JSON.parse(content.text);
  return {
    language: parsed.language,
    intent: parsed.intent,
    refund_reason: parsed.refund_reason,
    mentioned_order_id: parsed.mentioned_order_id,
    anger_score: parsed.anger_score ?? 0,
    high_urgency: parsed.high_urgency ?? false,
  };
}

// ============================================================================
// CITED GENERATION (Sonnet — for customer-facing replies)
// ============================================================================

interface GenerationOutput {
  reply_text: string;
  cited_section_ids: string[];
  contains_policy_claim: boolean;
  confidence: number; // 0-1, self-reported
}

async function generateCitedReply(
  state: ConversationState,
  eventConfig: EventConfig,
  intent: string,
): Promise<GenerationOutput> {
  const relevantSections = eventConfig.kb_sections
    .filter(s => s.intent === intent || s.intent === "other")
    .map(s => ({
      id: s.section_id,
      en: s.answer_en_neutral,
      ar: s.answer_ar_neutral,
    }));

  const replyLanguage = state.language === "ar" ? "Arabic" :
                        state.language === "ru" ? "Russian" : "English";

  const recentMessages = state.message_history
    .slice(-6)
    .map(m => `${m.role.toUpperCase()}: ${m.text}`)
    .join("\n");

  const resp = await claude.messages.create({
    model: "claude-sonnet-4-6-20251015",
    max_tokens: 600,
    system: `You are a customer support agent for ${eventConfig.event_name}.

Rules:
1. Answer in ${replyLanguage} unless the customer's last message switched languages.
2. Every policy claim in your reply MUST cite at least one section_id from the
   provided KB sections. If you cannot find a relevant section, return an empty
   reply_text and set contains_policy_claim=true with cited_section_ids=[].
   The system will escalate.
3. Never approve a refund. You may only describe policy or offer alternatives
   that are explicitly in the KB sections.
4. Never quote a price, date, or policy that is not in the KB sections.
5. Be brief: 2-4 sentences typical, 6 sentences maximum.
6. If the customer is angry or distressed, acknowledge before answering.

Available KB sections for this intent:
${JSON.stringify(relevantSections, null, 2)}

Recent conversation:
${recentMessages}

Return JSON with: reply_text (string), cited_section_ids (string[]),
contains_policy_claim (boolean), confidence (0-1 float).`,
    messages: [{ role: "user", content: state.message_history.slice(-1)[0].text }],
  });

  const content = resp.content[0];
  if (content.type !== "text") throw new Error("Generator returned non-text content");
  return JSON.parse(content.text);
}

// ============================================================================
// STATE MACHINE (pure transitions)
// ============================================================================

export interface ProcessMessageResult {
  newState: ConversationState;
  action: Action;
}

export async function processMessage(
  prevState: ConversationState,
  incomingMessage: string,
  eventConfig: EventConfig,
  lookupOrder: (phoneOrId: string) => Promise<Order | null>,
): Promise<ProcessMessageResult> {
  // Append incoming message to history
  let state: ConversationState = {
    ...prevState,
    turn_count: prevState.turn_count + 1,
    message_history: [
      ...prevState.message_history,
      { role: "user", text: incomingMessage, timestamp: new Date().toISOString() },
    ],
  };

  // ---- Guardrail 1: Hard escalation keywords ----
  // Defense in depth: keyword filter runs before classifier so a network
  // failure on Claude cannot prevent escalation on a safety-critical message.
  if (containsEscalationKeyword(incomingMessage, eventConfig)) {
    return escalate(state, "hard_keyword_match",
      `Hard keyword triggered. Message: ${incomingMessage.slice(0, 200)}`);
  }

  // ---- Guardrail 2: Three turns without state progression ----
  if (state.consecutive_no_progress_turns >= 3) {
    return escalate(state, "stalled_conversation",
      `3 turns without progress. Current state: ${state.state}`);
  }

  // ---- Classify ----
  const cls = await classifyMessage(incomingMessage);
  state.language = cls.language;

  // ---- Guardrail 3: Anger threshold ----
  if (cls.anger_score >= 7) {
    return escalate(state, "high_anger_signal",
      `Anger score ${cls.anger_score}/10. Last message: ${incomingMessage.slice(0, 200)}`);
  }

  // ---- Guardrail 4: Reason requires immediate escalation ----
  if (cls.refund_reason && REASONS_REQUIRING_IMMEDIATE_ESCALATION.includes(cls.refund_reason)) {
    return escalate(state, `protected_reason:${cls.refund_reason}`,
      `Refund reason requires human handling. ${incomingMessage.slice(0, 200)}`);
  }

  // ---- Route by state ----
  switch (state.state) {
    case "START":
    case "INTAKE":
      return handleIntake(state, cls, incomingMessage, eventConfig, lookupOrder);

    case "VERIFY":
      return handleVerify(state, cls, incomingMessage, eventConfig);

    case "CLASSIFY_REASON":
      return handleClassifyReason(state, cls, eventConfig);

    case "POLICY_CHECK":
      return handlePolicyCheck(state, eventConfig);

    case "OFFER_ALTERNATIVE":
      return handleOfferResponse(state, cls, incomingMessage);

    default:
      return escalate(state, "unexpected_state", `State ${state.state} unhandled`);
  }
}

// ---- State handlers ----

async function handleIntake(
  state: ConversationState,
  cls: Classification,
  incomingMessage: string,
  eventConfig: EventConfig,
  lookupOrder: (phoneOrId: string) => Promise<Order | null>,
): Promise<ProcessMessageResult> {
  // If user mentioned an order ID, try to look it up
  if (cls.mentioned_order_id) {
    const order = await lookupOrder(cls.mentioned_order_id);
    if (order) {
      // VIP escalation at INTAKE
      if (order.vip_flag && eventConfig.vip_orders_always_escalate) {
        return escalate(
          { ...state, matched_order: order },
          "vip_order_at_intake",
          `VIP order ${order.order_id} - escalating per config`
        );
      }
      // Move forward
      state.matched_order = order;
      state.state = cls.intent === "refund_request" ? "CLASSIFY_REASON" : "VERIFY";
      state.consecutive_no_progress_turns = 0;
      return generateAndRespond(state, eventConfig, cls.intent);
    }
  }

  // If this is a non-refund intent that the KB can answer directly, do that
  if (cls.intent !== "refund_request" && cls.intent !== "refund_followup") {
    return generateAndRespond(state, eventConfig, cls.intent);
  }

  // Refund without order context: ask for order ID
  state.state = "INTAKE";
  state.consecutive_no_progress_turns += 1;
  const askEn = "To help with this, can you share your order ID or the phone number used at checkout?";
  const askAr = "للمساعدة في هذا الأمر، هل يمكنك مشاركة رقم الطلب أو رقم الهاتف المستخدم عند الشراء؟";
  return {
    newState: appendAgent(state, state.language === "ar" ? askAr : askEn),
    action: { kind: "request_order_lookup", replyText: state.language === "ar" ? askAr : askEn },
  };
}

async function handleVerify(
  state: ConversationState,
  cls: Classification,
  incomingMessage: string,
  eventConfig: EventConfig,
): Promise<ProcessMessageResult> {
  // Non-refund flow: just answer
  state.consecutive_no_progress_turns = 0;
  return generateAndRespond(state, eventConfig, cls.intent);
}

async function handleClassifyReason(
  state: ConversationState,
  cls: Classification,
  eventConfig: EventConfig,
): Promise<ProcessMessageResult> {
  if (!cls.refund_reason) {
    state.consecutive_no_progress_turns += 1;
    const ask = state.language === "ar"
      ? "هل يمكنك توضيح سبب طلب الاسترداد؟"
      : "Could you share the reason for your refund request?";
    return {
      newState: appendAgent(state, ask),
      action: { kind: "respond", replyText: ask, citedSectionIds: [] },
    };
  }
  state.classified_reason = cls.refund_reason;
  state.state = "POLICY_CHECK";
  state.consecutive_no_progress_turns = 0;
  return handlePolicyCheck(state, eventConfig);
}

async function handlePolicyCheck(
  state: ConversationState,
  eventConfig: EventConfig,
): Promise<ProcessMessageResult> {
  if (!state.matched_order) {
    return escalate(state, "policy_check_no_order", "POLICY_CHECK without matched order");
  }

  // Calculate days to event
  const daysToEvent = Math.ceil(
    (new Date(eventConfig.event_date_iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  // Find applicable tier
  const eligibleTier = eventConfig.refund_policy.tiers
    .sort((a, b) => b.days_before_event - a.days_before_event)
    .find(t => daysToEvent >= t.days_before_event);

  const refundPct = eligibleTier?.refund_pct ?? 0;

  if (refundPct > 0) {
    // In-window: human must process. Escalate (agent never approves refunds).
    return escalate(state, "in_window_refund_request",
      `Order ${state.matched_order.order_id} is within refund window (${daysToEvent} days out, ${refundPct}% eligible). Human approval required.`);
  }

  // Outside window: offer alternative
  const alternatives = eventConfig.refund_policy.allowed_alternatives_after_window;
  if (alternatives.length === 0) {
    return escalate(state, "no_alternatives_available",
      "Outside refund window and no alternatives configured.");
  }

  state.state = "OFFER_ALTERNATIVE";
  state.alternative_offered = alternatives[0];
  return offerAlternative(state, eventConfig, alternatives);
}

async function offerAlternative(
  state: ConversationState,
  eventConfig: EventConfig,
  alternatives: AlternativeOffered[],
): Promise<ProcessMessageResult> {
  const altText: Record<AlternativeOffered, { en: string; ar: string }> = {
    transfer_to_another_person: {
      en: "transfer your ticket to another guest",
      ar: "تحويل تذكرتك إلى ضيف آخر",
    },
    credit_for_future_event: {
      en: `credit valid for ${eventConfig.refund_policy.credit_validity_months} months toward a future event`,
      ar: `رصيد ساري لمدة ${eventConfig.refund_policy.credit_validity_months} شهرًا لفعالية مستقبلية`,
    },
    ticket_upgrade: { en: "upgrade your ticket subject to availability", ar: "ترقية تذكرتك حسب التوفر" },
    date_change_if_multi_day: { en: "switch to a different day of the event", ar: "تغيير اليوم" },
  };

  const offered = alternatives.map(a => altText[a]);
  const replyEn = `Per our published refund policy, we're unable to refund purchases at this stage. What we can do is offer ${offered.map(o => o.en).join(" or ")}. Which would you prefer?`;
  const replyAr = `وفقًا لسياسة الاسترداد المنشورة، لا يمكننا استرداد المبالغ في هذه المرحلة. ما يمكننا تقديمه هو ${offered.map(o => o.ar).join(" أو ")}. أيهما تفضل؟`;

  const reply = state.language === "ar" ? replyAr : replyEn;
  return {
    newState: appendAgent(state, reply),
    action: { kind: "respond", replyText: reply, citedSectionIds: ["policy.refund.standard"] },
  };
}

async function handleOfferResponse(
  state: ConversationState,
  cls: Classification,
  incomingMessage: string,
): Promise<ProcessMessageResult> {
  // Did the customer accept the alternative?
  // Lightweight: look for accept/decline signals. In production, use Haiku for this.
  const lower = incomingMessage.toLowerCase();
  const acceptSignals = ["yes", "ok", "okay", "sure", "transfer", "credit", "نعم", "تمام", "موافق", "حول"];
  const declineSignals = ["no", "refund", "money", "back", "لا", "أبي فلوسي", "استرداد"];

  const accepted = acceptSignals.some(s => lower.includes(s));
  const declined = declineSignals.some(s => lower.includes(s));

  if (accepted && !declined) {
    state.state = "RESOLVED_DEFLECTED";
    return escalate(state, "alternative_accepted_pending_human_action",
      `Customer accepted ${state.alternative_offered}. Human must execute (transfer/credit issue).`);
  }

  if (declined) {
    return escalate(state, "alternative_declined_wants_refund",
      "Customer declined alternative and is insisting on refund.");
  }

  // Unclear — escalate after one re-ask
  state.consecutive_no_progress_turns += 1;
  return escalate(state, "ambiguous_response_to_offer",
    `Could not parse customer response to alternative offer: ${incomingMessage.slice(0, 200)}`);
}

// ============================================================================
// HELPERS
// ============================================================================

async function generateAndRespond(
  state: ConversationState,
  eventConfig: EventConfig,
  intent: string,
): Promise<ProcessMessageResult> {
  const gen = await generateCitedReply(state, eventConfig, intent);

  // Guardrail: policy claim must have citations
  if (gen.contains_policy_claim && gen.cited_section_ids.length === 0) {
    return escalate(state, "policy_claim_without_citation",
      `Generator produced policy claim with no citations. Reply: ${gen.reply_text.slice(0, 200)}`);
  }

  // Guardrail: low confidence escalates
  if (gen.confidence < 0.6) {
    return escalate(state, "low_confidence_response",
      `Generator confidence ${gen.confidence}. Reply: ${gen.reply_text.slice(0, 200)}`);
  }

  return {
    newState: appendAgent(state, gen.reply_text),
    action: {
      kind: "respond",
      replyText: gen.reply_text,
      citedSectionIds: gen.cited_section_ids,
    },
  };
}

function escalate(
  state: ConversationState,
  reason: string,
  summaryForOps: string,
): ProcessMessageResult {
  const closingEn = "I'm connecting you with a member of the team who can help with this directly. They'll respond shortly.";
  const closingAr = "سأقوم بتحويلك إلى أحد أعضاء الفريق للمساعدة بشكل مباشر. سيتم الرد عليك قريبًا.";
  const reply = state.language === "ar" ? closingAr : closingEn;

  return {
    newState: { ...appendAgent(state, reply), state: "ESCALATED" },
    action: { kind: "escalate", reason, summaryForOps },
  };
}

function appendAgent(state: ConversationState, text: string): ConversationState {
  return {
    ...state,
    message_history: [
      ...state.message_history,
      { role: "agent", text, timestamp: new Date().toISOString() },
    ],
  };
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

/*
// Example: walk a conversation through the deflection happy path.

const initialState: ConversationState = {
  conversation_id: "conv_001",
  state: "START",
  turn_count: 0,
  consecutive_no_progress_turns: 0,
  language: "en",
  matched_order: null,
  classified_reason: null,
  alternative_offered: null,
  refund_case_id: null,
  message_history: [],
};

const eventConfig: EventConfig = {
  event_id: "coastline-2026",
  event_name: "Coastline Festival",
  event_date_iso: "2026-07-17",
  refund_policy: {
    shape: "tiered",
    tiers: [
      { days_before_event: 30, refund_pct: 100 },
      { days_before_event: 14, refund_pct: 50 },
      { days_before_event: 0, refund_pct: 0 },
    ],
    allowed_alternatives_after_window: ["transfer_to_another_person", "credit_for_future_event"],
    credit_validity_months: 12,
    medical_exception_section_id: "policy.refund.medical",
  },
  kb_sections: [/-* loaded from kb_coastline_festival.json *-/],
  escalation_keywords: ["police", "lawyer", "media"],
  vip_orders_always_escalate: true,
};

// Turn 1
let result = await processMessage(
  initialState,
  "I bought a ticket for Friday but can't make it. Order ORD-001023",
  eventConfig,
  async (id) => mockLookup(id),
);
// Expected: action.kind === "respond" or "escalate", agent has asked for clarification
// or moved to CLASSIFY_REASON after finding the order.

// Turn 2
result = await processMessage(
  result.newState,
  "I just don't feel like going anymore",
  eventConfig,
  async (id) => mockLookup(id),
);
// Expected: classified_reason = "cannot_attend_personal", policy check happens,
// alternative offered.

// Turn 3
result = await processMessage(
  result.newState,
  "Credit sounds fine",
  eventConfig,
  async (id) => mockLookup(id),
);
// Expected: action.kind === "escalate", reason = "alternative_accepted_pending_human_action".
// A human must now execute the credit issuance. refund_case row is logged.
*/
