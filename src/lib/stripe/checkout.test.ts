import { describe, expect, it } from 'vitest';
import { createCheckoutSession, LOOKUP_KEYS, type CheckoutClient } from './checkout';

describe('createCheckoutSession', () => {
  function fakeStripe(opts: { returnUrl?: string | null; prices?: Record<string, string> } = {}) {
    const {
      returnUrl = 'https://checkout.stripe.com/session123',
      prices = { [LOOKUP_KEYS.yearly]: 'price_yearly', [LOOKUP_KEYS.monthly]: 'price_monthly' },
    } = opts;
    const calls: { sessions: unknown[]; priceLookups: string[][] } = { sessions: [], priceLookups: [] };
    const stripe: CheckoutClient = {
      checkout: { sessions: { create: async (params) => { calls.sessions.push(params); return { url: returnUrl }; } } },
      prices: {
        list: async ({ lookup_keys }) => {
          calls.priceLookups.push(lookup_keys);
          const id = prices[lookup_keys[0]];
          return { data: id ? [{ id }] : [] };
        },
      },
    };
    return { stripe, calls };
  }

  it('creates a subscription session for the yearly plan, keyed to the user, with the price resolved by lookup_key', async () => {
    const { stripe, calls } = fakeStripe();
    const url = await createCheckoutSession(stripe, {
      plan: 'yearly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://members.alversjo.land',
    });
    expect(url).toBe('https://checkout.stripe.com/session123');
    expect(calls.priceLookups[0]).toEqual([LOOKUP_KEYS.yearly]);
    expect(calls.sessions[0]).toMatchObject({
      mode: 'subscription', client_reference_id: 'u1', customer_email: 'a@example.org',
      line_items: [{ price: 'price_yearly', quantity: 1 }],
      success_url: 'https://members.alversjo.land/?checkout=success',
    });
  });

  it('uses the existing Stripe customer id instead of customer_email when present', async () => {
    const { stripe, calls } = fakeStripe();
    await createCheckoutSession(stripe, {
      plan: 'monthly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: 'cus_123' }, platformUrl: 'https://x',
    });
    expect(calls.sessions[0]).toMatchObject({ customer: 'cus_123', customer_email: undefined, line_items: [{ price: 'price_monthly', quantity: 1 }] });
  });

  it('strips a trailing slash from platformUrl before building success/cancel URLs', async () => {
    const { stripe, calls } = fakeStripe();
    await createCheckoutSession(stripe, {
      plan: 'yearly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://x/',
    });
    expect(calls.sessions[0]).toMatchObject({ success_url: 'https://x/?checkout=success', cancel_url: 'https://x/?checkout=cancelled' });
  });

  it('throws a clear error when no active Stripe price has the expected lookup_key', async () => {
    const { stripe } = fakeStripe({ prices: {} });
    await expect(createCheckoutSession(stripe, {
      plan: 'yearly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://x',
    })).rejects.toThrow(/membership_yearly/);
  });

  it('throws if Stripe returns no checkout URL', async () => {
    const { stripe } = fakeStripe({ returnUrl: null });
    await expect(createCheckoutSession(stripe, {
      plan: 'yearly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://x',
    })).rejects.toThrow('did not return a checkout URL');
  });
});
