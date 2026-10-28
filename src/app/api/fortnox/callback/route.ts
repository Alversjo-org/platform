import { getDb } from '@/db';
import { createFortnoxClient } from '@/lib/fortnox/client';
import { completeConnect } from '@/lib/fortnox/connection-service';
import { requireTreasurer } from '@/lib/session';

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

function redirectTo(path: string): Response {
  return new Response(null, { status: 307, headers: { Location: path } });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (error) return redirectTo(`/fortnox?error=${encodeURIComponent(error)}`);
  if (!code) return redirectTo('/fortnox?error=missing_code');

  const cookieState = readCookie(request.headers.get('cookie'), 'fortnox_oauth_state');
  if (!cookieState || cookieState !== state) return redirectTo('/fortnox?error=state_mismatch');

  // Auth is checked here, not before the checks above: those redirects carry a diagnostic
  // reason and don't need identity, and Fortnox's own redirect still carries the browser's
  // session cookie, so the acting treasurer is whoever set the state cookie below.
  const user = await requireTreasurer();
  const db = await getDb();
  await completeConnect(db, createFortnoxClient(), { code, userId: user.id });
  return redirectTo('/fortnox');
}
