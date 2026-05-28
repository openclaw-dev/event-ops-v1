import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseMarkdown } from '@/lib/parsers/kb-markdown';
import { parseJson } from '@/lib/parsers/kb-json';
import { xlsxToMarkdown, docxToMarkdown } from '@/lib/kb/converters';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const BUCKET = 'kb';
const PAGE_SIZE = 500; // max sections per upsert batch

// Storage upload + parse + batched upsert of up to ~hundreds of sections.
// Typical: 2-5s. Vercel Hobby caps at 10s; Pro respects up to 60s.
export const maxDuration = 60;
export const runtime = 'nodejs';

type Format = 'markdown' | 'json' | 'xlsx' | 'docx';

function detectFormat(filename: string): Format | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'json') return 'json';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'docx') return 'docx';
  return null;
}

/**
 * POST /api/kb/upload
 *
 * Multipart form fields:
 *   file     — the KB file (.md or .json, max 5 MB)
 *   event_id — UUID of the target event
 *
 * Returns:
 *   { document_id, sections_parsed, errors }
 *
 * Authorization: Supabase RLS via the user's session cookie.
 * Storage writes use the service-role client (private bucket).
 * Audit log uses the service-role client (no user INSERT policy).
 */
export async function POST(request: Request) {
  // ── 1. Parse multipart body ──────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data.' }, { status: 400 });
  }

  const file = formData.get('file');
  const eventId = formData.get('event_id');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (typeof eventId !== 'string' || !eventId) {
    return NextResponse.json({ error: 'event_id is required.' }, { status: 400 });
  }

  // ── 2. Validate file ─────────────────────────────────────────────────────
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the 5 MB limit (got ${(file.size / 1024 / 1024).toFixed(1)} MB).` },
      { status: 413 },
    );
  }

  const format = detectFormat(file.name);
  if (!format) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload a .md, .json, .xlsx, or .docx file.' },
      { status: 415 },
    );
  }

  // ── 3. Authenticate & authorise ──────────────────────────────────────────
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  // RLS check: can this user see (and therefore write to) this event?
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, operator_id')
    .eq('id', eventId)
    .is('deleted_at', null)
    .single();

  if (eventError || !event) {
    return NextResponse.json(
      { error: 'Event not found or access denied.' },
      { status: 404 },
    );
  }

  // Resolve operator_users row for the uploaded_by FK.
  const { data: operatorUser } = await supabase
    .from('operator_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('operator_id', event.operator_id)
    .single();

  if (!operatorUser) {
    return NextResponse.json({ error: 'No operator membership found.' }, { status: 403 });
  }

  // ── 4. Upload file to Supabase Storage (admin client, private bucket) ───
  const admin = createAdminClient();
  const timestamp = Date.now();
  const storagePath = `events/${eventId}/kb/${timestamp}_${file.name}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const { error: storageError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false, // each upload is a new file (history kept)
    });

  if (storageError) {
    return NextResponse.json(
      { error: `Storage upload failed: ${storageError.message}` },
      { status: 500 },
    );
  }

  // ── 5. Insert kb_documents row ───────────────────────────────────────────
  const { data: kbDoc, error: docError } = await supabase
    .from('kb_documents')
    .insert({
      event_id: eventId,
      filename: file.name,
      file_format: format,
      storage_path: storagePath,
      uploaded_by: operatorUser.id,
      section_count: 0,
    })
    .select('id')
    .single();

  if (docError || !kbDoc) {
    // Best-effort: remove the orphaned storage file.
    await admin.storage.from(BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: `Failed to record document: ${docError?.message ?? 'unknown'}` },
      { status: 500 },
    );
  }

  // ── 6. Parse content ─────────────────────────────────────────────────────
  let markdownText: string;
  if (format === 'xlsx') {
    try {
      markdownText = await xlsxToMarkdown(fileBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Could not parse file: ${msg}` }, { status: 422 });
    }
  } else if (format === 'docx') {
    try {
      markdownText = await docxToMarkdown(fileBuffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Could not parse file: ${msg}` }, { status: 422 });
    }
  } else {
    markdownText = new TextDecoder().decode(fileBuffer);
  }

  const { sections, errors: parseErrors } =
    format === 'json'
      ? parseJson(markdownText)
      : parseMarkdown(markdownText);

  // ── 7. Upsert sections into kb_sections ──────────────────────────────────
  let sectionsParsed = 0;

  if (sections.length > 0) {
    // Batch in groups of PAGE_SIZE to stay within Supabase payload limits.
    for (let i = 0; i < sections.length; i += PAGE_SIZE) {
      const batch = sections.slice(i, i + PAGE_SIZE).map((s) => ({
        event_id: eventId,
        kb_document_id: kbDoc.id,
        section_id: s.section_id,
        category: s.category,
        intent: s.intent,
        escalation_needed: s.escalation_needed,
        question_en: s.question_en,
        answer_en: s.answer_en,
        question_ar: s.question_ar,
        answer_ar: s.answer_ar,
        sort_order: s.sort_order,
      }));

      const { error: upsertError } = await supabase
        .from('kb_sections')
        .upsert(batch, { onConflict: 'event_id,section_id', ignoreDuplicates: false });

      if (upsertError) {
        parseErrors.push(`Batch ${Math.floor(i / PAGE_SIZE) + 1} upsert failed: ${upsertError.message}`);
      } else {
        sectionsParsed += batch.length;
      }
    }
  }

  // ── 8. Update section_count on the document ──────────────────────────────
  await supabase
    .from('kb_documents')
    .update({ section_count: sectionsParsed })
    .eq('id', kbDoc.id);

  // ── 9. Audit log (service-role) ──────────────────────────────────────────
  await admin.from('audit_log').insert({
    operator_id: event.operator_id,
    event_id: eventId,
    actor_type: 'user',
    actor_id: user.id,
    action: 'kb.uploaded',
    entity_type: 'kb_document',
    entity_id: kbDoc.id,
    metadata: {
      filename: file.name,
      format,
      sections_parsed: sectionsParsed,
      parse_errors: parseErrors.length,
    },
  });

  return NextResponse.json({
    document_id: kbDoc.id,
    sections_parsed: sectionsParsed,
    errors: parseErrors,
  });
}
