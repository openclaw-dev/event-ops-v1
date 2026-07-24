/**
 * types.ts — shared shapes for the payment-webhook processor.
 */

/** Provider-agnostic view of a payment webhook, produced by each verifier's
 *  parse() so the route handler is provider-independent. */
export interface NormalizedPaymentEvent {
  /** Provider's unique event id — the idempotency key (provider_event_id). */
  providerEventId: string;
  /** TZK-XXXXXX correlation ref extracted from the PSP reference/metadata. */
  recoveryRef: string | null;
  /** Provider's payment/charge id (fallback correlation key). */
  providerPaymentId: string | null;
  /** Raw provider reference string, stored for audit. */
  providerReference: string | null;
  /** Captured amount in MAJOR units (e.g. 150.00 SAR), or null. */
  amount: number | null;
  /** ISO-4217 currency code, or null. */
  currency: string | null;
  /** Raw provider status/type string. */
  status: string;
  /** Normalised money-captured signal — true only for a captured/succeeded event. */
  captured: boolean;
}
