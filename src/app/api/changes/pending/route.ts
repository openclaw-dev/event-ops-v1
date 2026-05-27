export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { findPendingByEvent } from '@/lib/data-entry/pending-changes';

/**
 * GET /api/changes/pending?event_id=<uuid>[&limit=25&offset=0]
 *
 * Returns paginated pending_changes rows for a given event.
 * RLS validates the authenticated operator owns the event.
 */
export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // ── Params ──────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get('event_id');

  if (!eventId) {
    return NextResponse.json(
      { error: 'event_id query param is required.' },
      { status: 400 },
    );
  }

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '25', 10), 100);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

  // ── Authorise — RLS on the session-scoped client confirms ownership ──────
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

  // ── Fetch pending changes via admin client ───────────────────────────────
  const pendingChanges = await findPendingByEvent(eventId, limit, offset);

  return NextResponse.json({ pending_changes: pendingChanges });
}
