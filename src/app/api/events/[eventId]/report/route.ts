import { NextResponse } from 'next/server';

import { generateReportData } from '@/lib/report/generate-report-data';
import { renderReport } from '@/lib/report/render-report';
import { createServerClient } from '@/lib/supabase/server';

interface RouteParams {
  params: { eventId: string };
}

/**
 * GET /api/events/[eventId]/report
 *
 * Returns the post-event report as printable HTML. RLS scopes the read to
 * events the current user has access to. The browser's print dialog handles
 * the PDF conversion.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const data = await generateReportData(supabase, params.eventId);
  if (!data) {
    return NextResponse.json(
      { error: 'Event not found or access denied.' },
      { status: 404 },
    );
  }

  const html = renderReport(data);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Avoid stale reports from the browser cache between event-day refreshes.
      'Cache-Control': 'no-store',
    },
  });
}
