'use client';

import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EventSetupForm } from '../../_components/event-setup-form';
import { createEvent } from '../actions';

interface EventCreateFormProps {
  onBack: () => void;
}

/**
 * Thin wrapper that renders the full event setup form in "create" mode.
 * onBack() returns the user to the entry-point choice screen.
 */
export function EventCreateForm({ onBack }: EventCreateFormProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-8">
      <div className="mb-8">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-4 gap-1.5 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-semibold">Create event</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fill in the details below. You can always edit them later from the Setup tab.
        </p>
      </div>

      <EventSetupForm
        onSubmit={createEvent}
        submitLabel="Create event"
        cancelHref="/admin/events"
      />
    </div>
  );
}
