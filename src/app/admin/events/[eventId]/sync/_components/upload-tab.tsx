'use client';

import { useRef, useState } from 'react';
import { Upload, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FieldMapping, MappingResult } from '@/lib/data-entry/normaliser';

// ─── Valid target keypaths (mirrors normaliser.ts — keep in sync) ─────────────

const VALID_KEYPATHS = [
  'name',
  'slug',
  'event_type',
  'start_date',
  'end_date',
  'timezone',
  'venue_name',
  'venue_city',
  'capacity',
  'age_minimum',
  'refund_policy.shape',
  'refund_policy.tiers',
  'refund_policy.allowed_alternatives_after_window',
  'refund_policy.credit_validity_months',
  'refund_policy.medical_exception_section_id',
  'doors_open_local',
  'doors_close_local',
  'last_entry_local',
  'dress_code',
  'parking_info',
  'vip_orders_always_escalate',
  'escalation_keywords',
  'escalation_contacts',
  'ticket_tiers',
];

// ─── Confirm response ─────────────────────────────────────────────────────────

interface ConfirmResponse {
  success: boolean;
  change_event_id: string;
  kb_sections_updated: string[];
  dato: {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    dato_item_id?: string;
    error?: string;
  };
  error?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface UploadTabProps {
  eventId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UploadTab({ eventId }: UploadTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [editedMappings, setEditedMappings] = useState<FieldMapping[]>([]);
  const [confirmResult, setConfirmResult] = useState<ConfirmResponse | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  // ── Upload ──────────────────────────────────────────────────────────────

  async function upload(file: File) {
    setUploading(true);
    setMappingResult(null);
    setEditedMappings([]);
    setUploadError(null);
    setConfirmResult(null);
    setElapsedMs(null);

    const form = new FormData();
    form.append('mastersheet', file);
    form.append('event_id', eventId);

    try {
      const res = await fetch('/api/data-entry/upload', { method: 'POST', body: form });
      const data = (await res.json()) as MappingResult & { error?: string };

      if (!res.ok) {
        setUploadError(data.error ?? `Upload failed (${res.status}).`);
      } else {
        setMappingResult(data);
        setEditedMappings(data.mappings);
      }
    } catch {
      setUploadError('Network error — please try again.');
    } finally {
      setUploading(false);
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx') {
      setUploadError('Only .xlsx files are supported.');
      return;
    }
    void upload(file);
  }

  function updateMappingTarget(index: number, newTarget: string) {
    setEditedMappings((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, target_field: newTarget, needs_review: false } : m,
      ),
    );
  }

  // ── Confirm ─────────────────────────────────────────────────────────────

  async function confirmAndSync() {
    if (!mappingResult) return;
    setConfirming(true);
    setConfirmError(null);
    const start = Date.now();

    try {
      const res = await fetch('/api/data-entry/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          mappings: editedMappings,
          raw_data: mappingResult.raw_data,
          changed_by: 'operator',
        }),
      });

      const data = (await res.json()) as ConfirmResponse;
      setElapsedMs(Date.now() - start);

      if (!res.ok) {
        setConfirmError(data.error ?? `Confirm failed (${res.status}).`);
      } else {
        setConfirmResult(data);
      }
    } catch {
      setConfirmError('Network error — please try again.');
    } finally {
      setConfirming(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (confirmResult) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border bg-emerald-50 p-4 dark:bg-emerald-950/20">
          <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            Sync complete
          </div>
          {elapsedMs !== null && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {(elapsedMs / 1000).toFixed(1)}s elapsed
            </p>
          )}
        </div>

        {/* Systems updated */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Systems updated
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Supabase
            </span>
            {!confirmResult.dato.skipped && (
              <span className="flex items-center gap-1 text-sm">
                {confirmResult.dato.success ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                )}
                DatoCMS
              </span>
            )}
          </div>
        </div>

        {/* KB sections */}
        {confirmResult.kb_sections_updated.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              KB sections refreshed
            </p>
            <div className="flex flex-wrap gap-1.5">
              {confirmResult.kb_sections_updated.map((s) => (
                <Badge key={s} variant="secondary" className="font-mono text-xs">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setConfirmResult(null);
            setMappingResult(null);
            setEditedMappings([]);
          }}
        >
          Upload another file
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      {!mappingResult && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload mastersheet"
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/50',
            uploading && 'pointer-events-none opacity-60',
          )}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="mb-2 h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">
            {uploading ? 'Analysing…' : 'Drop .xlsx mastersheet here, or click to browse'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Max 5 MB</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}

      {/* Mapping confirmation table */}
      {mappingResult && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                {mappingResult.mappings.length} column
                {mappingResult.mappings.length !== 1 ? 's' : ''} mapped
              </p>
              <p className="text-xs text-muted-foreground">
                {mappingResult.high_confidence_count} high-confidence ·{' '}
                {mappingResult.needs_review_count} need review
                {mappingResult.unmapped_columns.length > 0 &&
                  ` · ${mappingResult.unmapped_columns.length} unmapped`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMappingResult(null);
                setEditedMappings([]);
                setUploadError(null);
              }}
            >
              Re-upload
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Source sheet
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Source column
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">
                    Target field
                  </th>
                  <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                    Sample value
                  </th>
                  <th className="px-3 py-2.5 text-center font-medium text-muted-foreground w-24">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {editedMappings.map((m, i) => (
                  <tr key={i} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {m.source_sheet}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{m.source_column}</td>
                    <td className="px-3 py-2">
                      {m.needs_review ? (
                        <Select
                          value={m.target_field}
                          onValueChange={(val) => updateMappingTarget(i, val)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select field…" />
                          </SelectTrigger>
                          <SelectContent>
                            {VALID_KEYPATHS.map((kp) => (
                              <SelectItem key={kp} value={kp} className="text-xs font-mono">
                                {kp}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="font-mono text-xs">{m.target_field}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell max-w-[160px] truncate">
                      {m.sample_value}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge
                        className={cn(
                          'text-xs',
                          m.confidence >= 0.85
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400',
                        )}
                        variant="outline"
                      >
                        {Math.round(m.confidence * 100)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Confirm error */}
          {confirmError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{confirmError}</span>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => void confirmAndSync()} disabled={confirming}>
              {confirming ? 'Syncing…' : 'Confirm and sync'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
