import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getAuth } from '@/lib/auth';
import { canAccessBox } from '@/lib/boxes/access';
import type { BoxSessionResult } from '@/lib/boxes/box-session';
import { mintCloudCliToken } from '@/lib/boxes/cloudcli-token';

/** Called only by server.ts over localhost. Resolves a box host + cookie into a proxy decision. */
export async function POST(request: Request): Promise<Response> {
  if (!process.env.INTERNAL_SECRET || request.headers.get('x-internal-secret') !== process.env.INTERNAL_SECRET) {
    return Response.json({ status: 'forbidden' } satisfies BoxSessionResult, { status: 403 });
  }
  const { host, cookie } = (await request.json()) as { host: string; cookie?: string };
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie ?? '' }) });
  if (!session) return Response.json({ status: 'unauthenticated' } satisfies BoxSessionResult);

  const db = await getDb();
  const boxId = host.split('.')[0];
  if (!/^[0-9a-f]{12}$/.test(boxId)) return Response.json({ status: 'not_found' } satisfies BoxSessionResult);
  const [box] = await db.select().from(schema.boxes).where(eq(schema.boxes.id, boxId));
  if (!box) return Response.json({ status: 'not_found' } satisfies BoxSessionResult);

  const role = (session.user as { role?: string }).role === 'admin' ? 'admin' : 'member';
  if (!(await canAccessBox(db, { id: session.user.id, role }, boxId))) {
    return Response.json({ status: 'forbidden' } satisfies BoxSessionResult);
  }
  if (!box.flyMachineId) return Response.json({ status: 'not_found' } satisfies BoxSessionResult);
  return Response.json({
    status: 'ok', boxId, machineId: box.flyMachineId, token: mintCloudCliToken(box.jwtSecret), canStart: role === 'admin',
  } satisfies BoxSessionResult);
}
