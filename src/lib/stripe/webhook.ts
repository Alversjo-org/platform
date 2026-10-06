import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { schema, type Db } from '@/db';
import type { User } from '@/db/schema';

/** The minimal slice of the Stripe client webhook handling needs to resolve a subscription's current period. */
export interface SubscriptionRetriever {
  subscriptions: { retrieve(id: string): Promise<Stripe.Subscription> };
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

// Stripe moved current_period_end from the subscription itself to each subscription item.
function periodEndOf(subscription: Stripe.Subscription): Date | undefined {
  const periodEndSec = subscription.items.data[0]?.current_period_end;
  return periodEndSec === undefined ? undefined : new Date(periodEndSec * 1000);
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

async function handleCheckoutCompleted(db: Db, session: Stripe.Checkout.Session, stripe: SubscriptionRetriever): Promise<void> {
  const user = await findByClientReferenceId(db, session.client_reference_id);
  if (!user) { console.error(`Stripe webhook: no user for client_reference_id ${session.client_reference_id}`); return; }
  const customerId = customerIdOf(session.customer) ?? user.stripeCustomerId;

  if (session.mode === 'subscription') {
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
    // Retrieve the subscription now rather than waiting for a follow-up customer.subscription.*
    // event: Stripe doesn't guarantee one will arrive (or arrive after this one), and that event
    // is resolved by stripeCustomerId, which only this handler writes — so out-of-order delivery
    // could otherwise leave membershipExpiresAt permanently unset.
    let membershipExpiresAt: Date | undefined;
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      membershipExpiresAt = periodEndOf(subscription);
      if (membershipExpiresAt === undefined) {
        console.error(`Stripe webhook: subscription ${subscriptionId} has no current_period_end`);
      }
    }
    await db.update(schema.user)
      .set({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        isActiveMember: true,
        ...(membershipExpiresAt !== undefined ? { membershipExpiresAt } : {}),
      })
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
  if (subscription.status !== 'active' && subscription.status !== 'trialing') {
    console.error(`Stripe webhook: subscription ${subscription.id} has status ${subscription.status}, leaving membership as-is`);
    return;
  }
  const membershipExpiresAt = periodEndOf(subscription);
  if (membershipExpiresAt === undefined) { console.error(`Stripe webhook: subscription ${subscription.id} has no current_period_end`); return; }
  await db.update(schema.user)
    .set({ membershipExpiresAt, isActiveMember: true })
    .where(eq(schema.user.id, user.id));
}

async function handleSubscriptionDeleted(db: Db, subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(subscription.customer);
  const user = await findByStripeCustomerId(db, customerId);
  if (!user) { console.error(`Stripe webhook: no user for customer ${customerId}`); return; }
  await db.update(schema.user).set({ stripeSubscriptionId: null }).where(eq(schema.user.id, user.id));
}

export async function handleStripeEvent(db: Db, event: Stripe.Event, stripe: SubscriptionRetriever): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(db, event.data.object as Stripe.Checkout.Session, stripe);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(db, event.data.object as Stripe.Subscription);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
    default:
      return;
  }
}
