import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { isBuildingInProgress, isPendingPlanConfirmation } from '@/core';
import {
  assertProjectAccess,
  assertWorkbenchWriteRequest,
  buildSandboxCspHeader,
  requireWorkbenchSession,
} from '@/app/api/_security';
import {
  compilePreviewSnapshot,
  resolvePublicBaseUrl,
} from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

export async function POST(
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

  const body = (await req.json().catch(() => ({}))) as {
    branchId?: string;
    runId?: string;
  };
  if (!body.branchId) {
    return NextResponse.json(
      { error: 'branchId is required' },
      { status: 400 }
    );
  }

  try {
    if (isPendingPlanConfirmation(existing)) {
      return NextResponse.json(
        { error: '当前存在待确认的 Emma 产品方案，请先确认方案后再选择候选分支' },
        { status: 409 }
      );
    }
    if (isBuildingInProgress(existing)) {
      return NextResponse.json(
        { error: 'Alex 正在构建中，请等待当前构建完成后再选择候选分支' },
        { status: 409 }
      );
    }
    const expectedRunId =
      typeof body.runId === 'string' && body.runId.trim()
        ? body.runId.trim()
        : undefined;
    const project = await c.workflow.selectBranch(id, body.branchId, {
      runId: expectedRunId,
    });
    const origin = resolvePublicBaseUrl(req, c.apiBaseUrl);
    const snapshot = await compilePreviewSnapshot(c, project, origin);
    return NextResponse.json(
      {
        project,
        previewHtml: snapshot.previewHtml,
        compileErrors: snapshot.compileErrors,
      },
      {
        headers: {
          'Content-Security-Policy': buildSandboxCspHeader(origin),
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
