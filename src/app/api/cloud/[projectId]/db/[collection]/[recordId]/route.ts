import { CloudRecordForbiddenError } from '@/ports';
import { getContainer } from '@/container';
import { isPublicCollection } from '@/app/api/_security';
import {
  corsOptionsResponse,
  extractBearerToken,
  jsonWithCors,
} from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

function mapRecordErrorStatus(err: unknown): { message: string; status: number } {
  if (err instanceof CloudRecordForbiddenError) {
    return { message: err.message, status: 403 };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    message,
    status: message.toLowerCase().includes('not found') ? 404 : 400,
  };
}

export function OPTIONS() {
  return corsOptionsResponse();
}

export async function PATCH(
  req: Request,
  context: {
    params: Promise<{ projectId: string; collection: string; recordId: string }>;
  }
) {
  const { projectId, collection, recordId } = await context.params;
  const token = extractBearerToken(req);
  if (!token) {
    return jsonWithCors(
      { error: 'Authentication required to modify records' },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    patch?: Record<string, unknown>;
  };

  if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
    return jsonWithCors(
      { error: 'Request body must include a JSON object "patch"' },
      { status: 400 }
    );
  }

  try {
    const c = await getContainer();
    const user = await c.appCloud.auth.verifyToken(projectId, token);
    if (!user) {
      return jsonWithCors({ error: 'Invalid session token' }, { status: 401 });
    }

    const record = await c.appCloud.db.update(
      projectId,
      collection,
      recordId,
      body.patch,
      {
        expectedOwnerUserId: user.id,
        allowUnownedPublic: isPublicCollection(collection),
      }
    );
    return jsonWithCors({ record });
  } catch (err) {
    const mapped = mapRecordErrorStatus(err);
    return jsonWithCors({ error: mapped.message }, { status: mapped.status });
  }
}

export async function DELETE(
  req: Request,
  context: {
    params: Promise<{ projectId: string; collection: string; recordId: string }>;
  }
) {
  const { projectId, collection, recordId } = await context.params;
  const token = extractBearerToken(req);
  if (!token) {
    return jsonWithCors(
      { error: 'Authentication required to delete records' },
      { status: 401 }
    );
  }

  try {
    const c = await getContainer();
    const user = await c.appCloud.auth.verifyToken(projectId, token);
    if (!user) {
      return jsonWithCors({ error: 'Invalid session token' }, { status: 401 });
    }

    await c.appCloud.db.remove(projectId, collection, recordId, {
      expectedOwnerUserId: user.id,
      allowUnownedPublic: isPublicCollection(collection),
    });
    return jsonWithCors({ ok: true });
  } catch (err) {
    const mapped = mapRecordErrorStatus(err);
    return jsonWithCors({ error: mapped.message }, { status: mapped.status });
  }
}
