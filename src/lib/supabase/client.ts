'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for Client Components.
 * Uses the authenticated user's session cookie. RLS applies.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
