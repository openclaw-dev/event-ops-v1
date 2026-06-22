import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { Sidebar } from './_components/sidebar';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();

  // Validate the session — middleware already guards this route,
  // but a server-component check is a good second layer.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Fetch operator memberships + operator names in a single query.
  // RLS ensures we only see operators the user belongs to.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id, role, operators(id, name)')
    .eq('user_id', user.id);

  const operators = (memberships ?? [])
    .map((m) => {
      const op = Array.isArray(m.operators) ? m.operators[0] : m.operators;
      return op ? { id: op.id as string, name: op.name as string } : null;
    })
    .filter(Boolean) as { id: string; name: string }[];

  // If the user has no operators, redirect to onboarding.
  // Exclude the onboarding path itself to prevent a redirect loop.
  const pathname = headers().get('x-current-path') ?? '';
  if (operators.length === 0 && pathname !== '/admin/onboarding') {
    redirect('/admin/onboarding');
  }

  // Determine the active operator.
  // Prefer the cookie selection; fall back to the first operator.
  const activeId = resolveActiveOperatorId(operators.map((op) => op.id));
  const currentOperator =
    operators.find((op) => op.id === activeId) ?? operators[0] ?? { id: '', name: '' };

  // Fetch events for the active operator.
  const { data: events } = currentOperator.id
    ? await supabase
        .from('events')
        .select('id, name, status, start_date, is_demo')
        .eq('operator_id', currentOperator.id)
        .is('deleted_at', null)
        .order('start_date', { ascending: true })
    : { data: [] };

  const eventList = (events ?? []).map((e) => ({
    id: e.id as string,
    name: e.name as string,
    status: e.status as string,
    start_date: e.start_date as string,
    is_demo: (e.is_demo as boolean) ?? false,
  }));

  return (
    <div className="dark animated-bg relative z-0 flex h-screen overflow-hidden text-foreground">
      {/* z-[1] wrapper lifts sidebar + main above the ::before radial overlay */}
      <div className="relative z-[1] flex h-full w-full overflow-hidden">
        <Sidebar
          operators={operators}
          currentOperator={currentOperator}
          events={eventList}
        />
        <main className="flex flex-1 flex-col overflow-y-auto border-t border-white/5 bg-white/[0.02]">
          {children}
        </main>
      </div>
    </div>
  );
}
