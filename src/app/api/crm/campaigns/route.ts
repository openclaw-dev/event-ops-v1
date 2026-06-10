export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { createCampaign, addRecipients, sendCampaign } from '@/lib/crm/campaigns';

// ─── Validation ───────────────────────────────────────────────────────────────

const recipientSchema = z.object({
  customer_phone_e164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 format'),
  customer_name: z.string().optional(),
  customer_email: z.string().optional(),
  source_order_id: z.string().optional(),
  source_event_name: z.string().optional(),
  segment: z.string().optional(),
});

const createCampaignSchema = z.object({
  name: z.string().min(1).max(200),
  campaign_type: z.enum([
    'no_show_remarket',
    'past_buyer_remarket',
    'abandoned_cart',
    'vip_upsell',
    'custom',
  ]),
  message_template: z.string().min(1),
  event_id: z.string().uuid().optional(),
  target_event_id: z.string().uuid().optional(),
  send_immediately: z.boolean().optional(),
  recipients: z.array(recipientSchema).min(1).max(500),
});

// ─── POST /api/crm/campaigns ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = createCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const {
    name,
    campaign_type,
    message_template,
    event_id,
    target_event_id,
    send_immediately,
    recipients,
  } = parsed.data;

  // Verify event ownership if event_id provided.
  if (event_id) {
    const { data: event } = await supabase
      .from('events')
      .select('id')
      .eq('id', event_id)
      .is('deleted_at', null)
      .single();
    if (!event) {
      return NextResponse.json(
        { error: 'Event not found or access denied.' },
        { status: 404 },
      );
    }
  }

  // Resolve operator_id.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operator_id = resolveActiveOperatorId(
    (memberships ?? []).map((m) => m.operator_id as string),
  );
  if (!operator_id) {
    return NextResponse.json(
      { error: 'No operator found. Complete onboarding first.' },
      { status: 403 },
    );
  }

  // Create campaign → add recipients → optionally send.
  const { id: campaign_id } = await createCampaign({
    operator_id,
    event_id,
    name,
    campaign_type,
    message_template,
    target_event_id,
  });

  const { added } = await addRecipients({
    campaign_id,
    operator_id,
    recipients,
  });

  if (send_immediately) {
    const { sent, failed } = await sendCampaign(campaign_id);
    return NextResponse.json({ campaign_id, added, sent, failed });
  }

  return NextResponse.json({ campaign_id, added });
}

// ─── GET /api/crm/campaigns ───────────────────────────────────────────────────

export async function GET() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operator_id = resolveActiveOperatorId(
    (memberships ?? []).map((m) => m.operator_id as string),
  );
  if (!operator_id) {
    return NextResponse.json({ campaigns: [] });
  }

  const { data: campaigns } = await supabase
    .from('crm_campaigns')
    .select(
      'id, name, campaign_type, status, total_recipients, sent_count, converted_count, revenue_attributed_sar, created_at, events!crm_campaigns_event_id_fkey(name)',
    )
    .eq('operator_id', operator_id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ campaigns: campaigns ?? [] });
}
