import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { isBuildingInProgress, isPlanningInProgress } from '@/core';
import { createSseResponse } from '@/app/api/_utils';
import type { ProductPlan } from '@/domain';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    planPatch?: Partial<ProductPlan>;
    model?: string;
    mode?: 'linear' | 'race';
  };

  const c = await getContainer();
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  if (isPlanningInProgress(project)) {
    return NextResponse.json(
      { error: 'Iris / Emma 正在分析需求并生成方案，请等待新方案就绪后再确认' },
      { status: 409 }
    );
  }
  if (isBuildingInProgress(project)) {
    return NextResponse.json(
      { error: 'Alex 正在构建中，请等待当前构建完成后再操作' },
      { status: 409 }
    );
  }
  if (!project.plan) {
    return NextResponse.json(
      { error: '当前项目暂无可确认的产品方案，请先启动 AI 团队' },
      { status: 400 }
    );
  }

  return createSseResponse(
    c.workflow.confirmPlan(id, {
      planPatch: body.planPatch,
      model: body.model,
      mode: body.mode,
    })
  );
}
