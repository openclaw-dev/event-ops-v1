/**
 * parse-meta-compatible.ts
 *
 * Parses Meta-compatible WhatsApp webhook payloads into normalised
 * InboundMessage objects. Used by both MetaAdapter and Dialog360Adapter
 * because 360dialog mirrors Meta's webhook shape.
 *
 * Meta webhook envelope:
 * {
 *   object: "whatsapp_business_account",
 *   entry: [{
 *     changes: [{
 *       field: "messages",
 *       value: {
 *         messages: [ ... ],   // present for inbound messages
 *         statuses: [ ... ],   // present for delivery receipts — we ignore
 *       }
 *     }]
 *   }]
 * }
 */

import type { InboundMessage } from './types';

// ─── Internal payload shape types ────────────────────────────────────────────
// Typed just enough to traverse the webhook envelope safely.

interface MetaTextPayload {
  body: string;
}

interface MetaButtonReplyPayload {
  id: string;
  title: string;
}

interface MetaInteractivePayload {
  type: 'button_reply' | string;
  button_reply?: MetaButtonReplyPayload;
}

interface MetaContextPayload {
  id: string;
}

interface MetaRawMessage {
  type: string;
  id: string;
  from: string;
  timestamp: string;
  text?: MetaTextPayload;
  interactive?: MetaInteractivePayload;
  context?: MetaContextPayload;
}

interface MetaWebhookValue {
  messages?: MetaRawMessage[];
  // statuses, contacts, metadata — all intentionally ignored
}

interface MetaWebhookChange {
  field?: string;
  value?: MetaWebhookValue;
}

interface MetaWebhookEntry {
  changes?: MetaWebhookChange[];
}

interface MetaWebhookBody {
  object?: string;
  entry?: MetaWebhookEntry[];
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Meta sends phone numbers without the leading '+'.
 * Normalise to E.164 by prepending '+' if not already present.
 */
function toE164(raw: string): string {
  return raw.startsWith('+') ? raw : `+${raw}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses a Meta-compatible webhook payload into normalised InboundMessages.
 * Returns an empty array for status updates, read receipts, and any payload
 * that does not contain a `messages` array.
 */
export function parseMetaCompatibleBody(rawBody: unknown): InboundMessage[] {
  const body = rawBody as MetaWebhookBody;
  const results: InboundMessage[] = [];

  if (!body?.entry) return results;

  for (const entry of body.entry) {
    for (const change of (entry.changes ?? [])) {
      const value = change.value;
      if (!value?.messages) continue; // status updates, read receipts — skip

      for (const msg of value.messages) {
        const wamid = msg.id;
        const from_phone_e164 = toE164(msg.from);
        const timestamp = parseInt(msg.timestamp, 10);

        if (msg.type === 'text' && msg.text?.body) {
          results.push({
            type: 'text',
            wamid,
            from_phone_e164,
            text: msg.text.body,
            timestamp,
          });
        } else if (
          msg.type === 'interactive' &&
          msg.interactive?.type === 'button_reply' &&
          msg.interactive.button_reply
        ) {
          results.push({
            type: 'button_reply',
            wamid,
            from_phone_e164,
            button_id: msg.interactive.button_reply.id,
            button_title: msg.interactive.button_reply.title,
            context_wamid: msg.context?.id ?? '',
            timestamp,
          });
        } else {
          // Reaction, image, audio, location, status update embedded in
          // messages array, or any future type — treat as unsupported.
          results.push({
            type: 'unsupported',
            wamid,
            from_phone_e164,
            timestamp,
          });
        }
      }
    }
  }

  return results;
}
