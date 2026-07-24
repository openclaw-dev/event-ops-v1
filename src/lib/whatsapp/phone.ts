/**
 * phone.ts
 *
 * Single source of truth for WhatsApp phone-number normalisation. Shared by the
 * outbound chokepoint (outbound-guard.ts) and the inbound STOP writer
 * (inbound-pre-router.ts) so the opt-out lookup key and the opt-out write key
 * are guaranteed byte-identical.
 *
 * Canonical stored format across the codebase is E.164 WITH a leading '+':
 *   • parse-meta-compatible.ts prepends '+' to Meta's digits-only wa_id;
 *   • inbound/route.ts normalisePhone() does the same;
 *   • recovery bulk upload validates /^\+[1-9]\d{6,14}$/.
 *
 * normalizePhone() strips every non-digit and re-prefixes '+', so a value that
 * arrives with spaces, dashes, or a leading '00'/'+' collapses to the same
 * canonical key. For already-validated data this is a no-op.
 */

/** Normalise any phone string to canonical E.164: '+' + digits-only. */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  return digits ? `+${digits}` : '';
}
