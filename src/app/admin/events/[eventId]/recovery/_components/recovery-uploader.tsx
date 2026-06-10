'use client';

import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, Loader2, CheckCircle2, XCircle, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedAttempt {
  customer_phone_e164: string;
  customer_name?: string;
  customer_email?: string;
  original_order_id?: string;
  ticket_type?: string;
  quantity?: number;
  amount_sar: number;
  payment_link: string;
  payment_provider: 'checkout' | 'tabby' | 'tamara' | 'tap' | 'manual';
  _error?: string;
}

interface SendResult {
  phone: string;
  status: 'sent' | 'failed';
  error?: string;
}

const VALID_PROVIDERS = new Set(['checkout', 'tabby', 'tamara', 'tap', 'manual']);

function parseRow(row: Record<string, string>): ParsedAttempt {
  const phone = (row['phone'] ?? '').trim();
  const amount = parseFloat((row['amount'] ?? '').trim());
  const paymentLink = (row['payment_link'] ?? '').trim();
  const rawProvider = (row['provider'] ?? 'manual').trim().toLowerCase();
  const provider = VALID_PROVIDERS.has(rawProvider)
    ? (rawProvider as ParsedAttempt['payment_provider'])
    : 'manual';

  if (!phone) return { customer_phone_e164: '', amount_sar: 0, payment_link: '', payment_provider: 'manual', _error: 'Missing phone' };
  if (isNaN(amount) || amount <= 0) return { customer_phone_e164: phone, amount_sar: 0, payment_link: '', payment_provider: 'manual', _error: 'Invalid amount' };
  if (!paymentLink) return { customer_phone_e164: phone, amount_sar: amount, payment_link: '', payment_provider: 'manual', _error: 'Missing payment_link' };

  const qty = parseInt((row['quantity'] ?? '1').trim(), 10);

  return {
    customer_phone_e164: phone,
    customer_name: (row['name'] ?? '').trim() || undefined,
    customer_email: (row['email'] ?? '').trim() || undefined,
    original_order_id: (row['order_id'] ?? '').trim() || undefined,
    ticket_type: (row['ticket_type'] ?? '').trim() || undefined,
    quantity: isNaN(qty) || qty < 1 ? 1 : qty,
    amount_sar: amount,
    payment_link: paymentLink,
    payment_provider: provider,
  };
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'sent' | 'failed' }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Sent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      <XCircle className="h-3 w-3" />
      Failed
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RecoveryUploader({ eventId }: { eventId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedAttempt[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);
  const [sendSummary, setSendSummary] = useState<{ sent: number; failed: number } | null>(null);

  function handleFile(file: File) {
    setFileName(file.name);
    setSendResults(null);
    setSendSummary(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        const parsed = result.data.map((r) => parseRow(r));
        setRows(parsed);
      },
    });
  }

  async function handleSend() {
    const valid = rows.filter((r) => !r._error);
    if (valid.length === 0) return;

    setIsSending(true);
    setSendResults(null);

    try {
      const res = await fetch('/api/recovery/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, recovery_attempts: valid }),
      });

      const json = (await res.json()) as {
        sent: number;
        failed: number;
        results: SendResult[];
      };

      setSendResults(json.results);
      setSendSummary({ sent: json.sent, failed: json.failed });
    } catch {
      setSendResults(null);
    } finally {
      setIsSending(false);
    }
  }

  const validCount = rows.filter((r) => !r._error).length;
  const errorCount = rows.filter((r) => !!r._error).length;

  return (
    <div className="space-y-5">
      {/* Upload area */}
      <div
        className={cn(
          'flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/20',
          rows.length > 0 && 'border-primary/40 bg-muted/10',
        )}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        {fileName ? (
          <div className="space-y-0.5">
            <p className="text-sm font-medium">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              {validCount} valid row{validCount !== 1 ? 's' : ''}
              {errorCount > 0 && ` · ${errorCount} with errors`}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Click to upload CSV</p>
            <p className="text-xs text-muted-foreground">
              Columns: phone, name, email, order_id, ticket_type, quantity, amount,
              payment_link, provider
            </p>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {/* Preview table */}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Phone</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Name</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Ticket</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell">Link</th>
                <th className="px-3 py-2 text-center font-medium text-muted-foreground w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.slice(0, 50).map((r, i) => (
                <tr key={i} className={cn('hover:bg-muted/20', r._error && 'bg-red-50')}>
                  <td className="px-3 py-2 font-mono">{r.customer_phone_e164 || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell truncate max-w-[120px]">
                    {r.customer_name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">
                    {r.ticket_type ? `${r.ticket_type} × ${r.quantity ?? 1}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.amount_sar ? `SAR ${r.amount_sar.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-3 py-2 hidden lg:table-cell">
                    <span className="truncate block max-w-[180px] text-muted-foreground">
                      {r.payment_link || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r._error ? (
                      <span className="text-red-600 font-medium">{r._error}</span>
                    ) : (
                      <span className="text-emerald-600">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              Showing first 50 of {rows.length} rows
            </div>
          )}
        </div>
      )}

      {/* Send button */}
      {validCount > 0 && !sendResults && (
        <Button
          onClick={handleSend}
          disabled={isSending}
          className="gap-2"
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {isSending
            ? 'Sending…'
            : `Send ${validCount} recovery message${validCount !== 1 ? 's' : ''}`}
        </Button>
      )}

      {/* Send results */}
      {sendResults && sendSummary && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            <span className="font-medium text-emerald-700">
              {sendSummary.sent} sent
            </span>
            {sendSummary.failed > 0 && (
              <span className="font-medium text-red-700">
                {sendSummary.failed} failed
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Phone</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sendResults.map((r, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono">{r.phone}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
