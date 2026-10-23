import { inArray } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, schema } from '@/db';
import { listSignups } from '@/lib/events/signup-service';
import { assertEventPermission } from '@/lib/projects/authorization';
import { getProjectBySlug } from '@/lib/projects/service';
import { requireUser } from '@/lib/session';

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const db = await getDb();
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  await assertEventPermission(db, project.id, user, 'editDetails');

  const signups = await listSignups(db, project.id);
  const users = signups.length > 0
    ? await db.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email }).from(schema.user)
      .where(inArray(schema.user.id, signups.map((s) => s.userId)))
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const header = 'name,email,seats,note,status';
  const rows = signups.map((s) => {
    const u = byId.get(s.userId);
    return [csvField(u?.name ?? ''), csvField(u?.email ?? ''), String(s.seats), csvField(s.note ?? ''), s.status].join(',');
  });
  const csv = [header, ...rows].join('\n');

  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="signups.csv"' },
  });
}
