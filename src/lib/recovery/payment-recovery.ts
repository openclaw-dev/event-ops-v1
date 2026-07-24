import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendBusinessInitiated, isSkipped } from '@/lib/whatsapp/outbound-guard';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecoveryStats {
  total_attempts: number;
  sent: number;
  completed: number;
  expired: number;
  total_amount_sar: number;
  // Actuals — sourced EXCLUSIVELY from webhook-confirmed rows (audit: fee is
  // billed only on signed-PSP-confirmed captures; customer text claims never
  // enter these numbers). See DECISIONS.md 2026-07-22.
  recovered_amount_sar: number;
  recovery_rate_pct: number;
  recovery_fee_sar: number;
  // Soft signal: customer said "paid"/"تم" but no signed webhook has confirmed.
  // Never billed; surfaced separately so the dashboard can show pipeline.
  claimed_awaiting_confirmation: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Correlation key embedded in the PSP payment-link reference. The payment
// webhook matches an incoming capture back to its attempt via this ref
// (DECISIONS.md 2026-07-22). 'TZK-' + 6 uppercase RFC-4648 base32 chars.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateRecoveryRef(): string {
  const bytes = randomBytes(6);
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += BASE32_ALPHABET[bytes[i] % 32];
  }
  return `TZK-${suffix}`;
}

function fmtAmount(amount: number): string {
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─── createRecoveryAttempt ────────────────────────────────────────────────────

export async function createRecoveryAttempt(params: {
  operator_id: string;
  event_id: string;
  customer_phone_e164: string;
  customer_name?: string;
  customer_email?: string;
  original_order_id?: string;
  ticket_type?: string;
  quantity?: number;
  amount_sar: number;
  payment_link: string;
  payment_provider: string;
}): Promise<{ id: string }> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('payment_recovery_attempts')
    .insert({
      operator_id: params.operator_id,
      event_id: params.event_id,
      customer_phone_e164: params.customer_phone_e164,
      customer_name: params.customer_name ?? null,
      customer_email: params.customer_email ?? null,
      original_order_id: params.original_order_id ?? null,
      ticket_type: params.ticket_type ?? null,
      quantity: params.quantity ?? 1,
      amount_sar: params.amount_sar,
      payment_link: params.payment_link,
      payment_provider: params.payment_provider,
      recovery_fee_sar: params.amount_sar * 0.22,
      recovery_ref: generateRecoveryRef(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create recovery attempt');
  }

  return { id: (data as { id: string }).id };
}

// ─── sendRecoveryMessage ──────────────────────────────────────────────────────

export async function sendRecoveryMessage(params: {
  recovery_attempt_id: string;
  event_name: string;
  customer_name?: string;
}): Promise<{ success: boolean; wamid?: string; error?: string; skipped?: boolean }> {
  const admin = createAdminClient();

  const { data: attempt } = await admin
    .from('payment_recovery_attempts')
    .select(
      'operator_id, customer_phone_e164, customer_name, ticket_type, quantity, amount_sar, payment_link, event_id',
    )
    .eq('id', params.recovery_attempt_id)
    .single();

  if (!attempt) {
    return { success: false, error: 'Recovery attempt not found' };
  }

  const a = attempt as {
    operator_id: string;
    customer_phone_e164: string;
    customer_name: string | null;
    ticket_type: string | null;
    quantity: number;
    amount_sar: number | string;
    payment_link: string | null;
    event_id: string;
  };

  // Demo guard (audit 8.2): never send a real WhatsApp message for a demo event.
  const { data: eventRow, error: eventError } = await admin
    .from('events')
    .select('is_demo')
    .eq('id', a.event_id)
    .single();
  if (eventError) {
    console.error('[recovery/sendRecoveryMessage] demo-event check failed', {
      recovery_attempt_id: params.recovery_attempt_id,
      event_id: a.event_id,
      error: eventError.message,
    });
  }
  if ((eventRow as { is_demo: boolean } | null)?.is_demo) {
    console.warn('[recovery/sendRecoveryMessage] demo event — WhatsApp send suppressed', {
      recovery_attempt_id: params.recovery_attempt_id,
      event_id: a.event_id,
    });
    return { success: false, error: 'Demo event — WhatsApp send suppressed.' };
  }

  const greeting = params.customer_name ?? a.customer_name ?? 'there';
  const amount = toNumber(a.amount_sar);
  const ticketLine = a.ticket_type
    ? `🎟️ ${a.ticket_type} × ${a.quantity}`
    : `🎟️ ${a.quantity} ticket${a.quantity !== 1 ? 's' : ''}`;

  const text =
    `Hi ${greeting}! 👋\n\n` +
    `Your order for ${params.event_name} is almost complete.\n\n` +
    `${ticketLine}\n` +
    `💰 SAR ${fmtAmount(amount)}\n\n` +
    `Complete your payment here:\n${a.payment_link ?? ''}\n\n` +
    `This link expires in 24 hours. Reply STOP to opt out.`;

  // Per-attempt status write helper — every write is checked and logged so a
  // silent failure no longer leaves an attempt stuck 'pending' (audit 6.2).
  const markAttempt = async (patch: Record<string, unknown>): Promise<void> => {
    const { error } = await admin
      .from('payment_recovery_attempts')
      .update(patch)
      .eq('id', params.recovery_attempt_id);
    if (error) {
      console.error('[recovery/sendRecoveryMessage] attempt status write failed', {
        recovery_attempt_id: params.recovery_attempt_id,
        patch_status: patch.status ?? null,
        error: error.message,
      });
    }
  };

  try {
    // Business-initiated → MUST go through the outbound guard (opt-out check).
    const result = await sendBusinessInitiated({
      operatorId: a.operator_id,
      phone: a.customer_phone_e164,
      messageType: 'template',
      payload: { text },
    });

    if (isSkipped(result)) {
      // Opted out: no message sent. Terminal 'failed' (the enum has no
      // dedicated skip state) so the attempt does not linger 'pending' or
      // count toward recovered revenue; the reason is logged for audit.
      await markAttempt({ status: 'failed', updated_at: new Date().toISOString() });
      console.log('[recovery/sendRecoveryMessage] suppressed — recipient opted out', {
        recovery_attempt_id: params.recovery_attempt_id,
      });
      return { success: false, error: 'opted_out', skipped: true };
    }

    if (result.success) {
      await markAttempt({
        status: 'sent',
        sent_at: new Date().toISOString(),
        whatsapp_message_wamid: result.wamid ?? null,
        updated_at: new Date().toISOString(),
      });
    } else {
      await markAttempt({ status: 'failed', updated_at: new Date().toISOString() });
    }

    return { success: result.success, wamid: result.wamid, error: result.error };
  } catch (err) {
    await markAttempt({ status: 'failed', updated_at: new Date().toISOString() });
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── markRecoveryHeuristicSignal ──────────────────────────────────────────────
// A customer text like "paid" / "تم" is a SOFT signal, not a confirmation. It
// records heuristic_paid_signal_at only — it must NEVER set status='completed'
// or webhook_confirmed_at (those are reserved for the signed-PSP webhook
// processor; see DECISIONS.md 2026-07-22 and markRecoveryCompleted below).
export async function markRecoveryHeuristicSignal(
  recovery_attempt_id: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('payment_recovery_attempts')
    .update({
      heuristic_paid_signal_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', recovery_attempt_id)
    .select('id');

  if (error) {
    throw new Error('markRecoveryHeuristicSignal failed: ' + error.message);
  }
  if (!data || data.length === 0) {
    throw new Error(
      `markRecoveryHeuristicSignal: no recovery attempt found for id ${recovery_attempt_id}`,
    );
  }
}

// ─── markRecoveryCompleted ────────────────────────────────────────────────────
// AUTHORITATIVE completion. status='completed' is reachable ONLY from here, and
// this is called ONLY by the signed payment-webhook processor
// (src/app/api/webhooks/payments/[provider]/route.ts). Do not call it from any
// heuristic / customer-text path — that is what markRecoveryHeuristicSignal is
// for (DECISIONS.md 2026-07-22).
export async function markRecoveryCompleted(params: {
  recovery_attempt_id: string;
  provider: string;
  provider_payment_id: string | null;
  provider_reference: string | null;
  confirmed_amount: number | null;
  confirmed_currency: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  // Zero-rows guard (audit 1.5): recovery-fee stats depend on this transition,
  // so a silent no-op must surface as a thrown error rather than a false success.
  const { data, error } = await admin
    .from('payment_recovery_attempts')
    .update({
      status: 'completed',
      completed_at: nowIso,
      webhook_confirmed_at: nowIso,
      confirmed_amount: params.confirmed_amount,
      confirmed_currency: params.confirmed_currency,
      provider: params.provider,
      provider_payment_id: params.provider_payment_id,
      provider_reference: params.provider_reference,
      updated_at: nowIso,
    })
    .eq('id', params.recovery_attempt_id)
    .select('id');

  if (error) {
    throw new Error('markRecoveryCompleted failed: ' + error.message);
  }
  if (!data || data.length === 0) {
    throw new Error(
      `markRecoveryCompleted: no recovery attempt found for id ${params.recovery_attempt_id}`,
    );
  }
}

// ─── getRecoveryStats ─────────────────────────────────────────────────────────

export async function getRecoveryStats(eventId: string): Promise<RecoveryStats> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('payment_recovery_attempts')
    .select(
      'status, amount_sar, confirmed_amount, webhook_confirmed_at, heuristic_paid_signal_at',
    )
    .eq('event_id', eventId);

  const rows = (data ?? []) as Array<{
    status: string;
    amount_sar: number | string;
    confirmed_amount: number | string | null;
    webhook_confirmed_at: string | null;
    heuristic_paid_signal_at: string | null;
  }>;

  const total_attempts = rows.length;
  // "sent" = any row that was successfully dispatched (sent, opened, or completed)
  const sent = rows.filter(
    (r) => r.status === 'sent' || r.status === 'opened' || r.status === 'completed',
  ).length;
  const completed = rows.filter((r) => r.status === 'completed').length;
  const expired = rows.filter((r) => r.status === 'expired').length;
  const total_amount_sar = rows.reduce((sum, r) => sum + toNumber(r.amount_sar), 0);

  // Recovered revenue and the billable 22% fee come EXCLUSIVELY from rows a
  // signed PSP webhook has confirmed (webhook_confirmed_at not null), summing
  // the confirmed_amount the PSP actually captured — never amount_sar and
  // never customer text claims (audit / DECISIONS.md 2026-07-22).
  const confirmedRows = rows.filter((r) => r.webhook_confirmed_at != null);
  const recovered_amount_sar = confirmedRows.reduce(
    (sum, r) => sum + toNumber(r.confirmed_amount),
    0,
  );
  const recovery_rate_pct = sent === 0 ? 0 : (confirmedRows.length / sent) * 100;
  const recovery_fee_sar = recovered_amount_sar * 0.22;

  // Soft-signal pipeline: customer claimed payment but no signed webhook yet.
  const claimed_awaiting_confirmation = rows.filter(
    (r) => r.heuristic_paid_signal_at != null && r.webhook_confirmed_at == null,
  ).length;

  return {
    total_attempts,
    sent,
    completed,
    expired,
    total_amount_sar,
    recovered_amount_sar,
    recovery_rate_pct,
    recovery_fee_sar,
    claimed_awaiting_confirmation,
  };
}

// ─── expireStaleRecoveryAttempts ──────────────────────────────────────────────

export async function expireStaleRecoveryAttempts(): Promise<number> {
  const admin = createAdminClient();

  // Expire any attempt that was dispatched but never completed once its 24h
  // window passes — not just 'pending' ones. The message promises "expires in
  // 24 hours", so 'sent' and 'opened' attempts must expire too, or stats
  // over-count active links and customers get re-messaged against a dead one
  // (audit 4.10).
  const { data, error } = await admin
    .from('payment_recovery_attempts')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .in('status', ['pending', 'sent', 'opened'])
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    throw new Error('expireStaleRecoveryAttempts failed: ' + error.message);
  }

  return data?.length ?? 0;
}
