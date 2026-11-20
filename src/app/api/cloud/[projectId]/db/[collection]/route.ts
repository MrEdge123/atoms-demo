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

  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');
  const limit = rawLimit !== null ? Number(rawLimit) : undefined;
  const offset = rawOffset !== null ? Number(rawOffset) : undefined;

  const records = await c.appCloud.db.list(projectId, collection, {
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    ...(offset !== undefined && Number.isFinite(offset) ? { offset } : {}),
  });
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
    let ownerUserId: string | undefined;
    if (token) {
      const user = await c.appCloud.auth.verifyToken(projectId, token);
      if (!user) {
        return jsonWithCors({ error: 'Invalid session token' }, { status: 401 });
      }
      ownerUserId = user.id;
    }

    const record = await c.appCloud.db.create(
      projectId,
      collection,
      body.data,
      ownerUserId
    );
    return jsonWithCors({ record }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonWithCors({ error: message }, { status: 400 });
  }
}
