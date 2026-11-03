import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Project } from '@/db/schema';
import { slugify } from '@/lib/slug';
import { uniqueSlug } from './service';

export async function createPurchaseProject(
  db: Db,
  input: { title: string; summary: string; body?: string; ownerUserId: string },
): Promise<Project> {
  const slug = await uniqueSlug(db, slugify(input.title));
  const [row] = await db.insert(schema.project).values({
    id: randomUUID(), slug, title: input.title, summary: input.summary, body: input.body ?? '',
    kind: 'purchase', status: 'published', visibility: 'members', ownerUserId: input.ownerUserId,
    publishedAt: new Date(),
  }).returning();
  return row;
}

export function listPurchaseProjects(db: Db): Promise<Project[]> {
  return db.select().from(schema.project)
    .where(and(eq(schema.project.kind, 'purchase'), eq(schema.project.status, 'published')))
    .orderBy(desc(schema.project.createdAt));
}
