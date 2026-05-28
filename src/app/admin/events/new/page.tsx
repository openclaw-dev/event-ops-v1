import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { NewEventChoice } from './_components/new-event-choice';

/**
 * /admin/events/new
 *
 * Server component: validates the session and resolves the active operator,
 * then renders the client-side entry-point choice screen.
 */
export default async function NewEventPage() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operatorId = resolveActiveOperatorId(
    (memberships ?? []).map((m) => m.operator_id as string),
  );

  if (!operatorId) redirect('/admin/onboarding');

  return <NewEventChoice />;
}
