export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { expireStalePendingChanges } from '@/lib/data-entry/pending-changes';
import { expireStaleRecoveryAttempts } from '@/lib/recovery/payment-recovery';
import { purgeProcessedMessages } from '@/lib/whatsapp/message-dedup';

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

  try {
    const [pendingCount, recoveryCount, purgedMessages] = await Promise.all([
      expireStalePendingChanges(),
      expireStaleRecoveryAttempts(),
      purgeProcessedMessages(),
    ]);
    console.log(`[cron/expire-pending] Expired ${pendingCount} stale pending changes`);
    console.log(`[cron/expire-pending] Expired ${recoveryCount} stale recovery attempts`);
    console.log(`[cron/expire-pending] Purged ${purgedMessages} processed WhatsApp messages`);
    return NextResponse.json({
      expired_pending: pendingCount,
      expired_recovery: recoveryCount,
      purged_messages: purgedMessages,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/expire-pending] failed:', err);
    return NextResponse.json(
      { error: msg, expired_pending: 0, expired_recovery: 0, purged_messages: 0 },
      { status: 200 },
    );
  }
}
