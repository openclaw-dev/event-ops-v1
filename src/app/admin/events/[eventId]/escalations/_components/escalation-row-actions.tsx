'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Hand, RotateCcw } from 'lucide-react';

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
  const router = useRouter();

  function handle(
    fn: (eventId: string, id: string) => Promise<{ error?: string }>,
  ) {
    startTransition(async () => {
      const result = await fn(eventId, escalationId);
      if (result.error) {
        alert(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
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
  );
}
