'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Ambient operational signals — cinematic, not a dashboard.
 *
 * A single whispered "signal" floats in, holds, then drifts out and is replaced
 * by the next: multilingual WhatsApp support fragments (EN / AR-RTL / RU) and
 * capability status lines (payment recovery, refund deflection). A live pulse
 * and a rotating label give the sense of an intelligence quietly working in the
 * background. All content is illustrative product demonstration — no fabricated
 * metrics or live figures.
 *
 * Motion pauses off-screen and when the tab is hidden; prefers-reduced-motion
 * shows one static signal with no cycling.
 */

type Signal = {
  label: string;
  lang?: 'ar';
  text: string;
};

const SIGNALS: Signal[] = [
  { label: 'WhatsApp · EN', text: 'Doors open at 7 PM. Arrive early to skip the queue.' },
  { label: 'Payment recovery', text: 'Failed payment detected. Secure retry link sent.' },
  { label: 'WhatsApp · AR', lang: 'ar', text: 'بالطبع، سأحوّل تذكرتك إلى صديقك خلال دقائق.' },
  { label: 'Refund deflection', text: 'Refund request met with a VIP upgrade offer.' },
  { label: 'WhatsApp · RU', text: 'Вместо возврата, кредит на следующий концерт.' },
];

const HOLD = 4200;
const FADE = 720;

export function AmbientSignals({
  arabicClassName,
  className,
}: {
  arabicClassName: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced || !visible) return;
    // hold → fade out → swap → fade in
    const outAt = setTimeout(() => setShown(false), HOLD);
    const swapAt = setTimeout(() => {
      setIndex((i) => (i + 1) % SIGNALS.length);
      setShown(true);
    }, HOLD + FADE);
    return () => {
      clearTimeout(outAt);
      clearTimeout(swapAt);
    };
  }, [index, reduced, visible]);

  const sig = SIGNALS[index];
  const on = reduced ? true : shown;
  const isArabic = sig.lang === 'ar';

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`} aria-hidden>
      {/* Live indicator + rotating label */}
      <div className="mb-4 flex items-center gap-2.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="login-pulse absolute inline-flex h-full w-full rounded-full bg-[#d79a4e]" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#e0a659]" />
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.32em] text-[#ede6d8]/45">
          Agent · live
        </span>
      </div>

      {/* The signal — floats in/out. Left hairline instead of a card frame. */}
      <div className="relative min-h-[92px] border-l border-[#ede6d8]/12 pl-5">
        <div
          key={index}
          className={`transition-all duration-[820ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            on ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-2 opacity-0 blur-[2px]'
          }`}
        >
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[#e0a659]/70">
            {sig.label}
          </p>
          <p
            dir={isArabic ? 'rtl' : 'ltr'}
            className={`max-w-[34ch] font-serif text-lg leading-snug text-[#ede6d8]/90 sm:text-xl ${
              isArabic ? arabicClassName : ''
            }`}
          >
            {sig.text}
          </p>
        </div>
      </div>

      {/* Cycle indicator — a hairline that fills across each signal's lifetime. */}
      <div className="mt-5 ml-5 h-px w-full max-w-[30ch] overflow-hidden rounded-full bg-[#ede6d8]/8">
        <div
          key={index}
          className="login-progress h-full w-full bg-gradient-to-r from-[#e0a659]/55 to-[#e0a659]/5"
        />
      </div>
    </div>
  );
}
