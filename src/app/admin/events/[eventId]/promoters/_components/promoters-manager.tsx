'use client';

import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2, Loader2, AlertCircle } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// ─── Row type (mirrors promoters DB schema) ───────────────────────────────────

export interface PromoterRow {
  id: string;
  operator_id: string;
  event_id: string | null;
  phone_e164: string;
  display_name: string;
  preferred_language: 'en' | 'ar' | 'ru';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Add-form schema (client-side, event_id added on submit) ──────────────────

const addFormSchema = z.object({
  display_name: z
    .string()
    .min(1, 'Name is required.')
    .max(100, 'Name must be 100 characters or less.'),
  phone_e164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 format e.g. +971501234567'),
  // No .default() here — useForm defaultValues handles initialization.
  preferred_language: z.enum(['en', 'ar', 'ru']),
});

type AddFormData = z.infer<typeof addFormSchema>;

// ─── API response helpers ─────────────────────────────────────────────────────

interface ApiErrorBody {
  error?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PromotersManagerProps {
  eventId: string;
  initialPromoters: PromoterRow[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PromotersManager({ eventId, initialPromoters }: PromotersManagerProps) {
  const [promoters, setPromoters] = useState<PromoterRow[]>(initialPromoters);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [toggleLoading, setToggleLoading] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Confirm-dialog target + per-row error map (replaces native alert/confirm).
  const [confirmTarget, setConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  function setRowError(id: string, msg: string | null) {
    setErrorById((prev) => {
      const next = { ...prev };
      if (msg === null) delete next[id];
      else next[id] = msg;
      return next;
    });
  }

  const form = useForm<AddFormData>({
    resolver: zodResolver(addFormSchema),
    defaultValues: {
      display_name: '',
      phone_e164: '',
      preferred_language: 'en',
    },
  });

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function performDelete(id: string) {
    setRowError(id, null);
    setDeleteLoading(id);
    try {
      const res = await fetch(`/api/promoters/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setPromoters((prev) => prev.filter((p) => p.id !== id));
      } else {
        const data = (await res.json()) as ApiErrorBody;
        setRowError(id, data.error ?? 'Delete failed.');
      }
    } catch {
      setRowError(id, 'Network error — please try again.');
    } finally {
      setDeleteLoading(null);
      setConfirmTarget(null);
    }
  }

  // ── Toggle active ──────────────────────────────────────────────────────────

  async function handleToggleActive(id: string, newValue: boolean) {
    setToggleLoading(id);
    // Optimistic update.
    setPromoters((prev) =>
      prev.map((p) => (p.id === id ? { ...p, is_active: newValue } : p)),
    );
    try {
      const res = await fetch(`/api/promoters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newValue }),
      });
      if (!res.ok) {
        // Revert on failure.
        setPromoters((prev) =>
          prev.map((p) => (p.id === id ? { ...p, is_active: !newValue } : p)),
        );
      }
    } catch {
      // Revert on network error.
      setPromoters((prev) =>
        prev.map((p) => (p.id === id ? { ...p, is_active: !newValue } : p)),
      );
    } finally {
      setToggleLoading(null);
    }
  }

  // ── Add ────────────────────────────────────────────────────────────────────

  async function handleAdd(values: AddFormData) {
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch('/api/promoters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, event_id: eventId }),
      });
      const data = (await res.json()) as PromoterRow & ApiErrorBody;

      if (!res.ok) {
        setAddError(data.error ?? `Add failed (${res.status}).`);
      } else {
        setPromoters((prev) => [...prev, data]);
        form.reset();
      }
    } catch {
      setAddError('Network error — please try again.');
    } finally {
      setAdding(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Promoter list ──────────────────────────────────────────────────── */}
      {promoters.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No promoters added yet. Add a phone number below.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          {promoters.map((promoter, i) => {
            const rowError = errorById[promoter.id];
            return (
              <div
                key={promoter.id}
                className={cn(
                  'transition-colors',
                  i > 0 && 'border-t',
                  !promoter.is_active && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Name + phone */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{promoter.display_name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {promoter.phone_e164}
                    </p>
                  </div>

                  {/* Language badge */}
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {promoter.preferred_language.toUpperCase()}
                  </Badge>

                  {/* Active toggle */}
                  <Switch
                    checked={promoter.is_active}
                    disabled={toggleLoading === promoter.id}
                    onCheckedChange={(checked) => void handleToggleActive(promoter.id, checked)}
                    aria-label={`Toggle ${promoter.display_name} active`}
                  />

                  {/* Delete button — opens confirm dialog */}
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deleteLoading === promoter.id}
                    onClick={() =>
                      setConfirmTarget({ id: promoter.id, name: promoter.display_name })
                    }
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    {deleteLoading === promoter.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>

                {rowError && (
                  <div
                    role="alert"
                    className="mx-4 mb-3 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="break-words">{rowError}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Delete confirmation dialog ────────────────────────────────────── */}
      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open && deleteLoading === null) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {confirmTarget?.name ?? 'this promoter'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will lose the ability to send change requests via WhatsApp.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmTarget) void performDelete(confirmTarget.id);
              }}
              disabled={deleteLoading !== null}
              className={cn(buttonVariants({ variant: 'destructive' }))}
            >
              {deleteLoading !== null ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing…
                </>
              ) : (
                'Remove'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Add promoter form ───────────────────────────────────────────────── */}
      <div className="rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-semibold">Add promoter</h3>

        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <form onSubmit={form.handleSubmit(handleAdd)} className="space-y-4">
          {/* Display name */}
          <div className="space-y-1.5">
            <Label htmlFor="display_name">Display name</Label>
            <Input
              id="display_name"
              {...form.register('display_name')}
              placeholder="e.g. Ahmed Al-Rashid"
              autoComplete="off"
            />
            {form.formState.errors.display_name && (
              <p className="text-xs text-destructive">
                {form.formState.errors.display_name.message}
              </p>
            )}
          </div>

          {/* Phone number */}
          <div className="space-y-1.5">
            <Label htmlFor="phone_e164">Phone number</Label>
            <Input
              id="phone_e164"
              type="tel"
              {...form.register('phone_e164')}
              placeholder="+971501234567"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Include country code e.g. +971 for UAE, +966 for Saudi
            </p>
            {form.formState.errors.phone_e164 && (
              <p className="text-xs text-destructive">
                {form.formState.errors.phone_e164.message}
              </p>
            )}
          </div>

          {/* Language */}
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Controller
              control={form.control}
              name="preferred_language"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ar">Arabic</SelectItem>
                    <SelectItem value="ru">Russian</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {/* Submission error */}
          {addError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{addError}</span>
            </div>
          )}

          <Button type="submit" disabled={adding}>
            {adding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              'Add promoter'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
