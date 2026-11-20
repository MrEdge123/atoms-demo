import { NextResponse } from 'next/server';
import { getContainer } from '@/container';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = await getContainer();
  return NextResponse.json({
    models: c.llm.listModels(),
  });
}
