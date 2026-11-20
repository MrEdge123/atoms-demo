import { getContainer } from '@/container';
import { corsOptionsResponse, jsonWithCors } from '@/app/api/_utils';

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(
  req: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    name?: string;
  };

  try {
    const c = await getContainer();
    const res = await c.appCloud.auth.register(
      projectId,
      body.email ?? '',
      body.password ?? '',
      body.name
    );
    return jsonWithCors(res, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonWithCors({ error: message }, { status: 400 });
  }
}
