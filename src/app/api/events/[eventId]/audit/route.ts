import { NextResponse } from 'next/server';

import { getRevenueLeakAuditData } from '@/lib/reports/revenue-leak-audit';
import { buildRevenueLeakAuditHtml } from '@/lib/reports/revenue-leak-audit-template';
import { createServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface RouteParams {
  params: { eventId: string };
}

export async function GET(_request: Request, { params }: RouteParams) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // RLS check: ensure the event belongs to the authenticated operator.
  const { data: event } = await supabase
    .from('events')
    .select('id, name, start_date')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();

  if (!event) {
    return NextResponse.json(
      { error: 'Event not found or access denied.' },
      { status: 404 },
    );
  }

  const auditData = await getRevenueLeakAuditData(params.eventId);
  const html = buildRevenueLeakAuditHtml(auditData);

  const safeName = (event.name as string)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const dateSlug = (event.start_date as string | null)?.slice(0, 10) ?? 'undated';
  const filename = `revenue-leak-audit-${safeName}-${dateSlug}.html`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
