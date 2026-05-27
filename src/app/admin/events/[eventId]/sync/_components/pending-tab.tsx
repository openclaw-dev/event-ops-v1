'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PendingChange, AmbiguousItem } from '@/lib/data-entry/pending-changes';
import type { DiffItem } from '@/lib/data-entry/pending-changes';
import { formatFieldLabel, formatValue } from '@/lib/data-entry/whatsapp-change-diff';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
}

function expiresIn(iso: string): { text: string; expired: boolean } {
  const remainingMs = new Date(iso).getTime() - Date.now();
  if (remainingMs <= 0) return { text: 'Expired', expired: true };
  const totalMinutes = Math.floor(remainingMs / 60000);
  if (totalMinutes >= 60) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return { text: `Expires in ${h}h ${m}m`, expired: false };
  }
  return { text: `Expires in ${totalMinutes}m`, expired: false };
}

// ─── Status badge config ──────────────────────────────────────────────────────

const STATUS_BADGE: Record<PendingChange['status'], { label: string; className: string }> = {
  pending: {
    label: 'Pending',
    className:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400',
  },
  confirmed: {
    label: 'Confirmed',
    className:
      'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400',
  },
  cancelled: {
    label: 'Cancelled',
    className:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
  },
  superseded: {
    label: 'Superseded',
    className:
      'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
  },
  expired: {
    label: 'Expired',
    className:
      'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400',
  },
  send_failed: {
    label: 'Send failed',
    className:
      'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400',
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingTabProps {
  initialPendingChanges: PendingChange[];
}

interface CardState {
  loading: 'confirm' | 'cancel' | null;
  error: string | null;
}

// API response shapes ──────────────────────────────────────────────────────────

interface ConfirmSuccessResponse {
  status: 'confirmed';
  change_event_ids: string[];
  dato: 'skipped' | 'success' | 'failed';
}

interface ApiErrorResponse {
  error?: string;
  status?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PendingTab({ initialPendingChanges }: PendingTabProps) {
  const [changes, setChanges] = useState<PendingChange[]>(initialPendingChanges);
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});

  function getCardState(id: string): CardState {
    return cardStates[id] ?? { loading: null, error: null };
  }

  function patchCardState(id: string, patch: Partial<CardState>) {
    setCardStates((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { loading: null, error: null }), ...patch },
    }));
  }

  // ── Confirm ────────────────────────────────────────────────────────────────

  async function handleConfirm(id: string) {
    patchCardState(id, { loading: 'confirm', error: null });
    try {
      const res = await fetch(`/api/changes/${id}/confirm`, { method: 'POST' });
      const data = (await res.json()) as ConfirmSuccessResponse | ApiErrorResponse;

      if (res.ok) {
        const confirmed = data as ConfirmSuccessResponse;
        setChanges((prev) =>
          prev.map((c) =>
            c.id === id
              ? { ...c, status: 'confirmed' as const, dato_sync_status: confirmed.dato }
              : c,
          ),
        );
        patchCardState(id, { loading: null });
      } else {
        const err = data as ApiErrorResponse;
        patchCardState(id, {
          loading: null,
          error: err.error ?? `Confirm failed (${res.status}).`,
        });
      }
    } catch {
      patchCardState(id, { loading: null, error: 'Network error — please try again.' });
    }
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  async function handleCancel(id: string) {
    patchCardState(id, { loading: 'cancel', error: null });
    try {
      const res = await fetch(`/api/changes/${id}/cancel`, { method: 'POST' });
      const data = (await res.json()) as ApiErrorResponse;

      if (res.ok) {
        setChanges((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, status: 'cancelled' as const } : c,
          ),
        );
        patchCardState(id, { loading: null });
      } else {
        patchCardState(id, {
          loading: null,
          error: data.error ?? `Cancel failed (${res.status}).`,
        });
      }
    } catch {
      patchCardState(id, { loading: null, error: 'Network error — please try again.' });
    }
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (changes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
        No pending confirmations.
      </div>
    );
  }

  // ── Cards ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {changes.map((change) => {
        const state = getCardState(change.id);
        const badge = STATUS_BADGE[change.status];
        const { text: expiresText, expired: isExpired } = expiresIn(change.expires_at);

        // Meaningful diff items only — noops, coercion errors, and tier-not-found are hidden.
        const meaningful = (change.diff_items as DiffItem[]).filter(
          (item) => !item.is_noop && item.coercion_error === null && !item.tier_not_found,
        );

        const ambiguousItems = change.ambiguous_items as AmbiguousItem[];

        return (
          <div key={change.id} className="overflow-hidden rounded-lg border bg-card">
            {/* ── Header ──────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/20 px-4 py-3">
              <span className="text-sm font-medium">Via WhatsApp</span>
              <span className="text-xs text-muted-foreground">
                {relativeTime(change.inbound_received_at)}
              </span>
              <span
                className={cn(
                  'text-xs',
                  isExpired ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                )}
              >
                {expiresText}
              </span>
              <Badge
                variant="outline"
                className={cn('ml-auto shrink-0 text-xs capitalize', badge.className)}
              >
                {badge.label}
              </Badge>
            </div>

            {/* ── Diff items table ─────────────────────────────────────────── */}
            {meaningful.length > 0 && (
              <div className="overflow-x-auto border-b">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                        Field
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                        Change
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {meaningful.map((item, i) => (
                      <tr key={i} className="transition-colors hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-xs font-medium">
                          {formatFieldLabel(item.field)}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className="text-muted-foreground">
                            {formatValue(item.field, item.current_value)}
                          </span>
                          <span className="mx-2 text-muted-foreground/40">→</span>
                          <span className="font-medium text-foreground">
                            {formatValue(item.field, item.coerced_value)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Ambiguous items ──────────────────────────────────────────── */}
            {change.extraction_ambiguous && ambiguousItems.length > 0 && (
              <div className="border-b px-4 py-3">
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
                  {ambiguousItems.map((a, i) => (
                    <p
                      key={i}
                      className="text-xs text-amber-800 dark:text-amber-400"
                    >
                      ⚠ Could not parse: {a.raw_text}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* ── Footer ──────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              {/* DatoCMS sync status — only visible after confirmation */}
              {change.status === 'confirmed' && change.dato_sync_status && (
                <span className="text-xs text-muted-foreground">
                  {change.dato_sync_status === 'skipped' && 'DatoCMS: not configured'}
                  {change.dato_sync_status === 'success' && 'DatoCMS: synced ✓'}
                  {change.dato_sync_status === 'failed' &&
                    `DatoCMS: sync failed — ${change.dato_sync_error ?? 'unknown error'}`}
                </span>
              )}

              {/* Action buttons — only shown while status is 'pending' */}
              {change.status === 'pending' && (
                <div className="ml-auto flex items-center gap-2">
                  {state.error && (
                    <span className="text-xs text-destructive">{state.error}</span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={state.loading !== null}
                    onClick={() => void handleCancel(change.id)}
                  >
                    {state.loading === 'cancel' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Cancel'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    disabled={state.loading !== null}
                    onClick={() => void handleConfirm(change.id)}
                  >
                    {state.loading === 'confirm' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Confirm'
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
