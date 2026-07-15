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
 *
 * The handler is wrapped in a single try/catch so any uncaught failure
 * returns a structured 200 response (Vercel cron retries on non-200, which
 * we don't want for an idempotent weekly digest).
 */
export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  // Fail closed if the secret is not configured — an unset CRON_SECRET must
  // NEVER become the literal comparison `Bearer undefined` (an auth bypass).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/weekly-digest] CRON_SECRET is not set — refusing to run');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const admin = createAdminClient();

    // ── Time window ────────────────────────────────────────────────────────
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const since = weekAgo.toISOString();
    const period = formatPeriod(weekAgo, new Date(now.getTime() - 24 * 60 * 60 * 1000));

    // ── Fetch all operators ────────────────────────────────────────────────
    const { data: operatorRows } = await admin.from('operators').select('id, name');
    const operators = (operatorRows ?? []) as { id: string; name: string }[];
    if (operators.length === 0) {
      return NextResponse.json({ sent: 0, skipped: 0, results: [] });
    }

    // ── Batch-load all events for all operators in ONE query ───────────────
    // Avoids N round-trips to Supabase inside the per-operator loop.
    const operatorIds = operators.map((o) => o.id);
    const { data: allEventRows } = await admin
      .from('events')
      .select('id, name, config, operator_id')
      .in('operator_id', operatorIds)
      .is('deleted_at', null);

    const eventsByOperator = new Map<
      string,
      { id: string; name: string; config: unknown }[]
    >();
    for (const row of (allEventRows ?? []) as Array<{
      id: string;
      name: string;
      config: unknown;
      operator_id: string;
    }>) {
      const list = eventsByOperator.get(row.operator_id) ?? [];
      list.push({ id: row.id, name: row.name, config: row.config });
      eventsByOperator.set(row.operator_id, list);
    }

    // ── Process all operators in parallel ──────────────────────────────────
    const settled = await Promise.allSettled(
      operators.map((operator) =>
        processOperator(operator, eventsByOperator.get(operator.id) ?? [], since, period, admin),
      ),
    );

    const results: { operator: string; status: string }[] = settled.map((res, i) => {
      if (res.status === 'fulfilled') return res.value;
      // A throw inside processOperator becomes a "failed" entry; the overall
      // batch survives because allSettled never short-circuits.
      console.error(
        '[cron/weekly-digest] operator processing threw:',
        operators[i].name,
        res.reason,
      );
      return { operator: operators[i].name, status: 'failed (uncaught error)' };
    });

    const sent = results.filter((r) => r.status.startsWith('sent')).length;
    const skipped = results.filter((r) => r.status.startsWith('skipped')).length;

    console.log(`[cron/weekly-digest] ${sent} sent, ${skipped} skipped`);
    return NextResponse.json({ sent, skipped, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/weekly-digest] uncaught failure:', err);
    return NextResponse.json({ error: msg, sent: 0 }, { status: 200 });
  }
}

// ─── Per-operator processing ─────────────────────────────────────────────────

async function processOperator(
  operator: { id: string; name: string },
  events: { id: string; name: string; config: unknown }[],
  since: string,
  period: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ operator: string; status: string }> {
  // ── Resolve owner email ───────────────────────────────────────────────────
  const { data: ownerRow } = await admin
    .from('operator_users')
    .select('user_id, invited_email')
    .eq('operator_id', operator.id)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!ownerRow) {
    return { operator: operator.name, status: 'skipped (no owner user)' };
  }

  const { user_id: userId, invited_email: invitedEmail } = ownerRow as {
    user_id: string | null;
    invited_email: string | null;
  };

  // ── Wrap the auth lookup so one bad operator doesn't abort the batch ──────
  let toEmail: string | null = null;
  if (userId) {
    try {
      const { data: authData } = await admin.auth.admin.getUserById(userId);
      toEmail = authData?.user?.email ?? invitedEmail ?? null;
    } catch (authErr) {
      console.warn(
        '[cron/weekly-digest] auth lookup failed for operator:',
        operator.name,
        authErr,
      );
      return { operator: operator.name, status: 'skipped (auth lookup failed)' };
    }
  } else {
    toEmail = invitedEmail;
  }

  if (!toEmail) {
    return { operator: operator.name, status: 'skipped (no email address)' };
  }

  if (events.length === 0) {
    return { operator: operator.name, status: 'skipped (no events)' };
  }

  // ── Per-event metrics in parallel ─────────────────────────────────────────
  const metricResults = await Promise.allSettled(
    events.map((ev) => getConversationMetrics(ev.id, { since })),
  );

  const digestEvents: DigestEvent[] = [];
  let totalSarSaved = 0;

  events.forEach((ev, i) => {
    const r = metricResults[i];
    if (r.status !== 'fulfilled' || r.value.total === 0) return;

    const metrics = r.value;
    const eventConfig = (ev.config ?? {}) as Partial<EventConfig>;
    const prices = (eventConfig.ticket_tiers ?? [])
      .map((t) => t.price ?? 0)
      .filter((p) => p > 0);
    const lowestPrice = prices.length > 0 ? Math.min(...prices) : 0;
    if (lowestPrice > 0) {
      totalSarSaved += metrics.refunds_deflected * lowestPrice;
    }

    digestEvents.push({
      name: ev.name,
      total_conversations: metrics.total,
      resolved_by_ai: metrics.resolved_by_ai,
      escalated: metrics.escalated,
      refunds_deflected: metrics.refunds_deflected,
      coverage_score: metrics.resolution_rate,
    });
  });

  if (digestEvents.length === 0) {
    return { operator: operator.name, status: 'skipped (no conversations this week)' };
  }

  // ── Build and send digest ─────────────────────────────────────────────────
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

  if (success) return { operator: operator.name, status: `sent to ${toEmail}` };
  return { operator: operator.name, status: `error: ${error ?? 'unknown'}` };
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
