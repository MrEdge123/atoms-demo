import { NextResponse } from 'next/server';
import { getContainer } from '@/container';
import {
  assertNotFromPublishedSiteReferer,
  assertProjectAccess,
  assertWorkbenchWriteRequest,
  requireWorkbenchSession,
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
  const session = await requireWorkbenchSession(req, c.authSecret);
  if (!session.ok) return session.response;

  const project = await c.repo.getById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const accessBlocked = assertProjectAccess(project, session.sid, 'cloud');
  if (accessBlocked) return accessBlocked;

  const url = new URL(req.url);
  const requestedCollection = url.searchParams.get('collection');

  const [collections, users] = await Promise.all([
    c.appCloud.db.listCollections(id),
    c.appCloud.auth.listUsers(id),
  ]);

  const plannedNames = (project.plan?.collections ?? []).map((col) => col.name);
  const collectionMap = new Map<string, number>();
  for (const name of plannedNames) {
    collectionMap.set(name, 0);
  }
  for (const col of collections) {
    collectionMap.set(col.name, col.count);
  }

  const mergedCollections = Array.from(collectionMap.entries()).map(
    ([name, count]) => ({ name, count })
  );

  const activeCollection =
    requestedCollection ??
    collections[0]?.name ??
    plannedNames[0] ??
    null;

  const records = activeCollection
    ? await c.appCloud.db.list(id, activeCollection)
    : [];

  return NextResponse.json({
    collections: mergedCollections,
    activeCollection,
    records,
    users,
  });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const c = await getContainer();
  const writeBlocked = assertWorkbenchWriteRequest(req, c.apiBaseUrl);
  if (writeBlocked) return writeBlocked;

  const session = await requireWorkbenchSession(req, c.authSecret);
  if (!session.ok) return session.response;

  const { id } = await context.params;
  const existing = await c.repo.getById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const accessBlocked = assertProjectAccess(existing, session.sid, 'cloud');
  if (accessBlocked) return accessBlocked;

  const url = new URL(req.url);
  const collection = url.searchParams.get('collection');
  const recordId = url.searchParams.get('recordId');

  if (!collection || !recordId) {
    return NextResponse.json(
      { error: 'collection and recordId are required' },
      { status: 400 }
    );
  }

  try {
    await c.appCloud.db.remove(id, collection, recordId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
