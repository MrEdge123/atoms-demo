/**
 * Mock Checkout Completion Endpoint (LOCAL / DEMO SIMULATION ONLY).
 *
 * This route does NOT connect to a real payment gateway; instead it validates
 * the caller's end-user Bearer token for the target project and issues a signed
 * internal Mock webhook event to upgrade only that authenticated user's plan.
 */
import { NextResponse } from 'next/server';
import { signHmacSha256 } from '@/adapters/app-cloud/crypto';
import { extractBearerToken } from '@/app/api/_utils';
import { getContainer } from '@/container';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const token = extractBearerToken(req);
  if (!token) {
    return NextResponse.json(
      { error: 'Authentication required before completing mock checkout' },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    projectId?: string;
    userId?: string;
    plan?: 'pro';
  };

  if (!body.sessionId || !body.projectId) {
    return NextResponse.json(
      { error: 'sessionId and projectId are required' },
      { status: 400 }
    );
  }

  const c = await getContainer();
  const user = await c.appCloud.auth.verifyToken(body.projectId, token);
  if (!user) {
    return NextResponse.json(
      { error: 'Invalid session token for target project' },
      { status: 401 }
    );
  }

  if (body.userId && body.userId !== user.id) {
    return NextResponse.json(
      { error: 'Token user does not match checkout userId' },
      { status: 403 }
    );
  }

  const rawBody = JSON.stringify({
    orderId: `ord_mock_${body.sessionId}`,
    projectId: body.projectId,
    userId: user.id,
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
