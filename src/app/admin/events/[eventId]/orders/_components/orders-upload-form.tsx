'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, AlertCircle, CheckCircle2, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface ImportResult {
  import_id: string;
  row_count: number;
  error_count: number;
  errors: RowError[];
}

interface OrdersUploadFormProps {
  eventId: string;
}

export function OrdersUploadForm({ eventId }: OrdersUploadFormProps) {
  const router   = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging,  setDragging]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result,    setResult]    = useState<ImportResult | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setResult(null);
    setError(null);

    const form = new FormData();
    form.append('file', file);
    form.append('event_id', eventId);

    try {
      const res  = await fetch('/api/orders/import', { method: 'POST', body: form });
      const data = (await res.json()) as ImportResult & { error?: string };

      if (!res.ok) {
        setError(data.error ?? `Import failed (${res.status}).`);
      } else {
        setResult(data);
        router.refresh();
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setUploading(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only .csv files are supported.');
      return;
    }
    upload(file);
  }

  return (
    <div className="space-y-4">
      {/* Template download + column reference */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>
            <span className="font-medium text-foreground">Required:</span>{' '}
            order_id, customer_phone_e164, ticket_type, quantity, status, vip_flag
          </p>
          <p>
            <span className="font-medium text-foreground">Optional:</span>{' '}
            customer_name, customer_email, preferred_language, amount_paid_aed, currency,
            purchase_date, transfer_eligible, notes
          </p>
        </div>
        <Button variant="outline" size="sm" asChild className="shrink-0 gap-1 text-xs">
          <a href="/api/orders/template" download>
            <Download className="h-3.5 w-3.5" />
            Download template
          </a>
        </Button>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload orders CSV"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          uploading && 'pointer-events-none opacity-60',
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="mb-2 h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm font-medium">
          {uploading ? 'Importing…' : 'Drop CSV here, or click to browse'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Max 10 MB · 100 000 rows</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Server / upload error */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Import result */}
      {result && (
        <div className="space-y-3 rounded-md border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {result.row_count} order{result.row_count !== 1 ? 's' : ''} imported
            {result.error_count > 0 && (
              <span className="ml-1 text-amber-600">
                · {result.error_count} error{result.error_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Row-level errors</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-1 pr-4 text-left font-medium text-muted-foreground">Row</th>
                      <th className="pb-1 pr-4 text-left font-medium text-muted-foreground">Field</th>
                      <th className="pb-1 text-left font-medium text-muted-foreground">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-4 font-mono">{e.row}</td>
                        <td className="py-1 pr-4 font-mono text-muted-foreground">
                          {e.field || '—'}
                        </td>
                        <td className="py-1 text-muted-foreground">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.error_count > result.errors.length && (
                <p className="text-xs text-muted-foreground">
                  Showing {result.errors.length} of {result.error_count} errors. Full list stored
                  in the database.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
