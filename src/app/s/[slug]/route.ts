import { getContainer } from '@/container';
import { buildSandboxCspHeader } from '@/app/api/_security';
import { resolvePublicBaseUrl } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(
  req: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const c = await getContainer();
  const origin = resolvePublicBaseUrl(req, c.apiBaseUrl);
  const cspHeader = buildSandboxCspHeader(origin);
  const project = await c.repo.getBySlug(slug);

  if (!project || !project.publishedHtml) {
    const safeSlug = escapeHtml(slug);
    const notFoundHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>站点尚未发布 · Mini Atoms</title>
  <style>
    body { font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #f8f8f6; color: rgba(12, 12, 12, 0.95); display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { max-width: 440px; width: 100%; background: #ffffff; border: 1px solid rgba(12, 12, 12, 0.1); border-radius: 16px; padding: 28px; box-shadow: 0 4px 20px rgba(12, 12, 12, 0.05); }
    code { background: #f3f3f0; padding: 2px 6px; border-radius: 6px; font-size: 13px; }
    a { display: inline-block; margin-top: 18px; padding: 9px 18px; background: #4267ff; color: #ffffff; text-decoration: none; border-radius: 999px; font-size: 13px; font-weight: 600; }
    a:hover { background: #425ce1; }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin:0;font-size:18px;font-weight:600;">站点尚未发布或不存在</h1>
    <p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:rgba(12,12,12,0.6);">标识为 <code>${safeSlug}</code> 的页面当前未发布线上版本，请先在工作台点击“发布”生成独立站点。</p>
    <a href="/">返回 Mini Atoms 工作台</a>
  </div>
</body>
</html>`;
    return new Response(notFoundHtml, {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': cspHeader,
      },
    });
  }

  return new Response(project.publishedHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': cspHeader,
    },
  });
}
