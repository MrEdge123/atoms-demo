import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { getMutationBlockReason, normalizePath } from '@/core';
import type { VirtualFS } from '@/domain';
import {
  assertProjectAccess,
  assertWorkbenchWriteRequest,
  buildSandboxCspHeader,
  requireWorkbenchSession,
} from '@/app/api/_security';
import { resolvePublicBaseUrl } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

const MAX_TOTAL_FILES_BYTES = 512 * 1024;

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const c = await getContainer();
  const writeBlocked = assertWorkbenchWriteRequest(req, c.apiBaseUrl);
  if (writeBlocked) return writeBlocked;

  const session = await requireWorkbenchSession(req, c.authSecret);
  if (!session.ok) return session.response;

  const { id } = await context.params;
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const accessBlocked = assertProjectAccess(project, session.sid, 'write');
  if (accessBlocked) return accessBlocked;

  const body = (await req.json().catch(() => ({}))) as {
    files?: unknown;
  };

  if (
    !body.files ||
    typeof body.files !== 'object' ||
    Array.isArray(body.files)
  ) {
    return NextResponse.json(
      { error: 'files object is required' },
      { status: 400 }
    );
  }

  const normalizedFiles: VirtualFS = {};
  let totalBytes = 0;
  try {
    for (const [rawPath, rawContent] of Object.entries(
      body.files as Record<string, unknown>
    )) {
      if (typeof rawContent !== 'string') {
        return NextResponse.json(
          { error: `Invalid content for file "${rawPath}"` },
          { status: 400 }
        );
      }
      const cleanPath = normalizePath(rawPath);
      normalizedFiles[cleanPath] = rawContent;
      totalBytes += Buffer.byteLength(rawContent, 'utf8');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (Object.keys(normalizedFiles).length === 0) {
    return NextResponse.json(
      { error: 'At least one source file is required' },
      { status: 400 }
    );
  }

  if (totalBytes > MAX_TOTAL_FILES_BYTES) {
    return NextResponse.json(
      { error: 'Total source size exceeds 512KB limit' },
      { status: 400 }
    );
  }

  const blockReason = getMutationBlockReason(project, 'iterate');
  if (blockReason) {
    return NextResponse.json({ error: blockReason }, { status: 409 });
  }

  const origin = resolvePublicBaseUrl(req, c.apiBaseUrl);
  const artifact = await c.builder.compile({
    files: normalizedFiles,
    projectId: project.id,
    apiBaseUrl: origin,
    capabilities: project.capabilities,
    mode: 'preview',
    seo: {
      title: project.plan?.seo?.title ?? project.plan?.appName ?? project.title,
      description:
        project.plan?.seo?.description ??
        project.plan?.summary ??
        project.title,
    },
  });

  // Preserve publishedHtml & publishedVersion untouched; only save draftFiles.
  await c.repo.saveDraft(
    id,
    normalizedFiles,
    artifact.ok ? 'ready' : 'error'
  );

  const existingEvents = await c.repo.listEvents(id);
  await c.repo.appendEvent(id, {
    seq: existingEvents.length + 1,
    role: 'system',
    type: 'thought',
    payload: {
      message: artifact.ok
        ? '手动编辑源码并重新编译通过'
        : '手动编辑源码编译失败，请修复后重试',
    },
    timestamp: new Date().toISOString(),
  });

  const updatedProject = await c.repo.getById(id);
  return NextResponse.json(
    {
      project: updatedProject,
      ok: artifact.ok,
      previewHtml: artifact.ok ? artifact.html : null,
      compileErrors: artifact.ok ? [] : artifact.errors,
    },
    {
      headers: {
        'Content-Security-Policy': buildSandboxCspHeader(origin),
      },
    }
  );
}
