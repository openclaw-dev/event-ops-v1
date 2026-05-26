import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  // ── Canonical domain — strip www before anything else ───────────────────
  // This must run first so that signInWithOtp is always called from tazkar.co.
  // The PKCE code verifier is stored in a cookie scoped to the domain where
  // signInWithOtp fires. If that domain is www.tazkar.co and the callback
  // later redirects to tazkar.co, the verifier cookie won't be sent and
  // exchangeCodeForSession will fail.
  if (request.nextUrl.hostname === 'www.tazkar.co') {
    const canonical = request.nextUrl.clone();
    canonical.hostname = 'tazkar.co';
    return NextResponse.redirect(canonical, { status: 301 });
  }

  // Forward the pathname as a header so Server Component layouts can read it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-current-path', request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Refresh the session cookie if it has expired.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: use getUser() not getSession() — getUser() validates the JWT
  // against the Supabase server and cannot be forged.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Redirect unauthenticated users away from /admin/*.
  if (!user && pathname.startsWith('/admin')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from /login.
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/admin';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Run middleware on all paths except:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     * - public image formats
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
