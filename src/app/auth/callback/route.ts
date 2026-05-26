import { createServerClient } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Supabase Auth PKCE callback.
 *
 * Supabase appends one of:
 *   ?code=<code>                          — PKCE flow (signInWithOtp via @supabase/ssr)
 *   ?token_hash=<hash>&type=<type>        — implicit / email-OTP flow (fallback)
 *
 * www→apex canonicalization is handled in middleware.ts (before this route ever
 * runs) so the PKCE code verifier cookie is always on the same domain that calls
 * exchangeCodeForSession. Do NOT add a www redirect here — it would move the
 * request to a domain that doesn't have the verifier cookie, breaking the exchange.
 *
 * On failure: redirect to /login?error=auth so the login page can show an error
 * without exposing details in the URL.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code       = searchParams.get('code');
  const tokenHash  = searchParams.get('token_hash');
  const type       = searchParams.get('type');
  const next       = searchParams.get('next') ?? '/admin/events';

  const supabase = createServerClient();

  // ── PKCE flow (primary — used by signInWithOtp with @supabase/ssr) ───────
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // ── Implicit / email-OTP flow (fallback) ──────────────────────────────────
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as Parameters<typeof supabase.auth.verifyOtp>[0]['type'],
    });
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Something went wrong — back to login with an error flag.
  const errorUrl = new URL('/login', origin);
  errorUrl.searchParams.set('error', 'auth');
  return NextResponse.redirect(errorUrl);
}
