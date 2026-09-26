/**
 * Embedded Stripe Checkout for donations. The page asks `/api/donate` for a
 * Checkout Session and mounts Stripe's embedded checkout in a modal; the
 * session is created here with the account's secret key over Stripe's REST
 * API, so no SDK is bundled. Without a secret key the endpoint answers 404 and
 * the page falls back to the hosted Payment Links.
 */
export interface DonationConfig {
  secretKey?: string;
  priceOnce?: string;
  priceMonthly?: string;
  returnUrl?: string;
}

export type DonationKind = 'once' | 'monthly';

export function donationEnabled(cfg: DonationConfig): boolean {
  return !!cfg.secretKey && (!!cfg.priceOnce || !!cfg.priceMonthly);
}

/** The form-encoded body for POST /v1/checkout/sessions, or null when that kind is not configured. */
export function donationSessionParams(cfg: DonationConfig, kind: DonationKind, quantity = 3): URLSearchParams | null {
  const price = kind === 'monthly' ? cfg.priceMonthly : cfg.priceOnce;
  if (!price) return null;
  const q = Math.min(50, Math.max(1, Math.round(quantity)));
  const p = new URLSearchParams();
  p.set('ui_mode', 'embedded');
  p.set('redirect_on_completion', 'never');
  p.set('mode', kind === 'monthly' ? 'subscription' : 'payment');
  p.set('line_items[0][price]', price);
  p.set('line_items[0][quantity]', kind === 'monthly' ? String(q) : '1');
  if (kind === 'monthly') {
    p.set('line_items[0][adjustable_quantity][enabled]', 'true');
    p.set('line_items[0][adjustable_quantity][minimum]', '1');
    p.set('line_items[0][adjustable_quantity][maximum]', '50');
  } else {
    p.set('submit_type', 'donate');
  }
  p.set('metadata[project]', 'fpv-airspace');
  p.set('metadata[purpose]', kind === 'monthly' ? 'donation-monthly' : 'donation');
  return p;
}

export async function createDonationSession(cfg: DonationConfig, kind: DonationKind, quantity: number | undefined, fetchImpl: typeof fetch = fetch): Promise<{ clientSecret: string } | { error: string; status: number }> {
  if (!cfg.secretKey) return { error: 'donations are not configured', status: 404 };
  const params = donationSessionParams(cfg, kind, quantity);
  if (!params) return { error: `no ${kind} price configured`, status: 404 };
  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { client_secret?: string; error?: { message?: string } };
  if (!res.ok || !json.client_secret) return { error: json.error?.message ?? `Stripe answered ${res.status}`, status: 502 };
  return { clientSecret: json.client_secret };
}
