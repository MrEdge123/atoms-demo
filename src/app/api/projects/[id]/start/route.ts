import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { styleThemeSchema } from '@/core';
import { createSseResponse } from '@/app/api/_utils';
import type { StyleThemeSpec } from '@/domain';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    idea?: string;
    model?: string;
    styleTheme?: unknown;
  };
  const idea = body.idea?.trim();
  if (!idea) {
    return NextResponse.json(
      { error: 'Please provide a product idea' },
      { status: 400 }
    );
  }

  let validatedTheme: StyleThemeSpec | undefined;
  if (body.styleTheme !== undefined && body.styleTheme !== null) {
    const parsedTheme = styleThemeSchema.safeParse(body.styleTheme);
    if (!parsedTheme.success) {
      return NextResponse.json(
        { error: '自定义风格主题格式无效，请检查配色与字段长度后重试' },
        { status: 400 }
      );
    }
    validatedTheme = parsedTheme.data;
  }

  const c = await getContainer();
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return createSseResponse(
    c.workflow.start(id, idea, { model: body.model, styleTheme: validatedTheme })
  );
}
