import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import {
  assertNotFromPublishedSiteReferer,
  assertProjectAccess,
  getVerifiedWorkbenchSid,
} from '@/app/api/_security';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const refererBlocked = assertNotFromPublishedSiteReferer(req);
  if (refererBlocked) return refererBlocked;

  const { id } = await context.params;
  const c = await getContainer();
  const sid = await getVerifiedWorkbenchSid(req, c.authSecret);
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const accessBlocked = assertProjectAccess(project, sid, 'read');
  if (accessBlocked) return accessBlocked;
  if (Object.keys(project.draftFiles).length === 0) {
    return NextResponse.json(
      { error: '当前项目暂无可导出的草稿文件' },
      { status: 400 }
    );
  }

  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(project.draftFiles)) {
    zip.file(filePath, content);
  }
  zip.file(
    'README.md',
    `# ${project.title}\n\nExported from Mini Atoms Demo.\nProject ID: ${project.id}\nCloud Endpoint: ${c.apiBaseUrl}/api/cloud/${project.id}\n`
  );

  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const body = Buffer.from(bytes);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${project.slug}.zip"`,
    },
  });
}
