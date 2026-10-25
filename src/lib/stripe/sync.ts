import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { schema, type Db } from '@/db';
import { LOOKUP_KEYS, priceFor, type MembershipPlan, type PriceLookupClient } from './checkout';
import { customerIdOf, periodEndOf } from './webhook';

export type SyncRowResult = { email: string; status: 'created' | 'matched' | 'error'; message?: string };

/** The minimal slice of the Stripe client syncMembersFromStripe needs — a real Stripe instance satisfies this structurally. */
export interface SyncClient extends PriceLookupClient {
  subscriptions: {
    list(params: {
      price: string;
      limit?: number;
      starting_after?: string;
      expand?: string[];
    }): Promise<{ data: Stripe.Subscription[]; has_more: boolean }>;
  };
}

async function subscriptionsForPrice(stripe: SyncClient, priceId: string): Promise<Stripe.Subscription[]> {
  const subscriptions: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const { data, has_more } = await stripe.subscriptions.list({ price: priceId, limit: 100, starting_after: startingAfter, expand: ['data.customer'] });
    subscriptions.push(...data);
    if (!has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return subscriptions;
}

function emailOf(customer: Stripe.Subscription['customer']): string | undefined {
  if (!customer || typeof customer === 'string' || customer.deleted) return undefined;
  return customer.email ?? undefined;
}

function nameOf(customer: Stripe.Subscription['customer']): string {
  if (!customer || typeof customer === 'string' || customer.deleted) return '';
  return customer.name ?? '';
}

async function upsertFromSubscription(db: Db, subscription: Stripe.Subscription): Promise<SyncRowResult> {
  const email = emailOf(subscription.customer);
  if (!email) return { email: '', status: 'error', message: `Subscription ${subscription.id} has no customer email` };
  const lowerEmail = email.toLowerCase();
  const customerId = customerIdOf(subscription.customer);
  const membershipExpiresAt = periodEndOf(subscription);

  const [byCustomerId] = customerId ? await db.select().from(schema.user).where(eq(schema.user.stripeCustomerId, customerId)) : [];
  const [byEmail] = byCustomerId ? [] : await db.select().from(schema.user).where(sql`lower(${schema.user.email}) = ${lowerEmail}`);
  const existing = byCustomerId ?? byEmail;

  if (existing) {
    await db.update(schema.user)
      .set({
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        isActiveMember: true,
        ...(membershipExpiresAt !== undefined ? { membershipExpiresAt } : {}),
      })
      .where(eq(schema.user.id, existing.id));
    return { email: lowerEmail, status: 'matched' };
  }

  await db.insert(schema.user).values({
    id: randomUUID(),
    email,
    name: nameOf(subscription.customer),
    isActiveMember: true,
    membershipExpiresAt,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
  });
  return { email: lowerEmail, status: 'created' };
}

/** Finds everyone with an active or trialing Stripe subscription on a membership price and makes sure they have a matching, active member account — covers payments that didn't originate from this app's own checkout (so never set client_reference_id for the webhook to resolve). */
export async function syncMembersFromStripe(db: Db, stripe: SyncClient): Promise<SyncRowResult[]> {
  const results: SyncRowResult[] = [];
  for (const plan of Object.keys(LOOKUP_KEYS) as MembershipPlan[]) {
    const priceId = await priceFor(stripe, plan);
    const subscriptions = await subscriptionsForPrice(stripe, priceId);
    for (const subscription of subscriptions) {
      if (subscription.status !== 'active' && subscription.status !== 'trialing') continue;
      results.push(await upsertFromSubscription(db, subscription));
    }
  }
  return results;
}
