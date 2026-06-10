import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { GateScanner } from './_components/gate-scanner';

export const metadata: Metadata = {
  title: 'Gate Scanner',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

interface GatePageProps {
  params: { eventId: string };
}

export default async function GatePage({ params }: GatePageProps) {
  const supabase = createServerClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();

  if (!event) notFound();

  return (
    <GateScanner
      eventId={params.eventId}
      eventName={(event as { id: string; name: string }).name}
    />
  );
}
