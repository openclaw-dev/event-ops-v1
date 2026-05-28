'use client';

import { useState, useTransition } from 'react';
import { Loader2, Radio } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { publishEvent } from '../actions';

interface PublishButtonProps {
  eventId: string;
}

export function PublishButton({ eventId }: PublishButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePublish() {
    setError(null);
    startTransition(async () => {
      const result = await publishEvent(eventId);
      if (result?.error) {
        setError(result.error);
      }
      // On success the page re-renders via revalidatePath and this component unmounts.
    });
  }

  return (
    <div className="space-y-2">
      <Button
        onClick={handlePublish}
        disabled={isPending}
        className="gap-2 bg-green-600 hover:bg-green-700 text-white"
        size="sm"
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Radio className="h-3.5 w-3.5" />
        )}
        Publish event
      </Button>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
