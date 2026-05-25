'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

interface OrdersFiltersProps {
  currentStatus: string;
  currentVip: string;
}

const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'payment_failed', label: 'Payment failed' },
  { value: 'payment_pending', label: 'Payment pending' },
  { value: 'refunded', label: 'Refunded' },
];

const VIP_OPTIONS = [
  { value: '', label: 'All orders' },
  { value: 'true', label: 'VIP only ★' },
  { value: 'false', label: 'Non-VIP' },
];

/**
 * Client-side selects that update URL search params, triggering
 * a server-side re-fetch of the orders list.
 */
export function OrdersFilters({ currentStatus, currentVip }: OrdersFiltersProps) {
  const router     = useRouter();
  const pathname   = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={currentStatus}
        onChange={(e) => updateParam('status', e.target.value)}
        className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Filter by status"
      >
        {STATUSES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        value={currentVip}
        onChange={(e) => updateParam('vip', e.target.value)}
        className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Filter by VIP"
      >
        {VIP_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
