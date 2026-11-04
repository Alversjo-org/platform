import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@/db';
import { assignTask, createTask, deleteTask, listTasks, TaskNotFoundError, updateTaskStatus } from './service';

const project = (id: string) => ({ id, slug: id, title: id.toUpperCase(), kind: 'build' as const, status: 'draft' as const, ownerUserId: 'u1' });

describe('tasks/service', () => {
  it('createTask defaults to backlog status and no assignee', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const t = await createTask(db, { description: 'Fix the gate', createdByUserId: 'u1' });
    expect(t.status).toBe('backlog');
    expect(t.assigneeUserId).toBeNull();
    expect(t.createdByUserId).toBe('u1');
  });

  it('listTasks(undefined) returns every task; {projectId: null} returns only standalone ones; {projectId: X} returns only that project’s', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.project).values(project('p1'));
    await createTask(db, { description: 'standalone', createdByUserId: 'u1' });
    await createTask(db, { description: 'sub-todo', createdByUserId: 'u1', projectId: 'p1' });
    expect(await listTasks(db)).toHaveLength(2);
    expect(await listTasks(db, { projectId: null })).toHaveLength(1);
    expect(await listTasks(db, { projectId: 'p1' })).toHaveLength(1);
    expect(await listTasks(db, { projectId: 'does-not-exist' })).toHaveLength(0);
  });

  it('updateTaskStatus changes the status and throws for an unknown id', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const t = await createTask(db, { description: 'x', createdByUserId: 'u1' });
    const updated = await updateTaskStatus(db, { taskId: t.id, status: 'doing' });
    expect(updated.status).toBe('doing');
    await expect(updateTaskStatus(db, { taskId: 'missing', status: 'done' })).rejects.toThrow(TaskNotFoundError);
  });

  it('assignTask sets and then clears the assignee, and throws for an unknown id', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'u2', email: 'u2@example.org' }]);
    const t = await createTask(db, { description: 'x', createdByUserId: 'u1' });
    const assigned = await assignTask(db, { taskId: t.id, assigneeUserId: 'u2' });
    expect(assigned.assigneeUserId).toBe('u2');
    const unassigned = await assignTask(db, { taskId: t.id, assigneeUserId: null });
    expect(unassigned.assigneeUserId).toBeNull();
    await expect(assignTask(db, { taskId: 'missing', assigneeUserId: null })).rejects.toThrow(TaskNotFoundError);
  });

  it('deleteTask removes the row; deleting a project cascades to its tasks', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.project).values(project('p1'));
    const standalone = await createTask(db, { description: 'x', createdByUserId: 'u1' });
    await createTask(db, { description: 'sub', createdByUserId: 'u1', projectId: 'p1' });
    await deleteTask(db, standalone.id);
    expect(await listTasks(db, { projectId: null })).toHaveLength(0);
    await db.delete(schema.project).where(eq(schema.project.id, 'p1'));
    expect(await listTasks(db, { projectId: 'p1' })).toHaveLength(0);
  });
});
