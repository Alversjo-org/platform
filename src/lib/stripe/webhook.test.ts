import { beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import { handleStripeEvent, type SubscriptionRetriever } from './webhook';

function event<T>(type: string, object: T): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

/** A fake Stripe client whose subscriptions.retrieve resolves to a subscription with the given current_period_end (unix seconds), or no items at all if omitted. */
function fakeStripe(currentPeriodEndSec?: number): SubscriptionRetriever {
  return {
    subscriptions: {
      retrieve: async (id: string) =>
        ({
          id,
          items: { data: currentPeriodEndSec === undefined ? [] : [{ current_period_end: currentPeriodEndSec }] },
        }) as unknown as Stripe.Subscription,
    },
  };
}

describe('handleStripeEvent', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'a@example.org' });
  });

  it('activates membership and stores the subscription id and expiry on a subscription checkout', async () => {
    const periodEnd = Math.floor(new Date('2027-06-01').getTime() / 1000);
    await handleStripeEvent(db, event('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_1',
    }), fakeStripe(periodEnd));
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u).toMatchObject({ isActiveMember: true, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
    expect(u.membershipExpiresAt).toEqual(new Date(periodEnd * 1000));
  });

  it('still activates membership on a subscription checkout when the retrieved subscription has no parseable current_period_end', async () => {
    await expect(
      handleStripeEvent(db, event('checkout.session.completed', {
        mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_1',
      }), fakeStripe(undefined)),
    ).resolves.toBeUndefined();
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u).toMatchObject({ isActiveMember: true, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
    expect(u.membershipExpiresAt).toBeNull();
  });

  it('ignores a checkout session with an unexpected (non-subscription) mode without throwing or writing', async () => {
    await expect(
      handleStripeEvent(db, event('checkout.session.completed', { mode: 'payment', client_reference_id: 'u1', customer: 'cus_1' }), fakeStripe()),
    ).resolves.toBeUndefined();
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u).toMatchObject({ isActiveMember: false, stripeCustomerId: null });
  });

  it('syncs membershipExpiresAt on subscription.updated when the subscription is active', async () => {
    await db.update(schema.user).set({ stripeCustomerId: 'cus_1' }).where(eq(schema.user.id, 'u1'));
    const periodEnd = Math.floor(new Date('2027-06-01').getTime() / 1000);
    await handleStripeEvent(
      db,
      event('customer.subscription.updated', { customer: 'cus_1', status: 'active', items: { data: [{ current_period_end: periodEnd }] } }),
      fakeStripe(),
    );
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u.membershipExpiresAt).toEqual(new Date(periodEnd * 1000));
  });

  it('leaves membershipExpiresAt and isActiveMember untouched on subscription.updated when status is past_due', async () => {
    const existingExpiry = new Date('2027-01-01T00:00:00Z');
    await db.update(schema.user)
      .set({ stripeCustomerId: 'cus_1', isActiveMember: true, membershipExpiresAt: existingExpiry })
      .where(eq(schema.user.id, 'u1'));
    const periodEnd = Math.floor(new Date('2027-06-01').getTime() / 1000);
    await handleStripeEvent(
      db,
      event('customer.subscription.updated', { customer: 'cus_1', status: 'past_due', items: { data: [{ current_period_end: periodEnd }] } }),
      fakeStripe(),
    );
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u.membershipExpiresAt).toEqual(existingExpiry);
    expect(u.isActiveMember).toBe(true);
  });

  it('clears stripeSubscriptionId on subscription.deleted', async () => {
    await db.update(schema.user).set({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }).where(eq(schema.user.id, 'u1'));
    await handleStripeEvent(db, event('customer.subscription.deleted', { customer: 'cus_1' }), fakeStripe());
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u.stripeSubscriptionId).toBeNull();
  });

  it('does not throw for a checkout session whose client_reference_id matches no user', async () => {
    await expect(
      handleStripeEvent(db, event('checkout.session.completed', { mode: 'subscription', client_reference_id: 'nobody', customer: 'cus_x' }), fakeStripe()),
    ).resolves.toBeUndefined();
  });

  it('does not throw for a subscription event whose customer matches no user', async () => {
    await expect(
      handleStripeEvent(
        db,
        event('customer.subscription.updated', { customer: 'cus_nobody', status: 'active', items: { data: [{ current_period_end: 0 }] } }),
        fakeStripe(),
      ),
    ).resolves.toBeUndefined();
  });

  it('ignores event types it does not handle', async () => {
    await expect(handleStripeEvent(db, event('payment_intent.succeeded', {}), fakeStripe())).resolves.toBeUndefined();
  });
});
