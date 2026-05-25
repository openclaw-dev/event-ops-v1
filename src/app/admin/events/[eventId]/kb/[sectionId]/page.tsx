import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

interface SectionDetailProps {
  params: { eventId: string; sectionId: string };
}

/**
 * /admin/events/[eventId]/kb/[sectionId]
 *
 * Read-only detail view for a single KB section.
 * `sectionId` is the `kb_sections.id` UUID (not the section_id string).
 */
export default async function SectionDetailPage({ params }: SectionDetailProps) {
  const supabase = createServerClient();

  const { data: section } = await supabase
    .from('kb_sections')
    .select(
      'id, section_id, category, intent, escalation_needed, question_en, answer_en, question_ar, answer_ar, sort_order, created_at, kb_document_id',
    )
    .eq('id', params.sectionId)
    .eq('event_id', params.eventId)
    .single();

  if (!section) notFound();

  // Fetch the source document name for context.
  const { data: doc } = await supabase
    .from('kb_documents')
    .select('filename, created_at')
    .eq('id', section.kb_document_id)
    .single();

  return (
    <div className="mx-auto w-full max-w-2xl px-8 py-8">
      {/* Back */}
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-1 gap-1 text-xs">
        <Link href={`/admin/events/${params.eventId}/kb`}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Knowledge Base
        </Link>
      </Button>

      {/* Header */}
      <div className="mb-6 space-y-2">
        <code className="text-base font-semibold">{section.section_id}</code>
        <div className="flex flex-wrap gap-2">
          {section.category && (
            <Badge variant="secondary">{section.category}</Badge>
          )}
          {section.intent && (
            <Badge variant="outline">{section.intent}</Badge>
          )}
          {section.escalation_needed && (
            <Badge className="border-amber-300 bg-amber-50 text-amber-700">
              Escalation needed
            </Badge>
          )}
        </div>
        {doc && (
          <p className="text-xs text-muted-foreground">
            From <span className="font-medium">{doc.filename}</span>
            {' · '}uploaded{' '}
            {new Date(doc.created_at).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        )}
      </div>

      <Separator className="mb-6" />

      {/* English Q&A */}
      <section className="mb-8 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          English
        </h2>
        {section.question_en && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Question</p>
            <p className="text-sm">{section.question_en}</p>
          </div>
        )}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Answer</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{section.answer_en}</p>
        </div>
      </section>

      {/* Arabic Q&A (shown only if content exists) */}
      {(section.question_ar || section.answer_ar) && (
        <>
          <Separator className="mb-6" />
          <section className="space-y-4" dir="rtl">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Arabic / العربية
            </h2>
            {section.question_ar && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Question</p>
                <p className="text-sm">{section.question_ar}</p>
              </div>
            )}
            {section.answer_ar && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Answer</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{section.answer_ar}</p>
              </div>
            )}
          </section>
        </>
      )}

      {/* Metadata footer */}
      <Separator className="mt-8 mb-4" />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <div>
          <dt className="font-medium">Sort order</dt>
          <dd>{section.sort_order}</dd>
        </div>
        <div>
          <dt className="font-medium">Record ID</dt>
          <dd className="font-mono">{section.id}</dd>
        </div>
        <div>
          <dt className="font-medium">Created</dt>
          <dd>
            {new Date(section.created_at).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </dd>
        </div>
      </dl>
    </div>
  );
}
