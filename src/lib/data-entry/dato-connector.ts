/**
 * dato-connector.ts
 *
 * Pushes event data to DatoCMS via the Site API.
 * If credentials are absent the function returns a skipped result rather than
 * throwing — callers should treat skipped as a benign no-op.
 */

import type { EventSetupFormData } from '@/lib/schemas';
import { optionalEnv } from '@/lib/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DatoSyncResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  dato_item_id?: string;
  error?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Pushes a (partial) EventSetupFormData payload to DatoCMS.
 *
 * Returns a skipped result when DATOCMS_API_TOKEN or DATOCMS_EVENT_MODEL_ID
 * are not configured — this is intentional so the feature degrades gracefully
 * in environments that don't use DatoCMS.
 */
export async function pushEventToDato(
  _eventId: string,
  data: Partial<EventSetupFormData>,
): Promise<DatoSyncResult> {
  // Trim on read so a trailing newline cannot corrupt the Authorization header
  // (token) or the item-type id in the request body (modelId) — audit 2.6.
  const token = optionalEnv('DATOCMS_API_TOKEN');
  const modelId = optionalEnv('DATOCMS_EVENT_MODEL_ID');

  if (!token || !modelId) {
    return {
      success: false,
      skipped: true,
      reason: 'DatoCMS credentials not configured',
    };
  }

  // Map EventSetupFormData fields to DatoCMS item attributes.
  const attributes: Record<string, unknown> = {};
  if (data.name !== undefined) attributes.title = data.name;
  if (data.start_date !== undefined) attributes.start_date = data.start_date;
  if (data.venue_name !== undefined) attributes.venue_name = data.venue_name;
  if (data.venue_city !== undefined) attributes.venue_city = data.venue_city;

  const body = JSON.stringify({
    data: {
      type: 'item',
      attributes,
      relationships: {
        item_type: {
          data: { type: 'item_type', id: modelId },
        },
      },
    },
  });

  try {
    const res = await fetch('https://site-api.datocms.com/items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Api-Version': '3',
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `DatoCMS ${res.status}: ${text}` };
    }

    const responseData = (await res.json()) as { data: { id: string } };
    return { success: true, dato_item_id: responseData.data.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
