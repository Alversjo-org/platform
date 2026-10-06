import type Stripe from 'stripe';

export type MembershipPlan = 'yearly' | 'monthly' | 'one_time';

/** The minimal slice of the Stripe client createCheckoutSession needs — a real Stripe instance satisfies this structurally. */
export interface CheckoutClient {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
    };
  };
}

function priceFor(plan: MembershipPlan): string {
  const envKey = plan === 'yearly' ? 'STRIPE_PRICE_YEARLY' : plan === 'monthly' ? 'STRIPE_PRICE_MONTHLY' : 'STRIPE_PRICE_ONE_TIME';
  const price = process.env[envKey];
  if (!price) throw new Error(`${envKey} is not set`);
  return price;
}

export async function createCheckoutSession(
  stripe: CheckoutClient,
  input: { plan: MembershipPlan; user: { id: string; email: string; stripeCustomerId: string | null }; platformUrl: string },
): Promise<string> {
  const platformUrl = input.platformUrl.replace(/\/$/, '');
  const session = await stripe.checkout.sessions.create({
    mode: input.plan === 'one_time' ? 'payment' : 'subscription',
    customer: input.user.stripeCustomerId ?? undefined,
    customer_email: input.user.stripeCustomerId ? undefined : input.user.email,
    client_reference_id: input.user.id,
    line_items: [{ price: priceFor(input.plan), quantity: 1 }],
    success_url: `${platformUrl}/?checkout=success`,
    cancel_url: `${platformUrl}/?checkout=cancelled`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}
