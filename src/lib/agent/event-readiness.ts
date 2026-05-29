/**
 * event-readiness.ts
 *
 * Computes an event's readiness to publish by running a set of checks against
 * the event row, config JSONB, and related tables.
 *
 * Uses createAdminClient() — always called from server components that have
 * already verified the caller's access via RLS on the events table.
 */

import { createAdminClient } from '@/lib/supabase/admin';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReadinessItem {
  id: string;
  label: string;
  description: string;
  /** complete = green ✓ | incomplete = red ✗ (blocks publish) | warning = amber ⚠ (advisory) */
  status: 'complete' | 'incomplete' | 'warning';
  /** Deep-link to the tab where the operator can fix this item. */
  action_url?: string;
  /** Required items block publishing when incomplete. */
  required: boolean;
}

export interface EventReadinessResult {
  items: ReadinessItem[];
  /** true when every required item is complete */
  can_publish: boolean;
  /** (complete items / total items) * 100, rounded to nearest integer */
  score: number;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getEventReadiness(
  eventId: string,
): Promise<EventReadinessResult> {
  const admin = createAdminClient();

  // ── Fetch event row ───────────────────────────────────────────────────────
  const { data: eventData } = await admin
    .from('events')
    .select(
      'id, operator_id, name, venue_name, venue_city, start_date, end_date, age_minimum, config',
    )
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();

  if (!eventData) return { items: [], can_publish: false, score: 0 };

  const ev = eventData as {
    id: string;
    operator_id: string;
    name: string;
    venue_name: string;
    venue_city: string;
    start_date: string;
    end_date: string;
    age_minimum: number;
    config: Record<string, unknown>;
  };

  const config = (ev.config ?? {}) as Record<string, unknown>;
  const operatorId = ev.operator_id;

  // ── Parallel queries ──────────────────────────────────────────────────────
  const [
    { count: kbCount },
    { count: operatorKbCount },
    { count: ordersCount },
    operatorResult,
  ] = await Promise.all([
    admin
      .from('kb_sections')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId),
    admin
      .from('operator_kb_sections')
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId),
    admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId),
    admin
      .from('operators')
      .select('whatsapp_business_phone_number_id')
      .eq('id', operatorId)
      .single(),
  ]);

  const operatorRow = operatorResult.data as
    | { whatsapp_business_phone_number_id: string | null }
    | null;

  // ── Build checklist items ─────────────────────────────────────────────────

  const items: ReadinessItem[] = [];

  // ── REQUIRED ──────────────────────────────────────────────────────────────

  // 1. basic_info
  items.push({
    id: 'basic_info',
    label: 'Basic information',
    description:
      'Event name, venue name, venue city, start date, and end date are all filled in.',
    status:
      ev.name?.trim() &&
      ev.venue_name?.trim() &&
      ev.venue_city?.trim() &&
      ev.start_date &&
      ev.end_date
        ? 'complete'
        : 'incomplete',
    required: true,
  });

  // 2. doors_time
  items.push({
    id: 'doors_time',
    label: 'Doors open time',
    description:
      'Set the time doors open so the agent can give accurate arrival advice.',
    status:
      typeof config.doors_open_local === 'string' &&
      config.doors_open_local.trim().length > 0
        ? 'complete'
        : 'incomplete',
    required: true,
  });

  // 3. age_policy
  items.push({
    id: 'age_policy',
    label: 'Age policy',
    description: 'Minimum age for entry is configured (0 = all ages welcome).',
    status: typeof ev.age_minimum === 'number' && ev.age_minimum >= 0 ? 'complete' : 'incomplete',
    required: true,
  });

  // 4. kb_content
  items.push({
    id: 'kb_content',
    label: 'Knowledge base',
    description:
      'Upload at least one KB document so the agent can answer customer questions accurately.',
    status: (kbCount ?? 0) > 0 || (operatorKbCount ?? 0) > 0 ? 'complete' : 'incomplete',
    action_url: `/admin/events/${eventId}/kb`,
    required: true,
  });

  // ── WARNINGS (optional but recommended) ───────────────────────────────────

  // 5. ticket_tiers
  const tiers = Array.isArray(config.ticket_tiers)
    ? (config.ticket_tiers as Array<{ name?: string }>)
    : [];
  items.push({
    id: 'ticket_tiers',
    label: 'Ticket tiers',
    description:
      'Add ticket types and prices for accurate savings estimates and refund calculations.',
    status:
      tiers.length > 0 && tiers.some((t) => t.name?.trim())
        ? 'complete'
        : 'warning',
    required: false,
  });

  // 6. refund_policy
  const refundPolicy = config.refund_policy;
  items.push({
    id: 'refund_policy',
    label: 'Refund policy',
    description:
      'Configure your refund policy so the agent can handle refund requests correctly.',
    status:
      refundPolicy != null &&
      typeof refundPolicy === 'object' &&
      !Array.isArray(refundPolicy)
        ? 'complete'
        : 'warning',
    required: false,
  });

  // 7. escalation_contacts
  const contacts = Array.isArray(config.escalation_contacts)
    ? (config.escalation_contacts as Array<{ name?: string }>)
    : [];
  items.push({
    id: 'escalation_contacts',
    label: 'Escalation contacts',
    description:
      'Add at least one contact who will be notified when the agent escalates a conversation.',
    status:
      contacts.length > 0 && contacts.some((c) => c.name?.trim())
        ? 'complete'
        : 'warning',
    required: false,
  });

  // 8. orders_imported
  items.push({
    id: 'orders_imported',
    label: 'Orders imported',
    description:
      'Import orders so the agent can look up customer bookings by name, phone, or email.',
    status: (ordersCount ?? 0) > 0 ? 'complete' : 'warning',
    action_url: `/admin/events/${eventId}/orders`,
    required: false,
  });

  // 9. whatsapp_configured
  items.push({
    id: 'whatsapp_configured',
    label: 'WhatsApp configured',
    description:
      'Connect a WhatsApp Business number so customers can message you directly.',
    status:
      typeof operatorRow?.whatsapp_business_phone_number_id === 'string' &&
      operatorRow.whatsapp_business_phone_number_id.trim().length > 0
        ? 'complete'
        : 'warning',
    action_url: '/admin/settings/whatsapp',
    required: false,
  });

  // ── Compute summary ───────────────────────────────────────────────────────

  const requiredItems = items.filter((i) => i.required);
  const can_publish = requiredItems.every((i) => i.status === 'complete');
  const score = Math.round(
    (items.filter((i) => i.status === 'complete').length / items.length) * 100,
  );

  return { items, can_publish, score };
}
