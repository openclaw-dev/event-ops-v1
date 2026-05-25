import { createServerClient } from '@/lib/supabase/server';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * Supabase Auth PKCE callback.
 *
 * Supabase appends ?code=<code>&next=<path> to the magic-link URL.
 * This route exchanges the code for a session and redirects to /admin.
 *
 * On failure it redirects to /login?error=auth so the login page can
 * show an error state without exposing details in the URL.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  // Canonicalize: if the magic link arrives on www.tazkar.co, redirect to the
  // bare domain first so the session cookie is always scoped to tazkar.co.
  // Without this, a www→apex infrastructure redirect strips the Set-Cookie
  // header and the user lands on /admin with no session.
  if (url.hostname === 'www.tazkar.co') {
    url.hostname = 'tazkar.co';
    return NextResponse.redirect(url, { status: 301 });
  }

  const { searchParams, origin } = url;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/admin';

  if (code) {
    const supabase = createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Redirect to the intended destination (default: /admin).
      const redirectUrl = new URL(next, origin);
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Something went wrong — back to login with an error flag.
  const errorUrl = new URL('/login', origin);
  errorUrl.searchParams.set('error', 'auth');
  return NextResponse.redirect(errorUrl);
}
