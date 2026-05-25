import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { KbUploadForm, KbDocumentRow } from './_components/kb-upload-form';
import { KbFilters } from './_components/kb-filters';

const PAGE_SIZE = 25;

interface KbPageProps {
  params: { eventId: string };
  searchParams: { page?: string; category?: string; intent?: string };
}

export default async function KbPage({ params, searchParams }: KbPageProps) {
  const supabase = createServerClient();

  // Verify event access (RLS).
  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();
  if (!event) notFound();

  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const categoryFilter = searchParams.category ?? '';
  const intentFilter = searchParams.intent ?? '';
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  // Fetch documents and sections in parallel.
  const [docsResult, filterDataResult, sectionsResult] = await Promise.all([
    // Recent uploads
    supabase
      .from('kb_documents')
      .select('id, filename, section_count, created_at')
      .eq('event_id', params.eventId)
      .order('created_at', { ascending: false })
      .limit(20),

    // All categories + intents for filter dropdowns (no pagination)
    supabase
      .from('kb_sections')
      .select('category, intent')
      .eq('event_id', params.eventId),

    // Paginated + filtered sections
    (() => {
      let q = supabase
        .from('kb_sections')
        .select('id, section_id, category, intent, escalation_needed', { count: 'exact' })
        .eq('event_id', params.eventId)
        .order('sort_order', { ascending: true })
        .range(rangeFrom, rangeTo);
      if (categoryFilter) q = q.eq('category', categoryFilter);
      if (intentFilter)   q = q.eq('intent', intentFilter);
      return q;
    })(),
  ]);

  const documents = docsResult.data ?? [];
  const allFilterData = filterDataResult.data ?? [];
  const sections = sectionsResult.data ?? [];
  const totalSections = sectionsResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalSections / PAGE_SIZE));

  // Distinct values for filters.
  const categories = Array.from(
    new Set(allFilterData.map((d) => d.category).filter((c): c is string => !!c)),
  ).sort();
  const intents = Array.from(
    new Set(allFilterData.map((d) => d.intent).filter((i): i is string => !!i)),
  ).sort();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-8 py-8">

      {/* ── Upload ──────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-base font-semibold">Upload a KB document</h2>
        <KbUploadForm eventId={params.eventId} />
      </section>

      <Separator />

      {/* ── Documents list ───────────────────────────────────────────── */}
      {documents.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Uploaded documents
          </h2>
          <div className="space-y-2">
            {documents.map((doc) => (
              <KbDocumentRow
                key={doc.id}
                filename={doc.filename}
                sectionCount={doc.section_count}
                uploadedAt={doc.created_at}
              />
            ))}
          </div>
        </section>
      )}

      <Separator />

      {/* ── Sections list ────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Sections — {totalSections} total
          </h2>
          <Suspense>
            <KbFilters
              categories={categories}
              intents={intents}
              currentCategory={categoryFilter}
              currentIntent={intentFilter}
            />
          </Suspense>
        </div>

        {sections.length === 0 ? (
          <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            {documents.length === 0
              ? 'No KB documents yet. Upload a .md or .json file above.'
              : 'No sections match the current filters.'}
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                      Section ID
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">
                      Category
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">
                      Intent
                    </th>
                    <th className="px-4 py-2.5 text-center font-medium text-muted-foreground w-16">
                      Esc?
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sections.map((section) => (
                    <tr
                      key={section.id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/events/${params.eventId}/kb/${section.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {section.section_id}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                        {section.category ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                        {section.intent ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {section.escalation_needed ? (
                          <span className="text-amber-600">✓</span>
                        ) : (
                          <span className="text-muted-foreground/40">·</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <PaginationLink
                    eventId={params.eventId}
                    page={page - 1}
                    disabled={page <= 1}
                    category={categoryFilter}
                    intent={intentFilter}
                    label="Previous"
                    icon={<ChevronLeft className="h-4 w-4" />}
                  />
                  <PaginationLink
                    eventId={params.eventId}
                    page={page + 1}
                    disabled={page >= totalPages}
                    category={categoryFilter}
                    intent={intentFilter}
                    label="Next"
                    icon={<ChevronRight className="h-4 w-4" />}
                    iconAfter
                  />
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ─── Pagination link ──────────────────────────────────────────────────────────

function PaginationLink({
  eventId,
  page,
  disabled,
  category,
  intent,
  label,
  icon,
  iconAfter,
}: {
  eventId: string;
  page: number;
  disabled: boolean;
  category: string;
  intent: string;
  label: string;
  icon: React.ReactNode;
  iconAfter?: boolean;
}) {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (category) params.set('category', category);
  if (intent) params.set('intent', intent);
  const href = `/admin/events/${eventId}/kb?${params.toString()}`;

  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1 text-xs">
        {!iconAfter && icon}
        {label}
        {iconAfter && icon}
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" asChild className="gap-1 text-xs">
      <Link href={href}>
        {!iconAfter && icon}
        {label}
        {iconAfter && icon}
      </Link>
    </Button>
  );
}
