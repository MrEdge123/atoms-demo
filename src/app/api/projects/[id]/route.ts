import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { isBuildingInProgress, isPlanningInProgress } from '@/core';
import {
  assertNotFromPublishedSiteReferer,
  assertProjectAccess,
  assertWorkbenchWriteRequest,
  buildSandboxCspHeader,
  getVerifiedWorkbenchSid,
  requireWorkbenchSession,
} from '@/app/api/_security';
import {
  compilePreviewSnapshot,
  resolvePublicBaseUrl,
} from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const refererBlocked = assertNotFromPublishedSiteReferer(req);
  if (refererBlocked) return refererBlocked;

  const { id } = await context.params;
  const c = await getContainer();
  const sid = await getVerifiedWorkbenchSid(req, c.authSecret);
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const accessBlocked = assertProjectAccess(project, sid, 'read');
  if (accessBlocked) return accessBlocked;

  const origin = resolvePublicBaseUrl(req, c.apiBaseUrl);
  const [events, snapshot] = await Promise.all([
    c.repo.listEvents(id),
    compilePreviewSnapshot(c, project, origin),
  ]);

  return NextResponse.json(
    {
      project: {
        ...project,
        publishedFiles: null,
        publishedHtml: null,
      },
      events,
      previewHtml: snapshot.previewHtml,
      compileErrors: snapshot.compileErrors,
      qrDataUrl: snapshot.qrDataUrl,
      publicUrl:
        project.publishedVersion > 0 ? `${origin}/s/${project.slug}` : null,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': buildSandboxCspHeader(origin),
      },
    }
  );
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const c = await getContainer();
  const writeBlocked = assertWorkbenchWriteRequest(req, c.apiBaseUrl);
  if (writeBlocked) return writeBlocked;

  const session = await requireWorkbenchSession(req, c.authSecret);
  if (!session.ok) return session.response;

  const { id } = await context.params;
  const existing = await c.repo.getById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const accessBlocked = assertProjectAccess(existing, session.sid, 'write');
  if (accessBlocked) return accessBlocked;

  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!title || title.length > 80) {
    return NextResponse.json(
      { error: '项目名称需为 1 至 80 个字符' },
      { status: 400 }
    );
  }

  try {
    const project = await c.repo.rename(id, title);
    return NextResponse.json({ project });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const c = await getContainer();
  const writeBlocked = assertWorkbenchWriteRequest(req, c.apiBaseUrl);
  if (writeBlocked) return writeBlocked;

  const session = await requireWorkbenchSession(req, c.authSecret);
  if (!session.ok) return session.response;

  const { id } = await context.params;
  const existing = await c.repo.getById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const accessBlocked = assertProjectAccess(existing, session.sid, 'write');
  if (accessBlocked) return accessBlocked;

  if (isPlanningInProgress(existing) || isBuildingInProgress(existing)) {
    return NextResponse.json(
      { error: '项目正在规划或构建中，请等待当前任务结束后再删除' },
      { status: 409 }
    );
  }

  await c.appCloud.purgeProject(id);
  await c.repo.remove(id);
  return NextResponse.json({ ok: true, id });
}
