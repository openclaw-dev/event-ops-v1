/**
 * POST /api/data-entry/upload
 *
 * Accepts an xlsx mastersheet, calls the normaliser to produce column→field
 * mappings via Claude Haiku, merges any previously-saved confidence scores,
 * and returns a MappingResult.
 *
 * Multipart form fields:
 *   mastersheet  — xlsx file, max 5 MB
 *   event_id     — UUID of the target event (optional)
 *                  • Present  → RLS event check; operator resolved via event.
 *                  • Absent   → operator resolved from authenticated user session.
 *                    mastersheet_mappings lookup still runs (non-fatal).
 *
 * Authorization: Supabase session cookie (RLS-enforced reads).
 */

import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { normaliseSheet } from '@/lib/data-entry/normaliser';
import type { MappingResult, FieldMapping } from '@/lib/data-entry/normaliser';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request): Promise<NextResponse> {
  // ── 1. Parse multipart body ──────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.warn('[data-entry/upload] formData parse failed:', err);
    return NextResponse.json({ error: 'Invalid multipart form data.' }, { status: 400 });
  }

  const file = formData.get('mastersheet');
  const eventIdRaw = formData.get('event_id');
  const eventId = typeof eventIdRaw === 'string' && eventIdRaw ? eventIdRaw : null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided. Use the "mastersheet" field.' }, { status: 400 });
  }

  // ── 2. Validate file ─────────────────────────────────────────────────────
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the 5 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB).` },
      { status: 400 },
    );
  }

  const ext = file.name.split('.').pop()?.toLowerCase();
  const mimeOk =
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.type === 'application/vnd.ms-excel' ||
    file.type === 'application/octet-stream';
  const extOk = ext === 'xlsx';

  if (!extOk || !mimeOk) {
    return NextResponse.json(
      { error: 'Only .xlsx files are supported.' },
      { status: 400 },
    );
  }

  // ── 3. Authenticate ──────────────────────────────────────────────────────
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // ── 4. Resolve operator (two paths: event-scoped vs session-scoped) ───────
  let resolvedOperatorId: string | undefined;

  if (eventId) {
    // Path A: eventId provided — RLS check confirms user can access this event.
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('id, operator_id')
      .eq('id', eventId)
      .is('deleted_at', null)
      .single();

    if (eventError || !event) {
      return NextResponse.json({ error: 'Event not found or access denied.' }, { status: 404 });
    }

    const { data: operatorUser } = await supabase
      .from('operator_users')
      .select('id')
      .eq('user_id', user.id)
      .eq('operator_id', event.operator_id)
      .single();

    if (!operatorUser) {
      return NextResponse.json({ error: 'No operator membership found.' }, { status: 403 });
    }

    resolvedOperatorId = event.operator_id as string;
  } else {
    // Path B: no eventId — resolve operator from the active session cookie.
    const { data: memberships } = await supabase
      .from('operator_users')
      .select('operator_id')
      .eq('user_id', user.id);

    resolvedOperatorId = resolveActiveOperatorId(
      (memberships ?? []).map((m) => m.operator_id as string),
    );

    if (!resolvedOperatorId) {
      return NextResponse.json({ error: 'No operator found. Complete onboarding first.' }, { status: 403 });
    }
  }

  // ── 5. Run normaliser (with fingerprint-based cache when operatorId known) ─
  let result: MappingResult;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    result = await normaliseSheet(buffer, resolvedOperatorId);
  } catch (err) {
    console.error('[data-entry/upload] normaliseSheet threw:', err);
    return NextResponse.json(
      {
        error:
          "We couldn't read this file. Try resaving as .xlsx and re-uploading.",
      },
      { status: 422 },
    );
  }

  // ── 6. Merge saved confidence scores from mastersheet_mappings ───────────
  // Scope the merge to the SAME format_fingerprint as this upload — otherwise
  // the most-recent saved mapping of ANY format could override colliding column
  // names at boosted confidence and bypass review (audit 4.12). Skip the merge
  // entirely when we have no fingerprint (no operatorId), since we cannot match.
  try {
    const uploadFingerprint = result.format_fingerprint;
    if (!uploadFingerprint) {
      console.warn('[data-entry/upload] no format_fingerprint — skipping saved-mapping merge');
      return NextResponse.json(result, { status: 200 });
    }

    const admin = createAdminClient();
    // .maybeSingle so a brand-new operator with no saved mapping yet doesn't
    // produce a noisy 404 PGRST round-trip.
    const { data: savedMapping } = await admin
      .from('mastersheet_mappings')
      .select('confidence_scores, field_map')
      .eq('operator_id', resolvedOperatorId)
      .eq('format_fingerprint', uploadFingerprint)
      .order('last_used_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (savedMapping) {
      const savedScores = (savedMapping.confidence_scores ?? {}) as Record<string, number>;
      const savedFieldMap = (savedMapping.field_map ?? {}) as Record<string, string>;

      result.mappings = result.mappings.map((m): FieldMapping => {
        const savedConfidence = savedScores[m.source_column];
        const savedTarget = savedFieldMap[m.source_column];

        if (savedConfidence !== undefined && savedTarget) {
          const mergedConfidence = Math.max(m.confidence, savedConfidence);
          return {
            ...m,
            target_field: savedTarget,
            confidence: mergedConfidence,
            needs_review: mergedConfidence < 0.85,
          };
        }
        return m;
      });

      result.high_confidence_count = result.mappings.filter((m) => !m.needs_review).length;
      result.needs_review_count = result.mappings.filter((m) => m.needs_review).length;
    }
  } catch (err) {
    console.warn('[data-entry/upload] saved-mapping merge failed:', err);
  }

  return NextResponse.json(result, { status: 200 });
}
