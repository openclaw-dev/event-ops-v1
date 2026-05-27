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

  const count = await expireStalePendingChanges();
  console.log(`[cron/expire-pending] Expired ${count} stale pending changes`);
  return NextResponse.json({ expired: count });
}
