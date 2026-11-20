import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getContainer } from '@/container';
import { getMutationBlockReason } from '@/core';
import { resolvePublicBaseUrl } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const c = await getContainer();
    const project = await c.repo.getById(id);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const blockReason = getMutationBlockReason(project, 'publish');
    if (blockReason) {
      return NextResponse.json({ error: blockReason }, { status: 409 });
    }
    if (Object.keys(project.draftFiles).length === 0) {
      return NextResponse.json(
        { error: '当前项目暂无可发布的草稿文件' },
        { status: 400 }
      );
    }

    const origin = resolvePublicBaseUrl(req, c.apiBaseUrl);
    const result = await c.workflow.publish(id);
    const publicUrl = `${origin}/s/${project.slug}`;
    const qrDataUrl = await QRCode.toDataURL(publicUrl, {
      margin: 1,
      width: 180,
    });
    return NextResponse.json({
      ...result,
      url: publicUrl,
      qrDataUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
