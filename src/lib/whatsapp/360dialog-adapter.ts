/**
 * 360dialog-adapter.ts
 *
 * WhatsAppAdapter implementation for 360dialog.
 *
 * 360dialog mirrors the Meta Cloud API webhook payload shape, so inbound
 * parsing is delegated to parseMetaCompatibleBody.
 *
 * Required env vars:
 *   DIALOG360_API_KEY   — used for signature verification and outbound auth
 *   DIALOG360_WABA_ID   — WhatsApp Business Account ID (logged / auditing only)
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Dialog360Adapter: missing required env var ${name}`);
  return val;
}

const DIALOG360_MESSAGES_URL = 'https://waba.360dialog.io/v1/messages';

interface Dialog360SendResponse {
  messages?: Array<{ id: string }>;
}

async function postToDialog360(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<SendResult> {
  const res = await fetch(DIALOG360_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'D360-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `360dialog API ${res.status}: ${text}` };
  }

  const data = (await res.json()) as Dialog360SendResponse;
  return { success: true, wamid: data.messages?.[0]?.id };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class Dialog360Adapter implements WhatsAppAdapter {
  parseInbound(rawBody: unknown): InboundMessage[] {
    // 360dialog sends the same Meta-compatible envelope shape.
    return parseMetaCompatibleBody(rawBody);
  }

  verifySignature(rawBody: string, headers: Record<string, string>): void {
    const apiKey = requireEnv('DIALOG360_API_KEY');

    // 360dialog uses D360-Signature (may be lowercased by the HTTP layer).
    // The value is a raw hex HMAC-SHA256 digest — no "sha256=" prefix.
    const sig =
      headers['d360-signature'] ??
      headers['D360-Signature'] ??
      '';

    if (!sig) {
      throw new Error('invalid signature');
    }

    const expectedHex = createHmac('sha256', apiKey).update(rawBody).digest('hex');

    // Use constant-time comparison to prevent timing attacks.
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const actualBuf = Buffer.from(sig, 'hex');

    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new Error('invalid signature');
    }
  }

  async sendText(msg: OutboundTextMessage): Promise<SendResult> {
    const apiKey = requireEnv('DIALOG360_API_KEY');

    return postToDialog360(apiKey, {
      messaging_product: 'whatsapp',
      to: msg.to_phone_e164,
      type: 'text',
      text: { body: msg.text },
    });
  }

  async sendInteractive(msg: OutboundInteractiveMessage): Promise<SendResult> {
    const apiKey = requireEnv('DIALOG360_API_KEY');

    return postToDialog360(apiKey, {
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
