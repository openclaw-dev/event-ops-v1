import { createAdminClient } from '@/lib/supabase/admin';
import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecoveryStats {
  total_attempts: number;
  sent: number;
  completed: number;
  expired: number;
  total_amount_sar: number;
  recovered_amount_sar: number;
  recovery_rate_pct: number;
  recovery_fee_sar: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(v: number | string | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
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
}): Promise<{ success: boolean; wamid?: string; error?: string }> {
  const admin = createAdminClient();

  const { data: attempt } = await admin
    .from('payment_recovery_attempts')
    .select(
      'customer_phone_e164, customer_name, ticket_type, quantity, amount_sar, payment_link, event_id',
    )
    .eq('id', params.recovery_attempt_id)
    .single();

  if (!attempt) {
    return { success: false, error: 'Recovery attempt not found' };
  }

  const a = attempt as {
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
    const adapter = createWhatsAppAdapter();
    const result = await adapter.sendText({
      to_phone_e164: a.customer_phone_e164,
      text,
    });

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

// ─── markRecoveryCompleted ────────────────────────────────────────────────────

export async function markRecoveryCompleted(
  recovery_attempt_id: string,
): Promise<void> {
  const admin = createAdminClient();
  // Zero-rows guard (audit 1.5): recovery-fee stats depend on this transition,
  // so a silent no-op must surface as a thrown error rather than a false success.
  const { data, error } = await admin
    .from('payment_recovery_attempts')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', recovery_attempt_id)
    .select('id');

  if (error) {
    throw new Error('markRecoveryCompleted failed: ' + error.message);
  }
  if (!data || data.length === 0) {
    throw new Error(
      `markRecoveryCompleted: no recovery attempt found for id ${recovery_attempt_id}`,
    );
  }
}

// ─── getRecoveryStats ─────────────────────────────────────────────────────────

export async function getRecoveryStats(eventId: string): Promise<RecoveryStats> {
  const admin = createAdminClient();

  const { data } = await admin
    .from('payment_recovery_attempts')
    .select('status, amount_sar')
    .eq('event_id', eventId);

  const rows = (data ?? []) as Array<{ status: string; amount_sar: number | string }>;

  const total_attempts = rows.length;
  // "sent" = any row that was successfully dispatched (sent, opened, or completed)
  const sent = rows.filter(
    (r) => r.status === 'sent' || r.status === 'opened' || r.status === 'completed',
  ).length;
  const completed = rows.filter((r) => r.status === 'completed').length;
  const expired = rows.filter((r) => r.status === 'expired').length;
  const total_amount_sar = rows.reduce((sum, r) => sum + toNumber(r.amount_sar), 0);
  const recovered_amount_sar = rows
    .filter((r) => r.status === 'completed')
    .reduce((sum, r) => sum + toNumber(r.amount_sar), 0);
  const recovery_rate_pct = sent === 0 ? 0 : (completed / sent) * 100;
  const recovery_fee_sar = recovered_amount_sar * 0.22;

  return {
    total_attempts,
    sent,
    completed,
    expired,
    total_amount_sar,
    recovered_amount_sar,
    recovery_rate_pct,
    recovery_fee_sar,
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
