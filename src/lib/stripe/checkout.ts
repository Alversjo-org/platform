import type Stripe from 'stripe';

export type MembershipPlan = 'yearly' | 'monthly' | 'one_time';

/** Set as the "Lookup key" on the matching Price in the Stripe Dashboard (Products → price → Lookup key). */
export const LOOKUP_KEYS: Record<MembershipPlan, string> = {
  yearly: 'membership_yearly',
  monthly: 'membership_monthly',
  one_time: 'membership_one_time',
};

/** The minimal slice of the Stripe client createCheckoutSession needs — a real Stripe instance satisfies this structurally. */
export interface CheckoutClient {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
    };
  };
  prices: {
    list(params: { lookup_keys: string[]; active?: boolean; limit?: number }): Promise<{ data: { id: string }[] }>;
  };
}

/** Resolves the plan's Price by its Stripe lookup_key, instead of a hardcoded Price ID — lets prices be managed entirely in Stripe. */
async function priceFor(stripe: CheckoutClient, plan: MembershipPlan): Promise<string> {
  const lookupKey = LOOKUP_KEYS[plan];
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = data[0];
  if (!price) throw new Error(`No active Stripe price found with lookup_key "${lookupKey}"`);
  return price.id;
}

export async function createCheckoutSession(
  stripe: CheckoutClient,
  input: { plan: MembershipPlan; user: { id: string; email: string; stripeCustomerId: string | null }; platformUrl: string },
): Promise<string> {
  const platformUrl = input.platformUrl.replace(/\/$/, '');
  const price = await priceFor(stripe, input.plan);
  const session = await stripe.checkout.sessions.create({
    mode: input.plan === 'one_time' ? 'payment' : 'subscription',
    customer: input.user.stripeCustomerId ?? undefined,
    customer_email: input.user.stripeCustomerId ? undefined : input.user.email,
    client_reference_id: input.user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${platformUrl}/?checkout=success`,
    cancel_url: `${platformUrl}/?checkout=cancelled`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}
