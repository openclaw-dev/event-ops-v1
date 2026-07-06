'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Amiri } from 'next/font/google';
import { ArrowRight, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConversationVignette } from './_components/conversation-vignette';

// Amiri is the login page's Arabic typeface — Newsreader (the display serif)
// and Inter (the UI sans) have no Arabic glyphs and would fall back to a
// per-machine system font. It is used ONLY for Arabic text here: the ghosted
// watermark, the wordmark companion glyph, and the Arabic demo message.
const arabic = Amiri({
  subsets: ['arabic'],
  weight: ['400', '700'],
  display: 'swap',
});

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

type FormData = z.infer<typeof schema>;

const CAPABILITIES = ['Payment recovery', 'Refund deflection', 'WhatsApp support'];

// Inner component reads search params — must be inside <Suspense>.
function LoginForm() {
  const searchParams = useSearchParams();
  const hasAuthError = searchParams.get('error') === 'auth';

  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [serverError, setServerError] = useState<string | null>(
    hasAuthError ? 'The sign-in link is invalid or has expired. Request a new one.' : null,
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  async function onSubmit({ email }: FormData) {
    setServerError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setServerError(error.message);
    } else {
      setSentEmail(email);
      setSent(true);
    }
  }

  return (
    <div className="login-rise w-full max-w-sm" style={{ animationDelay: '240ms' }}>
      {/* Card: two-layer depth on warm paper — hairline seat + soft ambient lift. */}
      <div className="rounded-2xl border border-border/70 bg-card p-8 shadow-[0_0_0_1px_rgba(28,27,23,0.03),0_2px_6px_-1px_rgba(28,27,23,0.06),0_28px_60px_-28px_rgba(28,27,23,0.30)]">
        {sent ? (
          <div className="login-success-enter space-y-4 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              {/* Envelope that draws itself in via SVG stroke animation. */}
              <svg
                viewBox="0 0 48 48"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="login-draw h-6 w-6"
                aria-hidden
              >
                <rect x="8" y="13" width="32" height="22" rx="3" />
                <path d="M9 16 L24 27 L39 16" />
              </svg>
            </span>
            <div className="space-y-1.5">
              <h2 className="font-serif text-2xl leading-tight text-foreground">Check your inbox</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                We sent a sign-in link to{' '}
                <span className="font-medium text-foreground">{sentEmail}</span>. It expires in
                60&nbsp;minutes.
              </p>
            </div>
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              onClick={() => {
                setSent(false);
                setServerError(null);
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6 space-y-1.5">
              <h2 className="font-serif text-3xl leading-none tracking-tight text-foreground">
                Sign in
              </h2>
              <p className="text-sm text-muted-foreground">
                Enter your email — we&apos;ll send a magic link, no password.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="group space-y-1.5">
                <Label
                  htmlFor="email"
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-all duration-200 group-focus-within:-translate-y-px group-focus-within:text-foreground"
                >
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  className="h-11 bg-background transition-[box-shadow,border-color] duration-200 focus-visible:border-foreground focus-visible:shadow-[0_0_0_4px_rgba(28,27,23,0.10)] focus-visible:ring-0 focus-visible:ring-offset-0"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              {serverError && (
                <p
                  role="alert"
                  className="login-error-enter rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive"
                >
                  {serverError}
                </p>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="group h-11 w-full text-sm font-medium shadow-sm transition-all hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:opacity-70"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending link…
                  </>
                ) : (
                  <>
                    Send magic link
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </>
                )}
              </Button>
            </form>
          </>
        )}
      </div>

      {/* Quiet secondary path — must not compete with the submit button. */}
      <p className="mt-6 text-center text-xs text-muted-foreground">
        No account?{' '}
        <a
          href="mailto:hello@tazkar.co"
          className="font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Request a pilot
        </a>
      </p>
    </div>
  );
}

function Wordmark() {
  return (
    <div
      className="login-rise flex items-center gap-2"
      style={{ animationDelay: '40ms' }}
    >
      <span className="font-serif text-2xl leading-none tracking-tight text-foreground">
        tazkar
        <span className="font-bold text-foreground">.</span>
        <span className="text-muted-foreground">co</span>
      </span>
      <span
        className={`${arabic.className} translate-y-[1px] text-base leading-none text-muted-foreground/55`}
        dir="rtl"
        lang="ar"
        aria-hidden
      >
        تذكرة
      </span>
    </div>
  );
}

function Hero() {
  return (
    <div className="relative flex flex-col overflow-hidden px-6 pb-12 pt-12 sm:px-8 lg:min-h-screen lg:px-16 lg:pb-14 lg:pt-14">
      {/* The ghosted Arabic watermark bleeds off the top-right corner, high and
          clear of the headline (which sits centred on the left) — opposite-corner
          texture, above the living gradient field but below the text. */}
      <div
        aria-hidden
        lang="ar"
        dir="rtl"
        className={`${arabic.className} login-ghost pointer-events-none absolute -right-[20%] -top-[13%] -z-10 hidden select-none whitespace-nowrap font-bold leading-none text-foreground/[0.05] lg:block`}
        style={{ fontSize: 'clamp(11rem, 18vw, 20rem)' }}
      >
        تذكرة
      </div>

      <header className="relative z-10">
        <Wordmark />
      </header>

      <div className="relative z-10 mt-10 lg:mt-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
        <div className="max-w-xl">
          <p
            className="login-rise mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground"
            style={{ animationDelay: '120ms' }}
          >
            Revenue operations for GCC event operators
          </p>
          <h1 className="font-serif text-[2.6rem] font-normal leading-[1.0] tracking-[-0.02em] text-foreground sm:text-6xl lg:text-[4.25rem]">
            <span className="login-rise block" style={{ animationDelay: '190ms' }}>
              Recover failed payments.
            </span>
            <span className="login-rise block" style={{ animationDelay: '260ms' }}>
              Deflect refunds.
            </span>
            <span className="login-ink block italic">Support every fan.</span>
          </h1>
          <p
            className="login-rise mt-5 max-w-md text-base leading-relaxed text-muted-foreground"
            style={{ animationDelay: '400ms' }}
          >
            An AI operations agent that lives on WhatsApp — fluent in Arabic, English, and Russian,
            working every conversation your team can&apos;t reach.
          </p>

          {/* Real trust indicators — capabilities + supported languages. */}
          <div
            className="login-rise mt-6 flex flex-wrap items-center gap-2"
            style={{ animationDelay: '470ms' }}
          >
            {CAPABILITIES.map((label) => (
              <span
                key={label}
                className="rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-foreground/80"
              >
                {label}
              </span>
            ))}
            <span className="ml-1 inline-flex items-center gap-1.5">
              {['EN', 'AR', 'RU'].map((lang) => (
                <span
                  key={lang}
                  className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-foreground"
                >
                  {lang}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Living gradient field: warm palette blobs drifting beneath the paper grain.
const FIELD_BLOBS: { cls: string; style: React.CSSProperties }[] = [
  {
    cls: 'login-blob-a',
    style: {
      top: '-12%',
      left: '-8%',
      background: 'radial-gradient(circle, rgba(255,251,240,0.95) 0%, rgba(255,251,240,0) 68%)',
    },
  },
  {
    cls: 'login-blob-b',
    style: {
      top: '-18%',
      right: '-6%',
      background: 'radial-gradient(circle, rgba(182,150,102,0.24) 0%, rgba(182,150,102,0) 68%)',
    },
  },
  {
    cls: 'login-blob-c',
    style: {
      bottom: '-16%',
      left: '2%',
      background: 'radial-gradient(circle, rgba(40,34,24,0.07) 0%, rgba(40,34,24,0) 68%)',
    },
  },
  {
    cls: 'login-blob-d',
    style: {
      bottom: '-14%',
      right: '-10%',
      background: 'radial-gradient(circle, rgba(246,238,220,0.9) 0%, rgba(246,238,220,0) 68%)',
    },
  },
];

function BackgroundField() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {FIELD_BLOBS.map((b) => (
        <div key={b.cls} className={`login-blob ${b.cls}`} style={b.style} />
      ))}
      {/* Fine static paper grain, layered on top of the moving light. */}
      <div className="login-grain absolute inset-0" />
    </div>
  );
}

// Page wraps the form in Suspense so Next.js 14 can statically render the shell.
// Desktop composes as one viewport: hero left; card + vignette stacked right.
// Mobile stacks hero → vignette → card via flex order.
export default function LoginPage() {
  return (
    <main className="relative isolate flex min-h-screen w-full flex-col bg-background lg:grid lg:grid-cols-[1.05fr_0.95fr] lg:grid-rows-2">
      <BackgroundField />

      {/* Hero — left column, spanning both rows, vertically centred. */}
      <section className="order-1 border-b border-border/60 lg:order-none lg:col-start-1 lg:row-span-2 lg:border-b-0 lg:border-r">
        <Hero />
      </section>

      {/* Sign-in card — right column, upper row, seated at the vertical centre. */}
      <section className="order-3 flex justify-center px-6 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-4 sm:px-8 lg:order-none lg:col-start-2 lg:row-start-1 lg:items-end lg:px-10 lg:pb-5 lg:pt-14">
        <Suspense
          fallback={<div className="h-72 w-full max-w-sm animate-pulse rounded-2xl bg-muted" />}
        >
          <LoginForm />
        </Suspense>
      </section>

      {/* Conversation vignette — right column, lower row. */}
      <section className="order-2 flex justify-center px-6 pb-10 pt-2 sm:px-8 lg:order-none lg:col-start-2 lg:row-start-2 lg:items-start lg:px-10 lg:pb-14 lg:pt-5">
        <div className="login-rise w-full max-w-sm" style={{ animationDelay: '620ms' }}>
          <ConversationVignette arabicClassName={arabic.className} className="w-full" />
        </div>
      </section>
    </main>
  );
}
