import { describe, it, expect } from 'vitest';

import {
  computeCheckoutSignature,
  verifyCheckoutSignature,
  parseCheckoutEvent,
} from '@/lib/payments/verifiers/checkout';
import {
  computeTapHashString,
  verifyTapSignature,
  parseTapEvent,
} from '@/lib/payments/verifiers/tap';

const SECRET = 'whsec_test_123';

describe('checkout verifier', () => {
  const payload = {
    id: 'evt_1',
    type: 'payment_captured',
    data: {
      id: 'pay_1',
      amount: 15000, // minor units
      currency: 'SAR',
      reference: 'TZK-ABC123',
    },
  };
  const rawBody = JSON.stringify(payload);

  it('accepts a valid cko-signature over the raw body', () => {
    const sig = computeCheckoutSignature(rawBody, SECRET);
    expect(verifyCheckoutSignature(rawBody, { 'cko-signature': sig }, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = computeCheckoutSignature(rawBody, SECRET);
    expect(verifyCheckoutSignature(rawBody + ' ', { 'cko-signature': sig }, SECRET)).toBe(
      false,
    );
  });

  it('rejects a missing header', () => {
    expect(verifyCheckoutSignature(rawBody, {}, SECRET)).toBe(false);
  });

  it('parses into a normalised event (minor→major amount)', () => {
    const ev = parseCheckoutEvent(payload);
    expect(ev).not.toBeNull();
    expect(ev!.providerEventId).toBe('evt_1');
    expect(ev!.providerPaymentId).toBe('pay_1');
    expect(ev!.recoveryRef).toBe('TZK-ABC123');
    expect(ev!.amount).toBe(150);
    expect(ev!.currency).toBe('SAR');
    expect(ev!.captured).toBe(true);
  });
});

describe('tap verifier', () => {
  const payload = {
    id: 'chg_1',
    amount: 150.0,
    currency: 'SAR',
    status: 'CAPTURED',
    reference: { order: 'TZK-XYZ777', payment: 'pay_x' },
    gateway: { reference: 'g1' },
    transaction: { created: '1700000000000' },
  };
  const rawBody = JSON.stringify(payload);

  it('accepts a valid hashstring', () => {
    const hash = computeTapHashString(payload, SECRET);
    expect(verifyTapSignature(rawBody, { hashstring: hash }, SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const hash = computeTapHashString(payload, SECRET);
    const tampered = JSON.stringify({ ...payload, amount: 999 });
    expect(verifyTapSignature(tampered, { hashstring: hash }, SECRET)).toBe(false);
  });

  it('parses into a normalised event', () => {
    const ev = parseTapEvent(payload);
    expect(ev).not.toBeNull();
    expect(ev!.providerEventId).toBe('chg_1');
    expect(ev!.recoveryRef).toBe('TZK-XYZ777');
    expect(ev!.amount).toBe(150);
    expect(ev!.captured).toBe(true);
  });
});
