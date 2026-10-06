import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { schema, type Db } from '@/db';
import type { User } from '@/db/schema';

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

function customerIdOf(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

async function findByClientReferenceId(db: Db, id: string | null): Promise<User | undefined> {
  if (!id) return undefined;
  const [row] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  return row;
}

async function findByStripeCustomerId(db: Db, customerId: string | null): Promise<User | undefined> {
  if (!customerId) return undefined;
  const [row] = await db.select().from(schema.user).where(eq(schema.user.stripeCustomerId, customerId));
  return row;
}

async function handleCheckoutCompleted(db: Db, session: Stripe.Checkout.Session): Promise<void> {
  const user = await findByClientReferenceId(db, session.client_reference_id);
  if (!user) { console.error(`Stripe webhook: no user for client_reference_id ${session.client_reference_id}`); return; }
  const customerId = customerIdOf(session.customer) ?? user.stripeCustomerId;

  if (session.mode === 'subscription') {
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
    // current_period_end isn't on the checkout session itself; the subscription.updated event
    // that follows moments later fills in the real expiry. Marking active now avoids a window
    // where a slow webhook ordering would otherwise lock the member out.
    await db.update(schema.user)
      .set({ stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, isActiveMember: true })
      .where(eq(schema.user.id, user.id));
    return;
  }

  const base = user.membershipExpiresAt && user.membershipExpiresAt > new Date() ? user.membershipExpiresAt : new Date();
  await db.update(schema.user)
    .set({ stripeCustomerId: customerId, isActiveMember: true, membershipExpiresAt: addYears(base, 1) })
    .where(eq(schema.user.id, user.id));
}

async function handleSubscriptionUpdated(db: Db, subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(subscription.customer);
  const user = await findByStripeCustomerId(db, customerId);
  if (!user) { console.error(`Stripe webhook: no user for customer ${customerId}`); return; }
  // Stripe moved current_period_end from the subscription itself to each subscription item.
  const periodEndSec = subscription.items.data[0]?.current_period_end;
  if (periodEndSec === undefined) { console.error(`Stripe webhook: subscription ${subscription.id} has no current_period_end`); return; }
  await db.update(schema.user)
    .set({ membershipExpiresAt: new Date(periodEndSec * 1000), isActiveMember: true })
    .where(eq(schema.user.id, user.id));
}

async function handleSubscriptionDeleted(db: Db, subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(subscription.customer);
  const user = await findByStripeCustomerId(db, customerId);
  if (!user) { console.error(`Stripe webhook: no user for customer ${customerId}`); return; }
  await db.update(schema.user).set({ stripeSubscriptionId: null }).where(eq(schema.user.id, user.id));
}

export async function handleStripeEvent(db: Db, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(db, event.data.object as Stripe.Checkout.Session);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(db, event.data.object as Stripe.Subscription);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
    default:
      return;
  }
}
