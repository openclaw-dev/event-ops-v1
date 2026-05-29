import { redirect } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';
import { Separator } from '@/components/ui/separator';
import { WhatsAppSettingsForm } from './_components/whatsapp-settings-form';

export default async function WhatsAppSettingsPage() {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Resolve active operator.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operatorIds = (memberships ?? []).map((m) => m.operator_id as string);
  const operatorId = resolveActiveOperatorId(operatorIds);
  if (!operatorId) redirect('/admin/onboarding');

  // Fetch current WhatsApp settings.
  const { data: operator } = await supabase
    .from('operators')
    .select('whatsapp_business_phone_number_id, whatsapp_display_phone_e164')
    .eq('id', operatorId)
    .single();

  const phoneNumberId =
    (operator as Record<string, unknown> | null)?.whatsapp_business_phone_number_id as
      | string
      | null ?? '';
  const displayPhone =
    (operator as Record<string, unknown> | null)?.whatsapp_display_phone_e164 as
      | string
      | null ?? '';

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-8 py-8">
      {/* Token expiry reminder */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p>
          Remember to regenerate your Meta access token if messages stop arriving. Tokens expire
          every 24 hours in development mode.
        </p>
      </div>

      {/* Header */}
      <div>
        <h2 className="text-base font-semibold">WhatsApp Integration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your WhatsApp Business number so customers can message you directly. The
          inbound webhook at{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/whatsapp/inbound</code>{' '}
          handles both promoter change requests and customer support.
        </p>
      </div>

      <Separator />

      {/* Webhook URL */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Webhook URL</h3>
        <div className="rounded-md border bg-muted/40 px-4 py-3">
          <code className="text-xs break-all">
            https://tazkar.co/api/whatsapp/inbound
          </code>
        </div>
        <p className="text-xs text-muted-foreground">
          Paste this into Meta for Developers → Your App → WhatsApp → Configuration →
          Webhook URL. Subscribe to the <strong>messages</strong> field.
        </p>
      </section>

      <Separator />

      {/* Settings form */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Business phone number</h3>
        <WhatsAppSettingsForm
          initialPhoneNumberId={phoneNumberId}
          initialDisplayPhone={displayPhone}
        />
      </section>

      <Separator />

      {/* Required env vars callout */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Required environment variables</h3>
        <div className="rounded-md border bg-muted/40 px-4 py-3 space-y-1.5">
          {[
            { key: 'WHATSAPP_PROVIDER', desc: 'Set to meta or dialog360' },
            { key: 'META_APP_SECRET', desc: 'Webhook signature verification' },
            { key: 'META_PERMANENT_TOKEN', desc: 'Used to send WhatsApp messages' },
            { key: 'META_PHONE_NUMBER_ID', desc: 'Must match Phone Number ID above' },
            { key: 'META_WEBHOOK_VERIFY_TOKEN', desc: 'Any secret string for webhook setup' },
          ].map(({ key, desc }) => (
            <div key={key} className="flex items-start gap-3 text-xs">
              <code className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono">{key}</code>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Set these in Vercel → Project Settings → Environment Variables, and in{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">.env.local</code> for local
          development.
        </p>
      </section>
    </div>
  );
}
