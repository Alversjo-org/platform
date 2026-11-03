import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The wiki is publicly readable (spec §2); its write paths are gated by requireAnyRole in the pages/actions themselves.
  if (pathname === '/login' || pathname.startsWith('/api/') || pathname === '/wiki' || pathname.startsWith('/wiki/')) return NextResponse.next();
  if (!getSessionCookie(request)) return NextResponse.redirect(new URL('/login', request.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next|.*\\..*).*)'] };
