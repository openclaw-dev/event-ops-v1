import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeAdmin, type QueryCtx } from './helpers/supabase-mock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => ({ admin: undefined as any, adapter: undefined as any }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/whatsapp/adapter-factory', () => ({
  createWhatsAppAdapter: () => h.adapter,
}));

import { sendBusinessInitiated, isSkipped } from '@/lib/whatsapp/outbound-guard';

describe('outbound guard (Item 8a)', () => {
  beforeEach(() => {
    h.adapter = {
      sendText: vi.fn().mockResolvedValue({ success: true, wamid: 'w1' }),
      sendInteractive: vi.fn(),
    };
  });

  it('blocks an opted-out phone and never touches the adapter', async () => {
    h.admin = makeAdmin((ctx: QueryCtx) => {
      if (ctx.table === 'whatsapp_opt_outs') {
        return { data: { phone_e164: '+966500000000' }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await sendBusinessInitiated({
      operatorId: 'op1',
      phone: '+966 50 000 0000',
      messageType: 'template',
      payload: { text: 'hi' },
    });

    expect(isSkipped(result)).toBe(true);
    expect(h.adapter.sendText).not.toHaveBeenCalled();
  });

  it('forwards to the adapter when not opted out (normalised phone)', async () => {
    h.admin = makeAdmin((ctx: QueryCtx) => {
      if (ctx.table === 'whatsapp_opt_outs') return { data: null, error: null };
      return { data: null, error: null };
    });

    const result = await sendBusinessInitiated({
      operatorId: 'op1',
      phone: '+966 50 000 0000',
      messageType: 'template',
      payload: { text: 'hi' },
    });

    expect(isSkipped(result)).toBe(false);
    expect(h.adapter.sendText).toHaveBeenCalledWith({
      to_phone_e164: '+966500000000',
      text: 'hi',
    });
  });

  it('fails safe (skips) when the opt-out lookup errors', async () => {
    h.admin = makeAdmin(() => ({ data: null, error: { message: 'db down' } }));

    const result = await sendBusinessInitiated({
      operatorId: 'op1',
      phone: '+966500000000',
      messageType: 'template',
      payload: { text: 'hi' },
    });

    expect(isSkipped(result)).toBe(true);
    expect(h.adapter.sendText).not.toHaveBeenCalled();
  });
});
