import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { startOfLocalDayUTC, DEFAULT_EVENT_TZ } from '@/lib/dates';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Maps conversation state to a human-readable intent label for the CSV.
const STATE_TO_INTENT: Record<string, string> = {
  faq_answer:           'FAQ',
  order_lookup:         'Order lookup',
  refund_deflection:    'Refund request',
  escalation_triggered: 'Escalation',
  greeting:             'Other',
  session_closed:       'Other',
  START:                'Other',
  INTAKE:               'Other',
};

import { INTENT_TO_STATES } from '@/lib/agent/intent-labels';

// "today" is anchored to midnight in the event's timezone, not the server's UTC
// midnight (audit 4.9); "7d" is a rolling instant and is timezone-independent.
function getRangeSince(range: string, timeZone: string): string | null {
  if (range === 'today') {
    return startOfLocalDayUTC(new Date(), timeZone).toISOString();
  }
  if (range === '7d') {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  return null;
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * GET /api/events/[eventId]/conversations/export
 *
 * Query params:
 *   q        — search query (phone, order ID, or message FTS)
 *   intent   — intent filter (faq | order | refund | escalation | other)
 *   language — language filter
 *   range    — date range (today | 7d | <empty>=all time)
 *
 * Returns a UTF-8 CSV file with columns:
 *   date, phone, language, intent, state, message_count, resolved_by
 */
export async function GET(
  request: Request,
  { params }: { params: { eventId: string } },
) {
  const supabase = createServerClient();

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // Verify access to this event via RLS.
  const { data: event } = await supabase
    .from('events')
    .select('id, name, timezone')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();

  if (!event) {
    return NextResponse.json({ error: 'Event not found or access denied.' }, { status: 404 });
  }

  const eventTz = (event as { timezone?: string | null }).timezone ?? DEFAULT_EVENT_TZ;

  // ── 2. Parse filters from URL ─────────────────────────────────────────────
  const url        = new URL(request.url);
  const query      = (url.searchParams.get('q') ?? '').trim();
  const intent     = url.searchParams.get('intent') ?? '';
  const language   = url.searchParams.get('language') ?? '';
  const range      = url.searchParams.get('range') ?? '';
  const since      = getRangeSince(range, eventTz);

  // ── 3. Resolve search → conversation IDs ─────────────────────────────────
  let searchConvoIds: string[] | null = null;

  if (query) {
    if (/^[A-Z]{2,5}[-_][A-Z0-9]{3,15}$/i.test(query)) {
      const { data: orderRows } = await supabase
        .from('orders')
        .select('id')
        .eq('event_id', params.eventId)
        .eq('order_id', query.toUpperCase())
        .limit(50);
      const orderIds = (orderRows ?? []).map((r) => r.id as string);
      if (orderIds.length > 0) {
        const { data: convoRows } = await supabase
          .from('conversations')
          .select('id')
          .eq('event_id', params.eventId)
          .in('matched_order_id', orderIds);
        searchConvoIds = (convoRows ?? []).map((r) => r.id as string);
      } else {
        searchConvoIds = [];
      }
    } else {
      const [phoneResult, ftsResult] = await Promise.all([
        supabase
          .from('conversations')
          .select('id')
          .eq('event_id', params.eventId)
          .ilike('customer_phone_e164', `%${query}%`),
        query.length >= 3
          ? supabase
              .from('messages')
              .select('conversation_id')
              .textSearch('text', query, { type: 'plain', config: 'english' })
              .limit(500)
          : Promise.resolve({ data: null }),
      ]);
      const phoneIds = (phoneResult.data ?? []).map((r) => r.id as string);
      const ftsIds   = ((ftsResult as { data: Array<{ conversation_id: string }> | null }).data ?? [])
        .map((r) => r.conversation_id);
      searchConvoIds = Array.from(new Set(phoneIds.concat(ftsIds)));
    }
  }

  // ── 4. Fetch all matching conversations (no pagination) ───────────────────
  let q = supabase
    .from('conversations')
    .select('id, customer_phone_e164, language, state, created_at')
    .eq('event_id', params.eventId)
    .order('created_at', { ascending: false })
    .limit(10000); // safety cap

  if (intent && INTENT_TO_STATES[intent]) {
    q = q.in('state', INTENT_TO_STATES[intent]);
  }
  if (language) q = q.eq('language', language);
  if (since)    q = q.gte('created_at', since);

  if (searchConvoIds !== null) {
    if (searchConvoIds.length === 0) {
      // Return empty CSV immediately.
      return csvResponse(event.name as string, []);
    }
    q = q.in('id', searchConvoIds);
  }

  const { data: convos, error: convosError } = await q;
  if (convosError) {
    return NextResponse.json({ error: convosError.message }, { status: 500 });
  }

  const rows = (convos ?? []) as Array<{
    id: string;
    customer_phone_e164: string;
    language: string;
    state: string;
    created_at: string;
  }>;

  if (rows.length === 0) {
    return csvResponse(event.name as string, []);
  }

  // ── 5. Fetch messages for message count + resolved_by ────────────────────
  const convoIds = rows.map((r) => r.id);
  const { data: msgs } = await supabase
    .from('messages')
    .select('conversation_id, role')
    .in('conversation_id', convoIds);

  const msgStats = new Map<string, { count: number; hasHuman: boolean }>();
  for (const m of (msgs ?? []) as Array<{ conversation_id: string; role: string }>) {
    const s = msgStats.get(m.conversation_id) ?? { count: 0, hasHuman: false };
    s.count += 1;
    if (m.role === 'human_operator') s.hasHuman = true;
    msgStats.set(m.conversation_id, s);
  }

  // ── 6. Build CSV rows ─────────────────────────────────────────────────────
  const csvRows: string[] = rows.map((c) => {
    const stats = msgStats.get(c.id) ?? { count: 0, hasHuman: false };

    let resolvedBy: string;
    if (c.state === 'escalation_triggered') {
      resolvedBy = 'Escalated';
    } else if (c.state === 'session_closed' && stats.hasHuman) {
      resolvedBy = 'Human';
    } else if (c.state === 'session_closed') {
      resolvedBy = 'AI';
    } else {
      resolvedBy = 'In progress';
    }

    const intentLabel = STATE_TO_INTENT[c.state] ?? 'Other';

    return [
      escapeCsvField(formatDate(c.created_at)),
      escapeCsvField(c.customer_phone_e164),
      escapeCsvField(c.language),
      escapeCsvField(intentLabel),
      escapeCsvField(c.state),
      String(stats.count),
      escapeCsvField(resolvedBy),
    ].join(',');
  });

  return csvResponse(event.name as string, csvRows);
}

function csvResponse(eventName: string, dataRows: string[]): Response {
  const header = 'date,phone,language,intent,state,message_count,resolved_by';
  const body   = [header, ...dataRows].join('\n');
  const filename = `conversations-${eventName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${
    new Date().toISOString().slice(0, 10)
  }.csv`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
