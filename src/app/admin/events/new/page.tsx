import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { createEvent } from './actions';
import { EventSetupForm } from '../_components/event-setup-form';

/**
 * /admin/events/new
 *
 * Shows the event setup form in "create" mode.
 * On submit the `createEvent` server action inserts the row and redirects
 * to /admin/events/[id]/setup.
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

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Create event</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill in the details below. You can always edit them later from the Setup tab.
        </p>
      </div>

      <EventSetupForm
        onSubmit={createEvent}
        submitLabel="Create event"
        cancelHref="/admin/events"
      />
    </div>
  );
}
