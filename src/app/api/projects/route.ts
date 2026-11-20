import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import {
  assertNotFromPublishedSiteReferer,
  assertWorkbenchWriteRequest,
  getVerifiedWorkbenchSid,
  requireWorkbenchSession,
} from '@/app/api/_security';
import {
  buildSessionCookieHeader,
  mintSignedSessionToken,
  shouldUseSecureCookie,
} from '@/lib/workbench-session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const refererBlocked = assertNotFromPublishedSiteReferer(req);
  if (refererBlocked) return refererBlocked;

  const c = await getContainer();
  const sid = await getVerifiedWorkbenchSid(req, c.authSecret);
  if (!sid) {
    const minted = await mintSignedSessionToken(c.authSecret);
    return NextResponse.json(
      { projects: [] },
      {
        headers: {
          'Cache-Control': 'no-store',
          'Set-Cookie': buildSessionCookieHeader(
            minted.cookieValue,
            shouldUseSecureCookie(req)
          ),
        },
      }
    );
  }

  const projects = await c.repo.listAll({ ownerSid: sid });
  const summaries = projects.map((project) => ({
    ...project,
    draftFiles: {},
    raceBranches: [],
    publishedFiles: null,
    publishedHtml: null,
  }));
  return NextResponse.json(
    { projects: summaries },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(req: Request) {
  const c = await getContainer();
  const writeBlocked = assertWorkbenchWriteRequest(req, c.apiBaseUrl);
  if (writeBlocked) return writeBlocked;

  const session = await requireWorkbenchSession(req, c.authSecret);
  if (!session.ok) return session.response;

  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    slug?: string;
  };
  const title = body.title?.trim() || '新应用项目';
  const rawSlug =
    body.slug?.trim() ||
    `app-${Date.now().toString(36).slice(-5)}`;
  if (rawSlug.length > 64) {
    return NextResponse.json(
      { error: '项目 slug 长度不能超过 64 个字符' },
      { status: 400 }
    );
  }

  const project = await c.repo.create({
    title,
    slug: rawSlug,
    ownerSid: session.sid,
  });
  return NextResponse.json({ project }, { status: 201 });
}
