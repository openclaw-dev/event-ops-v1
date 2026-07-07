import type { Metadata } from 'next';
import Link from 'next/link';

import { DemoCard } from './_components/demo-card';

export const metadata: Metadata = {
  title: 'tazkar — recover the revenue your events leak',
  description:
    'Failed payments recovered over WhatsApp. Refund requests turned into transfers, credits, and upgrades. Every fan answered in Arabic and English, day and night. You pay only on recovered revenue.',
};

// Public marketing landing. No auth required (middleware only guards /admin
// and /login). Static — the only motion lives inside <DemoCard />.
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-8">
        <Link href="/" className="flex items-baseline gap-2" aria-label="tazkar home">
          <span className="font-serif text-xl tracking-tight text-foreground">tazkar</span>
          <span dir="rtl" lang="ar" className="font-arabic text-base text-muted-foreground">
            تذكرة
          </span>
        </Link>
        <Link
          href="/login"
          className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Operator sign in
        </Link>
      </header>

      {/* Hero */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-12 sm:px-8 lg:py-20">
        <div className="grid flex-1 items-center gap-12 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
          {/* Left — message */}
          <div className="max-w-xl">
            <h1 className="font-serif text-[2.6rem] font-normal leading-[1.06] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.65rem]">
              Your last event <span className="italic">leaked money</span>.
              <br />
              tazkar gets it back.
            </h1>

            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
              Failed payments recovered over WhatsApp. Refund requests turned into transfers,
              credits, and upgrades. Every fan answered in Arabic and English, day and night. You
              pay only on recovered revenue.
            </p>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
              <a
                href="mailto:hello@tazkar.co?subject=Revenue%20leak%20audit"
                className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md sm:w-auto"
              >
                Get a free revenue leak audit
              </a>
              <p className="max-w-[30ch] text-xs leading-relaxed text-muted-foreground">
                Send one event export. We show the leak in SAR within 12&nbsp;hours.
              </p>
            </div>
          </div>

          {/* Right — demo card */}
          <div className="flex justify-center lg:justify-end">
            <DemoCard />
          </div>
        </div>
      </main>

      {/* Footer capability strip */}
      <footer className="mx-auto w-full max-w-6xl px-6 pb-10 pt-4 sm:px-8">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Payment recovery
          <span className="mx-2.5 text-border">·</span>
          Refund deflection
          <span className="mx-2.5 text-border">·</span>
          WhatsApp-native support
        </p>
      </footer>
    </div>
  );
}
