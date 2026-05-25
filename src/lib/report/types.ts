/**
 * Post-event report data shape.
 *
 * The full payload consumed by both the HTML renderer (route handler) and the
 * inline summary card (admin page). Designed to be JSON-serializable so the
 * same object can be passed to a client component or written to a file.
 */

export interface ReportEventMeta {
  id: string;
  name: string;
  slug: string;
  start_date: string;          // ISO date
  end_date: string;            // ISO date
  venue_name: string;
  venue_city: string;
  timezone: string;
  operator_name: string;
  default_currency: string;
}

export interface ReportConversations {
  total: number;
  deflected: number;
  escalated: number;
  deflection_rate: number;     // 0-1
  by_language: { language: string; count: number }[];
  by_day: { date: string; count: number }[];
}

export interface ReportOrders {
  total_tickets_sold: number;  // sum of quantity on completed orders
  total_orders: number;        // distinct completed orders
  total_revenue: number;
  currency: string;
  by_tier: { ticket_type: string; orders: number; tickets: number; revenue: number }[];
  payment_failed_orders: number;
  payment_pending_orders: number;
  refunded_orders: number;
}

export interface ReportRefund {
  total_cases: number;
  deflected_count: number;
  escalated_count: number;
  deflection_rate: number;     // 0-1
  estimated_revenue_protected: number;
  by_reason: { reason: string; count: number; deflected: number }[];
}

export interface ReportEscalations {
  total: number;
  by_status: { open: number; claimed: number; resolved: number; reopened: number };
  resolution_rate: number;     // 0-1, (resolved / total)
  by_reason: { reason: string; count: number }[];
}

export interface ReportKB {
  top_sections: {
    section_id: string;
    question_en: string | null;
    citation_count: number;
  }[];
  total_citations: number;
}

export interface ReportIntents {
  total: number;
  by_intent: { intent: string; count: number; percentage: number }[];
}

export interface ReportPerformance {
  median_response_seconds_ai: number | null;
  median_response_seconds_human: number | null;
  estimated_team_hours_saved: number;
}

export interface ReportData {
  event: ReportEventMeta;
  generated_at: string;
  is_empty: boolean;
  conversations: ReportConversations;
  orders: ReportOrders;
  refund: ReportRefund;
  escalations: ReportEscalations;
  kb: ReportKB;
  intents: ReportIntents;
  performance: ReportPerformance;
}
