import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';

export const DEFAULT_RENEWAL_SUBJECT = 'Time to renew your Alversjö membership';
export const DEFAULT_RENEWAL_BODY =
  'Hi {name},\n\nYour Alversjö membership expires on {expiresAt}. Renew at ' +
  'https://members.alversjo.land to keep your access.\n\nThanks,\nAlversjö';

export async function getRenewalMessage(db: Db): Promise<{ subject: string; body: string }> {
  const [row] = await db.select().from(schema.renewalMessageSetting).where(eq(schema.renewalMessageSetting.id, 'default'));
  if (!row) return { subject: DEFAULT_RENEWAL_SUBJECT, body: DEFAULT_RENEWAL_BODY };
  return { subject: row.subject, body: row.body };
}

export async function updateRenewalMessage(db: Db, input: { subject: string; body: string; updatedByUserId: string }): Promise<void> {
  await db
    .insert(schema.renewalMessageSetting)
    .values({ id: 'default', subject: input.subject, body: input.body, updatedByUserId: input.updatedByUserId })
    .onConflictDoUpdate({
      target: schema.renewalMessageSetting.id,
      set: { subject: input.subject, body: input.body, updatedAt: new Date(), updatedByUserId: input.updatedByUserId },
    });
}

/** Substitutes {name} and {expiresAt} in a subject or body string. */
export function renderMessage(template: string, vars: { name: string; expiresAt: Date | null }): string {
  const expiresAt = vars.expiresAt ? vars.expiresAt.toISOString().slice(0, 10) : 'an unknown date';
  return template.replaceAll('{name}', vars.name || 'there').replaceAll('{expiresAt}', expiresAt);
}
