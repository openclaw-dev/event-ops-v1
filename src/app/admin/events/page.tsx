import Link from 'next/link';
import { Plus, Calendar } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { localDateStringInTz, DEFAULT_EVENT_TZ } from '@/lib/dates';
import { Button } from '@/components/ui/button';

function EventStatusBadge({
  status,
  startDate,
  timezone,
}: {
  status: string;
  startDate: string;
  timezone: string | null;
}) {
  // Compare against "today" in the event's timezone, not the server's UTC date:
  // between 21:00 UTC and midnight a Saudi-evening event flips a day early/late
  // under a UTC comparison (audit 10.5).
  const today = localDateStringInTz(new Date(), timezone ?? DEFAULT_EVENT_TZ);
  const isPast = startDate < today;

  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Live
      </span>
    );
  }
  if (isPast || status === 'closed' || status === 'archived') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        Ended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Draft
    </span>
  );
}

export default async function EventsPage() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user!.id);

  const activeOperatorId = resolveActiveOperatorId(
    (memberships ?? []).map((m) => m.operator_id as string),
  );

  const { data: events } = activeOperatorId
    ? await supabase
        .from('events')
        .select('id, name, status, event_type, start_date, venue_city, timezone')
        .eq('operator_id', activeOperatorId)
        .is('deleted_at', null)
        .order('start_date', { ascending: true })
    : { data: [] };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events</h1>
        <Button asChild size="sm">
          <Link href="/admin/events/new">
            <Plus className="h-4 w-4" />
            New Event
          </Link>
        </Button>
      </div>

      {!events || events.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <Calendar className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="mb-1 text-sm font-medium">No events yet</p>
          <p className="mb-4 text-xs text-muted-foreground">
            Create your first event to get started.
          </p>
          <Button asChild size="sm">
            <Link href="/admin/events/new">
              <Plus className="h-4 w-4" />
              New Event
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/admin/events/${event.id}`}
              className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent/50"
            >
              <div>
                <p className="font-medium">{event.name}</p>
                <p className="text-xs text-muted-foreground">
                  {event.event_type} · {event.venue_city} · {event.start_date}
                </p>
              </div>
              <EventStatusBadge
                status={event.status}
                startDate={event.start_date}
                timezone={(event as { timezone?: string | null }).timezone ?? null}
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
