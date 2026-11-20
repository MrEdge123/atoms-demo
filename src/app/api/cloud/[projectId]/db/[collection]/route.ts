import { getContainer } from '@/container';
import {
  corsOptionsResponse,
  extractBearerToken,
  jsonWithCors,
} from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsOptionsResponse();
}

export async function GET(
  req: Request,
  context: { params: Promise<{ projectId: string; collection: string }> }
) {
  const { projectId, collection } = await context.params;
  const c = await getContainer();
  const url = new URL(req.url);
  const mineOnly = url.searchParams.get('mine') === '1';

  let ownerUserId: string | undefined;
  if (mineOnly) {
    const token = extractBearerToken(req);
    const user = token
      ? await c.appCloud.auth.verifyToken(projectId, token)
      : null;
    if (!user) {
      return jsonWithCors({ error: 'Authentication required' }, { status: 401 });
    }
    ownerUserId = user.id;
  }

  const records = await c.appCloud.db.list(
    projectId,
    collection,
    ownerUserId ? { ownerUserId } : undefined
  );
  return jsonWithCors({ records });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ projectId: string; collection: string }> }
) {
  const { projectId, collection } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
  };

  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return jsonWithCors(
      { error: 'Request body must include a JSON object "data"' },
      { status: 400 }
    );
  }

  try {
    const c = await getContainer();
    const token = extractBearerToken(req);
    const user = token
      ? await c.appCloud.auth.verifyToken(projectId, token)
      : null;

    const record = await c.appCloud.db.create(
      projectId,
      collection,
      body.data,
      user?.id
    );
    return jsonWithCors({ record }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonWithCors({ error: message }, { status: 400 });
  }
}
