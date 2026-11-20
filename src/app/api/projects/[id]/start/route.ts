import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import { createSseResponse } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    idea?: string;
    model?: string;
  };
  const idea = body.idea?.trim();
  if (!idea) {
    return NextResponse.json(
      { error: 'Please provide a product idea' },
      { status: 400 }
    );
  }

  const c = await getContainer();
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  return createSseResponse(c.workflow.start(id, idea, { model: body.model }));
}
