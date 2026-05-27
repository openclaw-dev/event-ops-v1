import { notFound } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { PromotersManager, type PromoterRow } from './_components/promoters-manager';

interface PromotersPageProps {
  params: { eventId: string };
}

export default async function PromotersPage({ params }: PromotersPageProps) {
  const supabase = createServerClient();

  // Verify event access (RLS).
  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();

  if (!event) notFound();

  // Fetch promoters for this event — RLS filters by operator automatically.
  const { data: rawPromoters } = await supabase
    .from('promoters')
    .select('*')
    .eq('event_id', params.eventId)
    .order('created_at', { ascending: true });

  const promoters = (rawPromoters ?? []) as PromoterRow[];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-8 py-8">
      <div>
        <h2 className="text-base font-semibold">Promoters</h2>
        <p className="text-sm text-muted-foreground">
          Phone numbers authorised to send WhatsApp change messages for this event.
        </p>
      </div>

      <PromotersManager eventId={params.eventId} initialPromoters={promoters} />
    </div>
  );
}
