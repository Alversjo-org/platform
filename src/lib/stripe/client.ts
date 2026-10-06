import Stripe from 'stripe';

let stripeClient: Stripe | undefined;

/** Process-wide Stripe client, built from STRIPE_API_KEY (already in Fly secrets) on first use. */
export function getStripe(): Stripe {
  stripeClient ??= new Stripe(requireApiKey());
  return stripeClient;
}

function requireApiKey(): string {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error('STRIPE_API_KEY is not set');
  return key;
}
