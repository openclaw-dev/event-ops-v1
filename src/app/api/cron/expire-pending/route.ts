export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { expireStalePendingChanges } from '@/lib/data-entry/pending-changes';
import { expireStaleRecoveryAttempts } from '@/lib/recovery/payment-recovery';
import { purgeProcessedMessages } from '@/lib/whatsapp/message-dedup';
import { purgeExpiredSessionState } from '@/lib/agent/whatsapp-session-state';

export async function GET(req: NextRequest) {
  // Fail closed if the secret is not configured — an unset CRON_SECRET must
  // NEVER become the literal comparison `Bearer undefined` (an auth bypass).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/expire-pending] CRON_SECRET is not set — refusing to run');
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  // Verify this is called by Vercel Cron or internally.
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // allSettled so one failing job never discards the others' results (audit
  // 6.11). A failed job reports null (distinct from 0 rows affected).
  const [pendingRes, recoveryRes, purgeRes, sessionRes] = await Promise.allSettled([
    expireStalePendingChanges(),
    expireStaleRecoveryAttempts(),
    purgeProcessedMessages(),
    // Purge expired whatsapp_session_state rows (audit 5.7) — expiry is enforced
    // on read but rows were never physically deleted, so the table grew forever.
    purgeExpiredSessionState(),
  ]);

  const jobResult = (res: PromiseSettledResult<number>, name: string): number | null => {
    if (res.status === 'fulfilled') return res.value;
    console.error(`[cron/expire-pending] ${name} failed:`, res.reason);
    return null;
  };

  const expired_pending = jobResult(pendingRes, 'expireStalePendingChanges');
  const expired_recovery = jobResult(recoveryRes, 'expireStaleRecoveryAttempts');
  const purged_messages = jobResult(purgeRes, 'purgeProcessedMessages');
  const purged_sessions = jobResult(sessionRes, 'purgeExpiredSessionState');

  console.log(
    `[cron/expire-pending] pending=${expired_pending} recovery=${expired_recovery} purged=${purged_messages} sessions=${purged_sessions}`,
  );

  const allSucceeded = [pendingRes, recoveryRes, purgeRes, sessionRes].every(
    (r) => r.status === 'fulfilled',
  );
  return NextResponse.json(
    { expired_pending, expired_recovery, purged_messages, purged_sessions, all_succeeded: allSucceeded },
    { status: 200 },
  );
}
