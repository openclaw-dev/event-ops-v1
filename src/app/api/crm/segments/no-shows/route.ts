export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { getNoShowSegment } from '@/lib/crm/campaigns';

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

  const segment = await getNoShowSegment(event_id);
  return NextResponse.json({ count: segment.length, segment });
}
