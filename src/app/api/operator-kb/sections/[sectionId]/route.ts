import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 30;
export const runtime = 'nodejs';

/**
 * DELETE /api/operator-kb/sections/[sectionId]
 *
 * Deletes an operator KB section by its UUID primary key.
 * Verifies via RLS that the calling user has access to the section's operator.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { sectionId: string } },
) {
  // ── 1. Authenticate ──────────────────────────────────────────────────────
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // ── 2. RLS-enforced ownership check ─────────────────────────────────────
  // The RLS policy on operator_kb_sections limits reads to the user's own
  // operators, so this SELECT doubles as an auth check.
  const { data: section } = await supabase
    .from('operator_kb_sections')
    .select('id, operator_id')
    .eq('id', params.sectionId)
    .single();

  if (!section) {
    return NextResponse.json({ error: 'Section not found or access denied.' }, { status: 404 });
  }

  // ── 3. Delete via admin client ───────────────────────────────────────────
  const admin = createAdminClient();
  const { error } = await admin
    .from('operator_kb_sections')
    .delete()
    .eq('id', params.sectionId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}
