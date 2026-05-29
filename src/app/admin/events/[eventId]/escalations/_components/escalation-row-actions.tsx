'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Check, Hand, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AddToKbModal } from '@/components/add-to-kb-modal';

import {
  claimEscalation,
  reopenEscalation,
  resolveEscalation,
} from '../actions';

interface EscalationRowActionsProps {
  eventId: string;
  escalationId: string;
  status: 'open' | 'claimed' | 'resolved' | 'reopened';
  /** Summary used as the pre-filled title in the Add to KB modal. */
  summary: string;
}

export function EscalationRowActions({
  eventId,
  escalationId,
  status,
  summary,
}: EscalationRowActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handle(
    fn: (eventId: string, id: string) => Promise<{ error?: string }>,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await fn(eventId, escalationId);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {(status === 'open' || status === 'reopened') && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => handle(claimEscalation)}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <Hand className="h-3 w-3" />
              Claim
            </Button>
            <Button
              size="sm"
              variant="default"
              disabled={isPending}
              onClick={() => handle(resolveEscalation)}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <Check className="h-3 w-3" />
              Resolve
            </Button>
          </>
        )}
        {status === 'claimed' && (
          <Button
            size="sm"
            variant="default"
            disabled={isPending}
            onClick={() => handle(resolveEscalation)}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <Check className="h-3 w-3" />
            Resolve
          </Button>
        )}
        {status === 'resolved' && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => handle(reopenEscalation)}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <RotateCcw className="h-3 w-3" />
            Reopen
          </Button>
        )}
        {/* Add to KB available on every row so the operator can document
            the correct answer regardless of whether it's been resolved yet. */}
        <AddToKbModal
          eventId={eventId}
          defaultTitle={summary}
          triggerClassName="h-7 gap-1 px-2 text-[11px]"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive max-w-xs"
        >
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}
    </div>
  );
}
