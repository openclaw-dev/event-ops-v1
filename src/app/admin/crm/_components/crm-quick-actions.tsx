'use client';

import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Loader2, Send, Upload, Users, ShoppingBag, Megaphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventOption {
  id: string;
  name: string;
  start_date: string;
}

interface NoShowEntry {
  customer_phone_e164: string;
  customer_name: string;
  customer_email: string;
  ticket_type: string;
  order_id: string;
}

interface CsvRecipient {
  customer_phone_e164: string;
  customer_name?: string;
  customer_email?: string;
  source_order_id?: string;
  source_event_name?: string;
  segment?: string;
  _error?: string;
}

interface SendResult {
  sent: number;
  failed: number;
  campaign_id: string;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvRow(row: Record<string, string>): CsvRecipient {
  const phone = (row['phone'] ?? '').trim();
  if (!phone) {
    return {
      customer_phone_e164: '',
      _error: 'Missing phone',
    };
  }
  return {
    customer_phone_e164: phone,
    customer_name: (row['name'] ?? '').trim() || undefined,
    customer_email: (row['email'] ?? '').trim() || undefined,
    source_order_id: (row['order_id'] ?? '').trim() || undefined,
    source_event_name: (row['event_name'] ?? '').trim() || undefined,
    segment: (row['segment'] ?? '').trim() || undefined,
  };
}

// ─── Shared result banner ─────────────────────────────────────────────────────

function ResultBanner({ result }: { result: SendResult }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
      <span className="font-medium text-emerald-700">{result.sent} sent</span>
      {result.failed > 0 && (
        <span className="font-medium text-red-700">{result.failed} failed</span>
      )}
      <span className="ml-auto text-xs text-muted-foreground font-mono">
        Campaign {result.campaign_id.slice(0, 8)}
      </span>
    </div>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function CampaignCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Textarea helper ──────────────────────────────────────────────────────────

function TemplateTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        Message template
        <span className="ml-2 font-normal opacity-70">
          Use {'{{name}}'} for customer name, {'{{event}}'} for target event
        </span>
      </label>
      <textarea
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ─── No-show campaign card ────────────────────────────────────────────────────

const NO_SHOW_TEMPLATE = `Hi {{name}}! 👋 We missed you at the event.

{{event}} is coming up — as a past ticket holder you get early access.

🎟️ Get your tickets: [PASTE LINK HERE]

Reply STOP to opt out.`;

export function NoShowCard({ events }: { events: EventOption[] }) {
  const [selectedEventId, setSelectedEventId] = useState('');
  const [segment, setSegment] = useState<NoShowEntry[] | null>(null);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [template, setTemplate] = useState(NO_SHOW_TEMPLATE);
  const [targetEventName, setTargetEventName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const selectedEvent = events.find((e) => e.id === selectedEventId);

  async function handleEventChange(eventId: string) {
    setSelectedEventId(eventId);
    setSegment(null);
    setResult(null);
    if (!eventId) return;

    setSegmentLoading(true);
    try {
      const res = await fetch(`/api/crm/segments/no-shows?event_id=${eventId}`);
      const json = (await res.json()) as { count: number; segment: NoShowEntry[] };
      setSegment(json.segment);
    } catch {
      setSegment([]);
    } finally {
      setSegmentLoading(false);
    }
  }

  async function handleSend() {
    if (!segment || segment.length === 0 || !selectedEvent) return;

    setIsSending(true);
    setResult(null);

    try {
      const res = await fetch('/api/crm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `No-show re-marketing — ${selectedEvent.name}`,
          campaign_type: 'no_show_remarket',
          message_template: template,
          event_id: selectedEventId,
          send_immediately: true,
          recipients: segment.map((s) => ({
            customer_phone_e164: s.customer_phone_e164,
            customer_name: s.customer_name || undefined,
            customer_email: s.customer_email || undefined,
            source_order_id: s.order_id,
            source_event_name: selectedEvent.name,
            segment: 'no_show',
          })),
        }),
      });

      const json = (await res.json()) as { campaign_id: string; sent: number; failed: number };
      setResult({ campaign_id: json.campaign_id, sent: json.sent ?? 0, failed: json.failed ?? 0 });
    } catch {
      setResult(null);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <CampaignCard
      icon={Users}
      title="Re-market no-shows"
      description="Send a message to customers who bought tickets but didn't attend. Auto-populated from order data."
    >
      {/* Event selector */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Past event</label>
        <select
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          value={selectedEventId}
          onChange={(e) => handleEventChange(e.target.value)}
        >
          <option value="">Select an event…</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.start_date})
            </option>
          ))}
        </select>
      </div>

      {/* Segment count */}
      {segmentLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading segment…
        </div>
      )}
      {segment !== null && !segmentLoading && (
        <div className="rounded-md bg-muted/30 px-3 py-2 text-sm">
          <span className="font-semibold">{segment.length}</span>{' '}
          <span className="text-muted-foreground">
            completed orders found for this event
          </span>
        </div>
      )}

      {/* Target event name */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Target event name <span className="opacity-70">(replaces {'{{event}}'})</span>
        </label>
        <input
          type="text"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="e.g. Boho Beach Festival 2026"
          value={targetEventName}
          onChange={(e) => setTargetEventName(e.target.value)}
        />
      </div>

      <TemplateTextarea value={template} onChange={setTemplate} />

      {result && <ResultBanner result={result} />}

      {!result && segment !== null && segment.length > 0 && (
        <Button onClick={handleSend} disabled={isSending} className="gap-2">
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {isSending
            ? 'Sending…'
            : `Send to ${segment.length} customer${segment.length !== 1 ? 's' : ''}`}
        </Button>
      )}
    </CampaignCard>
  );
}

// ─── CSV-based campaign card (past buyers + custom) ───────────────────────────

const PAST_BUYER_TEMPLATE = `Hi {{name}}! 👋

You previously attended one of our events and we'd love to see you again.

{{event}} is coming up — you get early access as a past ticket holder.

🎟️ Get your tickets: [PASTE LINK HERE]

Reply STOP to opt out.`;

const CUSTOM_TEMPLATE = `Hi {{name}}! 👋

[Your message here]

Reply STOP to opt out.`;

interface CsvCampaignCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  campaignType: 'past_buyer_remarket' | 'custom';
  defaultTemplate: string;
  csvHint: string;
}

function CsvCampaignCard({
  icon,
  title,
  description,
  campaignType,
  defaultTemplate,
  csvHint,
}: CsvCampaignCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CsvRecipient[]>([]);
  const [fileName, setFileName] = useState('');
  const [template, setTemplate] = useState(defaultTemplate);
  const [targetEventName, setTargetEventName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  function handleFile(file: File) {
    setFileName(file.name);
    setResult(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (res) => {
        setRows(res.data.map(parseCsvRow));
      },
    });
  }

  const validRows = rows.filter((r) => !r._error);

  async function handleSend() {
    if (validRows.length === 0) return;
    setIsSending(true);
    setResult(null);

    try {
      const res = await fetch('/api/crm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${title} — ${new Date().toLocaleDateString('en-GB')}`,
          campaign_type: campaignType,
          message_template: template,
          send_immediately: true,
          recipients: validRows.map((r) => ({
            ...r,
            source_event_name: r.source_event_name || targetEventName || undefined,
          })),
        }),
      });

      const json = (await res.json()) as { campaign_id: string; sent: number; failed: number };
      setResult({ campaign_id: json.campaign_id, sent: json.sent ?? 0, failed: json.failed ?? 0 });
    } catch {
      setResult(null);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <CampaignCard icon={icon} title={title} description={description}>
      {/* CSV upload */}
      <div
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center text-sm transition-colors hover:border-primary/50 hover:bg-muted/20',
          rows.length > 0 && 'border-primary/40 bg-muted/10',
        )}
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-5 w-5 text-muted-foreground" />
        {fileName ? (
          <p className="text-xs">
            <span className="font-medium">{fileName}</span>
            {' — '}
            <span className="text-muted-foreground">
              {validRows.length} valid row{validRows.length !== 1 ? 's' : ''}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{csvHint}</p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {/* Target event name */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Target event name <span className="opacity-70">(replaces {'{{event}}'})</span>
        </label>
        <input
          type="text"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="e.g. Boho Beach Festival 2026"
          value={targetEventName}
          onChange={(e) => setTargetEventName(e.target.value)}
        />
      </div>

      <TemplateTextarea value={template} onChange={setTemplate} />

      {result && <ResultBanner result={result} />}

      {!result && validRows.length > 0 && (
        <Button onClick={handleSend} disabled={isSending} className="gap-2">
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {isSending
            ? 'Sending…'
            : `Send to ${validRows.length} recipient${validRows.length !== 1 ? 's' : ''}`}
        </Button>
      )}
    </CampaignCard>
  );
}

// ─── Exported composite component ─────────────────────────────────────────────

export function CrmQuickActions({ events }: { events: EventOption[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <NoShowCard events={events} />

      <CsvCampaignCard
        icon={ShoppingBag}
        title="Re-market past buyers"
        description="Upload a CSV of past customers and send them a message about your next event."
        campaignType="past_buyer_remarket"
        defaultTemplate={PAST_BUYER_TEMPLATE}
        csvHint="Upload CSV — columns: phone, name, email, order_id, event_name"
      />

      <CsvCampaignCard
        icon={Megaphone}
        title="Custom campaign"
        description="Upload any recipient list and write your own message from scratch."
        campaignType="custom"
        defaultTemplate={CUSTOM_TEMPLATE}
        csvHint="Upload CSV — columns: phone, name, email, segment"
      />
    </div>
  );
}
