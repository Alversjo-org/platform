import { beforeEach, describe, expect, it } from 'vitest';
import { createCheckoutSession, type CheckoutClient } from './checkout';

describe('createCheckoutSession', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_YEARLY = 'price_yearly';
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
    process.env.STRIPE_PRICE_ONE_TIME = 'price_one_time';
  });

  function fakeStripe(returnUrl: string | null = 'https://checkout.stripe.com/session123') {
    const calls: unknown[] = [];
    const stripe: CheckoutClient = {
      checkout: { sessions: { create: async (params) => { calls.push(params); return { url: returnUrl }; } } },
    };
    return { stripe, calls };
  }

  it('creates a subscription session for the yearly plan, keyed to the user', async () => {
    const { stripe, calls } = fakeStripe();
    const url = await createCheckoutSession(stripe, {
      plan: 'yearly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://members.alversjo.land',
    });
    expect(url).toBe('https://checkout.stripe.com/session123');
    expect(calls[0]).toMatchObject({
      mode: 'subscription', client_reference_id: 'u1', customer_email: 'a@example.org',
      line_items: [{ price: 'price_yearly', quantity: 1 }],
      success_url: 'https://members.alversjo.land/?checkout=success',
    });
  });

  it('creates a payment-mode session for the one-time plan', async () => {
    const { stripe, calls } = fakeStripe();
    await createCheckoutSession(stripe, {
      plan: 'one_time', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://x',
    });
    expect(calls[0]).toMatchObject({ mode: 'payment', line_items: [{ price: 'price_one_time', quantity: 1 }] });
  });

  it('uses the existing Stripe customer id instead of customer_email when present', async () => {
    const { stripe, calls } = fakeStripe();
    await createCheckoutSession(stripe, {
      plan: 'monthly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: 'cus_123' }, platformUrl: 'https://x',
    });
    expect(calls[0]).toMatchObject({ customer: 'cus_123', customer_email: undefined, line_items: [{ price: 'price_monthly', quantity: 1 }] });
  });

  it('throws if Stripe returns no checkout URL', async () => {
    const { stripe } = fakeStripe(null);
    await expect(createCheckoutSession(stripe, {
      plan: 'yearly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://x',
    })).rejects.toThrow('did not return a checkout URL');
  });
});
