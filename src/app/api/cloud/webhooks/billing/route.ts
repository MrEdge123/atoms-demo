import { NextResponse } from 'next/server';
import { getContainer } from '@/container';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature =
    req.headers.get('creem-signature') ??
    req.headers.get('x-mock-signature') ??
    null;

  const c = await getContainer();
  const result = await c.appCloud.billing.handleWebhook({
    rawBody,
    signature,
  });

  if (!result) {
    return NextResponse.json(
      { error: 'Invalid webhook signature or unhandled event' },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
