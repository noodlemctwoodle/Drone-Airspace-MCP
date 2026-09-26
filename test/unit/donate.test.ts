import { describe, expect, it } from 'vitest';
import { createDonationSession, donationEnabled, donationSessionParams } from '../../src/map/donate.js';

const cfg = { secretKey: 'sk_test_x', priceOnce: 'price_once', priceMonthly: 'price_month' };

describe('donations', () => {
  it('is enabled only with a secret key and at least one price', () => {
    expect(donationEnabled(cfg)).toBe(true);
    expect(donationEnabled({ priceOnce: 'p' })).toBe(false);
    expect(donationEnabled({ secretKey: 'sk' })).toBe(false);
  });

  it('builds an embedded one-off session with the donate button', () => {
    const p = donationSessionParams(cfg, 'once')!;
    expect(p.get('ui_mode')).toBe('embedded_page');
    expect(p.get('redirect_on_completion')).toBe('never');
    expect(p.get('mode')).toBe('payment');
    expect(p.get('line_items[0][price]')).toBe('price_once');
    expect(p.get('line_items[0][quantity]')).toBe('1');
    expect(p.get('submit_type')).toBe('donate');
    expect(p.get('line_items[0][adjustable_quantity][enabled]')).toBeNull();
  });

  it('builds a monthly subscription with a clamped adjustable quantity', () => {
    const p = donationSessionParams(cfg, 'monthly', 99)!;
    expect(p.get('mode')).toBe('subscription');
    expect(p.get('line_items[0][quantity]')).toBe('50');
    expect(p.get('line_items[0][adjustable_quantity][enabled]')).toBe('true');
    expect(p.get('submit_type')).toBeNull();
    expect(donationSessionParams(cfg, 'monthly', 0)!.get('line_items[0][quantity]')).toBe('1');
    expect(donationSessionParams({ ...cfg, priceMonthly: undefined }, 'monthly')).toBeNull();
  });

  it('answers 404 without a key and 502 when Stripe fails, and returns the client secret otherwise', async () => {
    expect(await createDonationSession({ priceOnce: 'p' }, 'once', undefined)).toEqual({ error: 'donations are not configured', status: 404 });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ client_secret: 'cs_test_1' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await createDonationSession(cfg, 'monthly', 2, fake)).toEqual({ clientSecret: 'cs_test_1' });
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_x');
    expect(String(calls[0].init.body)).toContain('mode=subscription');
    const broken = (async () => new Response(JSON.stringify({ error: { message: 'No such price' } }), { status: 400 })) as unknown as typeof fetch;
    expect(await createDonationSession(cfg, 'once', undefined, broken)).toEqual({ error: 'No such price', status: 502 });
  });
});
