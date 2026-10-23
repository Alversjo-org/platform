import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Project, ProjectStatus } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';
import { slugify } from '@/lib/slug';

export class ProjectNotFoundError extends Error {
  constructor(id: string) { super(`No project ${id}`); this.name = 'ProjectNotFoundError'; }
}
export class EventCreationBlockedError extends Error {
  constructor(userId: string) { super(`${userId} is not allowed to create events`); this.name = 'EventCreationBlockedError'; }
}
export class InvalidTransitionError extends Error {
  constructor(from: ProjectStatus, to: ProjectStatus) { super(`Cannot transition from ${from} to ${to}`); this.name = 'InvalidTransitionError'; }
}
export class IncompleteEventError extends Error {
  constructor(reason: string) { super(`Cannot publish: ${reason}`); this.name = 'IncompleteEventError'; }
}

export async function getProject(db: Db, projectId: string): Promise<Project> {
  const [row] = await db.select().from(schema.project).where(eq(schema.project.id, projectId));
  if (!row) throw new ProjectNotFoundError(projectId);
  return row;
}

export async function getProjectBySlug(db: Db, slug: string): Promise<Project | null> {
  const [row] = await db.select().from(schema.project).where(eq(schema.project.slug, slug));
  return row ?? null;
}

async function uniqueSlug(db: Db, base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await getProjectBySlug(db, candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

export async function createEvent(db: Db, input: { title: string; summary: string; ownerUserId: string }): Promise<Project> {
  const [owner] = await db.select().from(schema.user).where(eq(schema.user.id, input.ownerUserId));
  if (!owner?.canCreateEvents) throw new EventCreationBlockedError(input.ownerUserId);
  const slug = await uniqueSlug(db, slugify(input.title));
  return db.transaction(async (tx) => {
    const id = randomUUID();
    const [row] = await tx.insert(schema.project).values({
      id, slug, title: input.title, summary: input.summary, kind: 'event', status: 'draft', visibility: 'members',
      ownerUserId: input.ownerUserId,
    }).returning();
    await tx.insert(schema.projectMember).values({ projectId: id, userId: input.ownerUserId, role: 'lead' });
    return row;
  });
}

export async function updateProjectMeta(db: Db, input: { projectId: string; title: string; summary: string; body: string }): Promise<Project> {
  const [row] = await db.update(schema.project)
    .set({ title: input.title, summary: input.summary, body: input.body, updatedAt: new Date() })
    .where(eq(schema.project.id, input.projectId))
    .returning();
  if (!row) throw new ProjectNotFoundError(input.projectId);
  return row;
}

export async function duplicateEvent(db: Db, input: { sourceProjectId: string; actorUserId: string }): Promise<Project> {
  const [owner] = await db.select().from(schema.user).where(eq(schema.user.id, input.actorUserId));
  if (!owner?.canCreateEvents) throw new EventCreationBlockedError(input.actorUserId);
  const source = await getProject(db, input.sourceProjectId);
  const members = await db.select().from(schema.projectMember).where(eq(schema.projectMember.projectId, input.sourceProjectId));
  const slug = await uniqueSlug(db, slugify(source.title));
  return db.transaction(async (tx) => {
    const id = randomUUID();
    const [row] = await tx.insert(schema.project).values({
      id, slug, title: source.title, summary: source.summary, body: source.body,
      kind: 'event', status: 'draft', visibility: 'members', ownerUserId: input.actorUserId,
    }).returning();
    if (members.length > 0) {
      await tx.insert(schema.projectMember).values(members.map((m) => ({ projectId: id, userId: m.userId, role: m.role })));
    }
    return row;
  });
}

export const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['published', 'archived'],
  published: ['cancelled', 'closed'],
  cancelled: ['archived'],
  closed: ['archived'],
  archived: [],
};

export async function transitionStatus(db: Db, input: { projectId: string; to: ProjectStatus; actorUserId: string }): Promise<Project> {
  const current = await getProject(db, input.projectId);
  if (!ALLOWED_TRANSITIONS[current.status].includes(input.to)) throw new InvalidTransitionError(current.status, input.to);
  if (input.to === 'published') {
    const [details] = await db.select().from(schema.eventDetails).where(eq(schema.eventDetails.projectId, input.projectId));
    if (!details) throw new IncompleteEventError('missing event details');
    const [anyArea] = await db.select().from(schema.eventArea).where(eq(schema.eventArea.eventProjectId, input.projectId));
    if (!anyArea) throw new IncompleteEventError('no area booked');
  }
  const [row] = await db.update(schema.project)
    .set({ status: input.to, publishedAt: input.to === 'published' ? new Date() : current.publishedAt, updatedAt: new Date() })
    .where(eq(schema.project.id, input.projectId))
    .returning();
  await logDecision(db, { entity: 'project', entityId: input.projectId, actorUserId: input.actorUserId, action: 'status_change', diff: { from: current.status, to: input.to } });
  return row;
}

