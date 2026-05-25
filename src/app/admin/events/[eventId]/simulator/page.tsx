import { notFound } from 'next/navigation';

import { createServerClient } from '@/lib/supabase/server';

import { SimulatorChat } from './_components/simulator-chat';

interface SimulatorPageProps {
  params: { eventId: string };
}

export default async function SimulatorPage({ params }: SimulatorPageProps) {
  const supabase = createServerClient();

  // Verify access (RLS).
  const { data: event } = await supabase
    .from('events')
    .select('id, name')
    .eq('id', params.eventId)
    .is('deleted_at', null)
    .single();
  if (!event) notFound();

  // KB section index — used to expand citations in the chat UI.
  const [{ data: sections }, { data: orders }] = await Promise.all([
    supabase
      .from('kb_sections')
      .select('section_id, question_en, answer_en')
      .eq('event_id', params.eventId)
      .limit(500),
    supabase
      .from('orders')
      .select('customer_phone_e164, customer_name, order_id, vip_flag')
      .eq('event_id', params.eventId)
      .order('vip_flag', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  const sampleSections = (sections ?? []).map((s) => ({
    section_id: s.section_id,
    question_en: s.question_en,
    answer_en: s.answer_en,
  }));

  const samplePhones = (orders ?? []).map((o) => ({
    phone: o.customer_phone_e164,
    customer_name: o.customer_name,
    order_id: o.order_id,
    vip_flag: o.vip_flag,
  }));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-8 py-8">
      <div>
        <h2 className="text-lg font-semibold">Simulator</h2>
        <p className="text-sm text-muted-foreground">
          Send messages as a simulated customer. The agent uses your KB, refund
          policy, and seeded orders. Each turn is logged to{' '}
          <code className="font-mono text-xs">conversations</code>,{' '}
          <code className="font-mono text-xs">messages</code>,{' '}
          <code className="font-mono text-xs">escalations</code>, and{' '}
          <code className="font-mono text-xs">audit_log</code>.
        </p>
      </div>

      <SimulatorChat
        eventId={params.eventId}
        sampleSections={sampleSections}
        samplePhones={samplePhones}
      />
    </div>
  );
}
