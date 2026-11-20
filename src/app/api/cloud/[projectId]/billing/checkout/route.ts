import { getContainer } from '@/container';
import {
  corsOptionsResponse,
  extractBearerToken,
  jsonWithCors,
  resolvePublicBaseUrl,
} from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(
  req: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const token = extractBearerToken(req);
  if (!token) {
    return jsonWithCors(
      { error: 'Please register or sign in before upgrading to Pro' },
      { status: 401 }
    );
  }

  const c = await getContainer();
  const user = await c.appCloud.auth.verifyToken(projectId, token);
  if (!user) {
    return jsonWithCors({ error: 'Invalid session token' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    plan?: 'pro';
    returnUrl?: string;
  };

  try {
    const origin = resolvePublicBaseUrl(req, c.apiBaseUrl);
    const project = await c.repo.getById(projectId);
    const fallbackReturn = project
      ? `${origin}/s/${project.slug}`
      : `${origin}/`;
    const session = await c.appCloud.billing.createCheckoutSession({
      projectId,
      userId: user.id,
      plan: body.plan ?? 'pro',
      returnUrl: body.returnUrl || fallbackReturn,
    });
    const checkoutUrl =
      origin !== c.apiBaseUrl && session.checkoutUrl.startsWith(c.apiBaseUrl)
        ? `${origin}${session.checkoutUrl.slice(c.apiBaseUrl.length)}`
        : session.checkoutUrl;
    return jsonWithCors({ ...session, checkoutUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonWithCors({ error: message }, { status: 400 });
  }
}
