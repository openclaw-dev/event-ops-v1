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
      <div className="login-card rounded-2xl bg-[#171310]/55 p-8 shadow-[0_2px_10px_rgba(0,0,0,0.4),0_40px_90px_-40px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(237,230,216,0.06)] backdrop-blur-2xl transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_2px_10px_rgba(0,0,0,0.4),0_54px_110px_-44px_rgba(0,0,0,0.95),0_0_60px_-24px_rgba(224,166,89,0.18),inset_0_1px_0_rgba(237,230,216,0.09)]">
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
                Enter your email and we&apos;ll send a magic link.
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

function Hero() {
  return (
    <div className="relative flex min-h-[86vh] flex-col overflow-hidden px-6 pb-16 pt-24 sm:px-8 lg:min-h-screen lg:px-16 lg:pb-[13vh] lg:pt-14">
      {/* Ghosted Arabic watermark — a faint glowing mark, high in the empty
          negative space; parallax handled by the wrapping layer. */}
      <div
        aria-hidden
        className="login-parallax-lg pointer-events-none absolute -right-[18%] -top-[16%] -z-[1] hidden lg:block"
      >
        <div
          lang="ar"
          dir="rtl"
          className={`${arabic.className} login-ghost select-none whitespace-nowrap font-bold leading-none text-[#e9ddc8]/[0.05] [text-shadow:0_0_60px_rgba(224,166,89,0.10)]`}
          style={{ fontSize: 'clamp(11rem, 17vw, 19rem)' }}
        >
          تذكرة
        </div>
      </div>

      {/* Content is anchored to the lower-left, leaving deliberate negative
          space above — editorial composition, not a centred block. */}
      <div className="login-parallax-sm relative z-10 mt-auto max-w-xl">
        <h1 className="font-serif text-[2.75rem] font-normal leading-[0.98] tracking-[-0.025em] text-[#f4efe4] [filter:drop-shadow(0_2px_28px_rgba(224,166,89,0.12))] sm:text-6xl lg:text-[4.6rem]">
          <span className="login-line">
            <span className="login-line-inner" style={{ animationDelay: '200ms' }}>
              Recover failed payments.
            </span>
          </span>
          <span className="login-line">
            <span className="login-line-inner" style={{ animationDelay: '320ms' }}>
              Deflect refunds.
            </span>
          </span>
          <span className="login-line">
            <span
              className="login-line-inner italic text-[#f0e6d4]"
              style={{ animationDelay: '460ms' }}
            >
              Support every fan.
            </span>
          </span>
        </h1>
        <p
          className="login-rise mt-7 max-w-md text-base leading-relaxed text-[#ede6d8]/60"
          style={{ animationDelay: '660ms' }}
        >
          An AI operations agent that lives on WhatsApp. Fluent in Arabic, English, and Russian,
          working every conversation your team can&apos;t reach.
        </p>

        {/* Capabilities as a quiet editorial line, not feature pills. */}
        <p
          className="login-rise mt-9 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-medium uppercase tracking-[0.26em] text-[#ede6d8]/40"
          style={{ animationDelay: '780ms' }}
        >
          {CAPABILITIES.map((label, i) => (
            <span key={label} className="inline-flex items-center gap-x-3">
              {i > 0 && <span className="text-[#e0a659]/45">/</span>}
              {label}
            </span>
          ))}
        </p>
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
      className="relative isolate flex min-h-screen w-full flex-col bg-[#0b0908] text-[#ede6d8] lg:grid lg:grid-cols-[1.15fr_0.85fr]"
    >
      {/* Living cinematic atmosphere behind everything, one continuous
          environment (no dividing chrome). */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <CinematicBackground className="absolute inset-0" />
        <AtmosphereOverlays />
      </div>

      {/* Hero — left column; content anchored lower-left with negative space. */}
      <section className="order-1 lg:order-none lg:col-start-1">
        <Hero />
      </section>

      {/* Right column: sign-in card seated high, ambient signals below it —
          an editorial diagonal against the hero's low-left anchor. On mobile it
          simply follows the hero (hero → card → signals). */}
      <section className="order-2 flex flex-col px-6 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-2 sm:px-8 lg:order-none lg:col-start-2 lg:h-screen lg:justify-start lg:gap-14 lg:px-12 lg:pb-10 lg:pt-[14vh]">
        <div className="flex justify-center lg:justify-start">
          <Suspense
            fallback={
              <div className="h-72 w-full max-w-sm animate-pulse rounded-2xl bg-[#ede6d8]/5" />
            }
          >
            <LoginForm />
          </Suspense>
        </div>
        <div className="mt-10 flex justify-center lg:mt-0 lg:justify-start">
          <div className="login-parallax-sm w-full max-w-sm">
            <div className="login-rise" style={{ animationDelay: '820ms' }}>
              <AmbientSignals arabicClassName={arabic.className} className="w-full" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
