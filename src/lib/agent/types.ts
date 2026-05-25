/**
 * Shared types for the agent runtime.
 *
 * Mirrors the reference state machine in docs/reference/refund_deflection.ts,
 * extended to cover all intents exercised by docs/data/test_messages.json.
 */

// ─── Languages ───────────────────────────────────────────────────────────────

export type Language = 'en' | 'ar' | 'ru' | 'mixed';

// ─── Top-level agent states (stored in conversations.state) ─────────────────

export type AgentState =
  | 'greeting'              // initial — no specific intent yet
  | 'faq_answer'            // serving an answer from the KB
  | 'order_lookup'          // awaiting / processing an order ID or phone
  | 'refund_deflection'     // inside refund flow (reason → policy → alternative)
  | 'escalation_triggered'  // terminal — escalated to a human
  | 'session_closed';       // terminal — deflected / resolved

// ─── Refund sub-types (preserved verbatim from refund_deflection.ts) ────────

export type RefundReason =
  | 'cannot_attend_personal'
  | 'cannot_attend_medical'
  | 'dissatisfied_experience'
  | 'event_change_or_cancellation'
  | 'payment_issue'
  | 'duplicate_purchase'
  | 'wrong_ticket_purchased'
  | 'accessibility_concern'
  | 'safety_concern'
  | 'other';

export type AlternativeOffered =
  | 'transfer_to_another_person'
  | 'credit_for_future_event'
  | 'ticket_upgrade'
  | 'date_change_if_multi_day';

// ─── Intent taxonomy ────────────────────────────────────────────────────────
//
// Covers every expected_intent in test_messages.json plus the additional
// intents from refund_deflection.ts.

export const KNOWN_INTENTS = [
  'event_timing',
  'venue_location',
  'age_eligibility',
  'dress_code',
  'last_entry_time',
  'entry_policy',
  'ticket_delivery_issue',
  'ticket_upgrade_request',
  'ticket_availability_sold_out',
  'backstage_or_vib_request',
  'refund_request',
  'refund_followup',
  'compensation_request',
  'payment_incomplete',
  'reservation_followup',
  'loyalty_benefits',
  'lineup_question',
  'membership_tier_issue',
  'partnership_inquiry',
  'other',
] as const;

export type Intent = (typeof KNOWN_INTENTS)[number];

// ─── Classifier output ──────────────────────────────────────────────────────

export interface Classification {
  intent: Intent;
  language: Language;
  refund_reason: RefundReason | null;
  mentioned_order_id: string | null;
  mentioned_phone: string | null;   // E.164 if extractable, else raw digits, else null
  anger_score: number;              // 0-10 integer
  high_urgency: boolean;
  escalate_immediately: boolean;    // classifier's own escalation signal
  confidence: number;               // 0-1 self-reported
}

// ─── KB retrieval ───────────────────────────────────────────────────────────

export interface RetrievedKBSection {
  section_id: string;
  category: string | null;
  intent: string | null;
  escalation_needed: boolean;
  question_en: string | null;
  answer_en: string;
  question_ar: string | null;
  answer_ar: string | null;
  source: 'intent_match' | 'fts_fallback';
}

// ─── Order context ──────────────────────────────────────────────────────────

export interface OrderContext {
  id: string;                       // DB UUID
  order_id: string;                 // External order ID
  customer_phone_e164: string;
  customer_name: string | null;
  ticket_type: string | null;
  quantity: number;
  amount_paid: number | null;
  currency: string;
  status: 'completed' | 'payment_failed' | 'payment_pending' | 'refunded';
  vip_flag: boolean;
  transfer_eligible: boolean;
}

// ─── Generator output ───────────────────────────────────────────────────────

export interface GenerationOutput {
  response_text: string;
  language_used: Language;
  kb_sections_cited: string[];
  deflection_offer: string | null;
  requires_escalation: boolean;
  contains_policy_claim: boolean;
  confidence: number;               // 0-1
}

// ─── Conversation snapshot (input to state machine) ─────────────────────────

export interface ConversationSnapshot {
  conversation_id: string;
  event_id: string;
  customer_phone_e164: string;
  state: AgentState;
  matched_order: OrderContext | null;
  classified_reason: RefundReason | null;
  alternative_offered: AlternativeOffered | null;
  language: Language;
  refund_case_id: string | null;
  message_history: Array<{
    role: 'user' | 'agent' | 'human_operator';
    text: string;
    created_at: string;
  }>;
  consecutive_no_progress_turns: number;
}

// ─── State machine result (returned to API route for persistence) ───────────

export interface AgentTurnResult {
  reply_text: string;
  new_state: AgentState;
  matched_order_id: string | null;
  classified_intent: Intent | null;
  cited_section_ids: string[];
  deflection_offer: AlternativeOffered | null;
  escalation: {
    reason: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    summary_for_ops: string;
  } | null;
  classification: Classification | null;
}
