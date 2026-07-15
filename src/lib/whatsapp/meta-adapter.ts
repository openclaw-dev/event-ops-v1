/**
 * meta-adapter.ts
 *
 * WhatsAppAdapter implementation for Meta Cloud API.
 *
 * Required env vars:
 *   META_APP_SECRET         — used for webhook HMAC-SHA256 signature verification
 *   META_PERMANENT_TOKEN    — system user bearer token for sending messages
 *   META_PHONE_NUMBER_ID    — the phone number ID in the Meta Cloud API
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  WhatsAppAdapter,
  InboundMessage,
  OutboundTextMessage,
  OutboundInteractiveMessage,
  SendResult,
} from './types';
import { parseMetaCompatibleBody } from './parse-meta-compatible';
import { requireEnv } from '@/lib/env';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function metaMessagesUrl(phoneNumberId: string): string {
  return `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
}

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
}

async function postToMeta(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<SendResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  let responseBody: unknown;
  try {
    responseBody = await res.json();
  } catch {
    const fallback = `Meta API ${res.status}: (non-JSON response)`;
    console.error('[meta-adapter] postToMeta FAILED (non-JSON)', { status: res.status, to: body.to });
    return { success: false, error: fallback };
  }

  if (!res.ok) {
    console.error('[meta-adapter] postToMeta FAILED', {
      status: res.status,
      to: body.to,
      body: JSON.stringify(responseBody),
    });
    return { success: false, error: JSON.stringify(responseBody) };
  }

  const data = responseBody as MetaSendResponse;
  const wamid = data.messages?.[0]?.id;
  console.log('[meta-adapter] postToMeta SUCCESS', { wamid, to: body.to });
  return { success: true, wamid };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class MetaAdapter implements WhatsAppAdapter {
  parseInbound(rawBody: unknown): InboundMessage[] {
    return parseMetaCompatibleBody(rawBody);
  }

  verifySignature(rawBody: string, headers: Record<string, string>): void {
    const secret = requireEnv('META_APP_SECRET');

    // Header name may be lowercased by Next.js / Node.js HTTP layer.
    const sig =
      headers['x-hub-signature-256'] ??
      headers['X-Hub-Signature-256'] ??
      '';

    if (!sig.startsWith('sha256=')) {
      throw new Error('invalid signature');
    }

    const actualHex = sig.slice('sha256='.length);
    const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');

    // Use constant-time comparison to prevent timing attacks.
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const actualBuf = Buffer.from(actualHex, 'hex');

    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new Error('invalid signature');
    }
  }

  async sendText(msg: OutboundTextMessage): Promise<SendResult> {
    const token = requireEnv('META_PERMANENT_TOKEN');
    const phoneNumberId = requireEnv('META_PHONE_NUMBER_ID');

    return postToMeta(metaMessagesUrl(phoneNumberId), token, {
      messaging_product: 'whatsapp',
      to: msg.to_phone_e164,
      type: 'text',
      text: { body: msg.text },
    });
  }

  async sendInteractive(msg: OutboundInteractiveMessage): Promise<SendResult> {
    const token = requireEnv('META_PERMANENT_TOKEN');
    const phoneNumberId = requireEnv('META_PHONE_NUMBER_ID');

    return postToMeta(metaMessagesUrl(phoneNumberId), token, {
      messaging_product: 'whatsapp',
      to: msg.to_phone_e164,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: msg.body_text },
        action: {
          buttons: msg.buttons.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
  }
}
