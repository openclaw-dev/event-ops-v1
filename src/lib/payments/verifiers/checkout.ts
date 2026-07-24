/**
 * checkout.ts — Checkout.com webhook verifier + parser.
 *
 * Signature: the `cko-signature` header is HMAC-SHA256 of the RAW request body
 * (exact bytes, verified before any JSON parse), keyed by the webhook signature
 * key, rendered as lowercase hex.
 *
 * Single-tenant for the pilot: one CHECKOUT_WEBHOOK_SECRET. Per-operator secrets
 * are a later migration (DECISIONS.md 2026-07-22).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedPaymentEvent } from '@/lib/payments/types';
import { minorToMajor } from '@/lib/payments/amount';

/** Compute the expected cko-signature hex for a raw body. Exported so tests
 *  build fixtures with the identical algorithm (no hand-rolled hashing). */
export function computeCheckoutSignature(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifyCheckoutSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  const provided = (headers['cko-signature'] ?? headers['Cko-Signature'] ?? '').trim();
  if (!provided) return false;

  const expected = computeCheckoutSignature(rawBody, secret);
  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

// Statuses/types that mean money was captured.
const CAPTURED_TYPES = new Set(['payment_captured']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function extractRecoveryRef(reference: string | null, metadata: unknown): string | null {
  if (metadata && typeof metadata === 'object') {
    const m = metadata as Record<string, unknown>;
    const fromMeta = str(m.recovery_ref);
    if (fromMeta) return fromMeta;
  }
  if (reference && /^TZK-/i.test(reference)) return reference;
  return null;
}

export function parseCheckoutEvent(payload: unknown): NormalizedPaymentEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as Record<string, unknown>;

  const providerEventId = str(body.id);
  const type = str(body.type) ?? '';
  const data = (body.data && typeof body.data === 'object'
    ? (body.data as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  if (!providerEventId) return null;

  const reference = str(data.reference);
  const currency = str(data.currency);
  const amountMinor = typeof data.amount === 'number' ? data.amount : null;

  return {
    providerEventId,
    recoveryRef: extractRecoveryRef(reference, data.metadata),
    providerPaymentId: str(data.id),
    providerReference: reference,
    amount: amountMinor != null ? minorToMajor(amountMinor, currency) : null,
    currency,
    status: type,
    captured: CAPTURED_TYPES.has(type),
  };
}
