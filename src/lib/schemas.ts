import { z } from 'zod';

// ─── Event setup ─────────────────────────────────────────────────────────────

export const eventSetupSchema = z
  .object({
    // ── Basic info ──────────────────────────────────────────────────────────
    name: z.string().min(3, 'Name must be at least 3 characters.').max(120),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens.')
      .min(3, 'Slug must be at least 3 characters.')
      .max(80),
    event_type: z.enum(['festival', 'club', 'concert', 'conference', 'other']),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format.'),
    timezone: z.string().min(1, 'Select a timezone.'),
    venue_name: z.string().min(3, 'Venue name must be at least 3 characters.'),
    venue_city: z.string().min(2, 'City must be at least 2 characters.'),
    capacity: z.number().int().positive('Capacity must be a positive number.').nullable(),
    age_minimum: z
      .number()
      .int()
      .min(0, 'Age minimum must be 0 or greater.')
      .max(99, 'Age minimum must be 99 or less.'),

    // ── Refund policy ────────────────────────────────────────────────────────
    refund_policy: z.object({
      shape: z.enum(['strict', 'tiered', 'lenient']),
      tiers: z
        .array(
          z.object({
            days_before_event: z.number().int().min(0, 'Days must be 0 or more.'),
            refund_pct: z
              .number()
              .min(0, 'Percentage must be 0–100.')
              .max(100, 'Percentage must be 0–100.'),
          }),
        )
        .min(1, 'At least one refund tier is required.'),
      allowed_alternatives_after_window: z.array(
        z.enum([
          'transfer_to_another_person',
          'credit_for_future_event',
          'ticket_upgrade',
          'date_change_if_multi_day',
        ]),
      ),
      credit_validity_months: z
        .number()
        .int()
        .min(1, 'Credit validity must be at least 1 month.')
        .max(36, 'Credit validity must be 36 months or less.'),
      medical_exception_section_id: z.string(),
    }),

    // ── Logistics ─────────────────────────────────────────────────────────────
    doors_open_local: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format (e.g. 20:00).'),
    doors_close_local: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format (e.g. 02:00).'),
    last_entry_local: z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM format (e.g. 01:00).'),
    dress_code: z.string().max(500),
    parking_info: z.string().max(1000),

    // ── Escalation ────────────────────────────────────────────────────────────
    vip_orders_always_escalate: z.boolean(),
    escalation_keywords: z.array(z.string()).max(50),
    escalation_contacts: z
      .array(
        z.object({
          name: z.string().min(1, 'Contact name is required.'),
          hours: z.string().min(1, 'Hours are required.'),
          method: z.enum(['in-app handoff', 'whatsapp'], {
            message: 'Select a notification method.',
          }),
          /** Required when method is 'whatsapp'. */
          phone: z.string().optional(),
        }),
      )
      .min(1, 'At least one escalation contact is required.'),

    // ── Ticket tiers ─────────────────────────────────────────────────────────
    ticket_tiers: z
      .array(
        z.object({
          name: z.string().min(1, 'Tier name is required.'),
          price: z.number().nonnegative('Price must be 0 or more.').optional(),
          description: z.string().optional(),
        }),
      )
      .min(1, 'At least one ticket tier is required.'),
  })
  .refine((d) => new Date(d.end_date) >= new Date(d.start_date), {
    message: 'End date must be on or after start date.',
    path: ['end_date'],
  })
  .refine(
    (d) => {
      const tiers = d.refund_policy.tiers;
      return tiers.every(
        (t, i) => i === 0 || t.days_before_event < tiers[i - 1].days_before_event,
      );
    },
    {
      message: 'Refund tiers must be in descending days-before-event order.',
      path: ['refund_policy', 'tiers'],
    },
  );

export type EventSetupFormData = z.infer<typeof eventSetupSchema>;

// ─── Default values ───────────────────────────────────────────────────────────

export const eventSetupDefaults: EventSetupFormData = {
  name: '',
  slug: '',
  event_type: 'festival',
  start_date: '',
  end_date: '',
  timezone: 'Asia/Dubai',
  venue_name: '',
  venue_city: '',
  capacity: null,
  age_minimum: 18,
  refund_policy: {
    shape: 'tiered',
    tiers: [
      { days_before_event: 30, refund_pct: 100 },
      { days_before_event: 14, refund_pct: 50 },
      { days_before_event: 0, refund_pct: 0 },
    ],
    allowed_alternatives_after_window: ['transfer_to_another_person', 'credit_for_future_event'],
    credit_validity_months: 12,
    medical_exception_section_id: 'policy.refund.medical',
  },
  doors_open_local: '20:00',
  doors_close_local: '02:00',
  last_entry_local: '01:00',
  dress_code: '',
  parking_info: '',
  vip_orders_always_escalate: true,
  escalation_keywords: [],
  escalation_contacts: [{ name: '', hours: '', method: 'in-app handoff' as const, phone: '' }],
  ticket_tiers: [{ name: '', price: undefined, description: '' }],
};

// ─── Orders CSV ───────────────────────────────────────────────────────────────

export const orderRowSchema = z.object({
  order_id: z.string().min(1).max(120),
  customer_phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/),
  customer_name: z.string().min(1).max(200).optional().nullable(),
  customer_email: z.string().email().optional().nullable(),
  preferred_language: z.enum(['en', 'ar', 'ru', 'mixed']).default('en'),
  ticket_type: z.string().max(120),
  quantity: z.coerce.number().int().positive(),
  amount_paid_aed: z.coerce.number().nonnegative().optional().nullable(),
  currency: z.string().length(3).default('AED'),
  purchase_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  status: z
    .enum(['completed', 'payment_failed', 'payment_pending', 'refunded'])
    .default('completed'),
  vip_flag: z.coerce.boolean().default(false),
  transfer_eligible: z.coerce.boolean().default(true),
  notes: z.string().optional().nullable(),
});

export type OrderRowData = z.infer<typeof orderRowSchema>;
