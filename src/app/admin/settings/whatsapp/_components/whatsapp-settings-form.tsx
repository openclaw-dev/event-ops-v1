'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveWhatsAppSettings } from '../../actions';

interface WhatsAppSettingsFormProps {
  initialPhoneNumberId: string;
  initialDisplayPhone: string;
}

export function WhatsAppSettingsForm({
  initialPhoneNumberId,
  initialDisplayPhone,
}: WhatsAppSettingsFormProps) {
  const [phoneNumberId, setPhoneNumberId] = useState(initialPhoneNumberId);
  const [displayPhone, setDisplayPhone] = useState(initialDisplayPhone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const result = await saveWhatsAppSettings({
        whatsapp_business_phone_number_id: phoneNumberId,
        whatsapp_display_phone_e164: displayPhone,
      });

      if (result?.error) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Phone Number ID */}
      <div className="space-y-1.5">
        <Label htmlFor="phone-number-id">Phone Number ID</Label>
        <Input
          id="phone-number-id"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder="e.g. 123456789012345"
          className="max-w-md font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Found in Meta for Developers → Your App → WhatsApp → API Setup. This is the numeric
          ID (not the phone number itself).
        </p>
      </div>

      {/* Display phone */}
      <div className="space-y-1.5">
        <Label htmlFor="display-phone">Display phone number (E.164)</Label>
        <Input
          id="display-phone"
          value={displayPhone}
          onChange={(e) => setDisplayPhone(e.target.value)}
          placeholder="e.g. +97150XXXXXXX"
          className="max-w-md font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          The number customers will see and message. Must be in E.164 format (e.g.{' '}
          <code>+97150XXXXXXX</code>).
        </p>
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Submit */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Save WhatsApp settings
        </Button>

        {saved && (
          <span className="flex items-center gap-1 text-sm text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}
