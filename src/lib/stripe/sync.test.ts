import { beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import { LOOKUP_KEYS } from './checkout';
import { syncMembersFromStripe, type SyncClient } from './sync';

/** A fake Stripe client resolving the two membership prices and listing the given subscriptions per price id. */
function fakeStripe(subsByPriceId: Record<string, Partial<Stripe.Subscription>[]>): SyncClient {
  const prices: Record<string, string> = { [LOOKUP_KEYS.yearly]: 'price_yearly', [LOOKUP_KEYS.monthly]: 'price_monthly' };
  return {
    prices: {
      list: async ({ lookup_keys }) => {
        const id = prices[lookup_keys[0]];
        return { data: id ? [{ id }] : [] };
      },
    },
    subscriptions: {
      list: async ({ price, starting_after }) => {
        const all = (subsByPriceId[price] ?? []) as Stripe.Subscription[];
        // Fakes one page of two, so pagination can be exercised without a real "limit" option.
        const startIndex = starting_after ? all.findIndex((s) => s.id === starting_after) + 1 : 0;
        const page = all.slice(startIndex, startIndex + 2);
        return { data: page, has_more: startIndex + 2 < all.length };
      },
    },
  };
}

function sub(id: string, overrides: Partial<Stripe.Subscription> & { customer: Stripe.Subscription['customer'] }): Stripe.Subscription {
  return {
    id,
    status: 'active',
    items: { data: [{ current_period_end: Math.floor(new Date('2027-06-01').getTime() / 1000) }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function customer(id: string, email: string | null, name: string | null = null): Stripe.Customer {
  return { id, object: 'customer', deleted: false, email, name } as unknown as Stripe.Customer;
}

describe('syncMembersFromStripe', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
  });

  it('creates a new user for a paying customer with no matching account', async () => {
    const stripe = fakeStripe({
      price_yearly: [sub('sub_1', { customer: customer('cus_1', 'new@example.org', 'New Person') })],
    });
    const results = await syncMembersFromStripe(db, stripe);
    expect(results).toEqual([{ email: 'new@example.org', status: 'created' }]);
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, 'new@example.org'));
    expect(u).toMatchObject({ name: 'New Person', isActiveMember: true, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
    expect(u.membershipExpiresAt).toEqual(new Date('2027-06-01'));
  });

  it('matches an existing user by stripeCustomerId and refreshes their membership', async () => {
    await db.insert(schema.user).values({ id: 'u1', email: 'old@example.org', stripeCustomerId: 'cus_1', isActiveMember: false });
    const stripe = fakeStripe({
      price_yearly: [sub('sub_1', { customer: customer('cus_1', 'old@example.org') })],
    });
    const results = await syncMembersFromStripe(db, stripe);
    expect(results).toEqual([{ email: 'old@example.org', status: 'matched' }]);
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u).toMatchObject({ isActiveMember: true, stripeSubscriptionId: 'sub_1' });
  });

  it('matches an existing user by email (case-insensitive) when no stripeCustomerId is linked yet', async () => {
    await db.insert(schema.user).values({ id: 'u1', email: 'Someone@Example.org', isActiveMember: false });
    const stripe = fakeStripe({
      price_yearly: [sub('sub_1', { customer: customer('cus_1', 'someone@example.org') })],
    });
    const results = await syncMembersFromStripe(db, stripe);
    expect(results).toEqual([{ email: 'someone@example.org', status: 'matched' }]);
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u).toMatchObject({ isActiveMember: true, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
  });

  it('ignores subscriptions that are not active or trialing', async () => {
    const stripe = fakeStripe({
      price_yearly: [sub('sub_1', { status: 'canceled', customer: customer('cus_1', 'gone@example.org') })],
    });
    const results = await syncMembersFromStripe(db, stripe);
    expect(results).toEqual([]);
    const rows = await db.select().from(schema.user).where(eq(schema.user.email, 'gone@example.org'));
    expect(rows).toEqual([]);
  });

  it('checks both the yearly and monthly prices', async () => {
    const stripe = fakeStripe({
      price_yearly: [sub('sub_y', { customer: customer('cus_y', 'yearly@example.org') })],
      price_monthly: [sub('sub_m', { customer: customer('cus_m', 'monthly@example.org') })],
    });
    const results = await syncMembersFromStripe(db, stripe);
    expect(results.map((r) => r.email).sort()).toEqual(['monthly@example.org', 'yearly@example.org']);
  });

  it('pages through more than one batch of subscriptions for a price', async () => {
    const subs = ['a', 'b', 'c'].map((n) => sub(`sub_${n}`, { customer: customer(`cus_${n}`, `${n}@example.org`) }));
    const stripe = fakeStripe({ price_yearly: subs });
    const results = await syncMembersFromStripe(db, stripe);
    expect(results.map((r) => r.email).sort()).toEqual(['a@example.org', 'b@example.org', 'c@example.org']);
  });

  it('reports an error for a subscription whose customer has no email, without throwing', async () => {
    const stripe = fakeStripe({
      price_yearly: [sub('sub_1', { customer: customer('cus_1', null) })],
    });
    const results = await syncMembersFromStripe(db, stripe);
    expect(results).toEqual([{ email: '', status: 'error', message: 'Subscription sub_1 has no customer email' }]);
  });
});
