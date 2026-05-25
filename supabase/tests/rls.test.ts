// ============================================================================
// supabase/tests/rls.test.ts
//
// Integration test for Row-Level Security policies.
//
// Creates two auth users, two operators, links each user to one operator,
// creates an event per operator, then signs in as user A and asserts:
//   1. User A can see operator A's event.
//   2. User A cannot see operator B's event.
//   3. Exactly one event is visible.
//
// Run with: pnpm test:rls
//
// Requires env vars (loaded from .env.local via node --env-file):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//
// The test cleans up after itself: deleted operators cascade events, deleted
// auth users cascade to operator_users via the user_id FK.
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    'Missing env. Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.',
  );
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Created = {
  userAId?: string;
  userBId?: string;
  op1Id: string;
  op2Id: string;
  ev1Id: string;
  ev2Id: string;
};

async function cleanup(created: Partial<Created>) {
  if (created.op1Id || created.op2Id) {
    const ids = [created.op1Id, created.op2Id].filter(Boolean) as string[];
    if (ids.length) await admin.from('operators').delete().in('id', ids);
  }
  if (created.userAId) await admin.auth.admin.deleteUser(created.userAId);
  if (created.userBId) await admin.auth.admin.deleteUser(created.userBId);
}

let passed = 0;
let failed = 0;
function expect(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  const tag = `rls-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const emailA = `${tag}-a@example.test`;
  const emailB = `${tag}-b@example.test`;
  const password = `Pw-${randomUUID()}`;

  const created: Partial<Created> = {};

  try {
    console.log('Setting up two users, two operators, two events.\n');

    // 1. Create two auth users (email-confirmed so they can sign in immediately).
    const { data: a, error: errA } = await admin.auth.admin.createUser({
      email: emailA,
      password,
      email_confirm: true,
    });
    if (errA || !a.user) throw new Error(`createUser A: ${errA?.message}`);
    created.userAId = a.user.id;

    const { data: b, error: errB } = await admin.auth.admin.createUser({
      email: emailB,
      password,
      email_confirm: true,
    });
    if (errB || !b.user) throw new Error(`createUser B: ${errB?.message}`);
    created.userBId = b.user.id;

    // 2. Create two operators.
    created.op1Id = randomUUID();
    created.op2Id = randomUUID();
    const { error: opErr } = await admin.from('operators').insert([
      { id: created.op1Id, name: `RLS Test Operator A ${tag}`, country_code: 'AE' },
      { id: created.op2Id, name: `RLS Test Operator B ${tag}`, country_code: 'AE' },
    ]);
    if (opErr) throw new Error(`operators insert: ${opErr.message}`);

    // 3. Link each user to one operator.
    const { error: ouErr } = await admin.from('operator_users').insert([
      { operator_id: created.op1Id, user_id: created.userAId, role: 'owner' },
      { operator_id: created.op2Id, user_id: created.userBId, role: 'owner' },
    ]);
    if (ouErr) throw new Error(`operator_users insert: ${ouErr.message}`);

    // 4. Create one event per operator.
    created.ev1Id = randomUUID();
    created.ev2Id = randomUUID();
    const { error: evErr } = await admin.from('events').insert([
      {
        id: created.ev1Id,
        operator_id: created.op1Id,
        name: `Event A ${tag}`,
        slug: `${tag}-a`,
        event_type: 'festival',
        start_date: '2026-12-01',
        end_date: '2026-12-01',
        timezone: 'Asia/Dubai',
        venue_name: 'Test Venue A',
        venue_city: 'Dubai',
        age_minimum: 18,
        status: 'draft',
      },
      {
        id: created.ev2Id,
        operator_id: created.op2Id,
        name: `Event B ${tag}`,
        slug: `${tag}-b`,
        event_type: 'club',
        start_date: '2026-12-02',
        end_date: '2026-12-02',
        timezone: 'Asia/Dubai',
        venue_name: 'Test Venue B',
        venue_city: 'Dubai',
        age_minimum: 21,
        status: 'draft',
      },
    ]);
    if (evErr) throw new Error(`events insert: ${evErr.message}`);

    // 5. Sign in as user A using the anon key (RLS applies to this JWT).
    const userClient: SupabaseClient = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInErr } = await userClient.auth.signInWithPassword({
      email: emailA,
      password,
    });
    if (signInErr) throw new Error(`sign-in A: ${signInErr.message}`);

    // 6. Assertions.
    console.log('Assertions:');

    const { data: visible, error: selErr } = await userClient
      .from('events')
      .select('id, operator_id, name')
      .in('id', [created.ev1Id, created.ev2Id]);
    expect('events SELECT succeeds for user A', !selErr, selErr?.message);

    const visibleIds = (visible ?? []).map((e) => e.id);
    expect(
      "user A sees own operator's event",
      visibleIds.includes(created.ev1Id!),
      `visible IDs: ${JSON.stringify(visibleIds)}`,
    );
    expect(
      "user A cannot see other operator's event (RLS isolation)",
      !visibleIds.includes(created.ev2Id!),
      visibleIds.includes(created.ev2Id!) ? 'RLS LEAK — saw B' : undefined,
    );
    expect(
      'exactly one event visible to user A',
      (visible ?? []).length === 1,
      `got ${(visible ?? []).length}`,
    );

    // 7. Cross-check via operators table — A should see only op1.
    const { data: opsVisible, error: opSelErr } = await userClient
      .from('operators')
      .select('id, name')
      .in('id', [created.op1Id!, created.op2Id!]);
    expect('operators SELECT succeeds for user A', !opSelErr, opSelErr?.message);
    const opIds = (opsVisible ?? []).map((o) => o.id);
    expect(
      "user A sees only own operator row",
      opIds.length === 1 && opIds[0] === created.op1Id,
      `visible: ${JSON.stringify(opIds)}`,
    );

    // 8. Negative write: A tries to insert an event under operator 2. Should fail RLS WITH CHECK.
    const { error: writeErr } = await userClient.from('events').insert({
      operator_id: created.op2Id,
      name: 'unauthorized',
      slug: `${tag}-evil`,
      event_type: 'club',
      start_date: '2026-12-03',
      end_date: '2026-12-03',
      timezone: 'Asia/Dubai',
      venue_name: 'x',
      venue_city: 'x',
      age_minimum: 18,
      status: 'draft',
    });
    expect(
      'user A INSERT into operator B is rejected by RLS',
      writeErr !== null,
      writeErr ? undefined : 'insert succeeded — RLS WITH CHECK is not enforced',
    );
  } finally {
    console.log('\nCleaning up.');
    await cleanup(created);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTest crashed:', err);
  process.exit(1);
});
