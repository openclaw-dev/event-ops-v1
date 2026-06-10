export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { expireStalePendingChanges } from '@/lib/data-entry/pending-changes';
import { expireStaleRecoveryAttempts } from '@/lib/recovery/payment-recovery';

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron or internally.
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const [pendingCount, recoveryCount] = await Promise.all([
      expireStalePendingChanges(),
      expireStaleRecoveryAttempts(),
    ]);
    console.log(`[cron/expire-pending] Expired ${pendingCount} stale pending changes`);
    console.log(`[cron/expire-pending] Expired ${recoveryCount} stale recovery attempts`);
    return NextResponse.json({ expired_pending: pendingCount, expired_recovery: recoveryCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/expire-pending] failed:', err);
    return NextResponse.json({ error: msg, expired_pending: 0, expired_recovery: 0 }, { status: 200 });
  }
}
