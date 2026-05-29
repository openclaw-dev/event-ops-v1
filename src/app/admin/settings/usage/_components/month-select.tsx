'use client';

import { useRouter, usePathname } from 'next/navigation';

interface MonthSelectProps {
  months: string[];   // YYYY-MM strings, newest first
  current: string;    // currently selected YYYY-MM
}

function formatMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function MonthSelect({ months, current }: MonthSelectProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <select
      value={current}
      onChange={(e) => router.push(`${pathname}?month=${e.target.value}`)}
      className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label="Select billing month"
    >
      {months.map((m) => (
        <option key={m} value={m}>
          {formatMonth(m)}
        </option>
      ))}
    </select>
  );
}
