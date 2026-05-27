/**
 * whatsapp-change-diff.ts
 *
 * Pure functions for computing a diff between extracted WhatsApp changes
 * and the current event record. No IO, no database calls, no Anthropic calls.
 *
 * Callers (confirm/cancel routes, tests) import generateDiff and the helper
 * utilities. The result drives both the confirmation message sent to the
 * promoter and the pending_changes row written to the database.
 */

import { z } from 'zod';
import type { ExtractedChange } from './whatsapp-change-extractor';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DiffItem {
  /** Keypath, e.g. "venue_name" or "config.doors_open_local" */
  field: string;
  /** Raw value from currentEvent at this path. null if field doesn't exist. */
  current_value: unknown;
  /** Raw string value received from the change extractor. */
  new_value: string;
  /** Type-safe value after applying FIELD_COERCERS. null when coercion failed. */
  coerced_value: unknown;
  /** True when coerced_value deeply equals current_value — nothing would change. */
  is_noop: boolean;
  /** Zod error message(s) joined by "; " when coercion failed. null otherwise. */
  coercion_error: string | null;
  /** True when field is config.ticket_tiers.<name> and the tier name is not found. */
  tier_not_found: boolean;
}

export interface DiffResult {
  /** All diff items — one per extracted change. */
  items: DiffItem[];
  /** Subset where !is_noop && coercion_error === null && !tier_not_found. */
  meaningful: DiffItem[];
  /** True when at least one item has a coercion_error. */
  has_errors: boolean;
  /** True when at least one item has tier_not_found. */
  has_tier_not_found: boolean;
}

// ─── Field coercers ───────────────────────────────────────────────────────────
// Haiku always emits new_value as a string. Coercers convert to the DB type.

export const FIELD_COERCERS: Record<string, z.ZodTypeAny> = {
  // ── Top-level string fields ─────────────────────────────────────────────────
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  venue_name: z.string().min(1),
  venue_city: z.string().min(1),
  timezone: z.string().min(1),
  event_type: z.enum(['festival', 'club', 'concert', 'conference', 'other']),

  // ── Date fields — Haiku is instructed to emit YYYY-MM-DD ────────────────────
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),

  // ── Numeric fields — Haiku emits numeric strings e.g. "500", "18" ──────────
  capacity: z.preprocess(
    (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(String(v).replace(/[^\d.]/g, ''));
      return isNaN(n) ? null : Math.floor(n);
    },
    z.number().int().positive().nullable(),
  ),
  age_minimum: z.preprocess(
    (v) => {
      const n = Number(String(v).replace(/[^\d]/g, ''));
      return isNaN(n) ? null : n;
    },
    z.number().int().min(0).max(99),
  ),

  // ── Config nested — time fields (HH:MM) ─────────────────────────────────────
  'config.doors_open_local': z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  'config.doors_close_local': z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),
  'config.last_entry_local': z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format'),

  // ── Config nested — text fields ──────────────────────────────────────────────
  'config.dress_code': z.string(),
  'config.parking_info': z.string(),

  // ── Config nested — enum ─────────────────────────────────────────────────────
  'config.refund_policy.shape': z.enum(['strict', 'tiered', 'lenient']),

  // ── Config nested — boolean (Haiku may emit "true" / "false") ───────────────
  'config.vip_orders_always_escalate': z.preprocess(
    (v) => {
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return v;
    },
    z.boolean(),
  ),
};

// ─── Field labels ─────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  name: 'Event Name',
  slug: 'Slug',
  venue_name: 'Venue Name',
  venue_city: 'Venue City',
  timezone: 'Timezone',
  event_type: 'Event Type',
  start_date: 'Start Date',
  end_date: 'End Date',
  capacity: 'Capacity',
  age_minimum: 'Age Minimum',
  'config.doors_open_local': 'Doors Open',
  'config.doors_close_local': 'Doors Close',
  'config.last_entry_local': 'Last Entry',
  'config.dress_code': 'Dress Code',
  'config.parking_info': 'Parking Info',
  'config.refund_policy.shape': 'Refund Policy',
  'config.ticket_tiers': 'Ticket Tiers',
  'config.vip_orders_always_escalate': 'VIP Always Escalate',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Reads a field value from the event row by keypath.
 *
 * Three formats:
 *   - "venue_name"                       → currentEvent["venue_name"]
 *   - "config.doors_open_local"          → (currentEvent.config)["doors_open_local"]
 *   - "config.ticket_tiers.<tierName>"   → price of named tier; tier_not_found if missing
 *   - "config.refund_policy.shape"       → nested walk through config object
 */
export function readFieldByPath(
  currentEvent: Record<string, unknown>,
  field: string,
): { value: unknown; tier_not_found: boolean } {
  // config.ticket_tiers.<name> — tier price lookup by name
  if (/^config\.ticket_tiers\..+/.test(field)) {
    const tierName = field.slice('config.ticket_tiers.'.length);
    const config = currentEvent.config;
    const tiers =
      config && typeof config === 'object'
        ? (config as Record<string, unknown>).ticket_tiers
        : undefined;
    if (!Array.isArray(tiers)) return { value: null, tier_not_found: true };
    const tier = (tiers as Array<Record<string, unknown>>).find(
      (t) =>
        typeof t.name === 'string' &&
        t.name.toLowerCase() === tierName.toLowerCase(),
    );
    if (!tier) return { value: null, tier_not_found: true };
    return { value: tier.price ?? null, tier_not_found: false };
  }

  // config.<nested.path> — walk the config JSONB object
  if (field.startsWith('config.')) {
    const config = currentEvent.config;
    if (!config || typeof config !== 'object') {
      return { value: null, tier_not_found: false };
    }
    const subPath = field.slice('config.'.length); // e.g. "refund_policy.shape"
    const parts = subPath.split('.');
    let cursor: unknown = config;
    for (const part of parts) {
      if (!cursor || typeof cursor !== 'object') {
        return { value: null, tier_not_found: false };
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
    return { value: cursor ?? null, tier_not_found: false };
  }

  // Top-level column
  return { value: currentEvent[field] ?? null, tier_not_found: false };
}

/**
 * Deep equality via JSON serialization. Handles primitives, objects, arrays.
 * Sufficient for comparing DB-read scalar and JSONB values.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Returns a human-readable label for a field keypath.
 *
 * - Known fields use FIELD_LABELS.
 * - config.ticket_tiers.<name> → "Ticket: <name>"
 * - Fallback: strip "config." prefix, replace underscores, title-case words.
 */
export function formatFieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  if (/^config\.ticket_tiers\..+/.test(field)) {
    const tierName = field.slice('config.ticket_tiers.'.length);
    return `Ticket: ${tierName}`;
  }
  return field
    .replace(/^config\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Returns a display-ready string for a field value.
 *
 * - null / undefined → "—"
 * - Booleans for vip flag → "Yes" / "No"
 * - Objects / arrays → JSON string (for ticket_tiers, refund_policy, etc.)
 * - Everything else → String(value)
 */
export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field === 'config.vip_orders_always_escalate') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes a diff between a list of extracted changes and the current event row.
 *
 * The result tells the caller:
 *   - Which changes are meaningful (will actually modify the DB).
 *   - Which have coercion errors (need to be flagged to the promoter).
 *   - Which reference a ticket tier that doesn't exist.
 *
 * @param extracted    Output of extractChanges() — each field is a valid keypath.
 * @param currentEvent The current event DB row (flat columns + config JSONB).
 */
export function generateDiff(
  extracted: ExtractedChange[],
  currentEvent: Record<string, unknown>,
): DiffResult {
  const items: DiffItem[] = extracted.map((change) => {
    const { value: current_value, tier_not_found } = readFieldByPath(
      currentEvent,
      change.field,
    );

    // Tier not found — cannot coerce or compare; surface to caller for user feedback.
    if (tier_not_found) {
      return {
        field: change.field,
        current_value: null,
        new_value: change.new_value,
        coerced_value: null,
        is_noop: false,
        coercion_error: null,
        tier_not_found: true,
      };
    }

    // Apply coercer if one is registered.
    const coercer = FIELD_COERCERS[change.field];
    let coerced_value: unknown = null;
    let coercion_error: string | null = null;

    if (coercer) {
      const result = coercer.safeParse(change.new_value);
      if (result.success) {
        coerced_value = result.data;
      } else {
        coercion_error = result.error.issues.map((i) => i.message).join('; ');
      }
    } else {
      // No registered coercer — pass through as-is (string).
      coerced_value = change.new_value;
    }

    // Noop check — only meaningful when coercion succeeded.
    const is_noop =
      coercion_error === null && deepEqual(coerced_value, current_value);

    return {
      field: change.field,
      current_value,
      new_value: change.new_value,
      coerced_value,
      is_noop,
      coercion_error,
      tier_not_found: false,
    };
  });

  const meaningful = items.filter(
    (item) =>
      !item.is_noop &&
      item.coercion_error === null &&
      !item.tier_not_found,
  );

  return {
    items,
    meaningful,
    has_errors: items.some((item) => item.coercion_error !== null),
    has_tier_not_found: items.some((item) => item.tier_not_found),
  };
}
