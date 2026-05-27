export const runtime = 'nodejs';
export const maxDuration = 10;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';

// ─── Validation schemas ───────────────────────────────────────────────────────

const createPromoterSchema = z.object({
  event_id: z.string().uuid(),
  phone_e164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 format e.g. +971501234567'),
  display_name: z.string().min(1).max(100),
  preferred_language: z.enum(['en', 'ar', 'ru']).default('en'),
});

// ─── GET /api/promoters?event_id=<uuid> ───────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get('event_id');
  if (!eventId) {
    return NextResponse.json({ error: 'event_id query param is required.' }, { status: 400 });
  }

  // Verify event belongs to the authenticated operator (RLS-scoped).
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();

  if (eventError || !event) {
    return NextResponse.json(
      { error: 'Event not found or access denied.' },
      { status: 404 },
    );
  }

  // Fetch promoters — RLS filters to the operator automatically.
  const { data: promoters, error: queryError } = await supabase
    .from('promoters')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  return NextResponse.json({ promoters: promoters ?? [] });
}

// ─── POST /api/promoters ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // Parse and validate body.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = createPromoterSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 422 },
    );
  }

  const body = parsed.data;

  // Validate event access and retrieve operator_id (RLS-scoped query).
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, operator_id')
    .eq('id', body.event_id)
    .is('deleted_at', null)
    .single();

  if (eventError || !event) {
    return NextResponse.json(
      { error: 'Event not found or access denied.' },
      { status: 404 },
    );
  }

  const operatorId = (event as Record<string, unknown>).operator_id as string;

  // Insert promoter — RLS WITH CHECK ensures operator ownership.
  const { data: promoter, error: insertError } = await supabase
    .from('promoters')
    .insert({
      operator_id: operatorId,
      event_id: body.event_id,
      phone_e164: body.phone_e164,
      display_name: body.display_name,
      preferred_language: body.preferred_language,
    })
    .select()
    .single();

  if (insertError) {
    // PostgreSQL unique violation
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'This phone number is already registered for this operator.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(promoter, { status: 201 });
}
