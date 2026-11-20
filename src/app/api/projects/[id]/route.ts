import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { isBuildingInProgress, isPlanningInProgress } from '@/core';
import {
  compilePreviewSnapshot,
  resolvePublicBaseUrl,
} from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const c = await getContainer();
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const origin = resolvePublicBaseUrl(req, c.apiBaseUrl);
  const [events, snapshot] = await Promise.all([
    c.repo.listEvents(id),
    compilePreviewSnapshot(c, project, origin),
  ]);

  return NextResponse.json({
    project,
    events,
    previewHtml: snapshot.previewHtml,
    compileErrors: snapshot.compileErrors,
    qrDataUrl: snapshot.qrDataUrl,
    publicUrl:
      project.publishedVersion > 0 ? `${origin}/s/${project.slug}` : null,
  });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim() : '';

  if (!title || title.length > 80) {
    return NextResponse.json(
      { error: '项目名称需为 1 至 80 个字符' },
      { status: 400 }
    );
  }

  const c = await getContainer();
  const existing = await c.repo.getById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
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
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const c = await getContainer();
  const existing = await c.repo.getById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

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
