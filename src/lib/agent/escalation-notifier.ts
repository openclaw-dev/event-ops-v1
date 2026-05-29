/**
 * escalation-notifier.ts
 *
 * Sends a WhatsApp notification to each escalation contact configured
 * with method: 'whatsapp'. In-app handoff contacts are skipped — they
 * see escalations directly in the admin dashboard.
 *
 * Every send is wrapped in try/catch. Notification failure must never
 * block the customer-facing response. Caller should also wrap the outer
 * call in try/catch as a second line of defence.
 */

import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';
import type { EventConfig } from '@/lib/types';

const DASHBOARD_BASE = 'https://tazkar.co';

export async function notifyEscalationContacts(params: {
  event: Record<string, unknown>;
  escalation_id: string;
  customer_phone: string;
  trigger_message: string;
  intent: string;
}): Promise<void> {
  const { event, escalation_id, customer_phone, trigger_message, intent } = params;

  const eventConfig = event.config as EventConfig | undefined;
  const contacts = eventConfig?.escalation_contacts ?? [];

  // Filter to WhatsApp contacts that have a phone number configured.
  const whatsAppContacts = contacts.filter(
    (c) => c.method === 'whatsapp' && c.phone && c.phone.trim().length > 0,
  );

  if (whatsAppContacts.length === 0) return;

  // Initialise adapter — throws if WHATSAPP_PROVIDER env var is not set.
  let adapter: ReturnType<typeof createWhatsAppAdapter>;
  try {
    adapter = createWhatsAppAdapter();
  } catch (err) {
    console.warn(
      '[escalation-notifier] WhatsApp adapter unavailable (provider not configured):',
      err,
    );
    return;
  }

  const eventId = event.id as string | undefined ?? '';
  const eventName = (event.name as string | undefined) ?? eventConfig?.event_name ?? 'Event';

  const truncatedMessage =
    trigger_message.length > 100
      ? `${trigger_message.slice(0, 100)}…`
      : trigger_message;

  const dashboardUrl = `${DASHBOARD_BASE}/admin/events/${eventId}/escalations`;

  const body =
    `🚨 Escalation — ${eventName}\n\n` +
    `Customer: ${customer_phone}\n` +
    `Intent: ${intent}\n` +
    `Message: "${truncatedMessage}"\n\n` +
    `View in dashboard: ${dashboardUrl}`;

  for (const contact of whatsAppContacts) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const result = await adapter.sendText({
        to_phone_e164: contact.phone!,
        text: body,
      });

      if (result.success) {
        console.log(
          `[escalation-notifier] Notified "${contact.name}" (${contact.phone}) ` +
            `for escalation ${escalation_id}`,
        );
      } else {
        console.warn(
          `[escalation-notifier] Failed to notify "${contact.name}": ${result.error ?? 'unknown error'}`,
        );
      }
    } catch (sendErr) {
      console.error(
        `[escalation-notifier] Send error for contact "${contact.name}":`,
        sendErr,
      );
    }
  }
}
