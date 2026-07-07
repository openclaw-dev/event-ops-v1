'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { ArrowRight, Loader2, MailCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
});

type FormData = z.infer<typeof schema>;

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
      <div className="rounded-xl border border-border bg-card p-8 shadow-[0_1px_2px_rgba(28,27,23,0.04),0_14px_40px_-20px_rgba(28,27,23,0.2)]">
        {sent ? (
          <div className="space-y-4 text-center">
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <MailCheck className="h-5 w-5" />
            </span>
            <div className="space-y-1.5">
              <h1 className="font-serif text-2xl leading-tight text-foreground">Check your inbox</h1>
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
              <h1 className="font-serif text-3xl leading-none tracking-tight text-foreground">
                Sign in
              </h1>
              <p className="text-sm text-muted-foreground">
                Enter your email and we&apos;ll send a magic link.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="group space-y-1.5">
                <Label
                  htmlFor="email"
                  className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors group-focus-within:text-foreground"
                >
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  className="h-11 bg-background transition-shadow duration-200 focus-visible:ring-2"
                  {...register('email')}
                  aria-invalid={!!errors.email}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              {serverError && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive"
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
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center px-6 py-6 sm:px-8">
        <Link href="/" className="flex items-baseline gap-2" aria-label="tazkar home">
          <span className="font-serif text-xl tracking-tight text-foreground">tazkar</span>
          <span dir="rtl" lang="ar" className="font-arabic text-base text-muted-foreground">
            تذكرة
          </span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-24 pt-4 sm:px-8">
        <Suspense
          fallback={<div className="h-72 w-full max-w-sm animate-pulse rounded-xl bg-muted" />}
        >
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
