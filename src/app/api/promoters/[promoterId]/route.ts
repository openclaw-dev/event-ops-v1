export const runtime = 'nodejs';
export const maxDuration = 10;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';

// ─── Validation ───────────────────────────────────────────────────────────────

const updatePromoterSchema = z.object({
  display_name: z.string().min(1).max(100).optional(),
  preferred_language: z.enum(['en', 'ar', 'ru']).optional(),
  is_active: z.boolean().optional(),
});

// ─── DELETE /api/promoters/[promoterId] ───────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // Verify the promoter belongs to the authenticated operator (RLS-scoped).
  const { data: promoter, error: fetchError } = await supabase
    .from('promoters')
    .select('id')
    .eq('id', params.promoterId)
    .single();

  if (fetchError || !promoter) {
    return NextResponse.json(
      { error: 'Promoter not found or access denied.' },
      { status: 404 },
    );
  }

  const { error: deleteError } = await supabase
    .from('promoters')
    .delete()
    .eq('id', params.promoterId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// ─── PATCH /api/promoters/[promoterId] ───────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { promoterId: string } },
) {
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

  const parsed = updatePromoterSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 422 },
    );
  }

  // Verify ownership (RLS) and fetch the promoter.
  const { data: existing, error: fetchError } = await supabase
    .from('promoters')
    .select('id')
    .eq('id', params.promoterId)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: 'Promoter not found or access denied.' },
      { status: 404 },
    );
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.display_name !== undefined) updates.display_name = parsed.data.display_name;
  if (parsed.data.preferred_language !== undefined) updates.preferred_language = parsed.data.preferred_language;
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;

  const { data: updated, error: updateError } = await supabase
    .from('promoters')
    .update(updates)
    .eq('id', params.promoterId)
    .select()
    .single();

  if (updateError || !updated) {
    return NextResponse.json(
      { error: updateError?.message ?? 'Update failed.' },
      { status: 500 },
    );
  }

  return NextResponse.json(updated);
}
