/**
 * POST /api/events
 *
 * Creates a new event under the authenticated user's active operator with
 * sensible defaults. The operator can refine all fields from the Setup tab.
 *
 * Body (JSON):
 *   name        — string, required, min 2 chars
 *   slug        — string, required, lowercase alphanumeric + hyphens
 *   event_type? — 'festival'|'club'|'concert'|'conference'|'other', default 'festival'
 *   start_date? — 'YYYY-MM-DD', default today
 *   end_date?   — 'YYYY-MM-DD', default today
 *   timezone?   — tz string, default 'Asia/Dubai'
 *
 * Returns: { event: { id, name, slug } }
 * 409 on slug uniqueness conflict.
 */

import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import type { EventConfig } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const VALID_EVENT_TYPES = new Set(['festival', 'club', 'concert', 'conference', 'other']);
const SLUG_RE = /^[a-z0-9-]+$/;

interface CreateEventBody {
  name: string;
  slug: string;
  event_type?: string;
  start_date?: string;
  end_date?: string;
  timezone?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  // ── 1. Parse body ────────────────────────────────────────────────────────
  let body: CreateEventBody;
  try {
    body = (await request.json()) as CreateEventBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { name, slug } = body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return NextResponse.json({ error: 'name is required (min 2 chars).' }, { status: 400 });
  }
  if (!slug || typeof slug !== 'string' || !SLUG_RE.test(slug) || slug.length < 2) {
    return NextResponse.json(
      { error: 'slug must contain only lowercase letters, numbers, and hyphens (min 2 chars).' },
      { status: 400 },
    );
  }

  // ── 2. Authenticate ──────────────────────────────────────────────────────
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // ── 3. Resolve active operator ───────────────────────────────────────────
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operatorId = resolveActiveOperatorId(
    (memberships ?? []).map((m) => m.operator_id as string),
  );

  if (!operatorId) {
    return NextResponse.json(
      { error: 'No operator found. Complete onboarding first.' },
      { status: 403 },
    );
  }

  // ── 4. Build defaults ────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0] as string;
  const trimmedName = name.trim();
  const eventType =
    typeof body.event_type === 'string' && VALID_EVENT_TYPES.has(body.event_type)
      ? body.event_type
      : 'festival';
  const startDate = typeof body.start_date === 'string' && body.start_date ? body.start_date : today;
  const endDate = typeof body.end_date === 'string' && body.end_date ? body.end_date : today;
  const timezone =
    typeof body.timezone === 'string' && body.timezone ? body.timezone : 'Asia/Dubai';

  const config: EventConfig = {
    event_id: '',           // patched after insert
    event_name: trimmedName,
    event_date_iso: startDate,
    refund_policy: {
      shape: 'strict',
      tiers: [{ days_before_event: 0, refund_pct: 0 }],
      allowed_alternatives_after_window: [],
      credit_validity_months: 12,
      medical_exception_section_id: '',
    },
    escalation_keywords: [],
    vip_orders_always_escalate: false,
    dress_code: '',
    age_minimum: 0,
    doors_open_local: '20:00',
    doors_close_local: '02:00',
    last_entry_local: '01:00',
    parking_info: '',
    escalation_contacts: [],
    ticket_tiers: [],
  };

  // ── 5. Insert event ──────────────────────────────────────────────────────
  const { data: event, error: insertError } = await supabase
    .from('events')
    .insert({
      operator_id: operatorId,
      name: trimmedName,
      slug,
      event_type: eventType,
      start_date: startDate,
      end_date: endDate,
      timezone,
      venue_name: '',
      venue_city: '',
      age_minimum: 0,
      config,
    })
    .select('id, name, slug')
    .single();

  if (insertError || !event) {
    const msg = insertError?.message ?? 'Failed to create event.';
    if (insertError?.code === '23505' || msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json(
        { error: 'An event with this slug already exists.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // ── 6. Patch config.event_id ─────────────────────────────────────────────
  const finalConfig: EventConfig = { ...config, event_id: event.id as string };
  await supabase.from('events').update({ config: finalConfig }).eq('id', event.id);

  // ── 7. Audit log ─────────────────────────────────────────────────────────
  const admin = createAdminClient();
  await admin.from('audit_log').insert({
    operator_id: operatorId,
    event_id: event.id,
    actor_type: 'user',
    actor_id: user.id,
    action: 'event.created',
    entity_type: 'event',
    entity_id: event.id,
    metadata: { name: trimmedName, slug, via: 'api' },
  });

  return NextResponse.json({
    event: {
      id: event.id as string,
      name: event.name as string,
      slug: event.slug as string,
    },
  });
}
