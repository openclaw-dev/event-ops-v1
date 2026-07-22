export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { rateLimit } from '@/lib/rate-limit';
import { filterPhonesToOperatorOrders } from '@/lib/recipients';
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

  // Verify ownership of every referenced event and capture the operator to
  // attribute the campaign to. target_event_id was previously NEVER ownership-
  // checked, yet sendCampaign reads that event's name via the admin client into
  // the outbound message — letting a user exfiltrate another tenant's event name
  // by UUID (audit 3.2). Both ids are now RLS-verified here.
  let anchorOperatorId: string | null = null;

  if (event_id) {
    const { data: event } = await supabase
      .from('events')
      .select('id, operator_id')
      .eq('id', event_id)
      .is('deleted_at', null)
      .single();
    if (!event) {
      return NextResponse.json(
        { error: 'Event not found or access denied.' },
        { status: 404 },
      );
    }
    anchorOperatorId = (event as { operator_id: string }).operator_id;
  }

  if (target_event_id) {
    const { data: targetEvent } = await supabase
      .from('events')
      .select('id, operator_id')
      .eq('id', target_event_id)
      .is('deleted_at', null)
      .single();
    if (!targetEvent) {
      return NextResponse.json(
        { error: 'Target event not found or access denied.' },
        { status: 404 },
      );
    }
    anchorOperatorId = anchorOperatorId ?? (targetEvent as { operator_id: string }).operator_id;
  }

  // Resolve operator_id: prefer the VERIFIED event's operator (audit 3.1); fall
  // back to the active-operator cookie only when no event is referenced.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operator_id =
    anchorOperatorId ??
    resolveActiveOperatorId((memberships ?? []).map((m) => m.operator_id as string));
  if (!operator_id) {
    return NextResponse.json(
      { error: 'No operator found. Complete onboarding first.' },
      { status: 403 },
    );
  }

  // Recipient ownership check (audit 9.1a) — recipients must be the operator's
  // own customers (phones on orders under the operator's events), never
  // arbitrary numbers on the shared WABA.
  const requestedPhones = recipients.map((r) => r.customer_phone_e164);
  const validPhones = await filterPhonesToOperatorOrders(supabase, operator_id, requestedPhones);
  const rejectedCount = recipients.filter((r) => !validPhones.has(r.customer_phone_e164)).length;
  if (rejectedCount > 0) {
    console.warn('[crm/campaigns] rejected recipients not matching operator orders', {
      operator_id,
      rejected_count: rejectedCount,
      total: recipients.length,
    });
    return NextResponse.json(
      {
        error: `${rejectedCount} of ${recipients.length} recipient(s) are not customers of your events and were rejected. Campaigns can only target phone numbers that appear on your orders.`,
        rejected_count: rejectedCount,
      },
      { status: 422 },
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
    // Per-operator rate limit on sends (audit 9.1b). In-memory / per-instance —
    // see rate-limit.ts. The campaign is created as a draft even when limited, so
    // the operator can retry the send via /api/crm/campaigns/[campaignId]/send.
    const rl = rateLimit(`crm-send:${operator_id}`, 5, 60_000);
    if (!rl.allowed) {
      console.warn('[crm/campaigns] send rate limit exceeded', {
        operator_id,
        retry_after_ms: rl.retryAfterMs,
      });
      return NextResponse.json(
        { campaign_id, added, error: 'Too many campaign sends. Please try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }
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
