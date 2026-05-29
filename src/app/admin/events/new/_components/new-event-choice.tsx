'use client';

import { useState, useTransition } from 'react';
import { UploadCloud, Pencil, Sparkles, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EventCreateForm } from './event-create-form';
import { MastersheetCreateFlow } from './mastersheet-create-flow';
import { createDemoEvent } from '../actions';

type View = 'choice' | 'manual' | 'mastersheet';

/**
 * Entry-point choice screen for creating a new event.
 * Manages which view is active: the two-card choice, the full manual form,
 * or the mastersheet upload flow.
 */
export function NewEventChoice() {
  const [view, setView] = useState<View>('choice');
  const [demoError, setDemoError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (view === 'manual') {
    return <EventCreateForm onBack={() => setView('choice')} />;
  }

  if (view === 'mastersheet') {
    return <MastersheetCreateFlow onBack={() => setView('choice')} />;
  }

  function handleCreateDemo() {
    setDemoError(null);
    startTransition(async () => {
      const result = await createDemoEvent();
      if (result?.error) {
        setDemoError(result.error);
      }
      // On success, createDemoEvent() calls redirect() server-side → client navigates.
    });
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

      {/* Card: Create demo event — full width below */}
      <div className="mt-4 flex flex-col items-start gap-4 rounded-xl border border-violet-200 bg-violet-50/50 p-6 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex w-full items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100">
            <Sparkles className="h-5 w-5 text-violet-600" />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="font-semibold text-violet-900">Create demo event</h2>
            <p className="text-sm text-muted-foreground">
              Instantly create a fully configured demo event with sample KB, 20 orders, and 5
              conversations. Perfect for exploring the product.
            </p>
          </div>
        </div>

        <Button
          className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
          onClick={handleCreateDemo}
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Setting up your demo event…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Create demo
            </>
          )}
        </Button>

        {demoError && (
          <p className="text-sm text-destructive">{demoError}</p>
        )}
      </div>
    </div>
  );
}
