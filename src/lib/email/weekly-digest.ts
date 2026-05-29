/**
 * weekly-digest.ts
 *
 * Builds the weekly operator digest HTML email.
 * Pure function — no async, no external dependencies.
 * All CSS is inline so major email clients render it correctly.
 */

export interface DigestEvent {
  name: string;
  total_conversations: number;
  resolved_by_ai: number;
  refunds_deflected: number;
  escalated: number;
  coverage_score: number;
}

export interface WeeklyDigestParams {
  operator_name: string;
  period: string;
  events: DigestEvent[];
  total_sar_saved: number;
}

// ─── Shared style constants ───────────────────────────────────────────────────

const BASE =
  'margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#111111;';
const TH_STYLE =
  'padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;' +
  'letter-spacing:0.08em;color:#666666;border-bottom:2px solid #111111;white-space:nowrap;';
const TD_STYLE =
  'padding:10px 12px;font-size:13px;border-bottom:1px solid #eeeeee;vertical-align:top;';
const TD_NUM =
  TD_STYLE + 'text-align:right;font-variant-numeric:tabular-nums;';

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildWeeklyDigestHtml(params: WeeklyDigestParams): string {
  const { operator_name, period, events, total_sar_saved } = params;

  const eventRows = events
    .map((ev, i) => {
      const bg = i % 2 === 0 ? '#ffffff' : '#fafafa';
      const pct = ev.total_conversations > 0
        ? Math.round((ev.resolved_by_ai / ev.total_conversations) * 100)
        : 0;
      return `
        <tr style="background:${bg}">
          <td style="${TD_STYLE}font-weight:600">${escHtml(ev.name)}</td>
          <td style="${TD_NUM}">${ev.total_conversations}</td>
          <td style="${TD_NUM}">${ev.resolved_by_ai}<br><span style="font-size:11px;color:#666666">${pct}%</span></td>
          <td style="${TD_NUM}">${ev.escalated}</td>
          <td style="${TD_NUM}">${ev.refunds_deflected}</td>
          <td style="${TD_NUM}">${ev.coverage_score}%</td>
        </tr>`;
    })
    .join('');

  const noEventsRow =
    events.length === 0
      ? `<tr><td colspan="6" style="${TD_STYLE}color:#999999;text-align:center">No events with activity this week.</td></tr>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Weekly Event Ops Summary — ${escHtml(period)}</title>
</head>
<body style="${BASE}background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="${BASE}background:#f5f5f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Card -->
        <table width="620" cellpadding="0" cellspacing="0" border="0"
               style="max-width:620px;width:100%;background:#ffffff;border:1px solid #e0e0e0;">

          <!-- ── Header ────────────────────────────────────────────── -->
          <tr>
            <td style="padding:28px 28px 20px 28px;border-bottom:2px solid #111111;">
              <p style="${BASE}font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#888888;">
                tazkar.co
              </p>
              <h1 style="${BASE}font-size:20px;font-weight:700;line-height:1.3;margin-top:6px;">
                Your weekly event ops summary
              </h1>
              <p style="${BASE}font-size:14px;color:#444444;margin-top:4px;">
                ${escHtml(period)} &nbsp;·&nbsp; ${escHtml(operator_name)}
              </p>
            </td>
          </tr>

          <!-- ── Events table ──────────────────────────────────────── -->
          <tr>
            <td style="padding:24px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <thead>
                  <tr>
                    <th style="${TH_STYLE}">Event</th>
                    <th style="${TH_STYLE}text-align:right;">Conversations</th>
                    <th style="${TH_STYLE}text-align:right;">AI resolved</th>
                    <th style="${TH_STYLE}text-align:right;">Escalated</th>
                    <th style="${TH_STYLE}text-align:right;">Refunds deflected</th>
                    <th style="${TH_STYLE}text-align:right;">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  ${eventRows}
                  ${noEventsRow}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- ── Total savings ─────────────────────────────────────── -->
          <tr>
            <td style="padding:16px 28px 20px 28px;border-top:2px solid #111111;border-bottom:1px solid #eeeeee;">
              <p style="${BASE}font-size:15px;">
                <strong>Total estimated savings this week:&nbsp;
                  SAR ${total_sar_saved.toLocaleString('en-US')}
                </strong>
              </p>
              <p style="${BASE}font-size:11px;color:#999999;margin-top:4px;">
                Estimated based on lowest ticket price × refunds deflected per event.
              </p>
            </td>
          </tr>

          <!-- ── Footer ────────────────────────────────────────────── -->
          <tr>
            <td style="padding:16px 28px;background:#fafafa;">
              <p style="${BASE}font-size:11px;color:#aaaaaa;">
                Powered by
                <a href="https://tazkar.co"
                   style="color:#aaaaaa;text-decoration:underline;">tazkar.co</a>
                &nbsp;·&nbsp;
                You're receiving this because you operate an event on Tazkar.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
