'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { SELECTED_OPERATOR_COOKIE } from '@/lib/get-active-operator';

/**
 * Switch the active operator (persisted as a cookie).
 * The sidebar calls this; the layout reads the cookie on next render.
 */
export async function switchOperator(operatorId: string) {
  cookies().set(SELECTED_OPERATOR_COOKIE, operatorId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: true,
    sameSite: 'lax',
  });
  redirect('/admin');
}

/**
 * Sign the current user out and redirect to /login.
 */
export async function signOut() {
  const supabase = createServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
