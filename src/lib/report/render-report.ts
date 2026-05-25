/**
 * Renders a ReportData payload as the printable HTML report.
 *
 * Structure preserved from docs/reference/post_event_report_template.html
 * (4 A4 pages, A4 print rules, Fraunces / DM Sans / JetBrains Mono).
 * All hardcoded sample numbers are replaced with values from the payload;
 * the bar widths and donut arc length are computed inline so the report
 * stays a single self-contained HTML document with no external runtime.
 */

import type { ReportData } from './types';

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(amount: number, currency: string): string {
  const rounded = Math.round(amount);
  const withCommas = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${withCommas}`;
}

function formatNumber(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPercent(fraction: number, digits = 0): string {
  return (fraction * 100).toFixed(digits);
}

function formatDateLong(iso: string): string {
  // "2026-07-17" → "17 July 2026"
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

function formatDateRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatDateLong(startIso);
  const [sy, sm, sd] = startIso.split('-').map((s) => parseInt(s, 10));
  const [ey, em, ed] = endIso.split('-').map((s) => parseInt(s, 10));
  if (sy === ey && sm === em) return `${sd} – ${ed} ${MONTHS_LONG[em - 1]} ${ey}`;
  if (sy === ey) return `${sd} ${MONTHS_LONG[sm - 1]} – ${ed} ${MONTHS_LONG[em - 1]} ${ey}`;
  return `${formatDateLong(startIso)} – ${formatDateLong(endIso)}`;
}

function eventTitleParts(name: string): { main: string; suffix: string } {
  // "Coastline Festival 2026" → { main: "Coastline Festival", suffix: "'26" }
  const yearMatch = name.match(/^(.*?)\s+(\d{4})\s*$/);
  if (yearMatch) {
    const main = yearMatch[1].trim();
    const yy = yearMatch[2].slice(-2);
    return { main, suffix: `&rsquo;${yy}.` };
  }
  return { main: name, suffix: '' };
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
  backstage_or_vib_request: 'Backstage / VIB',
  refund_request: 'Refund / cancellation',
  refund_followup: 'Refund follow-up',
  compensation_request: 'Compensation request',
  payment_incomplete: 'Payment issue',
  reservation_followup: 'Reservation follow-up',
  loyalty_benefits: 'Loyalty benefits',
  lineup_question: 'Line-up / schedule',
  membership_tier_issue: 'Membership tier',
  partnership_inquiry: 'Partnership inquiry',
  other: 'Other',
};

function intentLabel(intent: string): string {
  return INTENT_LABELS[intent] ?? intent;
}

const REFUND_REASON_LABELS: Record<string, string> = {
  cannot_attend_personal: 'Cannot attend (personal)',
  cannot_attend_medical: 'Medical (escalated)',
  dissatisfied_experience: 'Dissatisfied with experience',
  event_change_or_cancellation: 'Event change / cancellation',
  payment_issue: 'Payment issue',
  duplicate_purchase: 'Duplicate purchase',
  wrong_ticket_purchased: 'Wrong ticket purchased',
  accessibility_concern: 'Accessibility (escalated)',
  safety_concern: 'Safety (escalated)',
  other: 'Other',
};

function refundReasonLabel(reason: string): string {
  return REFUND_REASON_LABELS[reason] ?? reason;
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
  ru: 'Russian',
  mixed: 'Mixed',
};

// ============================================================================
// EMBEDDED CSS (lifted verbatim from the template)
// ============================================================================

const REPORT_CSS = `
  :root {
    --ink: #1a1a1a;
    --ink-muted: #6b6b65;
    --paper: #fafaf7;
    --paper-warm: #f5f3ec;
    --rule: #d8d6cf;
    --accent: #1d6b3a;
    --accent-soft: #e6efe9;
    --warn: #a8511c;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: var(--paper);
    color: var(--ink);
    font-family: 'DM Sans', sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  @page { size: A4; margin: 0; }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 22mm 22mm 18mm 22mm;
    margin: 0 auto 8mm auto;
    background: var(--paper);
    position: relative;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child { page-break-after: auto; }
  .display { font-family: 'Fraunces', serif; font-weight: 600; letter-spacing: -0.02em; line-height: 0.95; }
  .mono { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum'; }
  .eyebrow {
    font-family: 'DM Sans', sans-serif;
    font-size: 8pt; font-weight: 500;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ink-muted);
  }
  .meta { font-size: 9pt; color: var(--ink-muted); letter-spacing: 0.02em; }
  .page-cover { display: flex; flex-direction: column; justify-content: space-between; }
  .cover-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 8mm; border-bottom: 1px solid var(--rule);
  }
  .cover-title { margin-top: 14mm; }
  .cover-title .eyebrow { margin-bottom: 6mm; }
  .cover-title h1 {
    font-family: 'Fraunces', serif; font-weight: 400;
    font-size: 56pt; line-height: 0.92; letter-spacing: -0.035em;
    color: var(--ink); max-width: 95%;
  }
  .cover-title h1 .italic { font-style: italic; font-weight: 300; }
  .cover-deck {
    margin-top: 8mm; font-family: 'Fraunces', serif;
    font-size: 14pt; font-style: italic; font-weight: 300;
    color: var(--ink-muted); max-width: 75%; line-height: 1.4;
  }
  .stats-grid {
    margin-top: 16mm; display: grid; grid-template-columns: 1fr 1fr; gap: 0;
    border-top: 1px solid var(--rule); border-left: 1px solid var(--rule);
  }
  .stat {
    padding: 8mm 6mm;
    border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
    background: var(--paper);
  }
  .stat-headline {
    font-family: 'Fraunces', serif; font-weight: 500;
    font-size: 36pt; line-height: 1; letter-spacing: -0.02em;
    color: var(--ink); margin-bottom: 3mm;
  }
  .stat-headline .unit { font-size: 16pt; color: var(--ink-muted); letter-spacing: 0; margin-left: 2pt; }
  .stat-label { font-size: 9pt; color: var(--ink-muted); line-height: 1.4; max-width: 90%; }
  .stat.accent .stat-headline { color: var(--accent); }
  .cover-footer {
    margin-top: auto; padding-top: 10mm;
    display: flex; justify-content: space-between; align-items: flex-end;
    font-size: 9pt; color: var(--ink-muted);
  }
  .cover-footer .label-pair { display: flex; flex-direction: column; gap: 1mm; }
  .cover-footer .label-pair .key { font-size: 7.5pt; letter-spacing: 0.15em; text-transform: uppercase; }
  .cover-footer .label-pair .val { font-family: 'Fraunces', serif; font-size: 13pt; color: var(--ink); font-weight: 500; }
  .page-header {
    display: flex; justify-content: space-between; align-items: baseline;
    padding-bottom: 5mm; border-bottom: 1px solid var(--rule); margin-bottom: 10mm;
  }
  .page-header .page-num { font-family: 'JetBrains Mono', monospace; font-size: 9pt; color: var(--ink-muted); }
  .section-title { margin-bottom: 8mm; }
  .section-title h2 {
    font-family: 'Fraunces', serif; font-weight: 500;
    font-size: 32pt; line-height: 1.0; letter-spacing: -0.025em; margin-bottom: 4mm;
  }
  .section-title h2 .italic { font-style: italic; font-weight: 300; }
  .section-title p.lede {
    font-family: 'Fraunces', serif; font-style: italic;
    font-size: 12pt; color: var(--ink-muted); line-height: 1.4; max-width: 85%;
  }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; margin-bottom: 8mm; }
  .col h3 {
    font-family: 'DM Sans', sans-serif; font-weight: 600;
    font-size: 9pt; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--ink-muted); margin-bottom: 4mm; padding-bottom: 2mm; border-bottom: 1px solid var(--rule);
  }
  .bar-row {
    display: grid; grid-template-columns: 50mm 1fr 16mm; gap: 3mm;
    align-items: center; padding: 2mm 0; border-bottom: 1px solid var(--rule);
  }
  .bar-row:last-child { border-bottom: none; }
  .bar-label { font-size: 10pt; color: var(--ink); }
  .bar-track { height: 6pt; background: var(--paper-warm); border-radius: 0; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--ink); }
  .bar-fill.accent { background: var(--accent); }
  .bar-fill.muted { background: var(--ink-muted); }
  .bar-fill.warn { background: var(--warn); }
  .bar-value {
    font-family: 'JetBrains Mono', monospace; font-size: 10pt; color: var(--ink);
    text-align: right; font-variant-numeric: tabular-nums;
  }
  .deflection-block {
    background: var(--paper-warm); padding: 8mm; margin: 6mm 0 8mm 0;
    display: grid; grid-template-columns: 50mm 1fr; gap: 8mm; align-items: center;
  }
  .donut-wrap { position: relative; width: 50mm; height: 50mm; }
  .donut-wrap svg { width: 100%; height: 100%; }
  .donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .donut-pct {
    font-family: 'Fraunces', serif; font-weight: 500;
    font-size: 42pt; color: var(--accent); line-height: 1; letter-spacing: -0.02em;
  }
  .donut-label { font-size: 8pt; color: var(--ink-muted); letter-spacing: 0.1em; text-transform: uppercase; margin-top: 2mm; }
  .deflection-summary h4 {
    font-family: 'Fraunces', serif; font-weight: 500;
    font-size: 18pt; letter-spacing: -0.015em; margin-bottom: 3mm; line-height: 1.1;
  }
  .deflection-summary p { font-size: 10pt; color: var(--ink); line-height: 1.5; margin-bottom: 2mm; }
  .stories { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6mm; margin-top: 8mm; }
  .story { background: var(--paper); border-left: 2px solid var(--accent); padding: 5mm; }
  .story .story-tag {
    font-size: 8pt; color: var(--accent); letter-spacing: 0.12em;
    text-transform: uppercase; font-weight: 600; margin-bottom: 3mm;
  }
  .story .story-quote {
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 400;
    font-size: 10pt; line-height: 1.45; color: var(--ink); margin-bottom: 4mm;
  }
  .story .story-outcome {
    font-size: 8.5pt; color: var(--ink-muted); line-height: 1.4;
    padding-top: 3mm; border-top: 1px solid var(--rule);
  }
  .story .story-outcome strong { color: var(--accent); font-weight: 600; }
  .recs { margin-top: 6mm; }
  .rec {
    display: grid; grid-template-columns: 8mm 1fr; gap: 4mm;
    padding: 5mm 0; border-bottom: 1px solid var(--rule);
  }
  .rec-num { font-family: 'Fraunces', serif; font-weight: 500; font-size: 18pt; color: var(--accent); line-height: 1; }
  .rec-body h4 { font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 11pt; margin-bottom: 2mm; }
  .rec-body p { font-size: 9.5pt; color: var(--ink-muted); line-height: 1.5; }
  .page-footer {
    position: absolute; bottom: 10mm; left: 22mm; right: 22mm;
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 4mm; border-top: 1px solid var(--rule);
    font-size: 8pt; color: var(--ink-muted); letter-spacing: 0.04em;
  }
  .lang-row { display: flex; gap: 4mm; margin-bottom: 6mm; }
  .lang-chip { flex: 1; padding: 5mm; background: var(--paper-warm); border-left: 2px solid var(--ink); }
  .lang-chip .lang-pct { font-family: 'Fraunces', serif; font-weight: 500; font-size: 22pt; line-height: 1; }
  .lang-chip .lang-name {
    font-size: 8.5pt; color: var(--ink-muted); letter-spacing: 0.1em;
    text-transform: uppercase; margin-top: 2mm;
  }
  .lang-chip:nth-child(1) { border-left-color: var(--accent); }
  .lang-chip:nth-child(2) { border-left-color: var(--ink); }
  .lang-chip:nth-child(3) { border-left-color: var(--ink-muted); }
  .empty-state {
    background: var(--paper-warm); padding: 12mm; margin-top: 8mm;
    border-left: 2px solid var(--ink-muted); text-align: center;
  }
  .empty-state h3 {
    font-family: 'Fraunces', serif; font-weight: 500;
    font-size: 20pt; letter-spacing: -0.015em; margin-bottom: 4mm;
  }
  .empty-state p { font-size: 10pt; color: var(--ink-muted); line-height: 1.5; max-width: 60ch; margin: 0 auto; }
  @media print { body { background: white; } .page { margin: 0; box-shadow: none; } }
  @media screen { body { background: #e8e6df; padding: 12mm 0; } .page { box-shadow: 0 2mm 6mm rgba(0,0,0,0.08); } }
`;

// ============================================================================
// SECTION RENDERERS
// ============================================================================

function renderCover(data: ReportData): string {
  const { event, conversations, refund, performance, generated_at } = data;
  const title = eventTitleParts(event.name);
  const generatedLong = formatDateLong(generated_at.slice(0, 10));

  // Stat 1: conversations
  const totalConvos = conversations.total;
  // Stat 2: deflection rate (conversations resolved without escalation)
  const deflectionPct = formatPercent(conversations.deflection_rate);
  // Stat 3: revenue protected (sum of refund_cases deflected estimated_value_saved)
  const revenueProtected = formatMoney(refund.estimated_revenue_protected, event.default_currency);
  // Stat 4: estimated team hours saved
  const hoursSaved = performance.estimated_team_hours_saved.toFixed(0);

  return `
<div class="page page-cover">
  <div class="cover-header">
    <div class="eyebrow">Post-Event Operations Report</div>
    <div class="meta">Generated ${escapeHtml(generatedLong)} · Confidential</div>
  </div>

  <div class="cover-title">
    <div class="eyebrow">Event Summary</div>
    <h1 class="display">${escapeHtml(title.main)}<br>${title.suffix ? `<span class="italic">${title.suffix}</span>` : ''}</h1>
    <p class="cover-deck">A summary of customer support performance, refund-risk handling, and revenue protected across the event window.</p>
  </div>

  <div class="stats-grid">
    <div class="stat">
      <div class="stat-headline mono">${formatNumber(totalConvos)}</div>
      <div class="stat-label">Total customer conversations handled through the simulator and channel adapters during the event window.</div>
    </div>
    <div class="stat accent">
      <div class="stat-headline mono">${deflectionPct}<span class="unit">%</span></div>
      <div class="stat-label">Conversations resolved by the AI agent without escalation to the human support team.</div>
    </div>
    <div class="stat accent">
      <div class="stat-headline mono">${escapeHtml(revenueProtected)}</div>
      <div class="stat-label">Estimated revenue protected from refund-risk conversations successfully deflected to alternatives.</div>
    </div>
    <div class="stat">
      <div class="stat-headline mono">${hoursSaved}<span class="unit">hrs</span></div>
      <div class="stat-label">Estimated support team time saved, based on five minutes per resolved conversation.</div>
    </div>
  </div>

  <div class="cover-footer">
    <div class="label-pair">
      <span class="key">Event Dates</span>
      <span class="val">${escapeHtml(formatDateRange(event.start_date, event.end_date))}</span>
    </div>
    <div class="label-pair">
      <span class="key">Operator</span>
      <span class="val">${escapeHtml(event.operator_name)}</span>
    </div>
    <div class="label-pair">
      <span class="key">Venue</span>
      <span class="val">${escapeHtml(event.venue_name)}</span>
    </div>
  </div>
</div>`;
}

function renderRefundPage(data: ReportData): string {
  const { event, refund } = data;
  const total = refund.total_cases;
  const deflectedPct = total === 0 ? 0 : refund.deflected_count / total;
  const arc = (2 * Math.PI * 42 * deflectedPct).toFixed(1);
  const circ = (2 * Math.PI * 42).toFixed(1);

  // Empty state for refund
  if (total === 0) {
    return `
<div class="page">
  <div class="page-header">
    <div class="eyebrow">Section II · Refund Deflection</div>
    <div class="page-num mono">02 / 04</div>
  </div>
  <div class="section-title">
    <h2 class="display">Where the <span class="italic">money</span> stayed.</h2>
    <p class="lede">No refund-pressure conversations were recorded in the reporting window. This page will populate after the agent handles its first refund request.</p>
  </div>
  <div class="empty-state">
    <h3>No refund cases yet</h3>
    <p>Once customers begin sending refund requests through the simulator or production channels, this page will summarise how many were retained as transfers, credits, or upgrades — and how much revenue stayed in the business.</p>
  </div>
  <div class="page-footer">
    <span>${escapeHtml(event.name)} · Post-Event Operations Report</span>
    <span class="mono">02 / 04</span>
  </div>
</div>`;
  }

  // Rank reasons by count and compute bar widths relative to max
  const maxReason = Math.max(...refund.by_reason.map((r) => r.count), 1);
  const reasonRows = refund.by_reason
    .map((r) => {
      const widthPct = (r.count / maxReason) * 100;
      const cls =
        r.reason === 'cannot_attend_medical' ||
        r.reason === 'safety_concern' ||
        r.reason === 'accessibility_concern'
          ? 'warn'
          : r.deflected > 0
          ? 'accent'
          : 'muted';
      return `
  <div class="bar-row">
    <div class="bar-label">${escapeHtml(refundReasonLabel(r.reason))}</div>
    <div class="bar-track"><div class="bar-fill ${cls}" style="width: ${widthPct.toFixed(1)}%;"></div></div>
    <div class="bar-value">${r.count}</div>
  </div>`;
    })
    .join('');

  return `
<div class="page">
  <div class="page-header">
    <div class="eyebrow">Section II · Refund Deflection</div>
    <div class="page-num mono">02 / 04</div>
  </div>

  <div class="section-title">
    <h2 class="display">Where the <span class="italic">money</span> stayed.</h2>
    <p class="lede">${total} ${total === 1 ? 'conversation carried' : 'conversations carried'} real refund pressure. Of those, ${refund.deflected_count} ${refund.deflected_count === 1 ? 'ended' : 'ended'} with the customer accepting an alternative — a transfer, a credit, or an upgrade — instead of getting their money back.</p>
  </div>

  <div class="deflection-block">
    <div class="donut-wrap">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#d8d6cf" stroke-width="9"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#1d6b3a" stroke-width="9"
                stroke-dasharray="${arc} ${circ}" stroke-dashoffset="0"
                transform="rotate(-90 50 50)" stroke-linecap="butt"/>
      </svg>
      <div class="donut-center">
        <div class="donut-pct">${formatPercent(deflectedPct)}<span style="font-size: 18pt;">%</span></div>
        <div class="donut-label">Deflection</div>
      </div>
    </div>
    <div class="deflection-summary">
      <h4 class="display">${refund.deflected_count} of ${total} refund ${total === 1 ? 'case' : 'cases'} retained as revenue.</h4>
      <p>${refund.escalated_count} ${refund.escalated_count === 1 ? 'case was' : 'cases were'} escalated for human handling. Cases involving medical, safety, or accessibility reasons are excluded from the agent deflection path by design and handed directly to a human.</p>
      <p>The deflection rate is calibrated against the gross merchandise that would have left the business as refund. Estimated revenue protected: ${escapeHtml(formatMoney(refund.estimated_revenue_protected, event.default_currency))}.</p>
    </div>
  </div>

  <h3 style="font-family:'DM Sans';font-weight:600;font-size:9pt;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:4mm;padding-bottom:2mm;border-bottom:1px solid var(--rule);">Refund pressure by reason</h3>
${reasonRows}

  <div class="page-footer">
    <span>${escapeHtml(event.name)} · Post-Event Operations Report</span>
    <span class="mono">02 / 04</span>
  </div>
</div>`;
}

function renderPainPointsPage(data: ReportData): string {
  const { event, conversations, intents, performance } = data;

  // Language chips: top 3 languages by share
  const total = conversations.total;
  const ranked = [...conversations.by_language].sort((a, b) => b.count - a.count);
  const top3 = ranked.slice(0, 3);
  const otherTotal = ranked.slice(3).reduce((sum, r) => sum + r.count, 0);
  if (otherTotal > 0 && top3.length < 3) {
    top3.push({ language: 'mixed', count: otherTotal });
  }
  while (top3.length < 3) {
    top3.push({ language: '—', count: 0 });
  }

  // If no conversations, render empty-state for the page
  if (total === 0) {
    return `
<div class="page">
  <div class="page-header">
    <div class="eyebrow">Section III · Customer Pain Points</div>
    <div class="page-num mono">03 / 04</div>
  </div>
  <div class="section-title">
    <h2 class="display">What people <span class="italic">actually</span> asked.</h2>
    <p class="lede">No conversations have been recorded yet for ${escapeHtml(event.name)}. Once messages start flowing — through the simulator or a channel adapter — the most common intents, language mix, and response times will appear here.</p>
  </div>
  <div class="empty-state">
    <h3>No customer messages yet</h3>
    <p>Run a few sessions in the Simulator tab to populate this report. Each conversation contributes intent, language, citation, and response-time data.</p>
  </div>
  <div class="page-footer">
    <span>${escapeHtml(event.name)} · Post-Event Operations Report</span>
    <span class="mono">03 / 04</span>
  </div>
</div>`;
  }

  const langChips = top3
    .map(({ language, count }) => {
      const pct = total === 0 ? 0 : (count / total) * 100;
      return `
    <div class="lang-chip">
      <div class="lang-pct mono">${pct.toFixed(0)}<span style="font-size:14pt;">%</span></div>
      <div class="lang-name">${escapeHtml(LANGUAGE_LABELS[language] ?? language)}</div>
    </div>`;
    })
    .join('');

  // Intent rows: top 10 with bar widths
  const intentRows = intents.by_intent
    .slice(0, 10)
    .map((row) => {
      const maxCount = intents.by_intent[0]?.count ?? 1;
      const widthPct = (row.count / maxCount) * 100;
      const isRefundOrPayment =
        row.intent === 'refund_request' ||
        row.intent === 'payment_incomplete' ||
        row.intent === 'compensation_request';
      const isAccent =
        row.intent === 'event_timing' ||
        row.intent === 'dress_code' ||
        row.intent === 'age_eligibility';
      const isMuted =
        row.intent === 'other' ||
        row.intent === 'lineup_question' ||
        row.intent === 'backstage_or_vib_request';
      const cls = isRefundOrPayment ? 'warn' : isAccent ? 'accent' : isMuted ? 'muted' : '';
      return `
      <div class="bar-row" style="grid-template-columns: 38mm 1fr 12mm;">
        <div class="bar-label">${escapeHtml(intentLabel(row.intent))}</div>
        <div class="bar-track"><div class="bar-fill ${cls}" style="width: ${widthPct.toFixed(1)}%;"></div></div>
        <div class="bar-value">${row.count}</div>
      </div>`;
    })
    .join('');

  // Volume by day
  const maxDay = Math.max(...conversations.by_day.map((d) => d.count), 1);
  const dayRows = conversations.by_day.map((d) => {
    const widthPct = (d.count / maxDay) * 100;
    return `
      <div class="bar-row" style="grid-template-columns: 38mm 1fr 12mm;">
        <div class="bar-label">${escapeHtml(d.date)}</div>
        <div class="bar-track"><div class="bar-fill" style="width: ${widthPct.toFixed(1)}%;"></div></div>
        <div class="bar-value">${d.count}</div>
      </div>`;
  }).join('');

  // Response times
  const aiSec = performance.median_response_seconds_ai;
  const humanSec = performance.median_response_seconds_human;

  const topIntentsShare =
    intents.by_intent.slice(0, 3).reduce((sum, i) => sum + i.percentage, 0) * 100;

  return `
<div class="page">
  <div class="page-header">
    <div class="eyebrow">Section III · Customer Pain Points</div>
    <div class="page-num mono">03 / 04</div>
  </div>

  <div class="section-title">
    <h2 class="display">What people <span class="italic">actually</span> asked.</h2>
    <p class="lede">Beyond refunds, the bulk of inbound was logistical: when do gates open, what to wear, where to park, why hasn&rsquo;t my ticket arrived. The top three intents accounted for ${topIntentsShare.toFixed(0)}% of all conversations.</p>
  </div>

  <div class="lang-row">${langChips}
  </div>

  <div class="two-col">
    <div class="col">
      <h3>Top customer intents by volume</h3>
${intentRows}
    </div>

    <div class="col">
      <h3>Response performance</h3>
      <div style="margin-bottom: 8mm;">
        <div style="font-family:'Fraunces',serif;font-weight:500;font-size:38pt;line-height:1;color:var(--accent);letter-spacing:-0.02em;">${aiSec == null ? '—' : aiSec.toFixed(0)}<span style="font-size:18pt;color:var(--ink-muted);"> sec</span></div>
        <div style="font-size:9pt;color:var(--ink-muted);margin-top:2mm;">Median response time, AI-resolved conversations.</div>
      </div>
      <div style="margin-bottom: 8mm;">
        <div style="font-family:'Fraunces',serif;font-weight:500;font-size:38pt;line-height:1;letter-spacing:-0.02em;">${humanSec == null ? '—' : humanSec.toFixed(0)}<span style="font-size:18pt;color:var(--ink-muted);"> sec</span></div>
        <div style="font-size:9pt;color:var(--ink-muted);margin-top:2mm;">Median time-to-reply on escalated conversations.</div>
      </div>

      <h3 style="margin-top: 10mm;">Volume by day</h3>
${dayRows || '<p style="font-size:9pt;color:var(--ink-muted);">No day-level data yet.</p>'}
    </div>
  </div>

  <div class="page-footer">
    <span>${escapeHtml(event.name)} · Post-Event Operations Report</span>
    <span class="mono">03 / 04</span>
  </div>
</div>`;
}

function renderRecommendationsPage(data: ReportData): string {
  const { event, kb, escalations, orders, refund } = data;

  // Compute concrete recommendations from data
  const recs: { title: string; body: string }[] = [];

  // Rec 1: top cited KB section (if any)
  if (kb.top_sections.length > 0) {
    const top = kb.top_sections[0];
    recs.push({
      title: `Promote &ldquo;${escapeHtml(top.question_en ?? top.section_id)}&rdquo; into pre-event comms.`,
      body: `Section <span class="mono">${escapeHtml(top.section_id)}</span> was cited ${top.citation_count} ${top.citation_count === 1 ? 'time' : 'times'} — the most-referenced KB entry. A proactive push to ticket holders 48 hours before the event would absorb a portion of this inbound and free up agent capacity for higher-value cases.`,
    });
  }

  // Rec 2: unrecovered payments
  if (orders.payment_failed_orders + orders.payment_pending_orders > 0) {
    const lost = orders.payment_failed_orders + orders.payment_pending_orders;
    recs.push({
      title: `Add a payment-recovery flow for the ${lost} incomplete-payment ${lost === 1 ? 'order' : 'orders'}.`,
      body: `These orders sat unrecovered for the event window. A simple retry-link follow-up via the same channel that surfaced them would convert a meaningful share. This is the natural v1.1 extension of the deflection system.`,
    });
  }

  // Rec 3: escalation reasons cluster
  if (escalations.by_reason.length > 0) {
    const topReason = escalations.by_reason[0];
    recs.push({
      title: `Reduce the &ldquo;${escapeHtml(topReason.reason)}&rdquo; escalation pattern.`,
      body: `This reason triggered ${topReason.count} ${topReason.count === 1 ? 'escalation' : 'escalations'} — the most common in this window. Worth reviewing whether the underlying issue is a KB gap, a policy ambiguity, or an operational gap before the next event.`,
    });
  }

  // Rec 4: refund deflection inverse — escalated refund cases
  if (refund.escalated_count > 0) {
    recs.push({
      title: `Document the medical-exception and edge-case refund flows.`,
      body: `${refund.escalated_count} refund ${refund.escalated_count === 1 ? 'case was' : 'cases were'} escalated. Some are correctly handled by humans (medical, safety, legal). Others may be deflectable with clearer KB phrasing on what alternatives are available outside the refund window.`,
    });
  }

  // Always include: bilingual KB review (template generic)
  recs.push({
    title: 'Review bilingual phrasing on low-confidence sections.',
    body: 'Any KB section that triggered a low-confidence generator escalation is a candidate for a native rewrite (not a translation). The simulator&rsquo;s session logs show which sections were near the confidence floor.',
  });

  // Always include: post-event lessons-learned
  recs.push({
    title: 'Schedule a post-event lessons-learned with the ops team.',
    body: 'Walk through the escalations list together with the agent transcripts. Most prompt and KB improvements come from this conversation rather than from a metrics review.',
  });

  const renderedRecs = recs
    .slice(0, 6)
    .map(
      (r, i) => `
    <div class="rec">
      <div class="rec-num mono">${(i + 1).toString().padStart(2, '0')}</div>
      <div class="rec-body">
        <h4>${r.title}</h4>
        <p>${r.body}</p>
      </div>
    </div>`,
    )
    .join('');

  const protectedFmt = formatMoney(refund.estimated_revenue_protected, event.default_currency);
  const hoursSavedFmt = data.performance.estimated_team_hours_saved.toFixed(0);

  return `
<div class="page">
  <div class="page-header">
    <div class="eyebrow">Section IV · Recommendations</div>
    <div class="page-num mono">04 / 04</div>
  </div>

  <div class="section-title">
    <h2 class="display">Fix before <span class="italic">next time.</span></h2>
    <p class="lede">Concrete improvements identified from this event&rsquo;s data. Each is scoped to be addressable before the next event in the same series.</p>
  </div>

  <div class="recs">${renderedRecs}
  </div>

  <div style="margin-top: 12mm; padding: 6mm; background: var(--paper-warm); border-left: 2px solid var(--accent);">
    <div class="eyebrow" style="margin-bottom: 3mm;">Bottom Line</div>
    <p style="font-family:'Fraunces',serif;font-size:13pt;font-style:italic;line-height:1.4;color:var(--ink);">
      ${data.conversations.total} ${data.conversations.total === 1 ? 'conversation' : 'conversations'} handled. ${escapeHtml(protectedFmt)} protected. ${hoursSavedFmt} hours of team time saved. Improvements queued for the next event.
    </p>
  </div>

  <div class="page-footer">
    <span>${escapeHtml(event.name)} · Post-Event Operations Report · End</span>
    <span class="mono">04 / 04</span>
  </div>
</div>`;
}

// ============================================================================
// ENTRY POINT
// ============================================================================

export function renderReport(data: ReportData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Post-Event Operations Report — ${escapeHtml(data.event.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700;9..144,800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${REPORT_CSS}</style>
</head>
<body>
${renderCover(data)}
${renderRefundPage(data)}
${renderPainPointsPage(data)}
${renderRecommendationsPage(data)}
</body>
</html>`;
}
