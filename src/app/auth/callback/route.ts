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
  const { searchParams, origin } = new URL(request.url);
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
