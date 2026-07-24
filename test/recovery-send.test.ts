import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeAdmin, type QueryCtx } from './helpers/supabase-mock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => ({ admin: undefined as any, adapter: undefined as any }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/whatsapp/adapter-factory', () => ({
  createWhatsAppAdapter: () => h.adapter,
}));

import { sendRecoveryMessage, getRecoveryStats } from '@/lib/recovery/payment-recovery';

describe('recovery send path (Item 8b)', () => {
  beforeEach(() => {
    h.adapter = {
      sendText: vi.fn().mockResolvedValue({ success: true, wamid: 'w1' }),
      sendInteractive: vi.fn(),
    };
  });

  it('skips an opted-out recipient without contacting the adapter', async () => {
    const writes: QueryCtx[] = [];
    h.admin = makeAdmin(
      (ctx: QueryCtx) => {
        if (ctx.table === 'payment_recovery_attempts' && ctx.op === 'select') {
          return {
            data: {
              operator_id: 'op1',
              customer_phone_e164: '+966500000000',
              customer_name: 'A',
              ticket_type: 'GA',
              quantity: 1,
              amount_sar: 100,
              payment_link: 'https://pay',
              event_id: 'ev1',
            },
            error: null,
          };
        }
        if (ctx.table === 'events') return { data: { is_demo: false }, error: null };
        if (ctx.table === 'whatsapp_opt_outs') {
          return { data: { phone_e164: '+966500000000' }, error: null };
        }
        return { data: null, error: null };
      },
      (ctx) => {
        if (ctx.op === 'update' || ctx.op === 'insert' || ctx.op === 'upsert') writes.push(ctx);
      },
    );

    const result = await sendRecoveryMessage({
      recovery_attempt_id: 'att1',
      event_name: 'Event',
    });

    expect(result.skipped).toBe(true);
    expect(result.success).toBe(false);
    expect(h.adapter.sendText).not.toHaveBeenCalled();
    // The attempt is marked terminal (failed) rather than left pending.
    const marked = writes.find(
      (w) => w.table === 'payment_recovery_attempts' && w.op === 'update',
    );
    expect((marked?.payload as { status?: string })?.status).toBe('failed');
  });
});

describe('recovery stats use webhook-confirmed rows only (Item 8f)', () => {
  it('recovered/fee come from confirmed_amount; heuristic-only is "awaiting"', async () => {
    h.admin = makeAdmin((ctx: QueryCtx) => {
      if (ctx.table === 'payment_recovery_attempts') {
        return {
          data: [
            {
              status: 'sent',
              amount_sar: 100,
              confirmed_amount: null,
              webhook_confirmed_at: null,
              heuristic_paid_signal_at: '2026-07-01T00:00:00Z',
            },
            {
              status: 'completed',
              amount_sar: 200,
              confirmed_amount: 200,
              webhook_confirmed_at: '2026-07-02T00:00:00Z',
              heuristic_paid_signal_at: null,
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });

    const stats = await getRecoveryStats('ev1');
    expect(stats.recovered_amount_sar).toBe(200);
    expect(stats.recovery_fee_sar).toBeCloseTo(44, 5);
    expect(stats.claimed_awaiting_confirmation).toBe(1);
    expect(stats.completed).toBe(1);
  });
});
