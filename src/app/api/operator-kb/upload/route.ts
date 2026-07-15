import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/write-audit-log';
import { parseMarkdown } from '@/lib/parsers/kb-markdown';
import { parseJson } from '@/lib/parsers/kb-json';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const PAGE_SIZE = 500;

export const maxDuration = 60;
export const runtime = 'nodejs';

type Format = 'markdown' | 'json';

function detectFormat(filename: string): Format | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'json') return 'json';
  return null;
}

/**
 * POST /api/operator-kb/upload
 *
 * Multipart form fields:
 *   file        — the KB file (.md or .json, max 5 MB)
 *   operator_id — UUID of the target operator
 *
 * Returns:
 *   { sections_parsed, errors }
 *
 * Sections are upserted into operator_kb_sections. On section_id conflict the
 * row is updated (ignoreDuplicates: false), so re-uploading a file refreshes
 * existing sections cleanly.
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
  const operatorId = formData.get('operator_id');
  const languageRaw = formData.get('language');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  }
  if (typeof operatorId !== 'string' || !operatorId) {
    return NextResponse.json({ error: 'operator_id is required.' }, { status: 400 });
  }

  const VALID_LANGUAGES = new Set(['en', 'ar', 'ru', 'all']);
  const language =
    typeof languageRaw === 'string' && VALID_LANGUAGES.has(languageRaw)
      ? languageRaw
      : 'en';

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
      { error: 'Unsupported file type. Upload a .md or .json file.' },
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

  // RLS check: does this user belong to this operator?
  const { data: operatorUser } = await supabase
    .from('operator_users')
    .select('id')
    .eq('user_id', user.id)
    .eq('operator_id', operatorId)
    .single();

  if (!operatorUser) {
    return NextResponse.json({ error: 'Operator not found or access denied.' }, { status: 403 });
  }

  // ── 4. Parse content ─────────────────────────────────────────────────────
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const text = new TextDecoder().decode(fileBuffer);
  const { sections, errors: parseErrors } =
    format === 'markdown' ? parseMarkdown(text) : parseJson(text);

  // ── 5. Upsert into operator_kb_sections (admin client) ───────────────────
  const admin = createAdminClient();
  let sectionsParsed = 0;

  if (sections.length > 0) {
    for (let i = 0; i < sections.length; i += PAGE_SIZE) {
      const batch = sections.slice(i, i + PAGE_SIZE).map((s) => ({
        operator_id: operatorId,
        section_id: s.section_id,
        title: s.question_en ?? s.section_id,
        content: s.answer_en,
        source_file: file.name,
        language,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await admin
        .from('operator_kb_sections')
        .upsert(batch, { onConflict: 'operator_id,section_id', ignoreDuplicates: false });

      if (upsertError) {
        parseErrors.push(
          `Batch ${Math.floor(i / PAGE_SIZE) + 1} upsert failed: ${upsertError.message}`,
        );
      } else {
        sectionsParsed += batch.length;
      }
    }
  }

  // ── 6. Audit log (service-role) ──────────────────────────────────────────
  await writeAuditLog({
    operator_id: operatorId,
    event_id: null,
    actor_type: 'user',
    actor_id: user.id,
    action: 'operator_kb.uploaded',
    entity_type: 'operator_kb_sections',
    entity_id: null,
    metadata: {
      filename: file.name,
      format,
      sections_parsed: sectionsParsed,
      parse_errors: parseErrors.length,
    },
  });

  return NextResponse.json({
    sections_parsed: sectionsParsed,
    errors: parseErrors,
  });
}
