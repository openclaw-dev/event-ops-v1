import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/write-audit-log';
import { kbSectionUpdateSchema } from '@/lib/schemas';

export const maxDuration = 30;
export const runtime = 'nodejs';

/**
 * Ownership resolution for a single kb_sections row.
 *
 * The RLS SELECT on kb_sections (FOR ALL policy scoped by event → operator,
 * migration 0009) doubles as the auth check: a row only comes back if the
 * caller belongs to the section's operator. We then read the owning event's
 * operator_id for the audit trail.
 *
 * Returns null when the user is unauthenticated or the section is not visible.
 */
async function resolveSection(sectionId: string): Promise<
  | {
      userId: string;
      operatorId: string;
      eventId: string;
      sectionKey: string;
    }
  | null
> {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: section } = await supabase
    .from('kb_sections')
    .select('id, event_id, section_id')
    .eq('id', sectionId)
    .single();
  if (!section) return null;

  const { data: event } = await supabase
    .from('events')
    .select('operator_id')
    .eq('id', section.event_id)
    .single();
  if (!event) return null;

  return {
    userId: user.id,
    operatorId: (event as { operator_id: string }).operator_id,
    eventId: section.event_id as string,
    sectionKey: section.section_id as string,
  };
}

/**
 * PATCH /api/kb/[sectionId]
 *
 * Edits an event KB section (question/answer EN+AR, category, language,
 * escalation_needed). `sectionId` is the kb_sections.id UUID.
 *
 * Client choice: kb_sections HAS a working FOR ALL RLS policy (0009), so an
 * RLS-scoped write would succeed — but we mirror the operator-KB route and
 * CLAUDE.md's belt-and-braces guidance: verify ownership via the RLS SELECT
 * above, then write with the admin client and a zero-rows guard so a silent
 * no-op can never masquerade as success.
 */
export async function PATCH(
  request: Request,
  { params }: { params: { sectionId: string } },
) {
  const ctx = await resolveSection(params.sectionId);
  if (!ctx) {
    return NextResponse.json({ error: 'Section not found or access denied.' }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = kbSectionUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from('kb_sections')
    .update({
      question_en: parsed.data.question_en,
      answer_en: parsed.data.answer_en,
      question_ar: parsed.data.question_ar,
      answer_ar: parsed.data.answer_ar,
      category: parsed.data.category,
      language: parsed.data.language,
      escalation_needed: parsed.data.escalation_needed,
    })
    .eq('id', params.sectionId)
    .select('id');

  if (error) {
    console.error('[kb/section] update failed', { section_id: params.sectionId, error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    // Zero-rows guard: the write silently affected nothing (row vanished under
    // us). Surface it instead of reporting a false success.
    return NextResponse.json(
      { error: 'Update affected no rows — the section may have been deleted. Refresh and retry.' },
      { status: 409 },
    );
  }

  await writeAuditLog({
    operator_id: ctx.operatorId,
    event_id: ctx.eventId,
    actor_type: 'user',
    actor_id: ctx.userId,
    action: 'kb.section.updated',
    entity_type: 'kb_section',
    entity_id: params.sectionId,
    metadata: {
      section_id: ctx.sectionKey,
      language: parsed.data.language,
      escalation_needed: parsed.data.escalation_needed,
    },
  });

  return NextResponse.json({ updated: true });
}

/**
 * DELETE /api/kb/[sectionId]
 *
 * Deletes an event KB section. Same ownership + client rationale as PATCH.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { sectionId: string } },
) {
  const ctx = await resolveSection(params.sectionId);
  if (!ctx) {
    return NextResponse.json({ error: 'Section not found or access denied.' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: deleted, error } = await admin
    .from('kb_sections')
    .delete()
    .eq('id', params.sectionId)
    .select('id');

  if (error) {
    console.error('[kb/section] delete failed', { section_id: params.sectionId, error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json(
      { error: 'Delete affected no rows — the section may already be gone. Refresh and retry.' },
      { status: 409 },
    );
  }

  await writeAuditLog({
    operator_id: ctx.operatorId,
    event_id: ctx.eventId,
    actor_type: 'user',
    actor_id: ctx.userId,
    action: 'kb.section.deleted',
    entity_type: 'kb_section',
    entity_id: params.sectionId,
    metadata: { section_id: ctx.sectionKey },
  });

  return NextResponse.json({ deleted: true });
}
