'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { sendHumanReply } from '../actions';

interface HumanReplyFormProps {
  eventId: string;
  conversationId: string;
  /** 'whatsapp' | 'simulator' | 'email' */
  channel: string;
}

export function HumanReplyForm({
  eventId,
  conversationId,
  channel,
}: HumanReplyFormProps) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || isPending) return;

    setStatus('idle');
    startTransition(async () => {
      const result = await sendHumanReply(eventId, conversationId, text);
      if (result.success) {
        setStatus('success');
        setText('');
        router.refresh();
      } else {
        setStatus('error');
        setErrorMsg(result.error ?? 'An unexpected error occurred.');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (status !== 'idle') setStatus('idle');
        }}
        placeholder="Type your reply to the customer…"
        rows={4}
        disabled={isPending}
        className="w-full resize-y rounded-md border bg-background px-3 py-2.5 text-sm
                   placeholder:text-muted-foreground focus:outline-none focus:ring-2
                   focus:ring-ring disabled:opacity-50"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {channel === 'whatsapp'
            ? 'Will be delivered to the customer via WhatsApp and logged here.'
            : 'Will be logged in the conversation. Customer is not on WhatsApp.'}
        </p>
        <Button
          type="submit"
          size="sm"
          disabled={isPending || !text.trim()}
          className="gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          {isPending ? 'Sending…' : 'Send reply'}
        </Button>
      </div>

      {status === 'success' && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          ✓ Reply sent to customer.
        </p>
      )}
      {status === 'error' && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {errorMsg}
        </p>
      )}
    </form>
  );
}
