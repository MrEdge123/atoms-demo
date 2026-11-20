import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import {
  isBuildingInProgress,
  isPlanningInProgress,
  productPlanSchema,
} from '@/core';
import {
  assertProjectAccess,
  assertWorkbenchWriteRequest,
  requireWorkbenchSession,
} from '@/app/api/_security';
import { createSseResponse } from '@/app/api/_utils';
import type { ProductPlan } from '@/domain';

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
    planPatch?: Partial<ProductPlan>;
    model?: string;
    mode?: 'linear' | 'race';
  };
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

  let validatedPatch: Partial<ProductPlan> | undefined;
  if (body.planPatch !== undefined) {
    const parsedPatch = productPlanSchema.partial().safeParse(body.planPatch);
    if (!parsedPatch.success) {
      return NextResponse.json(
        { error: '产品方案补丁格式无效，请检查字段类型后重试' },
        { status: 400 }
      );
    }
    validatedPatch = parsedPatch.data;
  }

  return createSseResponse(
    (signal) =>
      c.workflow.confirmPlan(id, {
        planPatch: validatedPatch,
        model: body.model,
        mode: body.mode,
        signal,
      }),
    req
  );
}
