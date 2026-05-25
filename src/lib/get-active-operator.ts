import { cookies } from 'next/headers';

/** Cookie key used to persist the operator selection across requests. */
export const SELECTED_OPERATOR_COOKIE = 'selected_operator_id';

/**
 * Given a list of operator IDs the current user belongs to, returns the
 * active operator ID.
 *
 * Resolution order:
 *   1. The value stored in the `selected_operator_id` cookie — but only if it
 *      is present in `operatorIds` (guards against stale/tampered cookies).
 *   2. The first element of `operatorIds`.
 *   3. `undefined` when the list is empty (user has no operators yet).
 *
 * Reads `cookies()` internally — must be called from a Server Component,
 * Route Handler, or Server Action.
 */
export function resolveActiveOperatorId(operatorIds: string[]): string | undefined {
  if (operatorIds.length === 0) return undefined;
  const savedId = cookies().get(SELECTED_OPERATOR_COOKIE)?.value;
  return savedId && operatorIds.includes(savedId) ? savedId : operatorIds[0];
}
