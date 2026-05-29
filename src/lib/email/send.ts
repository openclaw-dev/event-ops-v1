/**
 * send.ts
 *
 * Thin email-sending wrapper.
 * Priority: Resend (RESEND_API_KEY) → SendGrid (SENDGRID_API_KEY) → console.log dev fallback.
 * Pure function — no Supabase, no Anthropic.
 */

const FROM_EMAIL = 'noreply@tazkar.co';
const FROM_NAME = 'Tazkar';

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  const { to, subject, html } = params;

  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;

  // ── Resend ──────────────────────────────────────────────────────────────────
  if (resendKey) {
    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [to],
          subject,
          html,
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Resend network error: ${msg}` };
    }

    if (!res.ok) {
      let message = `Resend error: HTTP ${res.status}`;
      try {
        const body = (await res.json()) as Record<string, unknown>;
        if (typeof body.message === 'string') message = `Resend: ${body.message}`;
      } catch {
        // ignore JSON parse errors
      }
      return { success: false, error: message };
    }

    return { success: true };
  }

  // ── SendGrid ─────────────────────────────────────────────────────────────────
  if (sendgridKey) {
    let res: Response;
    try {
      res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: FROM_EMAIL, name: FROM_NAME },
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `SendGrid network error: ${msg}` };
    }

    if (!res.ok) {
      let message = `SendGrid error: HTTP ${res.status}`;
      try {
        const body = (await res.json()) as Record<string, unknown>;
        const errors = body.errors as Array<{ message: string }> | undefined;
        if (errors?.[0]?.message) message = `SendGrid: ${errors[0].message}`;
      } catch {
        // ignore JSON parse errors
      }
      return { success: false, error: message };
    }

    return { success: true };
  }

  // ── Dev fallback ─────────────────────────────────────────────────────────────
  console.log('[sendEmail] DEV MODE — no provider configured. Email not sent.');
  console.log(`  To:      ${to}`);
  console.log(`  Subject: ${subject}`);
  console.log(`  Body:    ${html.length} chars (HTML)`);
  return { success: true };
}
