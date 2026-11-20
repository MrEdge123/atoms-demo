import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { getMutationBlockReason } from '@/core';
import {
  assertProjectAccess,
  assertWorkbenchWriteRequest,
  requireWorkbenchSession,
} from '@/app/api/_security';
import { createSseResponse } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

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
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const accessBlocked = assertProjectAccess(project, session.sid, 'write');
  if (accessBlocked) return accessBlocked;

  const body = (await req.json().catch(() => ({}))) as {
    instruction?: string;
    model?: string;
    targetRole?: string;
  };
  const instruction = body.instruction?.trim();
  if (!instruction) {
    return NextResponse.json(
      { error: 'instruction is required' },
      { status: 400 }
    );
  }

  let targetRole: 'auto' | 'iris' | 'emma' | 'alex' | undefined;
  if (body.targetRole !== undefined) {
    if (
      body.targetRole !== 'auto' &&
      body.targetRole !== 'iris' &&
      body.targetRole !== 'emma' &&
      body.targetRole !== 'alex'
    ) {
      return NextResponse.json(
        { error: 'targetRole must be one of auto, iris, emma, alex' },
        { status: 400 }
      );
    }
    targetRole = body.targetRole;
  }

  const blockReason = getMutationBlockReason(project, 'iterate');
  if (blockReason) {
    return NextResponse.json({ error: blockReason }, { status: 409 });
  }
  if (Object.keys(project.draftFiles).length === 0) {
    return NextResponse.json(
      { error: '当前项目尚未生成草稿文件，无法迭代' },
      { status: 400 }
    );
  }

  return createSseResponse(
    (signal) =>
      c.workflow.iterate(id, instruction, {
        model: body.model,
        targetRole,
        signal,
      }),
    req
  );
}
