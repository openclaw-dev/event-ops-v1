'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Demo conversation card for the marketing landing.
 *
 * On first view (IntersectionObserver) the exchange reveals in sequence:
 * customer message → typing indicator (~900ms) → agent reply → outcome row.
 * Runs once. Under prefers-reduced-motion everything renders immediately with
 * no animation. This is the only motion on the page.
 *
 * Presentation only — no data, no network.
 */

const CUSTOMER_AR = 'السلام عليكم، ما أقدر أحضر الحفلة، أبغى أسترجع قيمة التذاكر';
const CUSTOMER_EN = "Hi, I can't make the show anymore, I'd like a refund.";
const AGENT_AR =
  'أهلاً بك! نقدر نحوّل تذاكرك لأي شخص تختاره مجاناً، أو نعطيك رصيداً للفعالية القادمة مع ترقية. أي خيار يناسبك؟';
const AGENT_EN =
  'We can transfer your tickets to anyone you choose for free, or credit you toward the next event with an upgrade. Which works for you?';

// Stage: 0 none · 1 customer · 2 typing · 3 agent · 4 outcome
export function DemoCard() {
  const [stage, setStage] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setStage(4);
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    const start = () => {
      if (started.current) return;
      started.current = true;
      setStage(1);
      timers.push(setTimeout(() => setStage(2), 550));
      timers.push(setTimeout(() => setStage(3), 1450));
      timers.push(setTimeout(() => setStage(4), 2050));
    };

    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      start();
      return () => timers.forEach(clearTimeout);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) start();
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(28,27,23,0.04),0_14px_40px_-20px_rgba(28,27,23,0.22)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-foreground/75">
          Refund deflection
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          Demo event
        </span>
      </div>

      {/* Chat */}
      <div className="flex min-h-[304px] flex-col gap-4 bg-[#F1EAE0] px-4 py-5">
        {stage >= 1 && (
          <div className="chat-enter flex max-w-[86%] flex-col items-start gap-1.5 self-start">
            <div
              dir="rtl"
              lang="ar"
              className="rounded-2xl rounded-tl-sm border border-border bg-white px-3.5 py-2.5 text-right font-arabic text-[15px] leading-relaxed text-foreground"
            >
              {CUSTOMER_AR}
            </div>
            <p dir="ltr" className="px-1 text-xs leading-snug text-muted-foreground">
              {CUSTOMER_EN}
            </p>
          </div>
        )}

        {stage === 2 && (
          <div className="chat-enter self-end">
            <div className="flex items-center gap-1 rounded-2xl rounded-tr-sm bg-[#E4F4E9] px-4 py-3.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="chat-dot h-1.5 w-1.5 rounded-full bg-[#1E7F4F]/60"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {stage >= 3 && (
          <div className="chat-enter flex max-w-[88%] flex-col items-end gap-1.5 self-end">
            <div
              dir="rtl"
              lang="ar"
              className="rounded-2xl rounded-tr-sm bg-[#E4F4E9] px-3.5 py-2.5 text-right font-arabic text-[15px] leading-relaxed text-foreground"
            >
              {AGENT_AR}
            </div>
            <p dir="ltr" className="px-1 text-right text-xs leading-snug text-muted-foreground">
              {AGENT_EN}
            </p>
          </div>
        )}
      </div>

      {/* Outcome */}
      {stage >= 4 && (
        <div className="chat-enter flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            Outcome
          </span>
          <span className="text-sm font-medium text-[#1E7F4F]">
            Refund avoided · tickets transferred
          </span>
        </div>
      )}
    </div>
  );
}
