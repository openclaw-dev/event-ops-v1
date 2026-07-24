/**
 * amount.ts — currency decimal handling shared by the verifiers.
 *
 * Most currencies use 2 minor-unit decimals; the Gulf 3-decimal currencies
 * (KWD/BHD/OMR) and the zero-decimal ones are enumerated. Default is 2.
 */

const THREE_DECIMAL = new Set(['KWD', 'BHD', 'OMR', 'TND', 'JOD', 'IQD', 'LYD']);
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CLP', 'VND', 'XOF', 'XAF']);

export function currencyDecimals(currency: string | null | undefined): number {
  if (!currency) return 2;
  const c = currency.toUpperCase();
  if (THREE_DECIMAL.has(c)) return 3;
  if (ZERO_DECIMAL.has(c)) return 0;
  return 2;
}

/** Convert a minor-unit integer amount (e.g. Checkout's 15000) to major units. */
export function minorToMajor(amountMinor: number, currency: string | null): number {
  const d = currencyDecimals(currency);
  return amountMinor / 10 ** d;
}

/** Format a major-unit amount to the currency's decimal places (Tap's hashstring
 *  uses the amount rendered to the currency's decimals). */
export function formatMajorAmount(amountMajor: number, currency: string | null): string {
  return amountMajor.toFixed(currencyDecimals(currency));
}
