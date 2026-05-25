import { notFound } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { Separator } from '@/components/ui/separator';

interface EventLayoutProps {
  children: React.ReactNode;
  params: { eventId: string };
}

/**
 * Event-scoped layout.
 *
 * Validates the eventId exists and belongs to the current user (via RLS),
 * then renders a thin header with the event name above the page content.
 * The sidebar handles the sub-nav; this layout is intentionally minimal.
 */
export default async function EventLayout({ children, params }: EventLayoutProps) {
  const supabase = createServerClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, name, status, event_type')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();

  if (!event) notFound();

  return (
    <div className="flex flex-1 flex-col">
      {/* Event page header */}
      <header className="flex items-center gap-3 px-8 py-4">
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold leading-tight">{event.name}</h1>
          <p className="text-xs capitalize text-muted-foreground">
            {event.event_type} · {event.status}
          </p>
        </div>
      </header>
      <Separator />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
