'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';

interface ConversationsFiltersProps {
  currentState: string;
  currentLanguage: string;
  currentQuery: string;
}

const STATES = [
  { value: '', label: 'All states' },
  { value: 'greeting', label: 'Greeting' },
  { value: 'faq_answer', label: 'FAQ' },
  { value: 'order_lookup', label: 'Order lookup' },
  { value: 'refund_deflection', label: 'Refund deflection' },
  { value: 'escalation_triggered', label: 'Escalated' },
  { value: 'session_closed', label: 'Closed' },
];

const LANGUAGES = [
  { value: '', label: 'All languages' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'ru', label: 'Russian' },
  { value: 'mixed', label: 'Mixed' },
];

export function ConversationsFilters({
  currentState,
  currentLanguage,
  currentQuery,
}: ConversationsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(currentQuery);

  const updateParam = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          updateParam({ q: draftQuery.trim() });
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={draftQuery}
          onChange={(e) => setDraftQuery(e.target.value)}
          placeholder="Phone or order ID…"
          className="rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Search by phone or order"
        />
      </form>

      <select
        value={currentState}
        onChange={(e) => updateParam({ state: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Filter by state"
      >
        {STATES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        value={currentLanguage}
        onChange={(e) => updateParam({ language: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Filter by language"
      >
        {LANGUAGES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
