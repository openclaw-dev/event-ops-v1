/**
 * conversation-metrics.ts
 *
 * Derives aggregate performance numbers from conversations, escalations,
 * and messages for a single event. Uses createAdminClient() — always called
 * from server-side code that has already verified the caller's access.
 */

import { createAdminClient } from '@/lib/supabase/admin';

export interface ConversationMetrics {
  total: number;
  resolved_by_ai: number;
  escalated: number;
  refunds_deflected: number;
  resolution_rate: number;
}

export async function getConversationMetrics(
  eventId: string,
  options?: {
    /** ISO 8601 timestamp. When set, only conversations created on or after this date are counted. */
    since?: string;
  },
): Promise<ConversationMetrics> {
  const admin = createAdminClient();
  const since = options?.since;

  // Helper: apply optional date filter to a conversation query.
  function withSince<T extends { gte: (col: string, val: string) => T }>(q: T): T {
    return since ? q.gte('created_at', since) : q;
  }

  // ── Total and escalated counts (run in parallel) ──────────────────────────
  const [{ count: totalCount }, { count: escalatedCount }] = await Promise.all([
    withSince(
      admin
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId),
    ),
    withSince(
      admin
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', eventId)
        .eq('state', 'escalation_triggered'),
    ),
  ]);

  const total = totalCount ?? 0;
  const escalated = escalatedCount ?? 0;
  const resolved_by_ai = total - escalated;
  const resolution_rate =
    total === 0 ? 0 : Math.round((resolved_by_ai / total) * 100);

  // ── Refunds deflected ─────────────────────────────────────────────────────
  // Definition: conversations that were NOT escalated and contain at least one
  // agent message offering a transfer, credit, or upgrade alternative.
  let refunds_deflected = 0;

  if (total > 0) {
    const { data: nonEscalatedConvos } = await withSince(
      admin
        .from('conversations')
        .select('id')
        .eq('event_id', eventId)
        .neq('state', 'escalation_triggered'),
    );

    const nonEscalatedIds = (nonEscalatedConvos ?? []).map(
      (c) => (c as { id: string }).id,
    );

    if (nonEscalatedIds.length > 0) {
      const { data: deflectionMsgs } = await admin
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', nonEscalatedIds)
        .eq('role', 'agent')
        .or('text.ilike.%transfer%,text.ilike.%credit%,text.ilike.%upgrade%');

      const deflectedSet = new Set(
        (deflectionMsgs ?? []).map(
          (m) => (m as { conversation_id: string }).conversation_id,
        ),
      );
      refunds_deflected = deflectedSet.size;
    }
  }

  return {
    total,
    resolved_by_ai,
    escalated,
    refunds_deflected,
    resolution_rate,
  };
}
