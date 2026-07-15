/**
 * paginate.ts
 *
 * PostgREST caps a select at ~1000 rows by default, silently — a query that
 * returns exactly the cap looks "complete" while dropping everything past it,
 * which undercounts revenue/no-show/deflection stats on large events (audit
 * 4.14). fetchAllRows walks the full result set in fixed-size pages via
 * .range() so counts and sums are exact regardless of table size.
 *
 * Use this when the code needs the ROWS (to sum/reduce or build an id list).
 * When only a count is needed, prefer `.select('id', { count: 'exact', head: true })`.
 */

interface PagedResponse<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Runs `makeQuery(from, to)` repeatedly with advancing .range() bounds until a
 * page returns fewer rows than `pageSize` (the last page). Throws on any query
 * error so a partial result never masquerades as complete.
 */
export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => Promise<PagedResponse<T>>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) {
      throw new Error(`fetchAllRows: ${error.message}`);
    }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
