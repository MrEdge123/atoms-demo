import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { getMutationBlockReason } from '@/core';
import { createSseResponse } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    instruction?: string;
    model?: string;
  };
  const instruction = body.instruction?.trim();
  if (!instruction) {
    return NextResponse.json(
      { error: 'instruction is required' },
      { status: 400 }
    );
  }

  const c = await getContainer();
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
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
    c.workflow.iterate(id, instruction, { model: body.model })
  );
}
