export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import {
  createRecoveryAttempt,
  sendRecoveryMessage,
  getRecoveryStats,
} from '@/lib/recovery/payment-recovery';

// ─── Validation ───────────────────────────────────────────────────────────────

const attemptSchema = z.object({
  customer_phone_e164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 format e.g. +971501234567'),
  customer_name: z.string().optional(),
  customer_email: z.string().optional(),
  original_order_id: z.string().optional(),
  ticket_type: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  amount_sar: z.number().positive(),
  payment_link: z.string().url('payment_link must be a valid URL'),
  payment_provider: z.enum(['checkout', 'tabby', 'tamara', 'tap', 'manual']),
});

const bulkSchema = z.object({
  event_id: z.string().uuid(),
  recovery_attempts: z.array(attemptSchema).min(1).max(100),
});

// ─── POST /api/recovery/bulk ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = bulkSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { event_id, recovery_attempts } = parsed.data;

  // Verify event ownership and fetch event name.
  const { data: eventRow } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', event_id)
    .is('deleted_at', null)
    .single();

  if (!eventRow) {
    return NextResponse.json(
      { error: 'Event not found or access denied.' },
      { status: 404 },
    );
  }

  const event_name = (eventRow as { id: string; name: string }).name;

  // Resolve operator_id.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operator_id = resolveActiveOperatorId(
    (memberships ?? []).map((m) => m.operator_id as string),
  );

  if (!operator_id) {
    return NextResponse.json(
      { error: 'No operator found. Complete onboarding first.' },
      { status: 403 },
    );
  }

  // Process attempts sequentially — avoids Meta rate-limit (one failure does not abort others).
  let sent = 0;
  let failed = 0;
  const results: Array<{ phone: string; status: 'sent' | 'failed'; error?: string }> = [];

  for (const attempt of recovery_attempts) {
    try {
      const { id } = await createRecoveryAttempt({
        ...attempt,
        operator_id,
        event_id,
      });
      const sendResult = await sendRecoveryMessage({
        recovery_attempt_id: id,
        event_name,
        customer_name: attempt.customer_name,
      });
      if (sendResult.success) {
        sent++;
        results.push({ phone: attempt.customer_phone_e164, status: 'sent' });
      } else {
        failed++;
        results.push({ phone: attempt.customer_phone_e164, status: 'failed', error: sendResult.error });
      }
    } catch (err) {
      failed++;
      results.push({
        phone: attempt.customer_phone_e164,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ sent, failed, results });
}

// ─── GET /api/recovery/bulk?event_id=<uuid> ───────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const event_id = searchParams.get('event_id');
  if (!event_id) {
    return NextResponse.json(
      { error: 'event_id query param is required.' },
      { status: 400 },
    );
  }

  // Verify event ownership.
  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('id', event_id)
    .is('deleted_at', null)
    .single();

  if (!event) {
    return NextResponse.json(
      { error: 'Event not found or access denied.' },
      { status: 404 },
    );
  }

  const stats = await getRecoveryStats(event_id);
  return NextResponse.json(stats);
}
