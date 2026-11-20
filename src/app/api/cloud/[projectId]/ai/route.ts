import { getContainer } from '@/container';
import { consumeAiRateLimit, getAiProxyLimits } from '@/app/api/_rate-limit';
import { extractClientIp } from '@/app/api/_security';
import {
  corsOptionsResponse,
  extractBearerToken,
  jsonWithCors,
  resolvePublicBaseUrl,
} from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

function hasPublishedAiCapability(html: string | null): boolean {
  if (!html) return false;
  const match = html.match(/window\.__ATOMS_CONFIG__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match?.[1]) return false;
  try {
    const parsed = JSON.parse(match[1]) as { capabilities?: unknown };
    return Array.isArray(parsed.capabilities) && parsed.capabilities.includes('ai');
  } catch {
    return false;
  }
}

function isSameOriginPublishedSiteRequest(
  req: Request,
  expectedOrigin: string,
  slug: string
): boolean {
  const reqOrigin = req.headers.get('origin')?.trim();
  const referer = req.headers.get('referer')?.trim();
  if (!reqOrigin || reqOrigin !== expectedOrigin || !referer) {
    return false;
  }
  try {
    const parsed = new URL(referer);
    if (parsed.origin !== expectedOrigin) {
      return false;
    }
    const publishedPrefix = `/s/${slug}`;
    return (
      parsed.pathname === publishedPrefix ||
      parsed.pathname.startsWith(`${publishedPrefix}/`)
    );
  } catch {
    return false;
  }
}

export function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(
  req: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    maxTokens?: number;
  };
  const limits = getAiProxyLimits();
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return jsonWithCors({ error: 'prompt is required' }, { status: 400 });
  }
  if (prompt.length > limits.maxInputChars) {
    return jsonWithCors(
      {
        error: `prompt length must be ${limits.maxInputChars} characters or fewer`,
      },
      { status: 400 }
    );
  }

  const requestedMaxTokens =
    typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens)
      ? Math.trunc(body.maxTokens)
      : undefined;
  const effectiveMaxTokens = Math.max(
    1,
    Math.min(requestedMaxTokens ?? limits.maxTokens, limits.maxTokens)
  );

  const c = await getContainer();
  const project = await c.repo.getById(projectId);
  if (!project) {
    return jsonWithCors({ error: 'Project not found' }, { status: 404 });
  }
  if (
    !project.capabilities.includes('ai') &&
    !(project.publishedVersion > 0 && hasPublishedAiCapability(project.publishedHtml))
  ) {
    return jsonWithCors(
      { error: 'AI capability is not enabled for this project' },
      { status: 403 }
    );
  }
  if (!c.appCloud.ai) {
    return jsonWithCors(
      { error: 'AI proxy is not enabled on this runtime' },
      { status: 501 }
    );
  }

  let authMode: 'user' | 'published_origin';
  let actor: string;
  const token = extractBearerToken(req);
  if (token) {
    const user = await c.appCloud.auth.verifyToken(projectId, token);
    if (!user) {
      return jsonWithCors({ error: 'Invalid session token' }, { status: 401 });
    }
    authMode = 'user';
    actor = user.id;
  } else {
    const baseUrl = resolvePublicBaseUrl(req, c.apiBaseUrl);
    let expectedOrigin = baseUrl;
    try {
      expectedOrigin = new URL(baseUrl).origin;
    } catch {
      expectedOrigin = baseUrl;
    }
    if (
      project.publishedVersion > 0 &&
      isSameOriginPublishedSiteRequest(req, expectedOrigin, project.slug)
    ) {
      authMode = 'published_origin';
      actor = project.slug;
    } else {
      return jsonWithCors(
        {
          error:
            'Authentication required or request must come from the published site origin',
        },
        { status: 401 }
      );
    }
  }

  const ip = extractClientIp(req);
  const rate = consumeAiRateLimit({ ip, projectId });
  if (!rate.allowed) {
    console.warn(
      `[CloudAI] rate_limited project=${projectId} scope=${rate.scope} ip=${ip} auth=${authMode} ipCount=${rate.ipCount}/${rate.ipLimit} projectDayCount=${rate.projectDayCount}/${rate.projectDayLimit} retryAfter=${rate.retryAfterSec}s`
    );
    return jsonWithCors(
      {
        error:
          rate.scope === 'ip'
            ? 'Too many AI requests from this IP. Please retry shortly.'
            : 'Daily AI quota exceeded for this project.',
        scope: rate.scope,
        retryAfterSec: rate.retryAfterSec,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rate.retryAfterSec) },
      }
    );
  }

  console.log(
    `[CloudAI] invoke project=${projectId} ip=${ip} auth=${authMode} actor=${actor} promptLen=${prompt.length} maxTokens=${effectiveMaxTokens} ipCount=${rate.ipCount}/${rate.ipLimit} projectDayCount=${rate.projectDayCount}/${rate.projectDayLimit}`
  );

  const result = await c.appCloud.ai.complete(projectId, prompt, {
    maxTokens: effectiveMaxTokens,
    abortSignal: req.signal,
  });
  return jsonWithCors(result);
}
