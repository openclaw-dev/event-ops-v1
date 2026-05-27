/**
 * /api/whatsapp/inbound
 *
 * GET  — Meta webhook verification (hub challenge handshake).
 *         360dialog does not use this endpoint.
 * POST — Inbound message receiver for both Meta and 360dialog.
 *         Always returns HTTP 200 — WhatsApp retries on any non-200 response.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { createWhatsAppAdapter } from '@/lib/whatsapp/adapter-factory';
import type { InboundMessage, WhatsAppAdapter } from '@/lib/whatsapp/types';
import { extractChanges } from '@/lib/data-entry/whatsapp-change-extractor';
import { generateDiff, formatFieldLabel, formatValue } from '@/lib/data-entry/whatsapp-change-diff';
import {
  createPendingChange,
  updateConfirmationWamid,
  updateConfirmationSendError,
  findPendingByConfirmationWamid,
  confirmPendingChange,
  cancelPendingChange,
  type PendingChange,
} from '@/lib/data-entry/pending-changes';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ─── GET — Meta webhook verification ─────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const verifyToken = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (
    mode === 'subscribe' &&
    verifyToken === process.env.META_WEBHOOK_VERIFY_TOKEN
  ) {
    return new Response(challenge ?? '', { status: 200 });
  }

  return new Response('forbidden', { status: 403 });
}

// ─── Per-message handler ──────────────────────────────────────────────────────

async function handleInboundMessage(
  message: InboundMessage,
  adapter: WhatsAppAdapter,
): Promise<void> {
  const admin = createAdminClient();

  // ── Text messages: extract changes, create pending diff, send confirmation ─
  if (message.type === 'text') {
    // 1. Look up promoter by phone.
    const { data: promoterData } = await admin
      .from('promoters')
      .select('id, operator_id, event_id, preferred_language')
      .eq('phone_e164', message.from_phone_e164)
      .eq('is_active', true)
      .maybeSingle();

    if (!promoterData) {
      await adapter.sendText({
        to_phone_e164: message.from_phone_e164,
        text: 'Sorry, your number is not authorised to send changes for this event.',
      });
      return;
    }

    const promoter = promoterData as {
      id: string;
      operator_id: string;
      event_id: string | null;
      preferred_language: string;
    };

    if (!promoter.event_id) {
      await adapter.sendText({
        to_phone_e164: message.from_phone_e164,
        text: 'Your account is not linked to an event. Contact the operator.',
      });
      return;
    }

    // 2. Fetch event row.
    const { data: eventData } = await admin
      .from('events')
      .select('*')
      .eq('id', promoter.event_id)
      .single();

    if (!eventData) {
      await adapter.sendText({
        to_phone_e164: message.from_phone_e164,
        text: 'The linked event could not be found. Contact the operator.',
      });
      return;
    }

    const eventRow = eventData as Record<string, unknown>;

    // 3. Extract structured changes via Haiku.
    const language = promoter.preferred_language as 'en' | 'ar' | 'ru';
    const extraction = await extractChanges(message.text, eventRow, language);

    // 4. Generate diff against current event state.
    const diff = generateDiff(extraction.changes, eventRow);

    // 5. If nothing actionable, reply with a summary and stop.
    if (diff.meaningful.length === 0) {
      let replyText = 'No changes detected.';
      if (extraction.ambiguous.length > 0) {
        const ambigList = extraction.ambiguous
          .map((a) => `"${a.raw_text}" (${a.reason})`)
          .join('; ');
        replyText = `Could not parse: ${ambigList}. Please resend with clearer wording.`;
      }
      await adapter.sendText({ to_phone_e164: message.from_phone_e164, text: replyText });
      return;
    }

    // 6. Persist the pending change (supersedes any prior open row).
    const pendingChange = await createPendingChange({
      operator_id: promoter.operator_id,
      event_id: promoter.event_id,
      promoter_id: promoter.id,
      inbound_wamid: message.wamid,
      inbound_text: message.text,
      extraction,
      diff,
    });

    // 7. Build confirmation interactive message body.
    const changeLines = diff.meaningful
      .map(
        (item) =>
          `- ${formatFieldLabel(item.field)}: ${formatValue(item.field, item.current_value)} → ${formatValue(item.field, item.coerced_value)}`,
      )
      .join('\n');

    const ambigBlock =
      extraction.ambiguous.length > 0
        ? `\n⚠️ Could not parse: ${extraction.ambiguous.map((a) => a.raw_text).join(', ')}`
        : '';

    const eventName = String(eventRow.name ?? 'your event');
    const bodyText =
      `Here's what I'll update for ${eventName}:\n\n${changeLines}${ambigBlock}\n\nReply to confirm or cancel.`;

    // 8. Send interactive message with Confirm / Cancel buttons.
    const sendResult = await adapter.sendInteractive({
      to_phone_e164: message.from_phone_e164,
      body_text: bodyText,
      buttons: [
        { id: `confirm_pc_${pendingChange.id}`, title: 'Confirm' },
        { id: `cancel_pc_${pendingChange.id}`, title: 'Cancel' },
      ],
    });

    // 9. Record send outcome on the pending_changes row.
    if (sendResult.success && sendResult.wamid) {
      await updateConfirmationWamid(pendingChange.id, sendResult.wamid);
    } else {
      await updateConfirmationSendError(
        pendingChange.id,
        sendResult.error ?? 'Unknown send error',
      );
    }
    return;
  }

  // ── Button replies: confirm or cancel a pending diff ──────────────────────
  if (message.type === 'button_reply') {
    // 1. Resolve the pending change from the message we sent.
    let pendingChange: PendingChange | null = null;
    try {
      pendingChange = await findPendingByConfirmationWamid(message.context_wamid);
    } catch {
      return; // lookup failure — ignore silently
    }
    if (!pendingChange) return;

    // 2. Verify the sender is the promoter who originated the request.
    const { data: promoterData } = await admin
      .from('promoters')
      .select('id, phone_e164')
      .eq('id', pendingChange.promoter_id)
      .maybeSingle();

    if (!promoterData) return;
    const promoter = promoterData as { id: string; phone_e164: string };
    if (promoter.phone_e164 !== message.from_phone_e164) return;

    // 3. Handle "Confirm" reply.
    if (message.button_id.startsWith('confirm_pc_')) {
      const result = await confirmPendingChange({
        pending_change_id: pendingChange.id,
        actor_user_id: null,
        actor_promoter_id: promoter.id,
        via: 'whatsapp',
      });

      if (result.status === 'confirmed') {
        // Fetch event name for the confirmation reply.
        const { data: eventData } = await admin
          .from('events')
          .select('name')
          .eq('id', pendingChange.event_id)
          .maybeSingle();
        const eventName = eventData
          ? String((eventData as Record<string, unknown>).name ?? 'your event')
          : 'your event';
        const count = pendingChange.diff_items.filter(
          (i) => !i.is_noop && i.coercion_error === null && !i.tier_not_found,
        ).length;
        await adapter.sendText({
          to_phone_e164: message.from_phone_e164,
          text: `✓ Done. ${count} change(s) applied to ${eventName}.`,
        });
      } else if (result.status === 'race_lost') {
        await adapter.sendText({
          to_phone_e164: message.from_phone_e164,
          text: 'Already processed.',
        });
      } else if (result.status === 'expired') {
        await adapter.sendText({
          to_phone_e164: message.from_phone_e164,
          text: 'This change request has expired. Please resend.',
        });
      }
      // 'not_found': ignore silently
      return;
    }

    // 4. Handle "Cancel" reply.
    if (message.button_id.startsWith('cancel_pc_')) {
      await cancelPendingChange({
        pending_change_id: pendingChange.id,
        actor_user_id: null,
        actor_promoter_id: promoter.id,
        via: 'whatsapp',
      });
      await adapter.sendText({
        to_phone_e164: message.from_phone_e164,
        text: 'Cancelled.',
      });
    }
    return;
  }

  // ── Unsupported message types ─────────────────────────────────────────────
  if (message.type === 'unsupported') {
    await adapter.sendText({
      to_phone_e164: message.from_phone_e164,
      text: 'Sorry, I can only process text messages.',
    });
  }
}

// ─── POST — Inbound message receiver ─────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  try {
    // Read raw body as text first (needed for signature verification).
    const rawBody = await req.text();

    // Parse JSON — malformed bodies are ignored, not rejected.
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return Response.json({ status: 'ignored' }, { status: 200 });
    }

    // Instantiate the correct adapter — throws if WHATSAPP_PROVIDER is unset.
    let adapter: ReturnType<typeof createWhatsAppAdapter>;
    try {
      adapter = createWhatsAppAdapter();
    } catch (err) {
      console.error('[whatsapp/inbound] adapter init failed:', err);
      return Response.json({ status: 'ignored' }, { status: 200 });
    }

    // Verify signature — invalid or missing sigs are silently ignored (never 4xx).
    try {
      adapter.verifySignature(rawBody, Object.fromEntries(req.headers));
    } catch {
      return Response.json({ status: 'ignored' }, { status: 200 });
    }

    // Parse inbound messages from the normalised payload.
    const messages: InboundMessage[] = adapter.parseInbound(body);

    // Process each message independently — one failure must not block others.
    for (const message of messages) {
      try {
        await handleInboundMessage(message, adapter);
      } catch (err) {
        console.error(
          '[whatsapp/inbound] message processing failed:',
          message.wamid,
          err,
        );
      }
    }

    return Response.json({ status: 'ok', count: messages.length }, { status: 200 });
  } catch (err) {
    // Top-level safety net — log and return 200 so WhatsApp doesn't retry.
    console.error('[whatsapp/inbound] unhandled error:', err);
    return Response.json({ status: 'ignored' }, { status: 200 });
  }
}
