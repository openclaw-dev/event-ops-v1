import { createAdminClient } from '@/lib/supabase/admin';
import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function personalizeTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── createCampaign ───────────────────────────────────────────────────────────

export async function createCampaign(params: {
  operator_id: string;
  event_id?: string;
  name: string;
  campaign_type: string;
  message_template: string;
  target_event_id?: string;
}): Promise<{ id: string }> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('crm_campaigns')
    .insert({
      operator_id: params.operator_id,
      event_id: params.event_id ?? null,
      name: params.name,
      campaign_type: params.campaign_type,
      message_template: params.message_template,
      target_event_id: params.target_event_id ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create campaign');
  }

  return { id: (data as { id: string }).id };
}

// ─── addRecipients ────────────────────────────────────────────────────────────

export async function addRecipients(params: {
  campaign_id: string;
  operator_id: string;
  recipients: Array<{
    customer_phone_e164: string;
    customer_name?: string;
    customer_email?: string;
    source_order_id?: string;
    source_event_name?: string;
    segment?: string;
  }>;
}): Promise<{ added: number }> {
  if (params.recipients.length === 0) return { added: 0 };

  const admin = createAdminClient();

  const rows = params.recipients.map((r) => ({
    campaign_id: params.campaign_id,
    operator_id: params.operator_id,
    customer_phone_e164: r.customer_phone_e164,
    customer_name: r.customer_name ?? null,
    customer_email: r.customer_email ?? null,
    source_order_id: r.source_order_id ?? null,
    source_event_name: r.source_event_name ?? null,
    segment: r.segment ?? null,
  }));

  const { data, error } = await admin
    .from('crm_campaign_recipients')
    .insert(rows)
    .select('id');

  if (error) {
    throw new Error(error.message ?? 'Failed to add recipients');
  }

  const added = (data ?? []).length;

  // Increment total_recipients (don't overwrite — addRecipients may be called multiple times).
  const { data: current } = await admin
    .from('crm_campaigns')
    .select('total_recipients')
    .eq('id', params.campaign_id)
    .single();

  const newTotal = ((current as { total_recipients: number } | null)?.total_recipients ?? 0) + added;

  await admin
    .from('crm_campaigns')
    .update({ total_recipients: newTotal, updated_at: new Date().toISOString() })
    .eq('id', params.campaign_id);

  return { added };
}

// ─── sendCampaign ─────────────────────────────────────────────────────────────

export async function sendCampaign(
  campaign_id: string,
): Promise<{ sent: number; failed: number }> {
  const admin = createAdminClient();

  // Fetch campaign details.
  const { data: campaignRow } = await admin
    .from('crm_campaigns')
    .select('message_template, target_event_id, operator_id')
    .eq('id', campaign_id)
    .single();

  if (!campaignRow) {
    throw new Error(`Campaign ${campaign_id} not found`);
  }

  const campaign = campaignRow as {
    message_template: string;
    target_event_id: string | null;
    operator_id: string;
  };

  // Resolve target event name for {{event}} substitution.
  let targetEventName = '';
  if (campaign.target_event_id) {
    const { data: targetEvent } = await admin
      .from('events')
      .select('name')
      .eq('id', campaign.target_event_id)
      .single();
    targetEventName = (targetEvent as { name: string } | null)?.name ?? '';
  }

  // Mark campaign as sending.
  await admin
    .from('crm_campaigns')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', campaign_id);

  // Fetch all pending recipients.
  const { data: recipientsData } = await admin
    .from('crm_campaign_recipients')
    .select('id, customer_phone_e164, customer_name')
    .eq('campaign_id', campaign_id)
    .eq('status', 'pending');

  const recipients = (recipientsData ?? []) as Array<{
    id: string;
    customer_phone_e164: string;
    customer_name: string | null;
  }>;

  let adapter: ReturnType<typeof createWhatsAppAdapter> | null = null;
  try {
    adapter = createWhatsAppAdapter();
  } catch (err) {
    // WhatsApp not configured — mark all recipients failed.
    const errMsg = err instanceof Error ? err.message : String(err);
    for (const r of recipients) {
      await admin
        .from('crm_campaign_recipients')
        .update({ status: 'failed' })
        .eq('id', r.id);
    }
    await admin
      .from('crm_campaigns')
      .update({ status: 'failed', sent_count: 0, updated_at: new Date().toISOString() })
      .eq('id', campaign_id);
    console.error('[crm/sendCampaign] adapter init failed:', errMsg);
    return { sent: 0, failed: recipients.length };
  }

  let sent = 0;
  let failed = 0;
  const now = new Date().toISOString();

  // Sequential sends with 100ms rate-limit delay.
  for (const recipient of recipients) {
    if (sent + failed > 0) {
      await delay(100);
    }

    try {
      const text = personalizeTemplate(campaign.message_template, {
        name: recipient.customer_name ?? 'there',
        event: targetEventName,
      });

      const result = await adapter.sendText({
        to_phone_e164: recipient.customer_phone_e164,
        text,
      });

      if (result.success) {
        sent++;
        await admin
          .from('crm_campaign_recipients')
          .update({
            status: 'sent',
            sent_at: now,
            wamid: result.wamid ?? null,
          })
          .eq('id', recipient.id);
      } else {
        failed++;
        await admin
          .from('crm_campaign_recipients')
          .update({ status: 'failed' })
          .eq('id', recipient.id);
      }
    } catch {
      failed++;
      await admin
        .from('crm_campaign_recipients')
        .update({ status: 'failed' })
        .eq('id', recipient.id);
    }
  }

  // Update campaign stats — preserve total_recipients set by addRecipients.
  const finalStatus = sent === 0 ? 'send_failed' : failed > 0 ? 'partial' : 'sent';
  await admin
    .from('crm_campaigns')
    .update({
      status: finalStatus,
      sent_count: sent,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaign_id);

  return { sent, failed };
}

// ─── getCampaignStats ─────────────────────────────────────────────────────────

export async function getCampaignStats(campaignId: string): Promise<{
  total: number;
  sent: number;
  delivered: number;
  converted: number;
  conversion_rate_pct: number;
  revenue_attributed_sar: number;
}> {
  const admin = createAdminClient();

  const { data: recipientsData } = await admin
    .from('crm_campaign_recipients')
    .select('status, converted, conversion_revenue_sar')
    .eq('campaign_id', campaignId);

  const rows = (recipientsData ?? []) as Array<{
    status: string;
    converted: boolean;
    conversion_revenue_sar: number | string | null;
  }>;

  const total = rows.length;
  const sent = rows.filter(
    (r) => r.status === 'sent' || r.status === 'delivered',
  ).length;
  const delivered = rows.filter((r) => r.status === 'delivered').length;
  const converted = rows.filter((r) => r.converted).length;
  const conversion_rate_pct = sent === 0 ? 0 : (converted / sent) * 100;
  const revenue_attributed_sar = rows
    .filter((r) => r.converted && r.conversion_revenue_sar != null)
    .reduce((sum, r) => {
      const v = r.conversion_revenue_sar;
      return sum + (typeof v === 'number' ? v : parseFloat(String(v)) || 0);
    }, 0);

  return {
    total,
    sent,
    delivered,
    converted,
    conversion_rate_pct,
    revenue_attributed_sar,
  };
}

// ─── getNoShowSegment ─────────────────────────────────────────────────────────

export async function getNoShowSegment(eventId: string): Promise<
  Array<{
    customer_phone_e164: string;
    customer_name: string;
    customer_email: string;
    ticket_type: string;
    order_id: string;
  }>
> {
  const admin = createAdminClient();

  const [ordersResult, scansResult] = await Promise.all([
    admin
      .from('orders')
      .select('customer_phone_e164, customer_name, customer_email, ticket_type, order_id')
      .eq('event_id', eventId)
      .eq('status', 'completed'),
    admin
      .from('gate_scans')
      .select('order_id')
      .eq('event_id', eventId)
      .eq('scan_result', 'admitted'),
  ]);

  const orders = (ordersResult.data ?? []) as Array<{
    customer_phone_e164: string;
    customer_name: string | null;
    customer_email: string | null;
    ticket_type: string | null;
    order_id: string;
  }>;

  const admittedScans = (scansResult.data ?? []) as Array<{ order_id: string | null }>;
  const admittedOrderIds = new Set(admittedScans.map((s) => s.order_id).filter(Boolean) as string[]);

  // Only filter by gate scans if the event has scan data (gates were in use).
  // If no scans exist, return all completed orders as a best-effort segment.
  const noShows = admittedOrderIds.size > 0
    ? orders.filter((o) => !admittedOrderIds.has(o.order_id))
    : orders;

  return noShows.map((o) => ({
    customer_phone_e164: o.customer_phone_e164,
    customer_name: o.customer_name ?? '',
    customer_email: o.customer_email ?? '',
    ticket_type: o.ticket_type ?? '',
    order_id: o.order_id,
  }));
}
