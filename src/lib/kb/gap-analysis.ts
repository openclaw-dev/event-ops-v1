/**
 * gap-analysis.ts
 *
 * Derives KB coverage gaps from an event's escalation and conversation data.
 * Uses the admin client (bypasses RLS) — always called from server-side code
 * that has already verified the caller's access to the event.
 */

import { createAdminClient } from '@/lib/supabase/admin';

export interface KBGapResult {
  /**
   * Escalation reasons grouped by frequency (highest first), top 10.
   * `intent` is the escalation reason string.
   * `example_message` is the first customer message from one of those conversations.
   */
  unanswered: Array<{ intent: string; count: number; example_message: string }>;
  /** Total number of escalations for this event. */
  escalated_count: number;
  /** Total conversations (all states) for this event. */
  total_conversations: number;
  /**
   * 0–100 integer: percentage of conversations resolved without an escalation.
   * Returns 100 when there are no conversations yet.
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
  const total_conversations = totalCount ?? 0;

  // ── All escalations for this event ────────────────────────────────────────
  const { data: rawEscalations } = await admin
    .from('escalations')
    .select('conversation_id, reason')
    .eq('event_id', eventId);

  const escalations = (rawEscalations ?? []) as Array<{
    conversation_id: string;
    reason: string;
  }>;

  const escalated_count = escalations.length;

  // ── Group by reason → unanswered categories ───────────────────────────────
  const reasonMap = new Map<string, { count: number; example_conversation_id: string }>();
  for (const esc of escalations) {
    const key = esc.reason.trim();
    if (!reasonMap.has(key)) {
      reasonMap.set(key, { count: 0, example_conversation_id: esc.conversation_id });
    }
    const entry = reasonMap.get(key);
    if (entry) entry.count++;
  }

  // ── Fetch first customer message for each example conversation ────────────
  const exampleConvIds = Array.from(
    new Set(Array.from(reasonMap.values()).map((v) => v.example_conversation_id)),
  );

  const firstMsgLookup = new Map<string, string>();
  if (exampleConvIds.length > 0) {
    const { data: exampleMsgs } = await admin
      .from('messages')
      .select('conversation_id, text, created_at')
      .in('conversation_id', exampleConvIds)
      .eq('role', 'user')
      .order('created_at', { ascending: true });

    for (const msg of exampleMsgs ?? []) {
      const convId = (msg as Record<string, unknown>).conversation_id as string;
      if (!firstMsgLookup.has(convId)) {
        firstMsgLookup.set(convId, (msg as Record<string, unknown>).text as string ?? '');
      }
    }
  }

  // ── Build unanswered list, sorted by frequency ────────────────────────────
  const unanswered = Array.from(reasonMap.entries())
    .map(([reason, { count, example_conversation_id }]) => ({
      intent: reason,
      count,
      example_message: firstMsgLookup.get(example_conversation_id) ?? '',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // ── Coverage score ────────────────────────────────────────────────────────
  const coverage_score =
    total_conversations === 0
      ? 100
      : Math.round(((total_conversations - escalated_count) / total_conversations) * 100);

  return {
    unanswered,
    escalated_count,
    total_conversations,
    coverage_score,
  };
}
