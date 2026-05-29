'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, CheckCircle2 } from 'lucide-react';

import { eventSetupSchema, eventSetupDefaults, type EventSetupFormData } from '@/lib/schemas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEZONES = [
  { group: 'GCC', options: [
    'Asia/Dubai',
    'Asia/Riyadh',
    'Asia/Kuwait',
    'Asia/Qatar',
    'Asia/Bahrain',
    'Asia/Muscat',
  ]},
  { group: 'MENA', options: [
    'Asia/Amman',
    'Asia/Beirut',
    'Africa/Cairo',
    'Asia/Baghdad',
    'Africa/Casablanca',
    'Africa/Tunis',
  ]},
  { group: 'Other', options: ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles'] },
];

const ALTERNATIVES = [
  { value: 'transfer_to_another_person', label: 'Transfer to another person' },
  { value: 'credit_for_future_event',    label: 'Credit for future event' },
  { value: 'ticket_upgrade',             label: 'Ticket upgrade' },
  { value: 'date_change_if_multi_day',   label: 'Date change (multi-day)' },
] as const;

// ─── Slug helper ──────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <Separator className="mt-2" />
      </div>
      {children}
    </section>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EventSetupFormProps {
  /** Prefilled values for edit mode. Defaults applied when omitted (create mode). */
  defaultValues?: Partial<EventSetupFormData>;
  /** Called on valid submit. Return `{ error }` to surface a server-side message. */
  onSubmit: (data: EventSetupFormData) => Promise<{ error: string } | undefined | void>;
  /** "Save Event" or "Create event" etc. */
  submitLabel?: string;
  /** Optional cancel href. */
  cancelHref?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventSetupForm({
  defaultValues,
  onSubmit,
  submitLabel = 'Save event',
  cancelHref,
}: EventSetupFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Track whether the user has manually edited the slug
  const slugTouched = useRef(false);

  const {
    register,
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<EventSetupFormData>({
    resolver: zodResolver(eventSetupSchema),
    defaultValues: { ...eventSetupDefaults, ...defaultValues },
  });

  // Auto-derive slug from name (unless user has touched slug).
  const watchedName = useWatch({ control, name: 'name' });
  useEffect(() => {
    if (!slugTouched.current) {
      setValue('slug', toSlug(watchedName ?? ''), { shouldValidate: false });
    }
  }, [watchedName, setValue]);

  // Refund tiers dynamic array
  const {
    fields: tierFields,
    append: appendTier,
    remove: removeTier,
  } = useFieldArray({ control, name: 'refund_policy.tiers' });

  // Escalation contacts dynamic array
  const {
    fields: contactFields,
    append: appendContact,
    remove: removeContact,
  } = useFieldArray({ control, name: 'escalation_contacts' });

  // Ticket tiers dynamic array
  const {
    fields: ticketFields,
    append: appendTicket,
    remove: removeTicket,
  } = useFieldArray({ control, name: 'ticket_tiers' });

  async function submit(data: EventSetupFormData) {
    setServerError(null);
    setSaved(false);
    const result = await onSubmit(data);
    if (result?.error) {
      setServerError(result.error);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-10" noValidate>

      {/* ── Basic Information ───────────────────────────────────────────── */}
      <Section title="Basic Information">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event name *" htmlFor="name" error={errors.name?.message}>
            <Input
              id="name"
              placeholder="e.g. Coastline Festival 2026"
              autoFocus
              {...register('name')}
              aria-invalid={!!errors.name}
            />
          </Field>

          <Field label="Slug *" htmlFor="slug" error={errors.slug?.message}>
            <Input
              id="slug"
              placeholder="coastline-festival-2026"
              {...register('slug', {
                onChange: () => {
                  slugTouched.current = true;
                },
              })}
              aria-invalid={!!errors.slug}
            />
          </Field>
        </div>

        <Field label="Event type *" error={errors.event_type?.message}>
          <Controller
            control={control}
            name="event_type"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="flex flex-wrap gap-4"
              >
                {(['festival', 'club', 'concert', 'conference', 'other'] as const).map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
                    <RadioGroupItem value={t} />
                    {t}
                  </label>
                ))}
              </RadioGroup>
            )}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date *" htmlFor="start_date" error={errors.start_date?.message}>
            <Input
              id="start_date"
              type="date"
              {...register('start_date')}
              aria-invalid={!!errors.start_date}
            />
          </Field>
          <Field label="End date *" htmlFor="end_date" error={errors.end_date?.message}>
            <Input
              id="end_date"
              type="date"
              {...register('end_date')}
              aria-invalid={!!errors.end_date}
            />
          </Field>
        </div>

        <Field label="Timezone *" error={errors.timezone?.message}>
          <Controller
            control={control}
            name="timezone"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger aria-invalid={!!errors.timezone} className="w-full sm:w-64">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map(({ group, options }) => (
                    <div key={group}>
                      <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                        {group}
                      </p>
                      {options.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue name *" htmlFor="venue_name" error={errors.venue_name?.message}>
            <Input
              id="venue_name"
              placeholder="e.g. Festival Grounds, Coastal City"
              {...register('venue_name')}
              aria-invalid={!!errors.venue_name}
            />
          </Field>
          <Field label="Venue city *" htmlFor="venue_city" error={errors.venue_city?.message}>
            <Input
              id="venue_city"
              placeholder="e.g. Dubai"
              {...register('venue_city')}
              aria-invalid={!!errors.venue_city}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Capacity" htmlFor="capacity" error={errors.capacity?.message}>
            <Input
              id="capacity"
              type="number"
              placeholder="e.g. 10000"
              {...register('capacity', {
                setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
              })}
              aria-invalid={!!errors.capacity}
            />
          </Field>
          <Field label="Age minimum *" htmlFor="age_minimum" error={errors.age_minimum?.message}>
            <Input
              id="age_minimum"
              type="number"
              min={0}
              max={99}
              {...register('age_minimum', { valueAsNumber: true })}
              aria-invalid={!!errors.age_minimum}
            />
          </Field>
        </div>
      </Section>

      {/* ── Refund Policy ───────────────────────────────────────────────── */}
      <Section title="Refund Policy">
        <Field label="Policy shape *" error={errors.refund_policy?.shape?.message}>
          <Controller
            control={control}
            name="refund_policy.shape"
            render={({ field }) => (
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="flex gap-6"
              >
                {(['strict', 'tiered', 'lenient'] as const).map((s) => (
                  <label key={s} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
                    <RadioGroupItem value={s} />
                    {s}
                  </label>
                ))}
              </RadioGroup>
            )}
          />
        </Field>

        {/* Refund tiers */}
        <div className="space-y-2">
          <Label>Refund tiers *</Label>
          {typeof errors.refund_policy?.tiers?.message === 'string' && (
            <p className="text-xs text-destructive">{errors.refund_policy.tiers.message}</p>
          )}
          <div className="space-y-2">
            {tierFields.map((field, i) => (
              <div key={field.id} className="flex items-start gap-2">
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    {i === 0 && <Label className="text-xs text-muted-foreground">Days before</Label>}
                    <Input
                      type="number"
                      min={0}
                      placeholder="30"
                      {...register(`refund_policy.tiers.${i}.days_before_event`, {
                        valueAsNumber: true,
                      })}
                      aria-invalid={!!errors.refund_policy?.tiers?.[i]?.days_before_event}
                    />
                    {errors.refund_policy?.tiers?.[i]?.days_before_event && (
                      <p className="text-xs text-destructive">
                        {errors.refund_policy.tiers[i].days_before_event?.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <Label className="text-xs text-muted-foreground">Refund %</Label>}
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      placeholder="100"
                      {...register(`refund_policy.tiers.${i}.refund_pct`, {
                        valueAsNumber: true,
                      })}
                      aria-invalid={!!errors.refund_policy?.tiers?.[i]?.refund_pct}
                    />
                    {errors.refund_policy?.tiers?.[i]?.refund_pct && (
                      <p className="text-xs text-destructive">
                        {errors.refund_policy.tiers[i].refund_pct?.message}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`px-2 ${i === 0 ? 'mt-6' : ''}`}
                  onClick={() => removeTier(i)}
                  disabled={tierFields.length === 1}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 text-xs"
            onClick={() => appendTier({ days_before_event: 0, refund_pct: 0 })}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add tier
          </Button>
        </div>

        {/* Alternatives */}
        <div className="space-y-2">
          <Label>Allowed alternatives after refund window</Label>
          <Controller
            control={control}
            name="refund_policy.allowed_alternatives_after_window"
            render={({ field }) => (
              <div className="space-y-2">
                {ALTERNATIVES.map(({ value, label }) => (
                  <label key={value} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value.includes(value)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          field.onChange([...field.value, value]);
                        } else {
                          field.onChange(field.value.filter((v) => v !== value));
                        }
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          />
        </div>

        <Field
          label="Credit validity (months) *"
          htmlFor="credit_validity_months"
          error={errors.refund_policy?.credit_validity_months?.message}
        >
          <Input
            id="credit_validity_months"
            type="number"
            min={1}
            max={36}
            className="w-32"
            {...register('refund_policy.credit_validity_months', { valueAsNumber: true })}
            aria-invalid={!!errors.refund_policy?.credit_validity_months}
          />
        </Field>
      </Section>

      {/* ── Logistics ───────────────────────────────────────────────────── */}
      <Section title="Logistics">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Doors open *"
            htmlFor="doors_open_local"
            error={errors.doors_open_local?.message}
          >
            <Input
              id="doors_open_local"
              type="time"
              {...register('doors_open_local')}
              aria-invalid={!!errors.doors_open_local}
            />
          </Field>
          <Field
            label="Doors close *"
            htmlFor="doors_close_local"
            error={errors.doors_close_local?.message}
          >
            <Input
              id="doors_close_local"
              type="time"
              {...register('doors_close_local')}
              aria-invalid={!!errors.doors_close_local}
            />
          </Field>
          <Field
            label="Last entry *"
            htmlFor="last_entry_local"
            error={errors.last_entry_local?.message}
          >
            <Input
              id="last_entry_local"
              type="time"
              {...register('last_entry_local')}
              aria-invalid={!!errors.last_entry_local}
            />
          </Field>
        </div>

        <Field label="Dress code" htmlFor="dress_code" error={errors.dress_code?.message}>
          <Textarea
            id="dress_code"
            placeholder="Smart casual. Local customs apply."
            rows={2}
            {...register('dress_code')}
            aria-invalid={!!errors.dress_code}
          />
        </Field>

        <Field label="Parking info" htmlFor="parking_info" error={errors.parking_info?.message}>
          <Textarea
            id="parking_info"
            placeholder="Free at venue. Gate opens 16:00."
            rows={2}
            {...register('parking_info')}
            aria-invalid={!!errors.parking_info}
          />
        </Field>
      </Section>

      {/* ── Escalation ──────────────────────────────────────────────────── */}
      <Section title="Escalation">
        <Field label="VIP orders auto-escalate?" error={errors.vip_orders_always_escalate?.message}>
          <Controller
            control={control}
            name="vip_orders_always_escalate"
            render={({ field }) => (
              <RadioGroup
                value={String(field.value)}
                onValueChange={(v) => field.onChange(v === 'true')}
                className="flex gap-6"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="true" />
                  Yes
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="false" />
                  No
                </label>
              </RadioGroup>
            )}
          />
        </Field>

        <Field
          label="Escalation keywords (comma-separated)"
          htmlFor="escalation_keywords_input"
          error={
            Array.isArray(errors.escalation_keywords)
              ? errors.escalation_keywords[0]?.message
              : (errors.escalation_keywords as { message?: string } | undefined)?.message
          }
        >
          <Controller
            control={control}
            name="escalation_keywords"
            render={({ field }) => (
              <Input
                id="escalation_keywords_input"
                placeholder="police, media, lawyer, refund_all"
                value={field.value.join(', ')}
                onChange={(e) => {
                  const val = e.target.value;
                  field.onChange(
                    val
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  );
                }}
              />
            )}
          />
        </Field>

        {/* Escalation contacts */}
        <div className="space-y-2">
          <Label>Escalation contacts *</Label>
          {typeof errors.escalation_contacts?.message === 'string' && (
            <p className="text-xs text-destructive">{errors.escalation_contacts.message}</p>
          )}
          <div className="space-y-3">
            {contactFields.map((field, i) => (
              <div key={field.id} className="flex items-start gap-2">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    {i === 0 && <Label className="text-xs text-muted-foreground">Name</Label>}
                    <Input
                      placeholder="Ops Manager"
                      {...register(`escalation_contacts.${i}.name`)}
                      aria-invalid={!!errors.escalation_contacts?.[i]?.name}
                    />
                    {errors.escalation_contacts?.[i]?.name && (
                      <p className="text-xs text-destructive">
                        {errors.escalation_contacts[i].name?.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <Label className="text-xs text-muted-foreground">Hours</Label>}
                    <Input
                      placeholder="20:00–02:00 GST"
                      {...register(`escalation_contacts.${i}.hours`)}
                      aria-invalid={!!errors.escalation_contacts?.[i]?.hours}
                    />
                    {errors.escalation_contacts?.[i]?.hours && (
                      <p className="text-xs text-destructive">
                        {errors.escalation_contacts[i].hours?.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    {i === 0 && <Label className="text-xs text-muted-foreground">Method</Label>}
                    <Controller
                      control={control}
                      name={`escalation_contacts.${i}.method`}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger
                            aria-invalid={!!errors.escalation_contacts?.[i]?.method}
                            className="w-full"
                          >
                            <SelectValue placeholder="Select method" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="in-app handoff">In-app handoff</SelectItem>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.escalation_contacts?.[i]?.method && (
                      <p className="text-xs text-destructive">
                        {errors.escalation_contacts[i].method?.message}
                      </p>
                    )}
                    {watch(`escalation_contacts.${i}.method`) === 'whatsapp' && (
                      <Input
                        placeholder="+971500000000"
                        {...register(`escalation_contacts.${i}.phone`)}
                        className="mt-1"
                        aria-label="WhatsApp phone number"
                      />
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`px-2 ${i === 0 ? 'mt-6' : ''}`}
                  onClick={() => removeContact(i)}
                  disabled={contactFields.length === 1}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 text-xs"
            onClick={() => appendContact({ name: '', hours: '', method: 'in-app handoff', phone: '' })}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add contact
          </Button>
        </div>
      </Section>

      {/* ── Ticket Tiers ────────────────────────────────────────────────── */}
      <Section title="Ticket Tiers">
        {typeof errors.ticket_tiers?.message === 'string' && (
          <p className="text-xs text-destructive">{errors.ticket_tiers.message}</p>
        )}
        <div className="space-y-3">
          {ticketFields.map((field, i) => (
            <div key={field.id} className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  {i === 0 && <Label className="text-xs text-muted-foreground">Tier name</Label>}
                  <Input
                    placeholder="GA - Day 1"
                    {...register(`ticket_tiers.${i}.name`)}
                    aria-invalid={!!errors.ticket_tiers?.[i]?.name}
                  />
                  {errors.ticket_tiers?.[i]?.name && (
                    <p className="text-xs text-destructive">
                      {errors.ticket_tiers[i].name?.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  {i === 0 && (
                    <Label className="text-xs text-muted-foreground">Price (optional)</Label>
                  )}
                  <Input
                    type="number"
                    min={0}
                    placeholder="200"
                    {...register(`ticket_tiers.${i}.price`, {
                      setValueAs: (v) => (v === '' || v === undefined ? undefined : Number(v)),
                    })}
                    aria-invalid={!!errors.ticket_tiers?.[i]?.price}
                  />
                  {errors.ticket_tiers?.[i]?.price && (
                    <p className="text-xs text-destructive">
                      {errors.ticket_tiers[i].price?.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  {i === 0 && (
                    <Label className="text-xs text-muted-foreground">Description (optional)</Label>
                  )}
                  <Input
                    placeholder="General entry"
                    {...register(`ticket_tiers.${i}.description`)}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`px-2 ${i === 0 ? 'mt-6' : ''}`}
                onClick={() => removeTicket(i)}
                disabled={ticketFields.length === 1}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1 text-xs"
          onClick={() => appendTicket({ name: '', price: undefined, description: '' })}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add tier
        </Button>
      </Section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <Separator />

      {serverError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {serverError}
        </p>
      )}

      {saved && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-600">
          <CheckCircle2 className="h-4 w-4" />
          Saved successfully.
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pb-8">
        {cancelHref && (
          <Button type="button" variant="outline" asChild>
            <a href={cancelHref}>Cancel</a>
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting} className="min-w-[140px]">
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
