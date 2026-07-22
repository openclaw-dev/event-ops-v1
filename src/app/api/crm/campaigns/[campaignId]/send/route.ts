export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rate-limit';
import { sendCampaign } from '@/lib/crm/campaigns';

interface RouteParams {
  params: { campaignId: string };
}

export async function POST(_req: Request, { params }: RouteParams) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // Verify campaign ownership via RLS.
  const { data: campaign } = await supabase
    .from('crm_campaigns')
    .select('id, status, operator_id')
    .eq('id', params.campaignId)
    .single();

  if (!campaign) {
    return NextResponse.json(
      { error: 'Campaign not found or access denied.' },
      { status: 404 },
    );
  }

  const c = campaign as { id: string; status: string; operator_id: string };
  if (c.status !== 'draft') {
    return NextResponse.json(
      { error: `Campaign is already in status "${c.status}".` },
      { status: 409 },
    );
  }

  // Per-operator rate limit on sends (audit 9.1b). In-memory / per-instance —
  // see rate-limit.ts.
  const rl = rateLimit(`crm-send:${c.operator_id}`, 5, 60_000);
  if (!rl.allowed) {
    console.warn('[crm/send] rate limit exceeded', {
      operator_id: c.operator_id,
      retry_after_ms: rl.retryAfterMs,
    });
    return NextResponse.json(
      { error: 'Too many campaign sends. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  // Use admin client for the actual send (createAdminClient is called inside sendCampaign).
  void createAdminClient(); // ensure env vars are present before delegating
  const { sent, failed } = await sendCampaign(params.campaignId);

  return NextResponse.json({ sent, failed });
}
