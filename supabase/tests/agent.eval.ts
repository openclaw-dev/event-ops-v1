/**
 * Adversarial evaluation of the agent runtime.
 *
 * Runs all 50 messages in docs/data/test_messages.json against the seeded
 * Coastline Festival event and reports:
 *   - intent classification accuracy (expected vs actual)
 *   - guardrail trips and the reason for each
 *   - any fabricated responses (cited section_ids not present in the KB)
 *
 * Usage:
 *   node --env-file=.env.local --import tsx supabase/tests/agent.eval.ts
 *
 * Reads via the service-role client (BYPASSRLS) so we don't need an auth
 * session in the test harness. The agent receives the same client and
 * therefore reads the same rows it would in production after RLS.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { runAgent } from '../../src/lib/agent/state-machine';
import type {
  AgentTurnResult,
  ConversationSnapshot,
} from '../../src/lib/agent/types';
import type { EventConfig } from '../../src/lib/types';

const COASTLINE_EVENT_ID = 'a9107667-93da-56fb-aaaf-b6d5f6d723bf';
const SESSION_PHONE = '+971500000000';

interface TestMessage {
  id: string;
  language: string;
  text: string;
  expected_intent: string;
  expected_action:
    | 'respond_from_kb'
    | 'request_order_lookup'
    | 'deflect_with_alternative'
    | 'escalate'
    | 'hard_refuse_then_escalate';
  escalation_reason: string | null;
  notes: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function mapResultToAction(r: AgentTurnResult): TestMessage['expected_action'] {
  if (r.escalation) return 'escalate';
  if (r.new_state === 'order_lookup') return 'request_order_lookup';
  if (r.new_state === 'refund_deflection') return 'deflect_with_alternative';
  return 'respond_from_kb';
}

function actionsEquivalent(
  expected: TestMessage['expected_action'],
  actual: TestMessage['expected_action'],
): boolean {
  // The agent has a single "escalate" path; both expected variants map to it.
  if (
    (expected === 'escalate' || expected === 'hard_refuse_then_escalate') &&
    actual === 'escalate'
  ) {
    return true;
  }
  return expected === actual;
}

async function main() {
  // ── Load test messages ──
  const messagesPath = resolve(process.cwd(), 'docs/data/test_messages.json');
  const messages: TestMessage[] = JSON.parse(readFileSync(messagesPath, 'utf-8'));

  // ── Load event + config ──
  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, name, config')
    .eq('id', COASTLINE_EVENT_ID)
    .single();

  if (eventError || !event) {
    console.error('Failed to load Coastline Festival event:', eventError?.message);
    process.exit(1);
  }

  const eventConfig = event.config as EventConfig;

  // ── Load valid section IDs for fabrication detection ──
  const { data: kbRows } = await supabase
    .from('kb_sections')
    .select('section_id')
    .eq('event_id', COASTLINE_EVENT_ID);

  const validSectionIds = new Set((kbRows ?? []).map((r) => r.section_id));
  console.log(`\nLoaded ${validSectionIds.size} KB sections for ${event.name}.\n`);

  // ── Run each test message ──
  interface Row {
    id: string;
    language: string;
    text: string;
    expected_intent: string;
    classified_intent: string | null;
    intent_match: boolean;
    expected_action: TestMessage['expected_action'];
    actual_action: TestMessage['expected_action'];
    action_match: boolean;
    escalated: boolean;
    escalation_reason: string | null;
    cited_section_ids: string[];
    fabricated_ids: string[];
    reply_preview: string;
  }

  const results: Row[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    process.stdout.write(`[${(i + 1).toString().padStart(2, ' ')}/50] ${m.id} `);

    const snapshot: ConversationSnapshot = {
      conversation_id: `eval-${m.id}`,
      event_id: COASTLINE_EVENT_ID,
      customer_phone_e164: SESSION_PHONE,
      state: 'greeting',
      matched_order: null,
      classified_reason: null,
      alternative_offered: null,
      language: 'en',
      refund_case_id: null,
      message_history: [],
      consecutive_no_progress_turns: 0,
    };

    let result: AgentTurnResult;
    try {
      result = await runAgent({ supabase, snapshot, message: m.text, eventConfig });
    } catch (err) {
      console.log('ERROR');
      console.error(err);
      continue;
    }

    const actualAction = mapResultToAction(result);
    const intentMatch = result.classified_intent === m.expected_intent;
    const actionMatch = actionsEquivalent(m.expected_action, actualAction);
    const fabricatedIds = (result.cited_section_ids ?? []).filter(
      (id) => !validSectionIds.has(id),
    );

    results.push({
      id: m.id,
      language: m.language,
      text: m.text,
      expected_intent: m.expected_intent,
      classified_intent: result.classified_intent ?? '(null)',
      intent_match: intentMatch,
      expected_action: m.expected_action,
      actual_action: actualAction,
      action_match: actionMatch,
      escalated: result.escalation !== null,
      escalation_reason: result.escalation?.reason ?? null,
      cited_section_ids: result.cited_section_ids,
      fabricated_ids: fabricatedIds,
      reply_preview: result.reply_text.slice(0, 140),
    });

    const intentSym = intentMatch ? '✓' : '✗';
    const actionSym = actionMatch ? '✓' : '✗';
    console.log(
      `intent ${intentSym} (${result.classified_intent ?? '∅'} vs ${m.expected_intent})  ` +
        `action ${actionSym} (${actualAction} vs ${m.expected_action})` +
        (fabricatedIds.length > 0 ? `  ⚠ FABRICATED: ${fabricatedIds.join(', ')}` : ''),
    );
  }

  // ── Summary ──
  console.log('\n' + '─'.repeat(80));
  console.log('SUMMARY');
  console.log('─'.repeat(80));

  const total = results.length;
  const intentCorrect = results.filter((r) => r.intent_match).length;
  const actionCorrect = results.filter((r) => r.action_match).length;
  const escalations = results.filter((r) => r.escalated);
  const expectedEscalations = messages.filter(
    (m) => m.expected_action === 'escalate' || m.expected_action === 'hard_refuse_then_escalate',
  );
  const escalationsCorrect = results.filter(
    (r) =>
      r.escalated ===
      (r.expected_action === 'escalate' || r.expected_action === 'hard_refuse_then_escalate'),
  ).length;
  const fabrications = results.filter((r) => r.fabricated_ids.length > 0);

  console.log(`\nIntent classification: ${intentCorrect}/${total} (${((intentCorrect / total) * 100).toFixed(0)}%)`);
  console.log(`Action mapping:        ${actionCorrect}/${total} (${((actionCorrect / total) * 100).toFixed(0)}%)`);
  console.log(`Escalation accuracy:   ${escalationsCorrect}/${total} (expected ${expectedEscalations.length}, got ${escalations.length})`);
  console.log(`Fabrications:          ${fabrications.length}/${total}`);

  // ── Detail tables ──
  console.log('\n' + '─'.repeat(80));
  console.log('INTENT MISMATCHES');
  console.log('─'.repeat(80));
  const intentMismatches = results.filter((r) => !r.intent_match);
  if (intentMismatches.length === 0) {
    console.log('(none — every message classified correctly)');
  } else {
    for (const r of intentMismatches) {
      console.log(`${r.id} [${r.language}]  expected=${r.expected_intent}  got=${r.classified_intent}`);
      console.log(`         "${r.text}"`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('ACTION MISMATCHES');
  console.log('─'.repeat(80));
  const actionMismatches = results.filter((r) => !r.action_match);
  if (actionMismatches.length === 0) {
    console.log('(none — every message routed correctly)');
  } else {
    for (const r of actionMismatches) {
      console.log(
        `${r.id} [${r.language}]  expected=${r.expected_action}  got=${r.actual_action}` +
          (r.escalation_reason ? `  reason=${r.escalation_reason}` : ''),
      );
      console.log(`         "${r.text}"`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('GUARDRAIL TRIPS');
  console.log('─'.repeat(80));
  const trips: Record<string, Row[]> = {};
  for (const r of escalations) {
    const key = r.escalation_reason ?? '(no reason)';
    (trips[key] ??= []).push(r);
  }
  const tripKeys = Object.keys(trips).sort();
  if (tripKeys.length === 0) {
    console.log('(no escalations)');
  } else {
    for (const k of tripKeys) {
      console.log(`\n  ${k} (${trips[k].length})`);
      for (const r of trips[k]) {
        console.log(`    ${r.id}  "${r.text.slice(0, 80)}"`);
      }
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('FABRICATIONS (cited section_ids not in KB)');
  console.log('─'.repeat(80));
  if (fabrications.length === 0) {
    console.log('(none — every cited section_id exists in the KB)');
  } else {
    for (const r of fabrications) {
      console.log(`${r.id}  cited=${r.cited_section_ids.join(', ')}  bad=${r.fabricated_ids.join(', ')}`);
      console.log(`        "${r.reply_preview}"`);
    }
  }

  // ── Persist full results for follow-up review ──
  const outPath = resolve(process.cwd(), 'supabase/tests/agent.eval.results.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nFull per-message results written to: ${outPath}\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
