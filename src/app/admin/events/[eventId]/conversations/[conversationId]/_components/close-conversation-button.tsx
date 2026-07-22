'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { closeConversation } from '../actions';

interface CloseConversationButtonProps {
  eventId: string;
  conversationId: string;
}

export function CloseConversationButton({
  eventId,
  conversationId,
}: CloseConversationButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleClose() {
    setError(null);
    startTransition(async () => {
      const result = await closeConversation(eventId, conversationId);
      if (result.success) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error ?? 'Failed to close conversation.');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={isPending}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Close conversation
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              Marks the conversation resolved without sending the customer a message.
              The transcript stays available and it can be reopened by the customer
              messaging again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleClose();
              }}
              disabled={isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Closing…
                </>
              ) : (
                'Close conversation'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
