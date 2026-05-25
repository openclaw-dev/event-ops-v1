'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

interface KbFiltersProps {
  categories: string[];
  intents: string[];
  currentCategory: string;
  currentIntent: string;
}

/**
 * Client-side filter selects that update the URL search params, triggering
 * a server-side re-fetch of the sections list.
 */
export function KbFilters({
  categories,
  intents,
  currentCategory,
  currentIntent,
}: KbFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset to page 1 when filter changes.
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={currentCategory}
        onChange={(e) => updateParam('category', e.target.value)}
        className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Filter by category"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={currentIntent}
        onChange={(e) => updateParam('intent', e.target.value)}
        className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Filter by intent"
      >
        <option value="">All intents</option>
        {intents.map((intent) => (
          <option key={intent} value={intent}>
            {intent}
          </option>
        ))}
      </select>
    </div>
  );
}
