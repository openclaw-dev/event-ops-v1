/**
 * outbound-guard.ts
 *
 * THE single chokepoint for BUSINESS-INITIATED WhatsApp sends (payment recovery,
 * CRM campaigns, and any future outbound marketing). Every such send MUST go
 * through sendBusinessInitiated() so the opt-out registry is consulted exactly
 * once, in one place.
 *
 * Reply-to-inbound sends — the support agent's reply, the inbound pre-router's
 * confirmations, and the human dashboard reply — are EXEMPT by design: they
 * answer a message the customer just sent inside an open, customer-initiated
 * conversation, so an opt-out (which suppresses unsolicited outreach) does not
 * apply. Those paths call the adapter factory directly and are the only files,
 * besides this one and adapter-factory.ts, permitted to import the factory
 * (enforced by ESLint no-restricted-imports; see .eslintrc.json).
 *
 * Opt-out authority: the whatsapp_opt_outs table (migration 0031), keyed by
 * (operator_id, phone_e164). Consulted via the service-role admin client — the
 * webhook/cron callers have no user session, and the table is RLS-locked to
 * SELECT-only for operators anyway.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';
import { normalizePhone } from '@/lib/whatsapp/phone';
import type { SendResult } from '@/lib/whatsapp/types';

/** Payload for a business-initiated send. Only free-text is supported today;
 *  `messageType` records intent (session vs template) for logging/future use. */
export interface BusinessOutboundPayload {
  text: string;
}

export type BusinessSendResult = SendResult | { skipped: 'opted_out' };

/** Type guard so callers can branch on a skip without inspecting `success`. */
export function isSkipped(
  r: BusinessSendResult,
): r is { skipped: 'opted_out' } {
  return 'skipped' in r;
}

/**
 * Throws if WhatsApp is not configured (WHATSAPP_PROVIDER unset/invalid).
 * Lets guard-restricted callers (which may not import the adapter factory
 * directly) do an upfront "is sending even possible?" pre-flight — e.g. the CRM
 * campaign sender cancels the whole campaign rather than failing recipients one
 * by one when the provider is misconfigured.
 */
export function assertWhatsAppConfigured(): void {
  createWhatsAppAdapter();
}

/**
 * Send a business-initiated WhatsApp message, honouring the opt-out registry.
 *
 * Returns { skipped: 'opted_out' } WITHOUT contacting the adapter when the
 * (operator, phone) pair has opted out; otherwise forwards to the provider
 * adapter via the factory and returns its SendResult.
 */
export async function sendBusinessInitiated(params: {
  operatorId: string;
  phone: string;
  messageType: 'session' | 'template';
  payload: BusinessOutboundPayload;
}): Promise<BusinessSendResult> {
  const { operatorId, messageType, payload } = params;
  const phone = normalizePhone(params.phone);

  const admin = createAdminClient();
  const { data: optOut, error } = await admin
    .from('whatsapp_opt_outs')
    .select('phone_e164')
    .eq('operator_id', operatorId)
    .eq('phone_e164', phone)
    .maybeSingle();

  if (error) {
    // Fail SAFE: if we cannot confirm opt-out status, do NOT send. A false send
    // to an opted-out customer is a compliance breach; a missed send is not.
    console.error('[outbound-guard] opt-out lookup failed — suppressing send', {
      operatorId,
      phone,
      error: error.message,
    });
    return { skipped: 'opted_out' };
  }

  if (optOut) {
    console.log('[outbound-guard] blocked', { operatorId, phone });
    return { skipped: 'opted_out' };
  }

  const adapter = createWhatsAppAdapter();
  console.log('[outbound-guard] forwarding to adapter', {
    operatorId,
    phone,
    messageType,
  });
  return adapter.sendText({ to_phone_e164: phone, text: payload.text });
}
