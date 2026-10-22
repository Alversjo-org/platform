import { randomUUID } from 'node:crypto';
import { schema, type Db } from '@/db';

export type DecisionLogEntry = {
  entity: string;
  entityId: string;
  actorUserId: string;
  action: string;
  diff: unknown;
};

export async function logDecision(db: Db, entry: DecisionLogEntry): Promise<void> {
  await db.insert(schema.decisionLog).values({
    id: randomUUID(),
    entity: entry.entity,
    entityId: entry.entityId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    diff: JSON.stringify(entry.diff),
  });
}
