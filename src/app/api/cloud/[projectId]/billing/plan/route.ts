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
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const token = extractBearerToken(req);
  if (!token) {
    return jsonWithCors({ error: 'Authentication required' }, { status: 401 });
  }

  const c = await getContainer();
  const user = await c.appCloud.auth.verifyToken(projectId, token);
  if (!user) {
    return jsonWithCors({ error: 'Invalid token' }, { status: 401 });
  }

  const plan = await c.appCloud.billing.getPlan(projectId, user.id);
  return jsonWithCors(plan);
}
