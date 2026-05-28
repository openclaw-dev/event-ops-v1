'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, AlertCircle, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

// ─── Slug helper (same logic as event-setup-form.tsx) ─────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'upload' | 'confirm' | 'creating';

interface EventCreatedResponse {
  event: { id: string; name: string; slug: string };
  error?: string;
}

interface ConfirmResponse {
  success: boolean;
  change_event_id?: string;
  kb_sections_updated?: string[];
  error?: string;
}

interface MastersheetCreateFlowProps {
  onBack: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function MastersheetCreateFlow({ onBack }: MastersheetCreateFlowProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Flow phase
  const [phase, setPhase] = useState<Phase>('upload');

  // Upload state
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Confirm state
  const [mappingResult, setMappingResult] = useState<MappingResult | null>(null);
  const [editedMappings, setEditedMappings] = useState<FieldMapping[]>([]);
  const [eventName, setEventName] = useState('');
  const [eventSlug, setEventSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [confirmFieldErrors, setConfirmFieldErrors] = useState<{ name?: string; slug?: string }>({});

  // Creating state
  const [creatingError, setCreatingError] = useState<string | null>(null);

  // ── Upload ──────────────────────────────────────────────────────────────

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);

    const form = new FormData();
    form.append('mastersheet', file);
    // No event_id — upload route resolves operator from session

    try {
      const res = await fetch('/api/data-entry/upload', { method: 'POST', body: form });
      const data = (await res.json()) as MappingResult & { error?: string };

      if (!res.ok) {
        setUploadError(data.error ?? `Upload failed (${res.status}).`);
      } else {
        // Pre-fill event name from the mapping if present
        const nameMapping = data.mappings.find((m) => m.target_field === 'name');
        const initialName = nameMapping?.sample_value ?? '';
        setEventName(initialName);
        setEventSlug(initialName ? toSlug(initialName) : '');
        setSlugManuallyEdited(false);
        setMappingResult(data);
        setEditedMappings(data.mappings);
        setPhase('confirm');
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
    void handleUpload(file);
  }

  // ── Confirm helpers ─────────────────────────────────────────────────────

  function updateMappingTarget(index: number, newTarget: string) {
    setEditedMappings((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, target_field: newTarget, needs_review: false } : m,
      ),
    );
  }

  function handleNameChange(value: string) {
    setEventName(value);
    if (!slugManuallyEdited) {
      setEventSlug(toSlug(value));
    }
    setConfirmFieldErrors((prev) => ({ ...prev, name: undefined }));
  }

  function handleSlugChange(value: string) {
    setEventSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
    setSlugManuallyEdited(true);
    setConfirmFieldErrors((prev) => ({ ...prev, slug: undefined }));
  }

  // ── Create ──────────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!mappingResult) return;

    // Validate required fields
    const errors: { name?: string; slug?: string } = {};
    if (!eventName.trim() || eventName.trim().length < 2) {
      errors.name = 'Event name is required (min 2 chars).';
    }
    if (!eventSlug || eventSlug.length < 2) {
      errors.slug = 'Slug is required (min 2 chars).';
    } else if (!/^[a-z0-9-]+$/.test(eventSlug)) {
      errors.slug = 'Slug may only contain lowercase letters, numbers, and hyphens.';
    }
    if (Object.keys(errors).length > 0) {
      setConfirmFieldErrors(errors);
      return;
    }

    setPhase('creating');
    setCreatingError(null);

    try {
      // Step 1: Create the event
      const createRes = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: eventName.trim(),
          slug: eventSlug,
          event_type: 'festival',
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0],
          timezone: 'Asia/Dubai',
        }),
      });

      const createData = (await createRes.json()) as EventCreatedResponse;

      if (!createRes.ok) {
        setCreatingError(createData.error ?? `Event creation failed (${createRes.status}).`);
        return;
      }

      const newEventId = createData.event.id;

      // Step 2: Confirm mastersheet mappings against the new event
      const confirmRes = await fetch('/api/data-entry/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: newEventId,
          mappings: editedMappings,
          raw_data: mappingResult.raw_data,
          changed_by: 'operator',
        }),
      });

      const confirmData = (await confirmRes.json()) as ConfirmResponse;

      if (!confirmRes.ok) {
        setCreatingError(
          confirmData.error ?? `Mapping sync failed (${confirmRes.status}). Event was created but fields were not applied.`,
        );
        return;
      }

      // Step 3: Navigate to the sync page
      router.push(`/admin/events/${newEventId}/sync`);
    } catch {
      setCreatingError('Network error — please try again.');
    }
  }

  // ── Render: creating ────────────────────────────────────────────────────

  if (phase === 'creating') {
    if (creatingError) {
      return (
        <div className="mx-auto w-full max-w-2xl px-8 py-16 text-center">
          <div className="mx-auto max-w-sm space-y-4">
            <div className="flex justify-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
            </div>
            <p className="font-medium text-destructive">{creatingError}</p>
            <div className="flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setCreatingError(null);
                  setPhase('confirm');
                }}
              >
                Back to review
              </Button>
              <Button
                onClick={() => {
                  setCreatingError(null);
                  void handleCreate();
                }}
              >
                Try again
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto w-full max-w-2xl px-8 py-16 text-center">
        <div className="mx-auto max-w-sm space-y-4">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <p className="font-medium text-muted-foreground">Creating your event…</p>
        </div>
      </div>
    );
  }

  // ── Render: confirm ─────────────────────────────────────────────────────

  if (phase === 'confirm' && mappingResult) {
    return (
      <div className="mx-auto w-full max-w-4xl px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-4 gap-1.5 text-muted-foreground"
            onClick={() => setPhase('upload')}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <h1 className="text-2xl font-semibold">Review mapped fields</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mappingResult.high_confidence_count} high-confidence ·{' '}
            {mappingResult.needs_review_count} need review
            {mappingResult.unmapped_columns.length > 0 &&
              ` · ${mappingResult.unmapped_columns.length} unmapped`}
          </p>
        </div>

        {/* Mapping table */}
        <div className="mb-6 overflow-hidden rounded-lg border">
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
                  Mapped to
                </th>
                <th className="px-3 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                  Sample value
                </th>
                <th className="w-24 px-3 py-2.5 text-center font-medium text-muted-foreground">
                  Confidence
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {editedMappings.map((m, i) => (
                <tr key={i} className="transition-colors hover:bg-muted/20">
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
                            <SelectItem key={kp} value={kp} className="font-mono text-xs">
                              {kp}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="font-mono text-xs">{m.target_field}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground hidden md:table-cell">
                    {m.sample_value
                      ? m.sample_value.length > 40
                        ? m.sample_value.slice(0, 40) + '…'
                        : m.sample_value
                      : '—'}
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

        {/* Event name + slug */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="event-name">Event name</Label>
            <Input
              id="event-name"
              value={eventName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Coastline Festival 2026"
              className={cn(confirmFieldErrors.name && 'border-destructive')}
            />
            {confirmFieldErrors.name && (
              <p className="text-xs text-destructive">{confirmFieldErrors.name}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-slug">Slug</Label>
            <Input
              id="event-slug"
              value={eventSlug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="e.g. coastline-festival-2026"
              className={cn(confirmFieldErrors.slug && 'border-destructive')}
            />
            {confirmFieldErrors.slug ? (
              <p className="text-xs text-destructive">{confirmFieldErrors.slug}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={() => setPhase('upload')}>
            Back
          </Button>
          <Button onClick={() => void handleCreate()}>Create event</Button>
        </div>
      </div>
    );
  }

  // ── Render: upload ──────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-4 gap-1.5 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold">Upload mastersheet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload your Excel mastersheet and we&apos;ll configure the event automatically.
        </p>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload mastersheet"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-16 text-center transition-colors',
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
        {uploading ? (
          <Loader2 className="mb-2 h-8 w-8 animate-spin text-primary" />
        ) : (
          <Upload className="mb-2 h-8 w-8 text-muted-foreground/60" />
        )}
        <p className="text-sm font-medium">
          {uploading ? 'Analysing…' : 'Drop .xlsx mastersheet here, or click to browse'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Max 5 MB · .xlsx only</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Error */}
      {uploadError && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
}
