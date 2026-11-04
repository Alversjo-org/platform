import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Task, TaskStatus } from '@/db/schema';

export class TaskNotFoundError extends Error {
  constructor(message = 'Task not found') { super(message); this.name = 'TaskNotFoundError'; }
}

export type CreateTaskInput = {
  description: string;
  createdByUserId: string;
  assigneeUserId?: string | null;
  projectId?: string | null;
  imageUrl?: string | null;
};

export async function createTask(db: Db, input: CreateTaskInput): Promise<Task> {
  const [row] = await db.insert(schema.task).values({
    id: randomUUID(),
    description: input.description,
    createdByUserId: input.createdByUserId,
    assigneeUserId: input.assigneeUserId ?? null,
    projectId: input.projectId ?? null,
    imageUrl: input.imageUrl ?? null,
  }).returning();
  return row;
}

/** `filter` omitted/`projectId` undefined → all tasks; `projectId: null` → standalone only; a string → that project's. */
export async function listTasks(db: Db, filter: { projectId?: string | null } = {}): Promise<Task[]> {
  let where: SQL | undefined;
  if (filter.projectId === null) where = isNull(schema.task.projectId);
  else if (filter.projectId !== undefined) where = eq(schema.task.projectId, filter.projectId);
  return db.select().from(schema.task).where(where && and(where)).orderBy(asc(schema.task.createdAt));
}

async function updateTask(db: Db, taskId: string, set: Partial<Pick<Task, 'status' | 'assigneeUserId'>>): Promise<Task> {
  const [row] = await db.update(schema.task)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(schema.task.id, taskId))
    .returning();
  if (!row) throw new TaskNotFoundError();
  return row;
}

export function updateTaskStatus(db: Db, input: { taskId: string; status: TaskStatus }): Promise<Task> {
  return updateTask(db, input.taskId, { status: input.status });
}

export function assignTask(db: Db, input: { taskId: string; assigneeUserId: string | null }): Promise<Task> {
  return updateTask(db, input.taskId, { assigneeUserId: input.assigneeUserId });
}

export async function deleteTask(db: Db, taskId: string): Promise<void> {
  await db.delete(schema.task).where(eq(schema.task.id, taskId));
}
