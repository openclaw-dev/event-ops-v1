'use server';

import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface CreateOperatorInput {
  name: string;
  country_code: string;
  default_currency: string;
}

/**
 * Creates an operator and links the current user as owner.
 *
 * Uses the service-role client because the `operators` and `operator_users`
 * tables have no INSERT policy for regular users — writes go through service role.
 *
 * Returns { error: string } on failure; redirects to /admin on success.
 */
export async function createOperator(
  input: CreateOperatorInput,
): Promise<{ error: string } | never> {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: operator, error: opError } = await admin
    .from('operators')
    .insert({
      name: input.name.trim(),
      country_code: input.country_code,
      default_currency: input.default_currency,
    })
    .select('id')
    .single();

  if (opError || !operator) {
    return { error: opError?.message ?? 'Failed to create operator.' };
  }

  const { error: ouError } = await admin.from('operator_users').insert({
    operator_id: operator.id,
    user_id: user.id,
    role: 'owner',
    invited_email: user.email,
  });

  if (ouError) {
    // Best-effort cleanup of the orphaned operator row.
    await admin.from('operators').delete().eq('id', operator.id);
    return { error: ouError.message };
  }

  redirect('/admin');
}
