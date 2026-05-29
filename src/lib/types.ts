// ─── Enumerations ────────────────────────────────────────────────────────────

export type EventStatus = 'draft' | 'live' | 'closed' | 'archived';
export type EventType = 'festival' | 'club' | 'concert' | 'conference' | 'other';
export type OrderStatus = 'completed' | 'payment_failed' | 'payment_pending' | 'refunded';
export type EscalationStatus = 'open' | 'claimed' | 'resolved' | 'reopened';
export type RefundShape = 'strict' | 'tiered' | 'lenient';

// ─── Refund policy ───────────────────────────────────────────────────────────

export interface RefundTier {
  days_before_event: number;
  refund_pct: number;
}

export interface RefundPolicy {
  shape: RefundShape;
  tiers: RefundTier[];
  allowed_alternatives_after_window: string[];
  credit_validity_months: number;
  medical_exception_section_id: string;
  hard_no_language?: { en: string; ar: string };
}

// ─── EventConfig ─────────────────────────────────────────────────────────────
//
// Mirrors EventConfig in refund_deflection.ts.
// Stored as events.config JSONB so the agent runtime can read without joins.

export interface EventConfig {
  event_id: string;
  event_name: string;
  event_date_iso: string;
  /** IANA timezone string, e.g. 'Asia/Dubai'. Top-level events.timezone injected at runtime. */
  timezone?: string;
  refund_policy: RefundPolicy;
  escalation_keywords: string[];
  vip_orders_always_escalate: boolean;
  dress_code: string;
  age_minimum: number;
  doors_open_local: string;   // 'HH:mm'
  doors_close_local: string;
  last_entry_local: string;
  parking_info: string;
  escalation_contacts: { name: string; hours: string; method: string; phone?: string }[];
  ticket_tiers: { name: string; price?: number; description?: string }[];
}

// ─── Domain objects ───────────────────────────────────────────────────────────

export interface Operator {
  id: string;
  name: string;
  country_code: string;
  default_currency: string;
}

export interface Event {
  id: string;
  operator_id: string;
  name: string;
  slug: string;
  event_type: EventType;
  start_date: string;
  end_date: string;
  timezone: string;
  venue_name: string;
  venue_city: string;
  capacity: number | null;
  age_minimum: number;
  status: EventStatus;
  config: EventConfig;
}

export interface KBSection {
  id: string;
  event_id: string;
  section_id: string;
  category: string | null;
  intent: string | null;
  escalation_needed: boolean;
  question_en: string | null;
  answer_en: string;
  question_ar: string | null;
  answer_ar: string | null;
}

export interface Order {
  id: string;
  event_id: string;
  order_id: string;
  customer_phone_e164: string;
  customer_name: string | null;
  ticket_type: string | null;
  quantity: number;
  amount_paid: number | null;
  currency: string;
  status: OrderStatus;
  vip_flag: boolean;
  transfer_eligible: boolean;
}
