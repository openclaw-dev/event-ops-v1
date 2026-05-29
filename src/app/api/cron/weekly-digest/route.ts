export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getConversationMetrics } from '@/lib/agent/conversation-metrics';
import { buildWeeklyDigestHtml, type DigestEvent } from '@/lib/email/weekly-digest';
import { sendEmail } from '@/lib/email/send';
import type { EventConfig } from '@/lib/types';

/**
 * GET /api/cron/weekly-digest
 *
 * Runs every Monday at 09:00 UTC (see vercel.json).
 * Sends one digest email per operator summarising the last 7 days of
 * conversation activity across all their events.
 *
 * Operators with zero conversations in the period are silently skipped.
 */
export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // ── Time window ───────────────────────────────────────────────────────────
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since = weekAgo.toISOString();
  const period = formatPeriod(weekAgo, new Date(now.getTime() - 24 * 60 * 60 * 1000));

  // ── Fetch all operators ───────────────────────────────────────────────────
  const { data: operatorRows } = await admin
    .from('operators')
    .select('id, name');

  const operators = (operatorRows ?? []) as { id: string; name: string }[];
  if (operators.length === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, results: [] });
  }

  const results: { operator: string; status: string }[] = [];

  for (const operator of operators) {
    // ── Resolve owner email ────────────────────────────────────────────────
    const { data: ownerRow } = await admin
      .from('operator_users')
      .select('user_id, invited_email')
      .eq('operator_id', operator.id)
      .eq('role', 'owner')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!ownerRow) {
      results.push({ operator: operator.name, status: 'skipped (no owner user)' });
      continue;
    }

    const { user_id: userId, invited_email: invitedEmail } = ownerRow as {
      user_id: string | null;
      invited_email: string | null;
    };

    let toEmail: string | null = null;
    if (userId) {
      const { data: authData } = await admin.auth.admin.getUserById(userId);
      toEmail = authData?.user?.email ?? invitedEmail ?? null;
    } else {
      toEmail = invitedEmail;
    }

    if (!toEmail) {
      results.push({ operator: operator.name, status: 'skipped (no email address)' });
      continue;
    }

    // ── Fetch events for this operator ─────────────────────────────────────
    const { data: eventRows } = await admin
      .from('events')
      .select('id, name, config')
      .eq('operator_id', operator.id)
      .is('deleted_at', null);

    const events = (eventRows ?? []) as { id: string; name: string; config: unknown }[];

    if (events.length === 0) {
      results.push({ operator: operator.name, status: 'skipped (no events)' });
      continue;
    }

    // ── Collect per-event metrics ──────────────────────────────────────────
    const digestEvents: DigestEvent[] = [];
    let totalSarSaved = 0;

    for (const ev of events) {
      const metrics = await getConversationMetrics(ev.id, { since });
      if (metrics.total === 0) continue;

      const eventConfig = (ev.config ?? {}) as Partial<EventConfig>;
      const prices = (eventConfig.ticket_tiers ?? [])
        .map((t) => t.price ?? 0)
        .filter((p) => p > 0);
      const lowestPrice = prices.length > 0 ? Math.min(...prices) : 150;
      totalSarSaved += metrics.refunds_deflected * lowestPrice;

      digestEvents.push({
        name: ev.name,
        total_conversations: metrics.total,
        resolved_by_ai: metrics.resolved_by_ai,
        escalated: metrics.escalated,
        refunds_deflected: metrics.refunds_deflected,
        coverage_score: metrics.resolution_rate,
      });
    }

    if (digestEvents.length === 0) {
      results.push({ operator: operator.name, status: 'skipped (no conversations this week)' });
      continue;
    }

    // ── Build and send digest ──────────────────────────────────────────────
    const html = buildWeeklyDigestHtml({
      operator_name: operator.name,
      period,
      events: digestEvents,
      total_sar_saved: totalSarSaved,
    });

    const { success, error } = await sendEmail({
      to: toEmail,
      subject: `Your weekly event ops summary — ${period}`,
      html,
    });

    if (success) {
      results.push({ operator: operator.name, status: `sent to ${toEmail}` });
    } else {
      results.push({ operator: operator.name, status: `error: ${error ?? 'unknown'}` });
    }
  }

  const sent = results.filter((r) => r.status.startsWith('sent')).length;
  const skipped = results.filter((r) => r.status.startsWith('skipped')).length;

  console.log(`[cron/weekly-digest] ${sent} sent, ${skipped} skipped`);
  return NextResponse.json({ sent, skipped, results });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable period string, e.g. "22–28 May 2026".
 * If start and end span two months/years, both are shown in full.
 */
function formatPeriod(start: Date, end: Date): string {
  const sameMonth =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();

  if (sameMonth) {
    const monthYear = end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return `${start.getDate()}–${end.getDate()} ${monthYear}`;
  }

  const startStr = start.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: start.getFullYear() !== end.getFullYear() ? 'numeric' : undefined,
  });
  const endStr = end.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${startStr} – ${endStr}`;
}
