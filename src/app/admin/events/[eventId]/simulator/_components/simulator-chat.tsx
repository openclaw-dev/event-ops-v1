'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Send, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const STATE_LABELS: Record<string, string> = {
  greeting: 'Greeting',
  faq_answer: 'FAQ',
  order_lookup: 'Order lookup',
  refund_deflection: 'Refund deflection',
  escalation_triggered: 'Escalated',
  session_closed: 'Closed',
};

const STATE_COLORS: Record<string, string> = {
  greeting:              'bg-slate-50 text-slate-700 border-slate-200',
  faq_answer:            'bg-emerald-50 text-emerald-700 border-emerald-200',
  order_lookup:          'bg-amber-50 text-amber-700 border-amber-200',
  refund_deflection:     'bg-blue-50 text-blue-700 border-blue-200',
  escalation_triggered:  'bg-red-50 text-red-700 border-red-200',
  session_closed:        'bg-zinc-100 text-zinc-700 border-zinc-200',
};

interface KBSectionInfo {
  section_id: string;
  question_en: string | null;
  answer_en: string;
}

interface SamplePhone {
  phone: string;
  customer_name: string | null;
  order_id: string;
  vip_flag: boolean;
}

interface ChatMessage {
  role: 'user' | 'agent';
  text: string;
  classified_intent?: string | null;
  cited_section_ids?: string[];
  escalated?: boolean;
  escalation_reason?: string | null;
  deflection_offer?: string | null;
}

interface SimulatorChatProps {
  eventId: string;
  sampleSections: KBSectionInfo[];
  samplePhones: SamplePhone[];
}

const DEFAULT_PHONE = '+971500000000';

export function SimulatorChat({
  eventId,
  sampleSections,
  samplePhones,
}: SimulatorChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string>(samplePhones[0]?.phone ?? DEFAULT_PHONE);
  const [state, setState] = useState<string>('greeting');
  const [language, setLanguage] = useState<string>('en');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);
  const sectionLookup = new Map(sampleSections.map((s) => [s.section_id, s]));

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending) return;
    setError(null);
    setSending(true);

    const userMsg: ChatMessage = { role: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setDraft('');

    try {
      const res = await fetch('/api/simulator/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          session_id: sessionId,
          message: text,
          customer_phone_e164: phone,
          language_hint: language,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status}).`);
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      setSessionId(data.session_id);
      setState(data.state);
      setLanguage(data.language ?? language);
      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          text: data.response,
          classified_intent: data.classified_intent,
          cited_section_ids: data.kb_cited ?? [],
          escalated: data.escalated,
          escalation_reason: data.escalation_reason,
          deflection_offer: data.deflection_offer,
        },
      ]);
    } catch {
      setError('Network error — please try again.');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  function resetSession() {
    setMessages([]);
    setSessionId(null);
    setState('greeting');
    setError(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
      {/* Chat column */}
      <div className="flex h-[640px] flex-col rounded-lg border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                STATE_COLORS[state] ?? STATE_COLORS.greeting,
              )}
            >
              {STATE_LABELS[state] ?? state}
            </span>
            {state === 'escalation_triggered' && (
              <span className="inline-flex items-center gap-1 text-xs text-red-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                Escalated to human
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {sessionId ? `Session ${sessionId.slice(0, 8)}…` : 'New session'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetSession}
            className="gap-1 text-xs"
            disabled={sending}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New session
          </Button>
        </div>

        {/* Thread */}
        <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && !sending && (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              Send a message as a simulated customer to begin.
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} sectionLookup={sectionLookup} />
          ))}

          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground/40" />
              Agent is thinking…
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t px-4 py-3">
          {error && (
            <div className="mb-2 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Type a customer message…"
              rows={2}
              className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={sending || state === 'escalation_triggered'}
            />
            <Button onClick={sendMessage} disabled={sending || !draft.trim()} className="gap-1">
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Enter to send · Shift+Enter for newline. The agent runs on Haiku 4.5 (classify) + Sonnet 4.6 (generate).
          </p>
        </div>
      </div>

      {/* Side panel */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Simulated customer
          </h3>
          <label className="mb-1 block text-xs text-muted-foreground">Phone (E.164)</label>
          <select
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={messages.length > 0}
            className="mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value={DEFAULT_PHONE}>Anonymous ({DEFAULT_PHONE})</option>
            {samplePhones.map((p) => (
              <option key={`${p.order_id}-${p.phone}`} value={p.phone}>
                {p.customer_name ?? 'Unknown'} — {p.phone}
                {p.vip_flag ? ' ★' : ''} ({p.order_id})
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Customer locked for this session. Click &ldquo;New session&rdquo; to change.
            </p>
          )}

          <label className="mb-1 mt-3 block text-xs text-muted-foreground">Language hint</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="en">English</option>
            <option value="ar">Arabic</option>
            <option value="ru">Russian</option>
            <option value="mixed">Mixed</option>
          </select>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Hint only — the classifier detects the actual language per turn.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Try these
          </h3>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li><kbd className="rounded bg-muted px-1 py-0.5">what time do gates open?</kbd></li>
            <li><kbd className="rounded bg-muted px-1 py-0.5">is there parking?</kbd></li>
            <li><kbd className="rounded bg-muted px-1 py-0.5">i need a refund</kbd></li>
            <li><kbd className="rounded bg-muted px-1 py-0.5">my mother is in the hospital</kbd></li>
            <li dir="rtl"><kbd className="rounded bg-muted px-1 py-0.5">كم الساعة تفتح البوابات؟</kbd></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  sectionLookup,
}: {
  message: ChatMessage;
  sectionLookup: Map<string, KBSectionInfo>;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] space-y-2 rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : message.escalated
            ? 'bg-red-50 text-red-900'
            : 'bg-muted text-foreground',
        )}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>

        {!isUser && (message.classified_intent || message.escalated) && (
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            {message.classified_intent && (
              <span className="rounded bg-background/60 px-1.5 py-0.5 font-mono">
                {message.classified_intent}
              </span>
            )}
            {message.escalated && message.escalation_reason && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-red-900">
                {message.escalation_reason}
              </span>
            )}
            {message.deflection_offer && (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-blue-900">
                offer: {message.deflection_offer}
              </span>
            )}
          </div>
        )}

        {!isUser && message.cited_section_ids && message.cited_section_ids.length > 0 && (
          <CitationFootnotes
            ids={message.cited_section_ids}
            sectionLookup={sectionLookup}
          />
        )}
      </div>
    </div>
  );
}

// ─── CitationFootnotes ────────────────────────────────────────────────────────

function CitationFootnotes({
  ids,
  sectionLookup,
}: {
  ids: string[];
  sectionLookup: Map<string, KBSectionInfo>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {ids.length} citation{ids.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <ul className="space-y-1 border-l-2 border-muted-foreground/20 pl-2">
          {ids.map((id) => {
            const section = sectionLookup.get(id);
            return (
              <li key={id} className="text-[10px]">
                <span className="font-mono font-medium">{id}</span>
                {section && (
                  <span className="block text-muted-foreground">
                    {section.question_en ?? section.answer_en.slice(0, 120)}
                  </span>
                )}
                {!section && (
                  <span className="block italic text-red-700">
                    (not found in KB — fabrication risk)
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
