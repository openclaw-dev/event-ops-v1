import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeAdmin, type QueryCtx } from './helpers/supabase-mock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => ({ admin: undefined as any }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));

import { POST } from '@/app/api/webhooks/payments/[provider]/route';
import { computeCheckoutSignature } from '@/lib/payments/verifiers/checkout';

const SECRET = 'whsec_test_123';

const payload = {
  id: 'evt_1',
  type: 'payment_captured',
  data: { id: 'pay_1', amount: 15000, currency: 'SAR', reference: 'TZK-ABC123' },
};
const rawBody = JSON.stringify(payload);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeReq(body: string, headers: Record<string, string>): any {
  return {
    text: async () => body,
    headers: new Headers(headers),
  };
}

describe('payment webhook endpoint (Item 8e)', () => {
  beforeEach(() => {
    process.env.CHECKOUT_WEBHOOK_SECRET = SECRET;
  });

  it('rejects a bad signature with 401 and stores nothing', async () => {
    const touched: QueryCtx[] = [];
    h.admin = makeAdmin(
      () => ({ data: null, error: null }),
      (ctx) => touched.push(ctx),
    );

    const req = makeReq(rawBody, { 'cko-signature': 'deadbeef' });
    const res = await POST(req, { params: { provider: 'checkout' } });

    expect(res.status).toBe(401);
    expect(touched).toHaveLength(0);
  });

  it('confirms the matched attempt on a valid captured event', async () => {
    const writes: QueryCtx[] = [];
    h.admin = makeAdmin(
      (ctx: QueryCtx) => {
        if (ctx.table === 'payment_recovery_attempts' && ctx.op === 'select') {
          return { data: { id: 'att1', operator_id: 'op1' }, error: null };
        }
        if (ctx.table === 'payment_webhook_events' && ctx.op === 'insert') {
          return { data: { id: 'we1' }, error: null };
        }
        if (ctx.table === 'payment_recovery_attempts' && ctx.op === 'update') {
          return { data: [{ id: 'att1' }], error: null };
        }
        return { data: null, error: null };
      },
      (ctx) => {
        if (ctx.op === 'update' || ctx.op === 'insert') writes.push(ctx);
      },
    );

    const sig = computeCheckoutSignature(rawBody, SECRET);
    const req = makeReq(rawBody, { 'cko-signature': sig });
    const res = await POST(req, { params: { provider: 'checkout' } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmed).toBe(true);

    const confirm = writes.find(
      (w) => w.table === 'payment_recovery_attempts' && w.op === 'update',
    );
    const p = confirm?.payload as Record<string, unknown>;
    expect(p.status).toBe('completed');
    expect(p.confirmed_amount).toBe(150);
    expect(p.confirmed_currency).toBe('SAR');
    expect(p.webhook_confirmed_at).toBeDefined();
  });

  it('returns 200 without reprocessing on a replayed event', async () => {
    const attemptUpdates: QueryCtx[] = [];
    h.admin = makeAdmin(
      (ctx: QueryCtx) => {
        if (ctx.table === 'payment_recovery_attempts' && ctx.op === 'select') {
          return { data: { id: 'att1', operator_id: 'op1' }, error: null };
        }
        if (ctx.table === 'payment_webhook_events' && ctx.op === 'insert') {
          // Unique (provider, provider_event_id) violation → replay.
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        return { data: null, error: null };
      },
      (ctx) => {
        if (ctx.table === 'payment_recovery_attempts' && ctx.op === 'update') {
          attemptUpdates.push(ctx);
        }
      },
    );

    const sig = computeCheckoutSignature(rawBody, SECRET);
    const req = makeReq(rawBody, { 'cko-signature': sig });
    const res = await POST(req, { params: { provider: 'checkout' } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
    // No double-processing: the attempt was never updated.
    expect(attemptUpdates).toHaveLength(0);
  });
});
