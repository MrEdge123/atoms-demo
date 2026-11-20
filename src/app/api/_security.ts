import { NextResponse } from 'next/server';
import type { Project } from '@/domain';
import {
  ATOMS_SID_COOKIE,
  parseCookieHeader,
  verifySignedSessionToken,
} from '@/lib/workbench-session';

const DEFAULT_PUBLIC_COLLECTIONS = 'guestbook,messages,comments,feedback';

export async function getVerifiedWorkbenchSid(
  req: Request,
  secret: string
): Promise<string | null> {
  const raw = parseCookieHeader(req.headers.get('cookie'), ATOMS_SID_COOKIE);
  return verifySignedSessionToken(raw, secret);
}

export function assertNotFromPublishedSiteReferer(
  req: Request
): NextResponse | null {
  const referer = req.headers.get('referer')?.trim();
  if (!referer) return null;

  if (referer === '/s' || referer.startsWith('/s/')) {
    return NextResponse.json(
      { error: '禁止从已发布站点直接调用工作台接口' },
      { status: 403 }
    );
  }

  try {
    const parsed = new URL(referer, 'http://localhost');
    if (parsed.pathname === '/s' || parsed.pathname.startsWith('/s/')) {
      return NextResponse.json(
        { error: '禁止从已发布站点直接调用工作台接口' },
        { status: 403 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Referer 请求头格式无效' },
      { status: 403 }
    );
  }

  return null;
}

export function resolveExpectedWorkbenchOrigin(apiBaseUrl: string): string | null {
  const configured = process.env.APP_BASE_URL?.trim() || apiBaseUrl;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

export function assertWorkbenchWriteRequest(
  req: Request,
  apiBaseUrl: string
): NextResponse | null {
  if (req.headers.get('x-atoms-workbench') !== '1') {
    return NextResponse.json(
      { error: '缺少合法的工作台请求标识头（X-Atoms-Workbench）' },
      { status: 403 }
    );
  }

  const refererBlocked = assertNotFromPublishedSiteReferer(req);
  if (refererBlocked) return refererBlocked;

  const expectedOrigin = resolveExpectedWorkbenchOrigin(apiBaseUrl);
  const reqOrigin = req.headers.get('origin')?.trim();
  if (!expectedOrigin || !reqOrigin || reqOrigin !== expectedOrigin) {
    return NextResponse.json(
      { error: 'Origin 校验失败，仅允许从配置的工作台源站发起写入' },
      { status: 403 }
    );
  }

  return null;
}

export async function requireWorkbenchSession(
  req: Request,
  secret: string
): Promise<{ ok: true; sid: string } | { ok: false; response: NextResponse }> {
  const sid = await getVerifiedWorkbenchSid(req, secret);
  if (!sid) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: '工作台匿名会话无效或已过期，请刷新页面后重试' },
        { status: 403 }
      ),
    };
  }
  return { ok: true, sid };
}

export function assertProjectAccess(
  project: Project,
  sid: string | null,
  mode: 'read' | 'write' | 'cloud'
): NextResponse | null {
  if (mode === 'read') {
    if (!project.ownerSid) {
      return null;
    }
    if (!sid || project.ownerSid !== sid) {
      return NextResponse.json(
        { error: '无权查看其他会话的项目内容' },
        { status: 403 }
      );
    }
    return null;
  }

  if (!sid) {
    return NextResponse.json(
      { error: '工作台匿名会话无效，请刷新页面后重试' },
      { status: 403 }
    );
  }

  if (!project.ownerSid) {
    return NextResponse.json(
      { error: '示例项目或历史只读项目不允许修改、删除或操作后台数据' },
      { status: 403 }
    );
  }

  if (project.ownerSid !== sid) {
    return NextResponse.json(
      { error: '无权操作其他工作台会话创建的项目' },
      { status: 403 }
    );
  }

  return null;
}

export function buildSandboxCspHeader(
  origin: string,
  opts?: { forMeta?: boolean }
): string {
  let cloudConnectPrefix = '/api/cloud/';
  try {
    const cleanOrigin = new URL(origin).origin;
    cloudConnectPrefix = `${cleanOrigin}/api/cloud/`;
  } catch {
    cloudConnectPrefix = '/api/cloud/';
  }

  const directives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${cloudConnectPrefix}`,
    "object-src 'none'",
    "base-uri 'self'",
  ];

  if (!opts?.forMeta) {
    directives.push("frame-ancestors 'self'");
  }

  return directives.join('; ');
}

export function isPublicCollection(collection: string): boolean {
  const configured =
    process.env.CLOUD_PUBLIC_COLLECTIONS ?? DEFAULT_PUBLIC_COLLECTIONS;
  const normalized = collection.trim().toLowerCase();
  if (!normalized) return false;
  const allowlist = configured
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(normalized);
}

export function extractClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown';
}
