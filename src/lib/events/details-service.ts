import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { EventDetails } from '@/db/schema';

export class InvalidCapacityError extends Error {
  constructor() { super('capacity must be set iff hasCapacityLimit is true'); this.name = 'InvalidCapacityError'; }
}

export type UpsertEventDetailsInput = {
  projectId: string;
  startsAt: Date;
  endsAt: Date;
  hasCapacityLimit: boolean;
  capacity: number | null;
  signupOpensAt: Date | null;
  signupClosesAt: Date | null;
  priceSek: number;
  priceNote: string | null;
  contactNote: string | null;
  showSignupsToParticipants: boolean;
};

export async function upsertEventDetails(db: Db, input: UpsertEventDetailsInput): Promise<EventDetails> {
  if ((input.capacity === null) !== !input.hasCapacityLimit) throw new InvalidCapacityError();
  if (input.hasCapacityLimit && !(Number.isFinite(input.capacity) && input.capacity! >= 1)) throw new InvalidCapacityError();
  const [row] = await db.insert(schema.eventDetails)
    .values(input)
    .onConflictDoUpdate({ target: schema.eventDetails.projectId, set: input })
    .returning();
  return row;
}

export async function getEventDetails(db: Db, projectId: string): Promise<EventDetails | null> {
  const [row] = await db.select().from(schema.eventDetails).where(eq(schema.eventDetails.projectId, projectId));
  return row ?? null;
}
