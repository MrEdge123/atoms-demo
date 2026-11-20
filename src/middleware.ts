import { NextResponse, type NextRequest } from 'next/server';
import {
  ATOMS_SID_COOKIE,
  ATOMS_SID_MAX_AGE_SECONDS,
  mintSignedSessionToken,
  resolveAuthSecret,
  shouldUseSecureCookie,
  verifySignedSessionToken,
} from '@/lib/workbench-session';

export const config = {
  matcher: ['/', '/api/projects'],
};

/**
 * Ensures anonymous visitors receive an HMAC-signed `atoms_sid` cookie on initial
 * GET navigation or project-list load. Write routes never auto-mint cookies so
 * cookie-less POST/PATCH/DELETE calls reliably fail ownership verification.
 */
export async function middleware(req: NextRequest) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return NextResponse.next();
  }

  const secret = resolveAuthSecret();
  const existingCookie = req.cookies.get(ATOMS_SID_COOKIE)?.value;
  const existingSid = await verifySignedSessionToken(existingCookie, secret);
  if (existingSid) {
    return NextResponse.next();
  }

  const minted = await mintSignedSessionToken(secret);
  const requestHeaders = new Headers(req.headers);
  const rawCookie = requestHeaders.get('cookie') ?? '';
  const filteredParts = rawCookie
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${ATOMS_SID_COOKIE}=`));
  filteredParts.push(`${ATOMS_SID_COOKIE}=${minted.cookieValue}`);
  requestHeaders.set('cookie', filteredParts.join('; '));

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });
  res.cookies.set({
    name: ATOMS_SID_COOKIE,
    value: minted.cookieValue,
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: 'lax',
    path: '/',
    maxAge: ATOMS_SID_MAX_AGE_SECONDS,
  });
  return res;
}
