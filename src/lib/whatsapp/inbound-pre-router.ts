/**
 * inbound-pre-router.ts
 *
 * Runs at the top of the customer WhatsApp flow (after wamid dedup, before ANY
 * AI classification/generation). Intercepts messages that must not be answered
 * by the generic support agent (audit 5.3):
 *
 *   (a) STOP / opt-out keywords — mark matching CRM campaign recipients
 *       'opted_out', acknowledge with a confirmation, and suppress the AI.
 *       This is a compliance requirement: the recovery/CRM messages tell the
 *       customer "Reply STOP to opt out", so STOP must never reach the agent.
 *   (b) recovery / CRM reply context — a reply from a phone that has an open
 *       payment-recovery attempt or campaign recipient is logged, and a
 *       completion signal ("paid" / "done" / "تم") transitions the matched
 *       recovery attempt(s) to 'completed' via markRecoveryCompleted (which
 *       previously had zero callers — audit 5.3c). Non-completion replies are
 *       logged and fall through to the support agent (minimum-viable per 5.3b;
 *       we deliberately do not over-build a bespoke recovery conversation).
 *
 * SCHEMA NOTE (audit 5.3a) — READ BEFORE EXTENDING:
 *   `payment_recovery_attempts` has NO opt-out status or column: the 0026 status
 *   enum is (pending|sent|opened|completed|failed|expired). A recovery opt-out
 *   therefore CANNOT be durably recorded without a schema change, which is out
 *   of scope for this fix session (no migration was written). We honour the
 *   opt-out behaviourally (suppress AI + confirm) and log the matched recovery
 *   attempts, but only CRM recipients are durably marked, because the 0027
 *   `crm_campaign_recipients.status` enum DOES include 'opted_out'. A durable,
 *   cross-flow opt-out would need a dedicated column/table — see AUDIT_2026-07.
 *
 * All access is via createAdminClient() (the webhook has no user session); every
 * query is scoped by the operator that owns the receiving WhatsApp number.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { WhatsAppAdapter } from '@/lib/whatsapp/types';
import { markRecoveryCompleted } from '@/lib/recovery/payment-recovery';

// Exact-match (after normalisation) opt-out keywords. Exact match — not
// substring — so an ordinary sentence containing "stop" does not trigger a
// false opt-out. Arabic forms per the audit: إيقاف / الغاء / إلغاء (with and
// without the hamza), plus the WhatsApp-standard English keywords.
const OPT_OUT_KEYWORDS = new Set<string>([
  'stop',
  'unsubscribe',
  'unsub',
  'إيقاف',
  'ايقاف',
  'إلغاء',
  'الغاء',
]);

// Completion keywords — only consulted when the sender has an OPEN recovery
// attempt, so the surrounding context (a live payment link) makes these a
// strong "I've paid" signal. Kept deliberately small; see the false-positive
// note in AUDIT_2026-07 (a text signal is weaker than a payment webhook).
const COMPLETION_KEYWORDS = new Set<string>([
  'paid',
  'i paid',
  'done',
  'payment done',
  'payment complete',
  'completed',
  'تم',
  'تم الدفع',
  'دفعت',
]);

/** Trim, lowercase, and strip trailing punctuation for exact keyword matching. */
function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.!?,،؛:]+$/, '')
    .trim();
}

export type PreRouteBranch = 'opt_out' | 'recovery_completed';

export type PreRouteResult =
  | { handled: false }
  | { handled: true; branch: PreRouteBranch };

/**
 * Pre-route an inbound customer text. Returns { handled: true } when the message
 * was fully handled here (the caller must NOT pass it to the AI) or
 * { handled: false } when the caller should continue to the normal flow.
 */
export async function preRouteInbound(params: {
  adapter: WhatsAppAdapter;
  operatorId: string;
  phone: string; // normalised E.164
  text: string;
}): Promise<PreRouteResult> {
  const { adapter, operatorId, phone, text } = params;
  const admin = createAdminClient();
  const norm = normalise(text);

  // ── (a) Opt-out ───────────────────────────────────────────────────────────
  if (OPT_OUT_KEYWORDS.has(norm)) {
    // CRM: durably mark open recipients 'opted_out' (0027 enum supports it).
    const { data: crmOptedOut, error: crmErr } = await admin
      .from('crm_campaign_recipients')
      .update({ status: 'opted_out' })
      .eq('operator_id', operatorId)
      .eq('customer_phone_e164', phone)
      .in('status', ['pending', 'sent', 'delivered'])
      .select('id');
    if (crmErr) {
      console.error('[inbound] pre-router: CRM opt-out write failed', {
        phone,
        error: crmErr.message,
      });
    }

    // Recovery: match open attempts for visibility only. There is NO opt-out
    // column on payment_recovery_attempts (see SCHEMA NOTE) — we cannot durably
    // record the opt-out here without a migration, which is out of scope.
    const { data: recMatched, error: recErr } = await admin
      .from('payment_recovery_attempts')
      .select('id')
      .eq('operator_id', operatorId)
      .eq('customer_phone_e164', phone)
      .in('status', ['pending', 'sent', 'opened']);
    if (recErr) {
      console.error('[inbound] pre-router: recovery opt-out lookup failed', {
        phone,
        error: recErr.message,
      });
    }

    console.log('[inbound] pre-router: opt-out keyword — suppressing AI', {
      phone,
      crm_recipients_opted_out: crmOptedOut?.length ?? 0,
      recovery_attempts_matched: recMatched?.length ?? 0,
      // No schema column exists to persist a recovery opt-out — audit 5.3a.
      recovery_durably_recorded: false,
    });

    const sendResult = await adapter.sendText({
      to_phone_e164: phone,
      text: "You've been unsubscribed and won't receive further messages. Reply any time if you need help.",
    });
    console.log('[inbound] pre-router: opt-out confirmation sent', {
      phone,
      success: sendResult.success,
      error: sendResult.error ?? null,
    });
    return { handled: true, branch: 'opt_out' };
  }

  // ── (b) Recovery reply context ──────────────────────────────────────────────
  const { data: recOpen, error: recCtxErr } = await admin
    .from('payment_recovery_attempts')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('customer_phone_e164', phone)
    .in('status', ['pending', 'sent', 'opened']);
  if (recCtxErr) {
    console.error('[inbound] pre-router: recovery context lookup failed', {
      phone,
      error: recCtxErr.message,
    });
  }
  const openRecovery = (recOpen ?? []) as Array<{ id: string }>;

  if (openRecovery.length > 0) {
    // (c) Completion signal → wire markRecoveryCompleted (was uncalled).
    if (COMPLETION_KEYWORDS.has(norm)) {
      let completed = 0;
      for (const attempt of openRecovery) {
        try {
          await markRecoveryCompleted(attempt.id);
          completed++;
        } catch (err) {
          console.error('[inbound] pre-router: markRecoveryCompleted failed', {
            recovery_attempt_id: attempt.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (completed > 0) {
        console.log('[inbound] pre-router: recovery completion — marked completed', {
          phone,
          completed,
          matched: openRecovery.length,
        });
        const sendResult = await adapter.sendText({
          to_phone_e164: phone,
          text: 'Thank you! Your payment has been confirmed. See you at the event! 🎉',
        });
        console.log('[inbound] pre-router: recovery completion confirmation sent', {
          phone,
          success: sendResult.success,
          error: sendResult.error ?? null,
        });
        return { handled: true, branch: 'recovery_completed' };
      }
      // Every completion write failed — fall through so the customer still gets
      // an answer from the agent rather than silence.
    }

    // Non-completion recovery reply: log the context and let the support agent
    // answer it (minimum-viable per audit 5.3b — no bespoke recovery handler).
    console.log('[inbound] pre-router: recovery-context reply — routing to support agent', {
      phone,
      open_attempts: openRecovery.length,
    });
    return { handled: false };
  }

  // ── (b) CRM reply context ───────────────────────────────────────────────────
  const { data: crmOpen, error: crmCtxErr } = await admin
    .from('crm_campaign_recipients')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('customer_phone_e164', phone)
    .in('status', ['pending', 'sent', 'delivered'])
    .limit(1);
  if (crmCtxErr) {
    console.error('[inbound] pre-router: CRM context lookup failed', {
      phone,
      error: crmCtxErr.message,
    });
  }
  if (crmOpen && crmOpen.length > 0) {
    console.log('[inbound] pre-router: CRM-context reply — routing to support agent', {
      phone,
    });
  }

  return { handled: false };
}
