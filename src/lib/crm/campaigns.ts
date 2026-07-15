import { createAdminClient } from '@/lib/supabase/admin';
import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';
import { localDateStringInTz, DEFAULT_EVENT_TZ } from '@/lib/dates';
import { fetchAllRows } from '@/lib/supabase/paginate';

// Recipient-fetch tripwire: today's 500-recipient creation cap keeps sendCampaign
// well under PostgREST's ~1000-row default, but if that cap is ever raised this
// bound would silently truncate the send. We fetch up to this many and log if we
// hit it exactly (audit 4.14).
const RECIPIENT_FETCH_LIMIT = 1000;

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
  // NOTE: this remains a racy read-modify-write; 1.5 only asks for the error/zero-rows
  // guard so a silent no-op surfaces, not for an atomic increment.
  const { data: current, error: readError } = await admin
    .from('crm_campaigns')
    .select('total_recipients')
    .eq('id', params.campaign_id)
    .single();

  if (readError) {
    console.error('[crm/addRecipients] total_recipients read failed', {
      campaign_id: params.campaign_id,
      error: readError.message,
    });
  }

  const newTotal = ((current as { total_recipients: number } | null)?.total_recipients ?? 0) + added;

  const { data: updatedCampaign, error: totalError } = await admin
    .from('crm_campaigns')
    .update({ total_recipients: newTotal, updated_at: new Date().toISOString() })
    .eq('id', params.campaign_id)
    .select('id');

  if (totalError || !updatedCampaign || updatedCampaign.length === 0) {
    console.error('[crm/addRecipients] total_recipients update failed', {
      campaign_id: params.campaign_id,
      error: totalError?.message ?? 'zero rows affected',
    });
  }

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

  // Atomically claim the campaign: transition draft→sending in a single
  // conditional update. If zero rows come back another send already claimed it
  // (or it is not in draft) — abort so two concurrent sends cannot both proceed
  // and double-message customers (audit 6.2).
  const { data: claimed, error: claimError } = await admin
    .from('crm_campaigns')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', campaign_id)
    .eq('status', 'draft')
    .select('id');

  if (claimError) {
    throw new Error(`Failed to claim campaign for sending: ${claimError.message}`);
  }
  if (!claimed || claimed.length === 0) {
    console.warn('[crm/sendCampaign] campaign not in draft state — already claimed, aborting', {
      campaign_id,
    });
    return { sent: 0, failed: 0 };
  }

  // Per-recipient status write helper — every write is checked and logged so a
  // silent failure no longer leaves a recipient stuck 'pending' (audit 6.2).
  const markRecipient = async (id: string, patch: Record<string, unknown>): Promise<void> => {
    const { error } = await admin
      .from('crm_campaign_recipients')
      .update(patch)
      .eq('id', id);
    if (error) {
      console.error('[crm/sendCampaign] recipient status write failed', {
        recipient_id: id,
        patch_status: patch.status ?? null,
        error: error.message,
      });
    }
  };

  // Fetch all pending recipients.
  const { data: recipientsData } = await admin
    .from('crm_campaign_recipients')
    .select('id, customer_phone_e164, customer_name')
    .eq('campaign_id', campaign_id)
    .eq('status', 'pending')
    .limit(RECIPIENT_FETCH_LIMIT);

  const recipients = (recipientsData ?? []) as Array<{
    id: string;
    customer_phone_e164: string;
    customer_name: string | null;
  }>;

  if (recipients.length === RECIPIENT_FETCH_LIMIT) {
    console.warn('[crm/sendCampaign] recipient fetch hit its limit — some recipients may not be messaged', {
      campaign_id,
      limit: RECIPIENT_FETCH_LIMIT,
    });
  }

  let adapter: ReturnType<typeof createWhatsAppAdapter> | null = null;
  try {
    adapter = createWhatsAppAdapter();
  } catch (err) {
    // WhatsApp not configured — mark all recipients failed.
    const errMsg = err instanceof Error ? err.message : String(err);
    for (const r of recipients) {
      await markRecipient(r.id, { status: 'failed' });
    }
    // NOTE: campaign-level status 'failed' is rejected by the 0027 CHECK
    // (draft|sending|sent|paused|cancelled) — that is finding 1.3 (invalid
    // enum), out of scope for this silent-failure sweep; left unchanged.
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
        await markRecipient(recipient.id, {
          status: 'sent',
          sent_at: now,
          wamid: result.wamid ?? null,
        });
      } else {
        failed++;
        await markRecipient(recipient.id, { status: 'failed' });
      }
    } catch (sendErr) {
      failed++;
      console.error('[crm/sendCampaign] send threw for recipient', {
        recipient_id: recipient.id,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
      await markRecipient(recipient.id, { status: 'failed' });
    }
  }

  // Update campaign stats — preserve total_recipients set by addRecipients.
  // NOTE: 'send_failed'/'partial' are rejected by the 0027 status CHECK — that
  // is finding 1.3 (invalid enum), out of scope for this sweep; left unchanged
  // so it is not silently masked. Only fully-successful ('sent') writes persist.
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

  // Paginate: revenue/conversion sums must include every recipient, not just the
  // first ~1000 PostgREST returns by default (audit 4.14).
  const rows = await fetchAllRows<{
    status: string;
    converted: boolean;
    conversion_revenue_sar: number | string | null;
  }>(async (from, to) => {
    const { data, error } = await admin
      .from('crm_campaign_recipients')
      .select('status, converted, conversion_revenue_sar')
      .eq('campaign_id', campaignId)
      .range(from, to);
    return {
      data: data as Array<{
        status: string;
        converted: boolean;
        conversion_revenue_sar: number | string | null;
      }> | null,
      error,
    };
  });

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

  // Guard 1 (audit 4.4): only build a no-show segment for an event that has
  // ACTUALLY ENDED, measured in the event's local timezone. A re-marketing
  // blast to every buyer of an event that hasn't happened yet is the failure
  // being prevented.
  const { data: eventRow, error: eventError } = await admin
    .from('events')
    .select('end_date, timezone')
    .eq('id', eventId)
    .single();

  if (eventError || !eventRow) {
    console.error('[crm/getNoShowSegment] event lookup failed — returning empty segment', {
      event_id: eventId,
      error: eventError?.message ?? 'not found',
    });
    return [];
  }

  const ev = eventRow as { end_date: string | null; timezone: string | null };
  const todayLocal = localDateStringInTz(new Date(), ev.timezone ?? DEFAULT_EVENT_TZ);
  if (!ev.end_date || ev.end_date >= todayLocal) {
    // Event has not ended (end_date today or in the future, or missing).
    console.warn('[crm/getNoShowSegment] event has not ended — refusing to build segment', {
      event_id: eventId,
      end_date: ev.end_date,
      today_local: todayLocal,
    });
    return [];
  }

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

  // Guard 2 (audit 4.4): with NO gate-scan data there is no evidence of who
  // actually attended, so we cannot distinguish no-shows from attendees. Return
  // an EMPTY segment rather than blasting every buyer of the event.
  if (admittedOrderIds.size === 0) {
    console.warn('[crm/getNoShowSegment] no gate-scan data for ended event — returning empty segment', {
      event_id: eventId,
      completed_orders: orders.length,
    });
    return [];
  }

  const noShows = orders.filter((o) => !admittedOrderIds.has(o.order_id));

  return noShows.map((o) => ({
    customer_phone_e164: o.customer_phone_e164,
    customer_name: o.customer_name ?? '',
    customer_email: o.customer_email ?? '',
    ticket_type: o.ticket_type ?? '',
    order_id: o.order_id,
  }));
}
