import { NextResponse } from 'next/server';

import { createServerClient } from '@/lib/supabase/server';

export const maxDuration = 15;
export const runtime = 'nodejs';

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * POST /api/whatsapp/test
 *
 * Validates the META_PERMANENT_TOKEN + META_PHONE_NUMBER_ID env vars by
 * calling the Meta Graph API and returning the phone number display name.
 *
 * Returns:
 *   { status: 'ok', display_name: string }
 *   { status: 'error', message: string }
 *
 * No request body required — all config is read from env.
 */
export async function POST(): Promise<Response> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ status: 'error', message: 'Not authenticated.' }, { status: 401 });
  }

  // ── Operator-membership check (audit 3.3) ─────────────────────────────────
  // Auth alone let ANY authenticated user probe whether the Meta credentials are
  // valid. Require membership in at least one operator, matching the ownership
  // gate used by the other admin routes. (The token itself is deliberately read
  // untrimmed below — this route exists to DETECT a trailing-newline token.)
  const { data: memberships } = await supabase
    .from('operator_users')
    .select('operator_id')
    .eq('user_id', user.id)
    .limit(1);
  if (!memberships || memberships.length === 0) {
    return NextResponse.json(
      { status: 'error', message: 'No operator membership.' },
      { status: 403 },
    );
  }

  // ── Env var checks ────────────────────────────────────────────────────────
  const token = process.env.META_PERMANENT_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  if (!token || token.trim().length === 0) {
    return NextResponse.json({
      status: 'error',
      message: 'META_PERMANENT_TOKEN is not set in environment variables.',
    });
  }
  if (!phoneNumberId || phoneNumberId.trim().length === 0) {
    return NextResponse.json({
      status: 'error',
      message: 'META_PHONE_NUMBER_ID is not set in environment variables.',
    });
  }

  // ── Call Meta Graph API ───────────────────────────────────────────────────
  let graphResponse: Response;
  try {
    graphResponse = await fetch(`${META_GRAPH_BASE}/${phoneNumberId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({
      status: 'error',
      message: `Could not reach Meta API: ${msg}`,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await graphResponse.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({
      status: 'error',
      message: `Meta API returned an unexpected response (HTTP ${graphResponse.status}).`,
    });
  }

  // ── Parse failure ─────────────────────────────────────────────────────────
  if (!graphResponse.ok) {
    const errObj = body.error as Record<string, unknown> | undefined;
    const rawMessage = (errObj?.message as string | undefined) ?? `HTTP ${graphResponse.status}`;

    let friendly = rawMessage;
    const lower = rawMessage.toLowerCase();
    if (
      lower.includes('expired') ||
      lower.includes('invalid oauth') ||
      lower.includes('session') ||
      lower.includes('access token')
    ) {
      friendly =
        'Token expired or invalid — regenerate META_PERMANENT_TOKEN in Meta for Developers.';
    } else if (
      lower.includes('does not exist') ||
      lower.includes('invalid id') ||
      lower.includes('unsupported get request')
    ) {
      friendly =
        'Invalid phone number ID — check META_PHONE_NUMBER_ID matches your Meta app.';
    } else if (lower.includes('permission')) {
      friendly = 'Missing permissions — ensure your token has whatsapp_business_messaging scope.';
    }

    return NextResponse.json({ status: 'error', message: friendly });
  }

  // ── Parse success ─────────────────────────────────────────────────────────
  const displayName =
    (body.display_phone_number as string | undefined) ??
    (body.verified_name as string | undefined) ??
    phoneNumberId;

  return NextResponse.json({ status: 'ok', display_name: displayName });
}
