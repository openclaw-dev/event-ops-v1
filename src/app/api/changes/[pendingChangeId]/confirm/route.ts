export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { confirmPendingChange } from '@/lib/data-entry/pending-changes';

/**
 * POST /api/changes/[pendingChangeId]/confirm
 *
 * Dashboard-initiated confirmation of a pending WhatsApp change.
 * Requires an authenticated operator session.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { pendingChangeId: string } },
) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // ── Ownership check (RLS-scoped) ───────────────────────────────────────
  const { data: pendingRow } = await supabase
    .from('pending_changes')
    .select('operator_id')
    .eq('id', params.pendingChangeId)
    .single();

  if (!pendingRow) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from('operator_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('operator_id', (pendingRow as { operator_id: string }).operator_id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // ── Confirm ─────────────────────────────────────────────────────────────
  const result = await confirmPendingChange({
    pending_change_id: params.pendingChangeId,
    actor_user_id: user.id,
    via: 'dashboard',
  });

  switch (result.status) {
    case 'confirmed':
      return NextResponse.json(result, { status: 200 });

    case 'race_lost':
      return NextResponse.json(
        { status: 'race_lost', current: result.current },
        { status: 409 },
      );

    case 'expired':
      return NextResponse.json({ status: 'expired' }, { status: 410 });

    case 'not_found':
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
  }
}
