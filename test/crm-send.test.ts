import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeAdmin, type QueryCtx } from './helpers/supabase-mock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => ({ admin: undefined as any, adapter: undefined as any }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => h.admin }));
vi.mock('@/lib/whatsapp/adapter-factory', () => ({
  createWhatsAppAdapter: () => h.adapter,
}));

import { sendCampaign } from '@/lib/crm/campaigns';

describe('CRM campaign send closes the re-add gap (Item 8c)', () => {
  beforeEach(() => {
    h.adapter = {
      sendText: vi.fn().mockResolvedValue({ success: true, wamid: 'w1' }),
      sendInteractive: vi.fn(),
    };
  });

  it('skips a freshly-added pending recipient whose phone is opted out', async () => {
    const writes: QueryCtx[] = [];
    h.admin = makeAdmin(
      (ctx: QueryCtx) => {
        if (ctx.table === 'crm_campaigns' && ctx.op === 'select') {
          return {
            data: {
              message_template: 'Hi {{name}}',
              target_event_id: null,
              event_id: null,
              operator_id: 'op1',
            },
            error: null,
          };
        }
        // Atomic claim draft→sending.
        if (ctx.table === 'crm_campaigns' && ctx.op === 'update' && ctx.filters.status === 'draft') {
          return { data: [{ id: 'camp1' }], error: null };
        }
        if (ctx.table === 'crm_campaigns' && ctx.op === 'update') {
          return { data: null, error: null };
        }
        // Freshly re-added recipient — status 'pending' in a NEW campaign.
        if (ctx.table === 'crm_campaign_recipients' && ctx.op === 'select') {
          return {
            data: [{ id: 'r1', customer_phone_e164: '+966500000000', customer_name: 'A' }],
            error: null,
          };
        }
        // Opt-out registry has the phone (opted out on a previous campaign).
        if (ctx.table === 'whatsapp_opt_outs') {
          return { data: { phone_e164: '+966500000000' }, error: null };
        }
        return { data: null, error: null };
      },
      (ctx) => {
        if (ctx.op === 'update' || ctx.op === 'insert') writes.push(ctx);
      },
    );

    const result = await sendCampaign('camp1');

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(h.adapter.sendText).not.toHaveBeenCalled();
    // Recipient durably marked opted_out (0027 enum).
    const recipientWrite = writes.find(
      (w) => w.table === 'crm_campaign_recipients' && w.op === 'update',
    );
    expect((recipientWrite?.payload as { status?: string })?.status).toBe('opted_out');
  });
});
