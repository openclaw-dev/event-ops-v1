'use server';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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

  // Resolve active operator via RLS-scoped membership read.
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id);

  const operatorIds = (memberships ?? []).map((m) => m.operator_id as string);
  const operatorId = resolveActiveOperatorId(operatorIds);
  if (!operatorId) return { error: 'No active operator found.' };

  // The operators table has only an RLS SELECT policy (see 0009_rls.sql) — no
  // UPDATE policy exists, so an RLS-scoped UPDATE silently matches 0 rows.
  // Membership is already verified above, so it is safe to write via the
  // admin client. `.select()` ensures we catch any future regressions where
  // the row genuinely doesn't get written.
  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from('operators')
    .update({
      whatsapp_business_phone_number_id:
        data.whatsapp_business_phone_number_id.trim() || null,
      whatsapp_display_phone_e164:
        data.whatsapp_display_phone_e164.trim() || null,
    })
    .eq('id', operatorId)
    .select('id');

  if (updateError) return { error: updateError.message };
  if (!updated || updated.length === 0) {
    return { error: 'Update affected no rows — operator not found.' };
  }

  return undefined; // success
}
