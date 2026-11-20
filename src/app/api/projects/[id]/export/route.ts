import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { getContainer } from '@/container';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const c = await getContainer();
  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
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
