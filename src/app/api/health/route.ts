import { NextResponse } from 'next/server';
import { getContainer } from '@/container';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const c = await getContainer();
    await c.repo.getById('__health_probe__');
    return NextResponse.json({
      ok: true,
      storage: process.env.STORAGE_ADAPTER || 'pglite',
      llm: process.env.LLM_ADAPTER || 'mock',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
