import Stripe from 'stripe';

let stripeClient: Stripe | undefined;

// Pinned to the version this codebase was built against (node_modules/stripe's own default,
// see node_modules/stripe/cjs/apiVersion.js) so response shapes like
// subscription.items.data[0].current_period_end don't shift under us if the Stripe dashboard's
// account-level default API version ever changes.
const STRIPE_API_VERSION = '2026-09-30.endive';

/** Process-wide Stripe client, built from STRIPE_API_KEY (already in Fly secrets) on first use. */
export function getStripe(): Stripe {
  stripeClient ??= new Stripe(requireApiKey(), { apiVersion: STRIPE_API_VERSION });
  return stripeClient;
}

function requireApiKey(): string {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error('STRIPE_API_KEY is not set');
  return key;
}
