import type { RevenueLeakAuditData } from './revenue-leak-audit';

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  const withCommas = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${withCommas}`;
}

function fmtNum(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtPct(pct: number, digits = 1): string {
  return `${pct.toFixed(digits)}%`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

function fmtDatetime(iso: string): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  const month = MONTHS_LONG[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} at ${hh}:${mm} UTC`;
}

const INTENT_LABELS: Record<string, string> = {
  event_timing: 'Event timing / gates',
  venue_location: 'Venue location',
  age_eligibility: 'Age eligibility',
  dress_code: 'Dress code',
  last_entry_time: 'Last entry time',
  entry_policy: 'Entry policy',
  ticket_delivery_issue: 'Ticket delivery',
  ticket_upgrade_request: 'Ticket upgrade',
  ticket_availability_sold_out: 'Ticket availability',
  refund_request: 'Refund / cancellation',
  refund_followup: 'Refund follow-up',
  payment_incomplete: 'Payment issue',
  other: 'Other',
};

function intentLabel(intent: string): string {
  return INTENT_LABELS[intent] ?? intent.replace(/_/g, ' ');
}

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #ffffff;
    color: #0F172A;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  @page { size: A4; margin: 0; }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 18mm 20mm 16mm 20mm;
    margin: 0 auto;
    background: #ffffff;
    position: relative;
  }
  hr.rule {
    border: none;
    border-top: 1.5px solid #E2E8F0;
    margin: 6mm 0;
  }
  /* Header */
  .report-header { margin-bottom: 5mm; }
  .report-header h1 {
    font-size: 22pt;
    font-weight: 700;
    color: #0F172A;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }
  .report-header .subtitle {
    font-size: 13pt;
    font-weight: 500;
    color: #475569;
    margin-top: 2mm;
  }
  .report-header .meta-row {
    display: flex;
    gap: 10mm;
    margin-top: 3mm;
    font-size: 8.5pt;
    color: #94A3B8;
  }
  /* Stat boxes */
  .stat-row {
    display: grid;
    gap: 4mm;
    margin-bottom: 5mm;
  }
  .stat-row.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  .stat-row.cols-2 { grid-template-columns: 1fr 1fr; }
  .stat-box {
    border: 1.5px solid #E2E8F0;
    border-radius: 6px;
    padding: 4mm 5mm;
    background: #F8FAFC;
  }
  .stat-box.red { border-color: #FECACA; background: #FEF2F2; }
  .stat-box.green { border-color: #BBF7D0; background: #F0FDF4; }
  .stat-box .label {
    font-size: 7.5pt;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #64748B;
    margin-bottom: 1.5mm;
  }
  .stat-box.red .label { color: #991B1B; }
  .stat-box.green .label { color: #166534; }
  .stat-box .value {
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: #0F172A;
    line-height: 1.1;
  }
  .stat-box.red .value { color: #DC2626; }
  .stat-box.green .value { color: #16A34A; }
  .stat-box .sub {
    font-size: 8pt;
    color: #94A3B8;
    margin-top: 1mm;
  }
  .stat-box.red .sub { color: #B91C1C; }
  .stat-box.green .sub { color: #15803D; }
  /* Section headings */
  .section-heading {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #64748B;
    margin-bottom: 3mm;
    margin-top: 5mm;
  }
  /* Prose callout */
  .callout {
    border-left: 3px solid #CBD5E1;
    padding: 2mm 4mm;
    font-size: 9pt;
    color: #475569;
    line-height: 1.6;
    margin-bottom: 4mm;
  }
  .callout.red { border-color: #FCA5A5; background: #FEF2F2; color: #7F1D1D; }
  /* Intent list */
  .intent-list { list-style: none; }
  .intent-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5mm 0;
    border-bottom: 1px solid #F1F5F9;
    font-size: 9.5pt;
    color: #334155;
  }
  .intent-list li:last-child { border-bottom: none; }
  .intent-list li .count {
    font-weight: 600;
    color: #0F172A;
    font-variant-numeric: tabular-nums;
  }
  /* Recovery section */
  .recovery-block {
    border: 2px solid #86EFAC;
    border-radius: 8px;
    background: #F0FDF4;
    padding: 5mm 6mm;
    margin-top: 4mm;
  }
  .recovery-block .headline {
    font-size: 11pt;
    font-weight: 700;
    color: #166534;
    margin-bottom: 3mm;
  }
  .recovery-block .line {
    display: flex;
    justify-content: space-between;
    font-size: 10pt;
    color: #15803D;
    padding: 1.5mm 0;
    border-bottom: 1px solid #BBF7D0;
  }
  .recovery-block .line:last-of-type { border-bottom: none; }
  .recovery-block .line .val { font-weight: 700; font-variant-numeric: tabular-nums; }
  .recovery-block .line.net { font-size: 13pt; font-weight: 700; color: #14532D; }
  .recovery-block .fine-print {
    margin-top: 3mm;
    font-size: 7.5pt;
    color: #4ADE80;
    color: #166534;
    opacity: 0.7;
    line-height: 1.5;
  }
  /* Footer */
  .footer {
    position: absolute;
    bottom: 10mm;
    left: 20mm;
    right: 20mm;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    font-size: 8pt;
    color: #94A3B8;
    border-top: 1px solid #E2E8F0;
    padding-top: 3mm;
  }
  .footer a { color: #64748B; text-decoration: none; }
  .footer .brand { font-weight: 600; color: #22C55E; }
`;

export function buildRevenueLeakAuditHtml(data: RevenueLeakAuditData): string {
  const netRecovery = data.recoverable_revenue_sar - data.recovery_fee_sar;
  const hasScanData = data.total_scan_attempts > 0;
  const hasSupportData = data.total_conversations > 0;

  const intentRows = data.top_intents
    .slice(0, 5)
    .map(
      (i) =>
        `<li><span>${esc(intentLabel(i.intent))}</span><span class="count">${fmtNum(i.count)}</span></li>`,
    )
    .join('');

  const scanSection = hasScanData
    ? `
      <div class="stat-row cols-2">
        <div class="stat-box">
          <div class="label">Total Scan Attempts</div>
          <div class="value">${fmtNum(data.total_scan_attempts)}</div>
        </div>
        <div class="stat-box red">
          <div class="label">Duplicate Redemptions</div>
          <div class="value">${fmtNum(data.duplicate_scan_count)}</div>
          <div class="sub">${fmtPct(data.gate_failure_rate_pct)} gate failure rate</div>
        </div>
      </div>
      <div class="callout red">
        Each duplicate scan incident averages 3+ minutes of staff time and risks a chargeback
        if unresolved. ${fmtNum(data.duplicate_scan_count)} incident${data.duplicate_scan_count !== 1 ? 's' : ''} recorded at this event.
      </div>`
    : `<div class="callout">No gate scan data available for this event. Connect a ticket-scanning integration to unlock gate incident analysis.</div>`;

  const supportSection = hasSupportData
    ? `
      <div class="stat-row cols-2">
        <div class="stat-box">
          <div class="label">Customer Conversations</div>
          <div class="value">${fmtNum(data.total_conversations)}</div>
          <div class="sub">${fmtNum(data.total_conversations - data.escalated_conversations)} resolved by AI</div>
        </div>
        <div class="stat-box${data.escalated_conversations > 0 ? ' red' : ''}">
          <div class="label">Escalated to Staff</div>
          <div class="value">${fmtNum(data.escalated_conversations)}</div>
          <div class="sub">${fmtPct(data.total_conversations === 0 ? 0 : (data.escalated_conversations / data.total_conversations) * 100)} of conversations</div>
        </div>
      </div>
      ${
        data.top_intents.length > 0
          ? `<div class="section-heading" style="margin-top:3mm">Top questions</div>
             <ul class="intent-list">${intentRows}</ul>`
          : ''
      }`
    : `<div class="callout">No conversation data available for this event.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Revenue Leak Audit — ${esc(data.event_name)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="report-header">
    <h1>Event Revenue Leak Audit</h1>
    <div class="subtitle">${esc(data.event_name)}</div>
    <div class="meta-row">
      <span>Event date: <strong>${data.event_date ? fmtDate(data.event_date) : '—'}</strong></span>
      <span>Generated: ${fmtDatetime(data.generated_at)}</span>
      <span>Prepared by <strong>tazkar.co</strong></span>
    </div>
  </div>

  <hr class="rule">

  <!-- Section 1: Revenue Summary -->
  <div class="section-heading">Revenue Summary</div>
  <div class="stat-row cols-3">
    <div class="stat-box">
      <div class="label">Completed Revenue</div>
      <div class="value">${fmtMoney(data.completed_revenue_sar, data.currency)}</div>
      <div class="sub">${fmtNum(data.completed_orders)} completed orders</div>
    </div>
    <div class="stat-box">
      <div class="label">Orders Completed</div>
      <div class="value">${fmtNum(data.completed_orders)}</div>
      <div class="sub">${fmtNum(data.tickets_sold)} tickets sold</div>
    </div>
    <div class="stat-box">
      <div class="label">Avg. Order Value</div>
      <div class="value">${fmtMoney(data.average_order_value_sar, data.currency)}</div>
      <div class="sub">per completed order</div>
    </div>
  </div>

  <hr class="rule">

  <!-- Section 2: Revenue Leaks -->
  <div class="section-heading">Revenue Leaks</div>
  <div class="stat-row cols-2">
    <div class="stat-box red">
      <div class="label">Failed Payment Leak</div>
      <div class="value">${fmtMoney(data.failed_payment_revenue_sar, data.currency)}</div>
      <div class="sub">${fmtNum(data.failed_payment_count)} failed authorizations &mdash; ${fmtPct(data.failed_payment_rate_pct)} of attempted revenue</div>
    </div>
    <div class="stat-box red">
      <div class="label">No-Show Inventory</div>
      <div class="value">${hasScanData ? fmtNum(data.no_show_count) : '—'}</div>
      <div class="sub">${hasScanData
        ? `${fmtPct(data.no_show_rate_pct)} no-show rate &mdash; est. ${fmtMoney(data.no_show_revenue_sar, data.currency)} resaleable`
        : 'Requires gate scan data'}</div>
    </div>
  </div>

  <hr class="rule">

  <!-- Section 3: Gate Incidents -->
  <div class="section-heading">Gate Incidents</div>
  ${scanSection}

  <hr class="rule">

  <!-- Section 4: Support Load -->
  <div class="section-heading">Support Load</div>
  ${supportSection}

  <hr class="rule">

  <!-- Section 5: Recovery Opportunity -->
  <div class="section-heading">Recovery Opportunity</div>
  <div class="recovery-block">
    <div class="headline">Estimated Recoverable Revenue</div>
    <div class="line">
      <span>Failed payment recovery (100% via payment link retry)</span>
      <span class="val">${fmtMoney(data.failed_payment_revenue_sar, data.currency)}</span>
    </div>
    <div class="line">
      <span>No-show resale estimate (30% industry average)</span>
      <span class="val">${fmtMoney(data.no_show_revenue_sar * 0.3, data.currency)}</span>
    </div>
    <div class="line">
      <span>Total recoverable</span>
      <span class="val">${fmtMoney(data.recoverable_revenue_sar, data.currency)}</span>
    </div>
    <div class="line">
      <span>tazkar.co recovery fee (22% of recovered)</span>
      <span class="val">&minus;${fmtMoney(data.recovery_fee_sar, data.currency)}</span>
    </div>
    <div class="line net">
      <span>Net recovery to operator</span>
      <span class="val">${fmtMoney(netRecovery, data.currency)}</span>
    </div>
    <div class="fine-print">
      Recovery estimate based on industry average 30% resale rate for no-shows and 100% recovery
      rate for failed authorizations with payment link retry. Actual recovery may vary.
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <span>This report was generated automatically by <span class="brand">tazkar.co</span></span>
    <span>Contact <a href="mailto:hello@tazkar.co">hello@tazkar.co</a> to start recovering this revenue.</span>
  </div>

</div>
</body>
</html>`;
}
