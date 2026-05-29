'use client';

import { useState, useTransition } from 'react';
import { Loader2, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { endEvent } from '../actions';

interface EndEventButtonProps {
  eventId: string;
}

export function EndEventButton({ eventId }: EndEventButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEnd() {
    setError(null);
    startTransition(async () => {
      const result = await endEvent(eventId);
      if (result?.error) {
        setError(result.error);
      }
      // On success the page re-renders via revalidatePath.
    });
  }

  return (
    <div className="space-y-1">
      <Button
        onClick={handleEnd}
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
