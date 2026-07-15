/**
 * message-dedup.ts
 *
 * Idempotency for the WhatsApp inbound webhook. Meta redelivers webhooks
 * at-least-once; without dedup a redelivery re-runs the classifier + generator
 * (double Anthropic spend), inserts duplicate `messages`, and sends the
 * customer two replies (audit 5.2).
 *
 * Strategy: insert-first against `whatsapp_processed_messages.wamid`
 * (PRIMARY KEY). A 23505 unique violation means we have already processed this
 * wamid. This is race-safe — two concurrent redeliveries race on the DB
 * constraint, not on a check-then-insert window in application code.
 *
 * All access is via createAdminClient() — the webhook has no user session and
 * the table has RLS enabled with no policies (migration 0030).
 */

import { createAdminClient } from '@/lib/supabase/admin';

export type DedupResult = 'first' | 'duplicate';

/**
 * Records a wamid as processed.
 *
 * Returns 'first' the first time a wamid is seen (caller should process the
 * message) or 'duplicate' if it was already recorded (caller should drop it).
 *
 * Fails OPEN: on any non-unique-violation DB error the wamid is treated as
 * 'first' and the error is logged — better to risk a rare double-reply than to
 * silently drop a real customer message on a transient DB error.
 */
export async function markMessageProcessed(wamid: string): Promise<DedupResult> {
  const admin = createAdminClient();

  const { error } = await admin
    .from('whatsapp_processed_messages')
    .insert({ wamid });

  if (!error) return 'first';

  // 23505 = unique_violation → this wamid was already processed.
  if (error.code === '23505') return 'duplicate';

  console.error('[message-dedup] insert failed (processing anyway)', {
    wamid,
    code: error.code,
    error: error.message,
  });
  return 'first';
}

/**
 * Deletes processed-message rows whose expires_at has passed. Called by the
 * existing /api/cron/expire-pending cron. Returns the number of rows removed.
 */
export async function purgeProcessedMessages(): Promise<number> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('whatsapp_processed_messages')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('wamid');

  if (error) {
    console.error('[message-dedup] purge failed:', error.message);
    return 0;
  }

  return data?.length ?? 0;
}
