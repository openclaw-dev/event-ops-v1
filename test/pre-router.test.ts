import { describe, it, expect, vi } from 'vitest';

import { makeAdmin, type QueryCtx } from './helpers/supabase-mock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => ({ admin: undefined as any }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));

import { preRouteInbound } from '@/lib/whatsapp/inbound-pre-router';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeAdapter(): any {
  return {
    sendText: vi.fn().mockResolvedValue({ success: true, wamid: 'w1' }),
    sendInteractive: vi.fn(),
  };
}

describe('STOP writes the opt-out registry (Item 8d)', () => {
  function setup() {
    const writes: QueryCtx[] = [];
    h.admin = makeAdmin(
      (ctx: QueryCtx) => {
        if (ctx.table === 'crm_campaign_recipients') return { data: [], error: null };
        if (ctx.table === 'payment_recovery_attempts') return { data: [], error: null };
        return { data: null, error: null };
      },
      (ctx) => {
        if (ctx.op === 'upsert') writes.push(ctx);
      },
    );
    return writes;
  }

  it.each([
    ['English STOP', 'STOP'],
    ['Arabic إيقاف', 'إيقاف'],
  ])('%s creates an idempotent opt-out row', async (_label, text) => {
    const writes = setup();
    const adapter = fakeAdapter();

    const result = await preRouteInbound({
      adapter,
      operatorId: 'op1',
      phone: '+966500000000',
      text,
    });

    expect(result).toEqual({ handled: true, branch: 'opt_out' });
    expect(writes).toHaveLength(1);
    const w = writes[0];
    expect(w.table).toBe('whatsapp_opt_outs');
    expect((w.payload as { phone_e164: string }).phone_e164).toBe('+966500000000');
    expect((w.payload as { source: string }).source).toBe('stop_keyword');
    // ON CONFLICT DO NOTHING → idempotent repeat.
    expect((w.options as { onConflict: string }).onConflict).toBe('operator_id,phone_e164');
    expect((w.options as { ignoreDuplicates: boolean }).ignoreDuplicates).toBe(true);
  });

  it('is idempotent across repeated STOPs', async () => {
    const writes = setup();
    const adapter = fakeAdapter();
    await preRouteInbound({ adapter, operatorId: 'op1', phone: '+966500000000', text: 'STOP' });
    await preRouteInbound({ adapter, operatorId: 'op1', phone: '+966500000000', text: 'stop' });
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect((w.options as { ignoreDuplicates: boolean }).ignoreDuplicates).toBe(true);
    }
  });
});

describe('paid-keyword records a soft signal only (Item 8f)', () => {
  it('sets heuristic_paid_signal_at and never status/webhook_confirmed_at', async () => {
    const writes: QueryCtx[] = [];
    h.admin = makeAdmin(
      (ctx: QueryCtx) => {
        if (ctx.table === 'payment_recovery_attempts' && ctx.op === 'select') {
          return { data: [{ id: 'att1' }], error: null };
        }
        if (ctx.table === 'payment_recovery_attempts' && ctx.op === 'update') {
          return { data: [{ id: 'att1' }], error: null };
        }
        return { data: [], error: null };
      },
      (ctx) => {
        if (ctx.op === 'update') writes.push(ctx);
      },
    );
    const adapter = fakeAdapter();

    const result = await preRouteInbound({
      adapter,
      operatorId: 'op1',
      phone: '+966500000000',
      text: 'paid',
    });

    expect(result).toEqual({ handled: true, branch: 'recovery_completed' });
    const upd = writes.find((w) => w.table === 'payment_recovery_attempts');
    const payload = upd?.payload as Record<string, unknown>;
    expect(payload.heuristic_paid_signal_at).toBeDefined();
    expect(payload.status).toBeUndefined();
    expect(payload.webhook_confirmed_at).toBeUndefined();
  });
});
