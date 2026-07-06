'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Amiri } from 'next/font/google';
import { ArrowRight, Loader2, MailCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Amiri is loaded ONLY for the single ghosted Arabic watermark below.
// Newsreader (the display serif) has no Arabic glyphs and would silently
// fall back to a per-machine system font. Do not use this anywhere else.
const arabic = Amiri({
  subsets: ['arabic'],
  weight: '700',
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
    <div className="w-full max-w-sm">
      {/* Card: refined layered depth on warm paper — soft shadow + hairline. */}
      <div className="rounded-2xl border border-border/70 bg-card p-8 shadow-[0_1px_3px_rgba(28,27,23,0.04),0_18px_44px_-20px_rgba(28,27,23,0.22)]">
        {sent ? (
          <div className="login-success-enter space-y-4 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <MailCheck className="h-5 w-5" />
            </div>
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
              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  className="text-xs font-medium tracking-wide text-muted-foreground"
                >
                  EMAIL ADDRESS
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  autoFocus
                  className="h-11 bg-background transition-shadow focus-visible:shadow-[0_0_0_4px_rgba(28,27,23,0.06)]"
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
                className="group h-11 w-full text-sm font-medium shadow-sm transition-all hover:shadow-md disabled:opacity-70"
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

function Cover() {
  return (
    <div className="relative flex min-h-full flex-col overflow-hidden px-8 py-10 lg:px-16 lg:py-14">
      {/* Atmosphere — decorative, aria-hidden, confined to dead space.
          Rendered on lg+ only. The warm glow is a *light* (never a shadow), so
          near-black text over it only gains contrast. The ghosted Arabic word
          is anchored to the empty lower-right corner, bleeding off-canvas, so it
          never sits behind the (left-aligned) headline, subhead, or chips. */}
      <div
        aria-hidden
        className="login-glow pointer-events-none absolute left-1/2 top-1/3 -z-10 hidden h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full lg:block"
        style={{
          background:
            'radial-gradient(circle, rgba(255,251,240,0.9) 0%, rgba(255,251,240,0) 70%)',
        }}
      />
      <div
        aria-hidden
        lang="ar"
        dir="rtl"
        className={`${arabic.className} login-ghost pointer-events-none absolute -right-[16%] -top-[10%] -z-10 hidden select-none whitespace-nowrap leading-none text-foreground/[0.045] lg:block`}
        style={{ fontSize: 'clamp(12rem, 20vw, 22rem)' }}
      >
        تذكرة
      </div>

      {/* Wordmark */}
      <div className="relative z-10">
        <span className="font-serif text-xl tracking-tight text-foreground">tazkar</span>
        <span className="font-serif text-xl text-muted-foreground">.co</span>
      </div>

      {/* Cover message */}
      <div className="relative z-10 mt-12 max-w-xl lg:mt-auto lg:pb-4">
        <p className="mb-5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Revenue operations for GCC event operators
        </p>
        <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Recover failed payments.
          <br />
          Deflect refunds.
          <br />
          <span className="italic">Support every fan.</span>
        </h1>
        <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
          An AI operations agent that lives on WhatsApp — fluent in Arabic, English, and Russian,
          working every conversation your team can&apos;t reach.
        </p>

        {/* Real trust indicators — capabilities + supported languages. */}
        <div className="mt-8 flex flex-wrap items-center gap-2">
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
  );
}

// Page wraps the form in Suspense so Next.js 14 can statically render the shell.
export default function LoginPage() {
  return (
    <main className="relative min-h-screen w-full bg-background lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      {/* Left: the cover of the magazine. Hairline divider on lg. */}
      <section className="border-b border-border/60 lg:border-b-0 lg:border-r">
        <Cover />
      </section>

      {/* Right: the act of entering. */}
      <section className="flex items-center justify-center px-6 py-14 lg:py-0">
        <Suspense
          fallback={<div className="h-72 w-full max-w-sm animate-pulse rounded-2xl bg-muted" />}
        >
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
