import { getDb } from '@/db';
import { getStripe } from '@/lib/stripe/client';
import { syncMembersFromStripe } from '@/lib/stripe/sync';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!secret || authHeader !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 });

  const results = await syncMembersFromStripe(await getDb(), getStripe());
  return Response.json({ results });
}
