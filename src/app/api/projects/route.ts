import { NextResponse } from 'next/server';
import { getContainer } from '@/container';

export const dynamic = 'force-dynamic';

export async function GET() {
  const c = await getContainer();
  const projects = await c.repo.listAll();
  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    slug?: string;
  };
  const title = body.title?.trim() || '新应用项目';
  const rawSlug =
    body.slug?.trim() ||
    `app-${Date.now().toString(36).slice(-5)}`;

  const c = await getContainer();
  const project = await c.repo.create({ title, slug: rawSlug });
  return NextResponse.json({ project }, { status: 201 });
}
