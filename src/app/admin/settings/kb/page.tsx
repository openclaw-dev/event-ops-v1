import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { Separator } from '@/components/ui/separator';
import { OperatorKbUploadForm } from './_components/operator-kb-upload-form';
import {
  OperatorKbSections,
  type OperatorKbSectionRow,
} from './_components/operator-kb-sections';

export default async function OperatorKbPage() {
  // ── Resolve active operator ──────────────────────────────────────────────
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operatorIds = (memberships ?? []).map((m) => m.operator_id as string);
  const operatorId = resolveActiveOperatorId(operatorIds);
  if (!operatorId) redirect('/admin/onboarding');

  // ── Fetch operator KB sections ───────────────────────────────────────────
  const admin = createAdminClient();
  const { data: rawSections } = await admin
    .from('operator_kb_sections')
    .select('id, section_id, title, content, source_file, updated_at')
    .eq('operator_id', operatorId)
    .order('updated_at', { ascending: false });

  const sections: OperatorKbSectionRow[] = (rawSections ?? []).map((row) => ({
    id: row.id as string,
    section_id: row.section_id as string,
    title: row.title as string,
    content: row.content as string,
    source_file: (row.source_file as string | null) ?? null,
    updated_at: row.updated_at as string,
  }));

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-8 py-8">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold">Operator Knowledge Base</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Content that applies to all your events. Event-specific knowledge takes priority when
          there is a conflict.
        </p>
      </div>

      {/* ── Upload ──────────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold">Upload a KB document</h3>
        <OperatorKbUploadForm operatorId={operatorId} />
      </section>

      <Separator />

      {/* ── Sections list ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Sections — {sections.length} total
        </h3>
        <OperatorKbSections initialSections={sections} />
      </section>
    </div>
  );
}
