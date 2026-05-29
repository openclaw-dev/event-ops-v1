export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { expireStalePendingChanges } from '@/lib/data-entry/pending-changes';

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron or internally.
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const count = await expireStalePendingChanges();
    console.log(`[cron/expire-pending] Expired ${count} stale pending changes`);
    return NextResponse.json({ expired: count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/expire-pending] failed:', err);
    return NextResponse.json({ error: msg, expired: 0 }, { status: 200 });
  }
}
