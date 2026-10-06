import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  DEFAULT_RENEWAL_BODY, DEFAULT_RENEWAL_SUBJECT, getRenewalMessage, renderMessage, updateRenewalMessage,
} from './renewal-message';

describe('renewal message settings', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'admin', email: 'admin@example.org', role: 'admin' });
  });

  it('falls back to the built-in default when nothing is configured', async () => {
    expect(await getRenewalMessage(db)).toEqual({ subject: DEFAULT_RENEWAL_SUBJECT, body: DEFAULT_RENEWAL_BODY });
  });

  it('stores and returns a custom message', async () => {
    await updateRenewalMessage(db, { subject: 'Renew now', body: 'Hi {name}', updatedByUserId: 'admin' });
    expect(await getRenewalMessage(db)).toEqual({ subject: 'Renew now', body: 'Hi {name}' });
  });

  it('overwrites the stored message on a second update rather than duplicating it', async () => {
    await updateRenewalMessage(db, { subject: 'A', body: 'A', updatedByUserId: 'admin' });
    await updateRenewalMessage(db, { subject: 'B', body: 'B', updatedByUserId: 'admin' });
    expect(await getRenewalMessage(db)).toEqual({ subject: 'B', body: 'B' });
    expect(await db.select().from(schema.renewalMessageSetting)).toHaveLength(1);
  });
});

describe('renderMessage', () => {
  it('substitutes the name and a formatted expiry date', () => {
    expect(renderMessage('Hi {name}, you expire {expiresAt}', { name: 'Viktor', expiresAt: new Date('2027-01-15') }))
      .toBe('Hi Viktor, you expire 2027-01-15');
  });

  it('falls back to placeholder text when the name or expiry is missing', () => {
    expect(renderMessage('Hi {name}, {expiresAt}', { name: '', expiresAt: null })).toBe('Hi there, an unknown date');
  });
});
