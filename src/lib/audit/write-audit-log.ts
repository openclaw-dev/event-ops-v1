/**
 * write-audit-log.ts
 *
 * Single entry point for appending to the append-only `audit_log` table.
 *
 * `audit_log` has no user INSERT policy, so writes must go through the
 * service-role client. supabase-js NEVER throws on a DB error — it returns
 * `{ error }` — so every call site that ignored the result silently dropped
 * audit rows (audit 6.5: the surrounding try/catch was dead code). This helper
 * checks and logs the error under the `[audit]` convention.
 *
 * It intentionally does NOT throw: a failed audit write must never break the
 * user-facing action it records, but it must be visible in logs instead of
 * vanishing.
 */

import { createAdminClient } from '@/lib/supabase/admin';

export interface AuditLogEntry {
  operator_id: string;
  event_id?: string | null;
  actor_type: 'user' | 'agent' | 'system';
  actor_id?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin.from('audit_log').insert({
    operator_id: entry.operator_id,
    event_id: entry.event_id ?? null,
    actor_type: entry.actor_type,
    actor_id: entry.actor_id ?? null,
    action: entry.action,
    entity_type: entry.entity_type ?? null,
    entity_id: entry.entity_id ?? null,
    metadata: entry.metadata ?? {},
  });

  if (error) {
    console.error('[audit] write failed — audit row dropped', {
      action: entry.action,
      entity_type: entry.entity_type ?? null,
      entity_id: entry.entity_id ?? null,
      operator_id: entry.operator_id,
      error: error.message,
    });
  }
}
