import { createClient } from '@supabase/supabase-js';

import { requireEnv } from '@/lib/env';

/**
 * Service-role Supabase client. Bypasses RLS.
 *
 * ONLY import this file in Server Actions and Route Handlers.
 * Never expose service-role operations to the client.
 *
 * Uses requireEnv (trim + fail-loud) instead of a non-null assertion so a
 * missing/whitespace SUPABASE_SERVICE_ROLE_KEY throws a descriptive error
 * naming the variable, rather than passing `undefined` into createClient and
 * surfacing as a cryptic downstream error (audit 2.8).
 */
export function createAdminClient() {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
