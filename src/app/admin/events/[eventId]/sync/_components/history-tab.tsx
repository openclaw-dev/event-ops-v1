'use client';

import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── Row shape ────────────────────────────────────────────────────────────────

export interface ChangeEventRow {
  id: string;
  changed_by: string;
  channel: 'dashboard' | 'whatsapp' | 'system' | 'mastersheet';
  fields_changed: string[];
  kb_sections_updated: string[];
  confirmed_at: string;
}

export interface PromoterInfo {
  display_name: string;
  phone_e164: string;
}

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

const CHANNEL_BADGE_CLASS: Record<string, string> = {
  dashboard: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400',
  whatsapp: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400',
  system: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
  mastersheet: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400',
};

// ─── Table columns ────────────────────────────────────────────────────────────

const col = createColumnHelper<ChangeEventRow>();

// ─── Component ───────────────────────────────────────────────────────────────

interface HistoryTabProps {
  rows: ChangeEventRow[];
  promoterLookup: Record<string, PromoterInfo>;
}

export function HistoryTab({ rows, promoterLookup }: HistoryTabProps) {
  const columns = useMemo(
    () => [
      col.accessor('confirmed_at', {
        header: 'Time',
        cell: (info) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {relativeTime(info.getValue())}
          </span>
        ),
      }),
      col.accessor('changed_by', {
        header: 'Changed by',
        cell: ({ getValue, row }) => {
          const changedBy = getValue();
          const { channel } = row.original;

          if (channel === 'mastersheet') {
            return <span className="text-sm">Operator</span>;
          }

          if (channel === 'whatsapp') {
            const promoter = promoterLookup[changedBy];
            if (promoter) {
              return (
                <div>
                  <span className="text-sm">{promoter.display_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {promoter.phone_e164}
                  </span>
                </div>
              );
            }
            // Promoter not found — show truncated UUID.
            return (
              <span className="font-mono text-xs text-muted-foreground">
                {changedBy.slice(0, 8)}
              </span>
            );
          }

          // dashboard / system / unknown
          return (
            <span className="font-mono text-xs text-muted-foreground">
              {changedBy.slice(0, 8)}
            </span>
          );
        },
      }),
      col.accessor('channel', {
        header: 'Channel',
        cell: (info) => (
          <Badge
            variant="outline"
            className={cn('text-xs capitalize', CHANNEL_BADGE_CLASS[info.getValue()] ?? '')}
          >
            {info.getValue()}
          </Badge>
        ),
      }),
      col.accessor('fields_changed', {
        header: 'Fields changed',
        cell: (info) => (
          <div className="flex flex-wrap gap-1">
            {info.getValue().map((f) => (
              <Badge key={f} variant="secondary" className="font-mono text-xs">
                {f}
              </Badge>
            ))}
          </div>
        ),
      }),
      col.accessor('kb_sections_updated', {
        header: 'KB sections',
        cell: (info) => {
          const count = info.getValue().length;
          if (count === 0) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <Badge variant="outline" className="text-xs">
              {count} updated
            </Badge>
          );
        },
      }),
    ],
    [promoterLookup],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
        No changes recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="px-3 py-2.5 text-left font-medium text-muted-foreground"
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/20 transition-colors">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2.5">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
