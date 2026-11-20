import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import type { AppContainer } from '@/container';
import type { AgentEvent, CompileError, Project } from '@/domain';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function corsOptionsResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonWithCors(
  data: unknown,
  init?: { status?: number; headers?: Record<string, string> }
): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: {
      ...CORS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function createSseResponse(
  iterableOrFactory:
    | AsyncIterable<AgentEvent>
    | ((signal: AbortSignal) => AsyncIterable<AgentEvent>),
  req?: Request
): Response {
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const onReqAbort = () => {
    closed = true;
    abortController.abort(new Error('SSE client disconnected'));
  };
  if (req?.signal) {
    if (req.signal.aborted) {
      onReqAbort();
    } else {
      req.signal.addEventListener('abort', onReqAbort, { once: true });
    }
  }

  const iterable =
    typeof iterableOrFactory === 'function'
      ? iterableOrFactory(abortController.signal)
      : iterableOrFactory;
  const iterator = iterable[Symbol.asyncIterator]();

  const stopHeartbeat = (completed = false) => {
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (req?.signal) {
      req.signal.removeEventListener('abort', onReqAbort);
    }
    if (!completed && !abortController.signal.aborted) {
      abortController.abort(new Error('SSE stream closed early'));
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          stopHeartbeat();
        }
      }, 15000);

      let completed = false;
      try {
        while (!closed) {
          const { done, value: event } = await iterator.next();
          if (done || closed) {
            if (done) completed = true;
            break;
          }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        }
      } catch (err) {
        if (!closed) {
          const message = err instanceof Error ? err.message : String(err);
          const errorEvent: AgentEvent = {
            seq: 9999,
            role: 'system',
            type: 'error',
            payload: { message },
            timestamp: new Date().toISOString(),
          };
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`)
            );
          } catch {
            // Stream closed concurrently before error event could be enqueued
          }
        }
      } finally {
        stopHeartbeat(completed);
        if (!completed) {
          await iterator.return?.().catch(() => undefined);
        }
        try {
          controller.close();
        } catch {
          // Stream may already be closed or cancelled
        }
      }
    },
    cancel() {
      stopHeartbeat(false);
      void iterator.return?.().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export function resolvePublicBaseUrl(
  req: Request | null | undefined,
  fallbackBaseUrl: string
): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  if (req) {
    const forwardedHost = req.headers
      .get('x-forwarded-host')
      ?.split(',')[0]
      ?.trim();
    const host = forwardedHost || req.headers.get('host')?.split(',')[0]?.trim();
    if (host) {
      const forwardedProto = req.headers
        .get('x-forwarded-proto')
        ?.split(',')[0]
        ?.trim();
      const proto =
        forwardedProto ||
        (host.startsWith('localhost') || host.startsWith('127.0.0.1')
          ? 'http'
          : 'https');
      return `${proto}://${host}`.replace(/\/$/, '');
    }
    try {
      return new URL(req.url).origin.replace(/\/$/, '');
    } catch {
      // Fall through to container fallback
    }
  }
  return fallbackBaseUrl.replace(/\/$/, '');
}

export async function compilePreviewSnapshot(
  c: AppContainer,
  project: Project,
  baseUrlOverride?: string
): Promise<{
  previewHtml: string | null;
  compileErrors: CompileError[];
  qrDataUrl: string | null;
}> {
  const resolvedBaseUrl = (baseUrlOverride ?? c.apiBaseUrl).replace(/\/$/, '');
  let previewHtml: string | null = null;
  let compileErrors: CompileError[] = [];

  if (Object.keys(project.draftFiles).length > 0) {
    const artifact = await c.builder.compile({
      files: project.draftFiles,
      projectId: project.id,
      apiBaseUrl: resolvedBaseUrl,
      capabilities: project.capabilities,
      mode: 'preview',
      seo: {
        title: project.plan?.seo?.title ?? project.plan?.appName ?? project.title,
        description:
          project.plan?.seo?.description ??
          project.plan?.summary ??
          project.title,
      },
    });
    if (artifact.ok) {
      previewHtml = artifact.html;
    } else {
      compileErrors = artifact.errors;
    }
  }

  let qrDataUrl: string | null = null;
  if (project.publishedVersion > 0) {
    const pubUrl = `${resolvedBaseUrl}/s/${project.slug}`;
    qrDataUrl = await QRCode.toDataURL(pubUrl, {
      margin: 1,
      width: 180,
    });
  }

  return { previewHtml, compileErrors, qrDataUrl };
}
