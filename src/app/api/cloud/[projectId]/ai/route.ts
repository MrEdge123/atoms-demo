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
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return jsonWithCors({ error: 'prompt is required' }, { status: 400 });
  }
  if (prompt.length > 4000) {
    return jsonWithCors(
      { error: 'prompt length must be 4000 characters or fewer' },
      { status: 400 }
    );
  }

  const c = await getContainer();
  const project = await c.repo.getById(projectId);
  if (!project) {
    return jsonWithCors({ error: 'Project not found' }, { status: 404 });
  }
  if (!project.capabilities.includes('ai')) {
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

  const result = await c.appCloud.ai.complete(projectId, prompt);
  return jsonWithCors(result);
}
