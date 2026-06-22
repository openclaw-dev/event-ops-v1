'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

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
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-5 w-5 text-primary" />
        </div>
        <CardTitle className="text-xl">Sign in to Event Ops</CardTitle>
        <CardDescription>Enter your email — we&apos;ll send a magic link.</CardDescription>
      </CardHeader>

      <CardContent>
        {sent ? (
          <div className="space-y-3 text-center">
            <p className="text-sm font-medium">Check your inbox</p>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to{' '}
              <span className="font-medium text-foreground">{sentEmail}</span>. The link expires
              in 60&nbsp;minutes.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-xs"
              onClick={() => {
                setSent(false);
                setServerError(null);
              }}
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                {...register('email')}
                aria-invalid={!!errors.email}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            {serverError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {serverError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// Page wraps the form in Suspense so Next.js 14 can statically render the shell.
export default function LoginPage() {
  return (
    <div className="dark animated-bg relative z-0 flex min-h-screen items-center justify-center p-4 text-foreground">
      <div className="relative z-[1]">
        <Suspense fallback={<div className="h-64 w-full max-w-sm animate-pulse rounded-lg bg-white/5" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
