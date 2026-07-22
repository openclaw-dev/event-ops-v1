export const runtime = 'nodejs';
export const maxDuration = 10;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { validateAndRecordScan } from '@/lib/gate/scan-validator';

const scanSchema = z.object({
  event_id: z.string().uuid(),
  scanned_code: z.string().min(1),
  gate_name: z.string().optional(),
  scanner_device: z.string().optional(),
});

// ─── POST /api/gate/scan ──────────────────────────────────────────────────────

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

  const parsed = scanSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const { event_id, scanned_code, gate_name, scanner_device } = parsed.data;

  // Verify event ownership via RLS.
  const { data: event } = await supabase
    .from('events')
    .select('id, operator_id')
    .eq('id', event_id)
    .is('deleted_at', null)
    .single();

  if (!event) {
    return NextResponse.json({ error: 'Event not found or access denied.' }, { status: 404 });
  }

  // Attribute the scan to the VERIFIED event's operator, not the active-operator
  // cookie — a user in two operators must never write gate_scans under the wrong
  // one (audit 3.1). RLS already guarantees the user belongs to event.operator_id
  // (the select above returned the row).
  const operator_id = (event as { id: string; operator_id: string }).operator_id;

  // Find the operator_user row id for attribution, scoped to THIS event's operator.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id, id')
    .eq('user_id', user.id);

  const operatorUserRow = (memberships ?? []).find(
    (m) => (m.operator_id as string) === operator_id,
  );

  const result = await validateAndRecordScan({
    event_id,
    operator_id,
    scanned_code,
    gate_name,
    scanner_device,
    scanned_by_user_id: operatorUserRow?.id as string | undefined,
  });

  return NextResponse.json(result);
}

// ─── GET /api/gate/scan?event_id=... ─────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const event_id = new URL(req.url).searchParams.get('event_id');
  if (!event_id) {
    return NextResponse.json({ error: 'event_id is required.' }, { status: 400 });
  }

  // Verify event ownership.
  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('id', event_id)
    .is('deleted_at', null)
    .single();

  if (!event) {
    return NextResponse.json({ error: 'Event not found or access denied.' }, { status: 404 });
  }

  // Stats
  const { data: allScans } = await supabase
    .from('gate_scans')
    .select('scan_result, created_at, customer_name, ticket_type, order_id')
    .eq('event_id', event_id)
    .order('created_at', { ascending: false });

  const scans = (allScans ?? []) as Array<{
    scan_result: string;
    created_at: string;
    customer_name: string | null;
    ticket_type: string | null;
    order_id: string | null;
  }>;

  const total_scanned = scans.length;
  const admitted = scans.filter((s) => s.scan_result === 'admitted').length;
  const duplicates = scans.filter((s) => s.scan_result === 'duplicate').length;
  const not_found = scans.filter((s) => s.scan_result === 'not_found').length;

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const scans_last_5_min = scans.filter((s) => s.created_at > fiveMinAgo).length;

  const recent_scans = scans.slice(0, 20).map((s) => ({
    result: s.scan_result,
    customer_name: s.customer_name,
    ticket_type: s.ticket_type,
    order_id: s.order_id,
    created_at: s.created_at,
  }));

  return NextResponse.json({
    total_scanned,
    admitted,
    duplicates,
    not_found,
    scans_last_5_min,
    recent_scans,
  });
}
