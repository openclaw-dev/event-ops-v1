'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Search, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface ConversationsFiltersProps {
  eventId: string;
  currentLanguage: string;
  currentQuery: string;
  currentIntent: string;
  currentRange: string;
}

const INTENTS = [
  { value: '', label: 'All intents' },
  { value: 'faq', label: 'FAQ' },
  { value: 'order', label: 'Order lookup' },
  { value: 'refund', label: 'Refund request' },
  { value: 'escalation', label: 'Escalation' },
  { value: 'other', label: 'Other' },
] as const;

const DATE_RANGES = [
  { value: '', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
] as const;

const LANGUAGES = [
  { value: '', label: 'All languages' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'ru', label: 'Russian' },
  { value: 'mixed', label: 'Mixed' },
] as const;

export function ConversationsFilters({
  eventId,
  currentLanguage,
  currentQuery,
  currentIntent,
  currentRange,
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

  // Build the export URL preserving all current active filters.
  function buildExportUrl() {
    const params = new URLSearchParams();
    const q = draftQuery.trim();
    if (q) params.set('q', q);
    if (currentIntent) params.set('intent', currentIntent);
    if (currentLanguage) params.set('language', currentLanguage);
    if (currentRange) params.set('range', currentRange);
    const qs = params.toString();
    return `/api/events/${eventId}/conversations/export${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* ── Search ─────────────────────────────────────────────────────────── */}
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
          placeholder="Phone, order ID, or message…"
          className="w-52 rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Search by phone, order ID, or message content"
        />
      </form>

      {/* ── Intent ─────────────────────────────────────────────────────────── */}
      <select
        value={currentIntent}
        onChange={(e) => updateParam({ intent: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Filter by intent"
      >
        {INTENTS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {/* ── Language ───────────────────────────────────────────────────────── */}
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

      {/* ── Date range ─────────────────────────────────────────────────────── */}
      <select
        value={currentRange}
        onChange={(e) => updateParam({ range: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Filter by date range"
      >
        {DATE_RANGES.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {/* ── Export ─────────────────────────────────────────────────────────── */}
      <Button variant="outline" size="sm" className="gap-1.5 text-xs" asChild>
        <a href={buildExportUrl()} download>
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </a>
      </Button>
    </div>
  );
}
