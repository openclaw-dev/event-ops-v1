import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';

/**
 * /admin root.
 *
 * Redirects to:
 *   - /admin/onboarding   if the user has no operators yet
 *   - /admin/events/<id>  if a first event exists under the active operator
 *   - /admin/events       if the operator exists but has no events yet
 */
export default async function AdminPage() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Check operator membership.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id)
    .limit(10);

  if (!memberships || memberships.length === 0) {
    redirect('/admin/onboarding');
  }

  // Resolve active operator via shared helper.
  const activeOperatorId = resolveActiveOperatorId(
    memberships.map((m) => m.operator_id as string),
  );

  // Find the first (soonest) event.
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('operator_id', activeOperatorId)
    .is('deleted_at', null)
    .order('start_date', { ascending: true })
    .limit(1);

  if (events && events.length > 0) {
    redirect(`/admin/events/${events[0].id}`);
  }

  redirect('/admin/events');
}
