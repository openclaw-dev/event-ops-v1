import Link from 'next/link';
import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

import type { EventReadinessResult, ReadinessItem } from '@/lib/agent/event-readiness';

interface ReadinessChecklistProps {
  result: EventReadinessResult;
}

function ItemIcon({ status }: { status: ReadinessItem['status'] }) {
  if (status === 'complete') {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  }
  if (status === 'incomplete') {
    return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  }
  // warning
  return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
}

export function ReadinessChecklist({ result }: ReadinessChecklistProps) {
  const { items, can_publish, score } = result;

  return (
    <div className="mt-8 rounded-lg border bg-card p-5 shadow-sm">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold">Event readiness</h2>
        <span className="text-sm font-medium text-muted-foreground">{score}% ready</span>
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────────── */}
      <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${score}%` }}
        />
      </div>

      {/* ── Item list ───────────────────────────────────────────────────────── */}
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3">
            <ItemIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-sm font-medium ${
                    item.status === 'incomplete'
                      ? 'text-destructive'
                      : item.status === 'warning'
                        ? 'text-amber-600'
                        : 'text-foreground'
                  }`}
                >
                  {item.label}
                </span>
                {item.required && item.status !== 'complete' && (
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                    Required
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
            </div>
            {item.action_url && item.status !== 'complete' && (
              <Link
                href={item.action_url}
                className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
              >
                Set up →
              </Link>
            )}
          </li>
        ))}
      </ul>

      {/* ── Publish hint ────────────────────────────────────────────────────── */}
      {!can_publish && (
        <p className="mt-4 text-xs text-muted-foreground">
          Complete all required items above to enable publishing.
        </p>
      )}
    </div>
  );
}
