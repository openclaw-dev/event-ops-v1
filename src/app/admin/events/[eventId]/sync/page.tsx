import { notFound } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';
import { findPendingByEvent, type PendingChange } from '@/lib/data-entry/pending-changes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { UploadTab } from './_components/upload-tab';
import { HistoryTab, type ChangeEventRow } from './_components/history-tab';
import { PendingTab } from './_components/pending-tab';

interface SyncPageProps {
  params: { eventId: string };
}

export default async function SyncPage({ params }: SyncPageProps) {
  const supabase = createServerClient();

  // Verify event access (RLS).
  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();

  if (!event) notFound();

  // Fetch change history for this event.
  const { data: rawChangeEvents } = await supabase
    .from('change_events')
    .select(
      'id, changed_by, channel, fields_changed, kb_sections_updated, confirmed_at',
    )
    .eq('event_id', params.eventId)
    .order('confirmed_at', { ascending: false })
    .limit(100);

  const changeEvents: ChangeEventRow[] = (rawChangeEvents ?? []).map((row) => ({
    id: row.id as string,
    changed_by: row.changed_by as string,
    channel: row.channel as ChangeEventRow['channel'],
    fields_changed: (row.fields_changed as string[]) ?? [],
    kb_sections_updated: (row.kb_sections_updated as string[]) ?? [],
    confirmed_at: row.confirmed_at as string,
  }));

  // Fetch pending WhatsApp changes (admin client inside findPendingByEvent).
  let pendingChanges: PendingChange[] = [];
  try {
    pendingChanges = await findPendingByEvent(params.eventId, 25, 0);
  } catch {
    // Non-fatal — degrade to empty tab rather than crashing the page.
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-8 py-8">
      <div>
        <h2 className="text-base font-semibold">Data sync</h2>
        <p className="text-sm text-muted-foreground">
          Upload a mastersheet to map and sync event data. All changes are recorded below.
        </p>
      </div>

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>

          <TabsTrigger value="pending" className="gap-1.5">
            Pending
            {pendingChanges.length > 0 && (
              <Badge
                variant="outline"
                className="h-4 px-1 py-0 text-[10px] leading-none"
              >
                {pendingChanges.length}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger value="history" className="gap-1.5">
            Change History
            {changeEvents.length > 0 && (
              <span className="rounded-full bg-muted-foreground/20 px-1.5 py-0.5 text-xs">
                {changeEvents.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-4">
          <UploadTab eventId={params.eventId} />
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          <PendingTab eventId={params.eventId} initialPendingChanges={pendingChanges} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab rows={changeEvents} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
