'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
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
import { CinematicBackground } from './_components/cinematic-background';
import { AmbientSignals } from './_components/ambient-signals';

// Amiri is the login page's Arabic typeface — Newsreader (the display serif)
// and Inter (the UI sans) have no Arabic glyphs. Used only for Arabic here:
// the ghosted watermark, the wordmark companion, and the Arabic ambient signal.
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
    <div className="login-rise w-full max-w-sm" style={{ animationDelay: '300ms' }}>
      {/* Glass card — integrated into the atmosphere: translucent, blurred,
          hairline gradient border with a slowly travelling light, inner top
          highlight, deep ambient shadow. */}
      <div className="login-card rounded-2xl bg-[#171310]/55 p-8 shadow-[0_2px_10px_rgba(0,0,0,0.4),0_40px_90px_-40px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(237,230,216,0.06)] backdrop-blur-2xl">
        {sent ? (
          <div className="login-success-enter space-y-4 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[#e0a659]/30 bg-[#e0a659]/10 text-[#e0a659]">
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
              <h2 className="font-serif text-2xl leading-tight text-[#f3ede1]">Check your inbox</h2>
              <p className="text-sm leading-relaxed text-[#ede6d8]/55">
                We sent a sign-in link to{' '}
                <span className="font-medium text-[#f3ede1]">{sentEmail}</span>. It expires in
                60&nbsp;minutes.
              </p>
            </div>
            <button
              type="button"
              className="text-xs font-medium text-[#ede6d8]/55 underline-offset-4 transition-colors hover:text-[#f3ede1] hover:underline"
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
              <h2 className="font-serif text-3xl leading-none tracking-tight text-[#f3ede1]">
                Sign in
              </h2>
              <p className="text-sm text-[#ede6d8]/55">
                Enter your email — we&apos;ll send a magic link, no password.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="group space-y-1.5">
                <Label
                  htmlFor="email"
                  className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#ede6d8]/50 transition-all duration-200 group-focus-within:-translate-y-px group-focus-within:text-[#e0a659]"
                >
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  className="h-11 border-[#ede6d8]/12 bg-[#ede6d8]/[0.04] text-[#f3ede1] placeholder:text-[#ede6d8]/30 transition-[box-shadow,border-color,background-color] duration-200 focus-visible:border-[#e0a659]/60 focus-visible:bg-[#ede6d8]/[0.06] focus-visible:shadow-[0_0_0_4px_rgba(224,166,89,0.12)] focus-visible:ring-0 focus-visible:ring-offset-0"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-xs text-[#e08a7a]">{errors.email.message}</p>
                )}
              </div>

              {serverError && (
                <p
                  role="alert"
                  className="login-error-enter rounded-lg border border-[#e08a7a]/25 bg-[#e08a7a]/10 px-3 py-2.5 text-xs leading-relaxed text-[#eba99b]"
                >
                  {serverError}
                </p>
              )}

              <Button
                type="submit"
                disabled={isSubmitting}
                className="group h-11 w-full bg-[#ede6d8] text-sm font-medium text-[#171310] shadow-[0_10px_36px_-10px_rgba(237,230,216,0.35)] transition-all hover:-translate-y-px hover:bg-white hover:shadow-[0_14px_44px_-10px_rgba(237,230,216,0.5)] active:translate-y-0 disabled:opacity-70"
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

      <p className="mt-6 text-center text-xs text-[#ede6d8]/45">
        No account?{' '}
        <a
          href="mailto:hello@tazkar.co"
          className="font-medium text-[#ede6d8]/70 underline-offset-4 transition-colors hover:text-[#f3ede1] hover:underline"
        >
          Request a pilot
        </a>
      </p>
    </div>
  );
}

function Wordmark() {
  return (
    <div className="login-rise flex items-center gap-2" style={{ animationDelay: '40ms' }}>
      <span className="font-serif text-2xl leading-none tracking-tight text-[#f3ede1]">
        tazkar
        <span className="font-bold text-[#e0a659]">.</span>
        <span className="text-[#ede6d8]/55">co</span>
      </span>
      <span
        className={`${arabic.className} translate-y-[1px] text-base leading-none text-[#ede6d8]/35`}
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
    <div className="relative flex flex-col overflow-hidden px-6 pb-14 pt-14 sm:px-8 lg:min-h-screen lg:px-16">
      {/* Ghosted Arabic watermark — a faint glowing mark in the empty top-right,
          well clear of the headline; parallax handled by the wrapping layer. */}
      <div
        aria-hidden
        data-parallax="18"
        className="login-parallax pointer-events-none absolute -right-[20%] -top-[13%] -z-[1] hidden lg:block"
      >
        <div
          lang="ar"
          dir="rtl"
          className={`${arabic.className} login-ghost select-none whitespace-nowrap font-bold leading-none text-[#e9ddc8]/[0.06] [text-shadow:0_0_60px_rgba(224,166,89,0.12)]`}
          style={{ fontSize: 'clamp(11rem, 18vw, 20rem)' }}
        >
          تذكرة
        </div>
      </div>

      <header className="relative z-10">
        <Wordmark />
      </header>

      <div className="relative z-10 mt-12 lg:mt-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
        <div className="max-w-xl">
          <p
            className="login-rise mb-5 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#ede6d8]/45"
            style={{ animationDelay: '140ms' }}
          >
            <span className="inline-block h-px w-6 bg-[#e0a659]/60" aria-hidden />
            AI operations · GCC live events
          </p>
          <h1 className="font-serif text-[2.7rem] font-normal leading-[1.0] tracking-[-0.02em] text-[#f4efe4] sm:text-6xl lg:text-[4.4rem]">
            <span className="login-line">
              <span className="login-line-inner" style={{ animationDelay: '240ms' }}>
                Recover failed payments.
              </span>
            </span>
            <span className="login-line">
              <span className="login-line-inner" style={{ animationDelay: '330ms' }}>
                Deflect refunds.
              </span>
            </span>
            <span className="login-line">
              <span
                className="login-line-inner italic text-[#f4efe4]/95"
                style={{ animationDelay: '420ms' }}
              >
                Support every fan.
              </span>
            </span>
          </h1>
          <p
            className="login-rise mt-6 max-w-md text-base leading-relaxed text-[#ede6d8]/60"
            style={{ animationDelay: '560ms' }}
          >
            An AI operations agent that lives on WhatsApp — fluent in Arabic, English, and Russian,
            working every conversation your team can&apos;t reach.
          </p>

          <div
            className="login-rise mt-8 flex flex-wrap items-center gap-2"
            style={{ animationDelay: '660ms' }}
          >
            {CAPABILITIES.map((label) => (
              <span
                key={label}
                className="rounded-full border border-[#ede6d8]/12 bg-[#ede6d8]/[0.03] px-3 py-1 text-xs font-medium text-[#ede6d8]/70"
              >
                {label}
              </span>
            ))}
            <span className="ml-1 inline-flex items-center gap-1.5">
              {['EN', 'AR', 'RU'].map((lang) => (
                <span
                  key={lang}
                  className="rounded border border-[#e0a659]/30 bg-[#e0a659]/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[#e6b673]"
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

// Ultra-soft drifting particles — a faint sense of live activity in the air.
const PARTICLES = [
  { left: '12%', top: '22%', size: 5, dur: 19, delay: 0 },
  { left: '28%', top: '68%', size: 3, dur: 24, delay: 3 },
  { left: '44%', top: '38%', size: 4, dur: 21, delay: 6 },
  { left: '61%', top: '74%', size: 3, dur: 27, delay: 1 },
  { left: '73%', top: '30%', size: 5, dur: 23, delay: 4 },
  { left: '86%', top: '58%', size: 3, dur: 26, delay: 8 },
  { left: '20%', top: '48%', size: 3, dur: 29, delay: 5 },
  { left: '52%', top: '16%', size: 4, dur: 22, delay: 2 },
];

function AtmosphereOverlays() {
  return (
    <>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="login-particle absolute rounded-full"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
      <div className="login-grain-dark absolute inset-0" />
      <div className="login-scanlines absolute inset-0" />
      <div className="login-vignette absolute inset-0" />
    </>
  );
}

// Desktop composes as one viewport: hero left; card + signals stacked right.
// Mobile is a full-bleed cinematic column: hero → card → ambient signals.
export default function LoginPage() {
  const mainRef = useRef<HTMLElement>(null);

  // Subtle pointer parallax → drives [data-parallax] layers via CSS vars.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mx = e.clientX / window.innerWidth - 0.5;
        const my = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty('--mx', mx.toFixed(3));
        el.style.setProperty('--my', my.toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <main
      ref={mainRef}
      className="relative isolate flex min-h-screen w-full flex-col bg-[#0b0908] text-[#ede6d8] lg:grid lg:grid-cols-[1.08fr_0.92fr] lg:grid-rows-2"
    >
      {/* Living cinematic atmosphere behind everything. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <CinematicBackground className="absolute inset-0" />
        <AtmosphereOverlays />
      </div>

      {/* Hero — left column, spanning both rows, vertically centred. */}
      <section className="order-1 lg:order-none lg:col-start-1 lg:row-span-2 lg:border-r lg:border-[#ede6d8]/8">
        <Hero />
      </section>

      {/* Sign-in card — right column, upper row, seated toward the centre. */}
      <section className="order-2 flex justify-center px-6 pb-8 pt-2 sm:px-8 lg:order-none lg:col-start-2 lg:row-start-1 lg:items-end lg:px-10 lg:pb-5 lg:pt-14">
        <Suspense
          fallback={
            <div className="h-72 w-full max-w-sm animate-pulse rounded-2xl bg-[#ede6d8]/5" />
          }
        >
          <LoginForm />
        </Suspense>
      </section>

      {/* Ambient operational signals — right column, lower row. */}
      <section className="order-3 flex justify-center px-6 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-4 sm:px-8 lg:order-none lg:col-start-2 lg:row-start-2 lg:items-start lg:px-10 lg:pb-14 lg:pt-6">
        <div
          className="login-rise login-parallax w-full max-w-sm"
          data-parallax="6"
          style={{ animationDelay: '760ms' }}
        >
          <AmbientSignals arabicClassName={arabic.className} className="w-full" />
        </div>
      </section>
    </main>
  );
}
