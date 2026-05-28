/**
 * gap-analysis.ts
 *
 * Derives KB coverage gaps from an event's escalation and conversation data.
 * Uses the admin client (bypasses RLS) — always called from server-side code
 * that has already verified the caller's access to the event.
 */

import { createAdminClient } from '@/lib/supabase/admin';

export interface KBGapResult {
  /** Escalation reasons grouped by frequency, highest first. */
  unanswered: Array<{ question: string; count: number; example_session_id: string }>;
  /** User-message intents from escalated conversations, highest first. */
  escalated_intents: Array<{ intent: string; count: number }>;
  /**
   * 0–100 integer: percentage of conversations resolved without an escalation.
   * 100 when there are no conversations yet.
   */
  coverage_score: number;
}

export async function getKBGaps(eventId: string): Promise<KBGapResult> {
  const admin = createAdminClient();

  // ── Total conversations (denominator for coverage score) ─────────────────
  const { count: totalCount } = await admin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);
  const total = totalCount ?? 0;

  // ── All escalations for this event ────────────────────────────────────────
  const { data: rawEscalations } = await admin
    .from('escalations')
    .select('conversation_id, reason')
    .eq('event_id', eventId);

  const escalations = (rawEscalations ?? []) as Array<{
    conversation_id: string;
    reason: string;
  }>;

  // ── Group by reason → unanswered categories ───────────────────────────────
  const reasonMap = new Map<string, { count: number; example_session_id: string }>();
  for (const esc of escalations) {
    const key = esc.reason.trim();
    if (!reasonMap.has(key)) {
      reasonMap.set(key, { count: 0, example_session_id: esc.conversation_id });
    }
    reasonMap.get(key)!.count++;
  }
  const unanswered = Array.from(reasonMap.entries())
    .map(([reason, { count, example_session_id }]) => ({
      question: reason,
      count,
      example_session_id,
    }))
    .sort((a, b) => b.count - a.count);

  // ── Intents from messages in escalated conversations ─────────────────────
  const convIds = escalations.map((e) => e.conversation_id);
  let escalated_intents: Array<{ intent: string; count: number }> = [];

  if (convIds.length > 0) {
    const { data: msgs } = await admin
      .from('messages')
      .select('classified_intent')
      .in('conversation_id', convIds)
      .eq('role', 'user')
      .not('classified_intent', 'is', null);

    const intentMap = new Map<string, number>();
    for (const msg of msgs ?? []) {
      const intent = msg.classified_intent as string | null;
      if (intent) {
        intentMap.set(intent, (intentMap.get(intent) ?? 0) + 1);
      }
    }
    escalated_intents = Array.from(intentMap.entries())
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count);
  }

  // ── Coverage score ────────────────────────────────────────────────────────
  const coverage_score =
    total === 0
      ? 100
      : Math.round(((total - escalations.length) / total) * 100);

  return { unanswered, escalated_intents, coverage_score };
}
