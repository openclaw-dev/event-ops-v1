/**
 * tap.ts — Tap Payments webhook verifier + parser.
 *
 * Signature: the `hashstring` header is HMAC-SHA256 (hex) of a fixed
 * field-concatenation of the charge, keyed by TAP_WEBHOOK_SECRET, per Tap's
 * "Verify Webhook" scheme:
 *
 *   x_id{id}x_amount{amount}x_currency{currency}
 *   x_gateway_reference{gateway.reference}x_payment_reference{reference.payment}
 *   x_status{status}x_created{transaction.created}
 *
 * The amount is rendered to the currency's decimal places. Implemented per the
 * documented scheme; because live Tap payload nuances (field presence) can vary
 * by product, the unit tests exercise the raw-byte plumbing and tamper
 * detection using computeTapHashString to build fixtures. Single-tenant secret
 * for the pilot (DECISIONS.md 2026-07-22).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedPaymentEvent } from '@/lib/payments/types';
import { formatMajorAmount } from '@/lib/payments/amount';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Build Tap's toBeHashed string from a parsed charge payload, then HMAC it.
 *  Exported so tests build fixtures with the identical algorithm. */
export function computeTapHashString(payload: unknown, secret: string): string {
  const body = obj(payload);
  const gateway = obj(body.gateway);
  const reference = obj(body.reference);
  const transaction = obj(body.transaction);

  const id = str(body.id) ?? '';
  const currency = str(body.currency);
  const amountNum = typeof body.amount === 'number' ? body.amount : 0;
  const amount = formatMajorAmount(amountNum, currency);

  const toBeHashed =
    `x_id${id}` +
    `x_amount${amount}` +
    `x_currency${currency ?? ''}` +
    `x_gateway_reference${str(gateway.reference) ?? ''}` +
    `x_payment_reference${str(reference.payment) ?? ''}` +
    `x_status${str(body.status) ?? ''}` +
    `x_created${str(transaction.created) ?? ''}`;

  return createHmac('sha256', secret).update(toBeHashed, 'utf8').digest('hex');
}

export function verifyTapSignature(
  rawBody: string,
  headers: Record<string, string>,
  secret: string,
): boolean {
  const provided = (headers['hashstring'] ?? headers['Hashstring'] ?? '').trim();
  if (!provided) return false;

  // Tap signs specific fields of the parsed body, not the raw bytes — but we
  // still parse from the exact raw body we received (no re-serialisation) so a
  // tampered payload cannot pass.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }

  const expected = computeTapHashString(parsed, secret);
  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

// Tap capture status.
const CAPTURED_STATUSES = new Set(['CAPTURED']);

function extractRecoveryRef(payload: Record<string, unknown>): string | null {
  const metadata = obj(payload.metadata);
  const fromMeta = str(metadata.recovery_ref);
  if (fromMeta) return fromMeta;
  const reference = obj(payload.reference);
  const order = str(reference.order);
  if (order && /^TZK-/i.test(order)) return order;
  return null;
}

export function parseTapEvent(payload: unknown): NormalizedPaymentEvent | null {
  const body = obj(payload);
  const providerEventId = str(body.id);
  if (!providerEventId) return null;

  const reference = obj(body.reference);
  const status = str(body.status) ?? '';
  const currency = str(body.currency);

  return {
    providerEventId,
    recoveryRef: extractRecoveryRef(body),
    providerPaymentId: providerEventId,
    providerReference: str(reference.order) ?? str(reference.payment),
    amount: typeof body.amount === 'number' ? body.amount : null,
    currency,
    status,
    captured: CAPTURED_STATUSES.has(status.toUpperCase()),
  };
}
