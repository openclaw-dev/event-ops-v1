'use server';

import { createServerClient } from '@/lib/supabase/server';
import { resolveActiveOperatorId } from '@/lib/get-active-operator';

/**
 * Save WhatsApp settings for the active operator.
 *
 * Returns `{ error: string }` on failure; `undefined` on success.
 */
export async function saveWhatsAppSettings(data: {
  whatsapp_business_phone_number_id: string;
  whatsapp_display_phone_e164: string;
}): Promise<{ error: string } | undefined> {
  const supabase = createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated.' };

  // Resolve active operator.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operatorIds = (memberships ?? []).map((m) => m.operator_id as string);
  const operatorId = resolveActiveOperatorId(operatorIds);
  if (!operatorId) return { error: 'No active operator found.' };

  const { error: updateError } = await supabase
    .from('operators')
    .update({
      whatsapp_business_phone_number_id:
        data.whatsapp_business_phone_number_id.trim() || null,
      whatsapp_display_phone_e164:
        data.whatsapp_display_phone_e164.trim() || null,
    })
    .eq('id', operatorId);

  if (updateError) return { error: updateError.message };

  return undefined; // success
}
