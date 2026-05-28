'use client';

import { useState } from 'react';
import { UploadCloud, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EventCreateForm } from './event-create-form';
import { MastersheetCreateFlow } from './mastersheet-create-flow';

type View = 'choice' | 'manual' | 'mastersheet';

/**
 * Entry-point choice screen for creating a new event.
 * Manages which view is active: the two-card choice, the full manual form,
 * or the mastersheet upload flow.
 */
export function NewEventChoice() {
  const [view, setView] = useState<View>('choice');

  if (view === 'manual') {
    return <EventCreateForm onBack={() => setView('choice')} />;
  }

  if (view === 'mastersheet') {
    return <MastersheetCreateFlow onBack={() => setView('choice')} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-8 py-16">
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-semibold">Create event</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          How would you like to set up your event?
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Card: Upload mastersheet */}
        <div className="flex flex-col items-start gap-4 rounded-xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <UploadCloud className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="font-semibold">Upload mastersheet</h2>
            <p className="text-sm text-muted-foreground">
              Upload your Excel mastersheet and we&apos;ll configure the event automatically.
            </p>
          </div>
          <Button className="w-full" onClick={() => setView('mastersheet')}>
            Upload mastersheet
          </Button>
        </div>

        {/* Card: Fill in manually */}
        <div className="flex flex-col items-start gap-4 rounded-xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Pencil className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="font-semibold">Fill in manually</h2>
            <p className="text-sm text-muted-foreground">
              Enter event details one by one using the setup form.
            </p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => setView('manual')}>
            Fill in manually
          </Button>
        </div>
      </div>
    </div>
  );
}
