import { redirect } from 'next/navigation';

interface EventPageProps {
  params: { eventId: string };
}

/**
 * /admin/events/[eventId] — redirect to the Setup tab.
 * The overview dashboard lives here post-v1.
 */
export default function EventPage({ params }: EventPageProps) {
  redirect(`/admin/events/${params.eventId}/setup`);
}
