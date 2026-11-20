import { getContainer } from '@/container';
import { corsOptionsResponse, jsonWithCors } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

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
    const record = await c.appCloud.db.update(
      projectId,
      collection,
      recordId,
      body.patch
    );
    return jsonWithCors({ record });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonWithCors({ error: message }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  context: {
    params: Promise<{ projectId: string; collection: string; recordId: string }>;
  }
) {
  const { projectId, collection, recordId } = await context.params;
  try {
    const c = await getContainer();
    await c.appCloud.db.remove(projectId, collection, recordId);
    return jsonWithCors({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonWithCors({ error: message }, { status: 404 });
  }
}
