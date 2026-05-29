'use client';

import { useState, useTransition } from 'react';
import { Loader2, Square } from 'lucide-react';

import { Button, buttonVariants } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { endEvent } from '../actions';

interface EndEventButtonProps {
  eventId: string;
}

export function EndEventButton({ eventId }: EndEventButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await endEvent(eventId);
      if (result?.error) {
        setError(result.error);
        setOpen(false);
      }
      // On success the page re-renders via revalidatePath.
    });
  }

  return (
    <div className="space-y-1">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            disabled={isPending}
            variant="outline"
            size="sm"
            className="gap-2 border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            End event
          </Button>
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this event?</AlertDialogTitle>
            <AlertDialogDescription>
              The support agent will stop serving customers immediately. This
              cannot be undone without republishing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep live</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Prevent radix from auto-closing before the transition completes.
                e.preventDefault();
                handleConfirm();
              }}
              disabled={isPending}
              className={cn(buttonVariants({ variant: 'destructive' }))}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Ending…
                </>
              ) : (
                'End event'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
