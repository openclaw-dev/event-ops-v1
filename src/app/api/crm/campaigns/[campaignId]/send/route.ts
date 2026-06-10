export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
    .select('id, status')
    .eq('id', params.campaignId)
    .single();

  if (!campaign) {
    return NextResponse.json(
      { error: 'Campaign not found or access denied.' },
      { status: 404 },
    );
  }

  const c = campaign as { id: string; status: string };
  if (c.status !== 'draft') {
    return NextResponse.json(
      { error: `Campaign is already in status "${c.status}".` },
      { status: 409 },
    );
  }

  // Use admin client for the actual send (createAdminClient is called inside sendCampaign).
  void createAdminClient(); // ensure env vars are present before delegating
  const { sent, failed } = await sendCampaign(params.campaignId);

  return NextResponse.json({ sent, failed });
}
