/**
 * /api/webhooks/payments/[provider]
 *
 * Receives PSP payment webhooks (checkout, tap) and is the SOLE code path that
 * confirms a payment-recovery attempt (status='completed'). Fee stats are
 * billed only on captures confirmed here (DECISIONS.md 2026-07-22).
 *
 * Flow:
 *   1. Read the RAW body text and verify the provider signature over the raw
 *      bytes BEFORE parsing JSON. Invalid → 401, store nothing.
 *   2. Parse to a provider-agnostic event; match to a recovery attempt by
 *      recovery_ref, else provider_payment_id.
 *   3. Insert an idempotent ledger row (payment_webhook_events). A duplicate
 *      (provider, provider_event_id) → 200 early (replay), no reprocessing.
 *   4. On a captured/succeeded event, confirm the attempt via
 *      markRecoveryCompleted (zero-rows guard). Unmatched or non-capture events
 *      are stored and logged, no further handling.
 *
 * This route is NOT auth-gated (middleware only blocks /admin + /login); it is
 * authenticated by the PSP signature instead.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { optionalEnv } from '@/lib/env';
import { markRecoveryCompleted } from '@/lib/recovery/payment-recovery';
import type { NormalizedPaymentEvent } from '@/lib/payments/types';
import {
  verifyCheckoutSignature,
  parseCheckoutEvent,
} from '@/lib/payments/verifiers/checkout';
import { verifyTapSignature, parseTapEvent } from '@/lib/payments/verifiers/tap';

interface ProviderConfig {
  secretEnv: string;
  verify: (rawBody: string, headers: Record<string, string>, secret: string) => boolean;
  parse: (payload: unknown) => NormalizedPaymentEvent | null;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  checkout: {
    secretEnv: 'CHECKOUT_WEBHOOK_SECRET',
    verify: verifyCheckoutSignature,
    parse: parseCheckoutEvent,
  },
  tap: {
    secretEnv: 'TAP_WEBHOOK_SECRET',
    verify: verifyTapSignature,
    parse: parseTapEvent,
  },
};

async function markProcessed(
  admin: ReturnType<typeof createAdminClient>,
  webhookEventId: string | undefined,
): Promise<void> {
  if (!webhookEventId) return;
  const { error } = await admin
    .from('payment_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', webhookEventId);
  if (error) {
    console.error('[webhook-pay] processed_at write failed', {
      webhook_event_id: webhookEventId,
      error: error.message,
    });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { provider: string } },
) {
  const provider = params.provider;
  const cfg = PROVIDERS[provider];
  if (!cfg) {
    console.warn('[webhook-pay] rejected', { provider, reason: 'unknown_provider' });
    return NextResponse.json({ error: 'unknown provider' }, { status: 404 });
  }

  const secret = optionalEnv(cfg.secretEnv);
  if (!secret) {
    console.error('[webhook-pay] provider secret not configured', {
      provider,
      env: cfg.secretEnv,
    });
    return NextResponse.json({ error: 'provider not configured' }, { status: 500 });
  }

  // (1) Verify over RAW bytes before any JSON parse.
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers) as Record<string, string>;

  if (!cfg.verify(rawBody, headers, secret)) {
    console.warn('[webhook-pay] rejected', { provider, reason: 'invalid_signature' });
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn('[webhook-pay] rejected', { provider, reason: 'invalid_json' });
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const event = cfg.parse(payload);
  if (!event) {
    console.warn('[webhook-pay] rejected', { provider, reason: 'unparseable_event' });
    return NextResponse.json({ error: 'unparseable event' }, { status: 400 });
  }

  const admin = createAdminClient();

  // (2) Match to a recovery attempt: recovery_ref first, else provider_payment_id.
  let attempt: { id: string; operator_id: string } | null = null;
  if (event.recoveryRef) {
    const { data } = await admin
      .from('payment_recovery_attempts')
      .select('id, operator_id')
      .eq('recovery_ref', event.recoveryRef)
      .maybeSingle();
    attempt = (data as { id: string; operator_id: string } | null) ?? null;
  }
  if (!attempt && event.providerPaymentId) {
    const { data } = await admin
      .from('payment_recovery_attempts')
      .select('id, operator_id')
      .eq('provider_payment_id', event.providerPaymentId)
      .maybeSingle();
    attempt = (data as { id: string; operator_id: string } | null) ?? null;
  }

  // (3) Idempotent ledger insert.
  const { data: inserted, error: insertErr } = await admin
    .from('payment_webhook_events')
    .insert({
      provider,
      provider_event_id: event.providerEventId,
      operator_id: attempt?.operator_id ?? null,
      recovery_attempt_id: attempt?.id ?? null,
      signature_valid: true,
      payload,
      processed_at: null,
    })
    .select('id')
    .maybeSingle();

  if (insertErr) {
    // Unique (provider, provider_event_id) violation → replay of an event we
    // already accepted. Idempotent: 200, no reprocessing.
    if ((insertErr as { code?: string }).code === '23505') {
      console.log('[webhook-pay] duplicate event — idempotent replay dropped', {
        provider,
        provider_event_id: event.providerEventId,
      });
      return NextResponse.json({ ok: true, idempotent: true }, { status: 200 });
    }
    console.error('[webhook-pay] ledger insert failed', {
      provider,
      provider_event_id: event.providerEventId,
      error: insertErr.message,
    });
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  const webhookEventId = (inserted as { id: string } | null)?.id;

  // Unmatched event: stored with null attempt id, logged, no further handling.
  if (!attempt) {
    console.warn('[webhook-pay] event stored but unmatched to any recovery attempt', {
      provider,
      provider_event_id: event.providerEventId,
      recovery_ref: event.recoveryRef,
      provider_payment_id: event.providerPaymentId,
    });
    await markProcessed(admin, webhookEventId);
    return NextResponse.json({ ok: true, matched: false }, { status: 200 });
  }

  // Only a captured/succeeded event confirms and enters fee stats.
  if (!event.captured) {
    console.log('[webhook-pay] matched, non-capture event — not confirming', {
      provider,
      status: event.status,
      recovery_attempt_id: attempt.id,
    });
    await markProcessed(admin, webhookEventId);
    return NextResponse.json({ ok: true, matched: true, confirmed: false }, { status: 200 });
  }

  // (4) Confirm — the ONLY path that sets status='completed' (zero-rows guard
  // inside markRecoveryCompleted surfaces a silent no-op as an error).
  try {
    await markRecoveryCompleted({
      recovery_attempt_id: attempt.id,
      provider,
      provider_payment_id: event.providerPaymentId,
      provider_reference: event.providerReference,
      confirmed_amount: event.amount,
      confirmed_currency: event.currency,
    });
  } catch (err) {
    console.error('[webhook-pay] confirm failed', {
      provider,
      recovery_attempt_id: attempt.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'confirm failed' }, { status: 500 });
  }

  await markProcessed(admin, webhookEventId);
  console.log('[webhook-pay] recovery attempt confirmed', {
    provider,
    recovery_attempt_id: attempt.id,
    confirmed_amount: event.amount,
    confirmed_currency: event.currency,
  });
  return NextResponse.json({ ok: true, matched: true, confirmed: true }, { status: 200 });
}
