import { NextResponse } from 'next/server';
import { signHmacSha256 } from '@/adapters/app-cloud/crypto';
import { getContainer } from '@/container';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    projectId?: string;
    userId?: string;
    plan?: 'pro';
  };

  if (!body.sessionId || !body.projectId || !body.userId) {
    return NextResponse.json(
      { error: 'sessionId, projectId and userId are required' },
      { status: 400 }
    );
  }

  const c = await getContainer();
  const rawBody = JSON.stringify({
    orderId: `ord_mock_${body.sessionId}`,
    projectId: body.projectId,
    userId: body.userId,
    plan: body.plan ?? 'pro',
  });

  const signature = signHmacSha256(rawBody, c.authSecret);
  const result = await c.appCloud.billing.handleWebhook({
    rawBody,
    signature,
  });

  if (!result) {
    return NextResponse.json(
      { error: 'Mock webhook processing failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
