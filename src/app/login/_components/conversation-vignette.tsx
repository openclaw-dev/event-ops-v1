'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The signature moment: an ambient, looping WhatsApp-style support exchange.
 * Three scripted Q&As (EN / AR-RTL / RU) cycle slowly — fan asks, agent shows a
 * typing indicator, then the reply materialises. No green branding, no phone
 * chrome; a minimal abstracted fragment on warm paper.
 *
 * All content is illustrative product demonstration — no real customer data.
 * Motion is fully disabled under prefers-reduced-motion (a single static
 * exchange is shown instead), and the loop pauses when scrolled off-screen.
 */

type Exchange = {
  lang: 'en' | 'ar' | 'ru';
  dir: 'ltr' | 'rtl';
  fan: string;
  reply: string;
};

const EXCHANGES: Exchange[] = [
  {
    lang: 'en',
    dir: 'ltr',
    fan: 'What time do doors open on Friday?',
    reply: 'Doors open at 7 PM, main act on at 9. Gates close 8:30 — arrive early to skip the queue.',
  },
  {
    lang: 'ar',
    dir: 'rtl',
    fan: 'هل يمكنني تحويل تذكرتي إلى صديق؟',
    reply: 'بالطبع — أرسل لي اسم صديقك ورقم هاتفه وسأحوّل التذكرة إليه خلال دقائق.',
  },
  {
    lang: 'ru',
    dir: 'ltr',
    fan: 'Хочу вернуть билет — не смогу прийти.',
    reply: 'Вместо возврата могу предложить VIP-апгрейд или кредит на следующий концерт. Оформить?',
  },
];

type Stage = 'fan' | 'typing' | 'reply' | 'out';
const ORDER: Stage[] = ['fan', 'typing', 'reply', 'out'];
// Slow, calm pacing — each full exchange runs ~8.7s.
const DURATION: Record<Stage, number> = { fan: 1600, typing: 1900, reply: 4500, out: 700 };

export function ConversationVignette({
  arabicClassName,
  className,
}: {
  arabicClassName: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>('fan');
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLElement>(null);

  // Honour the OS reduced-motion preference: no loop, one static exchange.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Pause the loop while off-screen — saves CPU on mobile scroll.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The state machine. One timer at a time; cleaned up on every transition.
  useEffect(() => {
    if (reduced || !visible) return;
    const timer = setTimeout(() => {
      setStage((current) => {
        if (current === 'out') {
          setIndex((i) => (i + 1) % EXCHANGES.length);
          return 'fan';
        }
        return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      });
    }, DURATION[stage]);
    return () => clearTimeout(timer);
  }, [stage, index, reduced, visible]);

  const ex = EXCHANGES[index];
  // Reduced motion: show the first exchange, fully resolved, no typing.
  const showFan = reduced ? true : stage !== 'out';
  const showTyping = reduced ? false : stage === 'typing';
  const showReply = reduced ? true : stage === 'reply';

  const isArabic = ex.lang === 'ar';
  const bodyDir = ex.dir;
  const textClass = isArabic ? `${arabicClassName} leading-relaxed` : 'leading-relaxed';

  return (
    <figure
      ref={rootRef}
      className={`relative m-0 ${className ?? ''}`}
      aria-label="Product demonstration — a sample WhatsApp support conversation the agent handles automatically"
    >
      <figcaption className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        <span className="inline-block h-1 w-1 rounded-full bg-foreground/50" aria-hidden />
        Product demonstration
      </figcaption>

      {/* The fragment. Fixed height so cycling messages never reflow the page. */}
      <div
        aria-hidden
        className="relative h-[212px] overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-4 shadow-[0_1px_2px_rgba(28,27,23,0.03),0_10px_30px_-18px_rgba(28,27,23,0.18)] sm:h-[204px]"
      >
        {/* Fan — incoming, top-left */}
        <div
          className={`absolute left-4 top-4 max-w-[82%] transition-all duration-500 ease-out ${
            showFan ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
          }`}
        >
          <div
            dir={bodyDir}
            className={`rounded-2xl rounded-tl-md border border-border bg-background px-3.5 py-2 text-sm text-foreground shadow-sm ${textClass}`}
          >
            {ex.fan}
          </div>
        </div>

        {/* Agent — outgoing, bottom-right. Typing indicator and reply share the slot. */}
        <div className="absolute inset-x-4 bottom-4 flex flex-col items-end">
          <p
            className={`mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-opacity duration-300 ${
              showTyping || showReply ? 'opacity-100' : 'opacity-0'
            }`}
          >
            tazkar
          </p>

          {/* Typing indicator (crossfades with the reply in the same corner) */}
          <div
            className={`absolute bottom-0 right-0 transition-opacity duration-300 ${
              showTyping ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="flex items-center gap-1 rounded-2xl rounded-br-md bg-primary px-3.5 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="login-typing-dot h-1.5 w-1.5 rounded-full bg-primary-foreground/70"
                  style={{ animationDelay: `${i * 160}ms` }}
                />
              ))}
            </div>
          </div>

          {/* Reply */}
          <div
            className={`max-w-[86%] transition-all duration-500 ease-out ${
              showReply ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
            }`}
          >
            <div
              dir={bodyDir}
              className={`rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm ${textClass}`}
            >
              {ex.reply}
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
