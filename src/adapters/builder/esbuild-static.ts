import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { compile as compileTailwind } from 'tailwindcss';
import { ATOMS_CLOUD_SDK_SOURCE, normalizePath } from '../../core';
import type { BuildArtifact, CompileError, VirtualFS } from '../../domain';
import type { AppBuilder, CompileInput } from '../../ports';

const ALLOWED_PACKAGES = new Set([
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'lucide-react',
  'clsx',
  'tailwind-merge',
]);

type TailwindCompiler = Awaited<ReturnType<typeof compileTailwind>>;
let cachedTailwindCompiler: Promise<TailwindCompiler> | null = null;

function getTailwindCompiler(): Promise<TailwindCompiler> {
  if (!cachedTailwindCompiler) {
    cachedTailwindCompiler = (async () => {
      const twBase = path.resolve(process.cwd(), 'node_modules/tailwindcss');
      const indexCssPath = path.join(twBase, 'index.css');
      return compileTailwind('@import "tailwindcss";', {
        loadStylesheet: async (id, base) => {
          const target =
            id === 'tailwindcss'
              ? indexCssPath
              : path.resolve(base || twBase, id);
          return {
            path: target,
            base: path.dirname(target),
            content: fs.readFileSync(target, 'utf8'),
          };
        },
      });
    })();
  }
  return cachedTailwindCompiler;
}

function extractTailwindCandidates(sources: string[]): string[] {
  const tokens = new Set<string>();
  const pattern = /[a-zA-Z0-9_:[\]#./%-]+/g;
  for (const src of sources) {
    const matches = src.match(pattern);
    if (!matches) continue;
    for (const token of matches) {
      if (token.length >= 2 && token.length <= 80) {
        tokens.add(token);
      }
    }
  }
  return Array.from(tokens);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeInlineScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script');
}

function buildWrapperEntrySource(
  appImportPath: string,
  mode: 'preview' | 'production'
): string {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './${appImportPath}';

function reportErrorToParent(err: unknown) {
  if (${JSON.stringify(mode)} !== 'preview') return;
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack || '' : '';
    window.parent?.postMessage({ type: 'ATOMS_RUNTIME_ERROR', message, stack }, '*');
  } catch {
    // Ignore cross-origin frame postMessage failures
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    reportErrorToParent(event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportErrorToParent(event.reason);
  });
}

class RuntimeErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportErrorToParent(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-slate-900">
          <div className="max-w-md w-full rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-semibold text-rose-700">页面渲染遇到异常</h2>
            <p className="mt-2 text-sm text-slate-600 break-words">
              {${JSON.stringify(mode)} === 'preview'
                ? this.state.error.message
                : '页面暂时无法正常展示，请刷新重试或联系站点管理员。'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <RuntimeErrorBoundary>
        <App />
      </RuntimeErrorBoundary>
    </React.StrictMode>
  );
}
`;
}

function resolveVirtualFile(
  vfs: VirtualFS,
  specifier: string,
  importerPath: string
): string | null {
  const baseDir = importerPath.includes('/')
    ? importerPath.slice(0, importerPath.lastIndexOf('/'))
    : '';

  let rawTarget: string;
  if (specifier.startsWith('@/')) {
    rawTarget = `src/${specifier.slice(2)}`;
  } else {
    const joined = baseDir ? path.posix.join(baseDir, specifier) : specifier;
    rawTarget = joined;
  }

  const normalized = rawTarget.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const candidates = [
    normalized,
    `${normalized}.tsx`,
    `${normalized}.ts`,
    `${normalized}.jsx`,
    `${normalized}.js`,
    `${normalized}/index.tsx`,
    `${normalized}/index.ts`,
  ];

  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(vfs, candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Compiles a VirtualFS React + Tailwind v4 SPA in memory using esbuild,
 * enforcing a strict npm package allowlist, injecting @atoms/cloud,
 * compiling self-contained Tailwind CSS, and embedding SEO/OG metadata.
 */
export class EsbuildStaticBuilder implements AppBuilder {
  async compile(input: CompileInput): Promise<BuildArtifact> {
    const normalizedFs: VirtualFS = {};
    for (const [rawPath, content] of Object.entries(input.files)) {
      normalizedFs[normalizePath(rawPath)] = content;
    }

    const entryPath =
      (['src/App.tsx', 'App.tsx', 'src/app.tsx'].find((p) =>
        Object.prototype.hasOwnProperty.call(normalizedFs, p)
      ) as string | undefined) ?? null;

    if (!entryPath) {
      return {
        ok: false,
        errors: [
          {
            phase: 'compile',
            message: 'Missing root entry component "src/App.tsx"',
          },
        ],
      };
    }

    const wrapperSource = buildWrapperEntrySource(entryPath, input.mode);
    const virtualEntryId = '__atoms_entry__.tsx';
    const resolveDir = process.cwd();

    const plugin: esbuild.Plugin = {
      name: 'atoms-virtual-fs',
      setup(build) {
        build.onResolve({ filter: /^__atoms_entry__\.tsx$/ }, () => ({
          path: virtualEntryId,
          namespace: 'atoms-vfs',
        }));

        build.onResolve(
          { filter: /.*/, namespace: 'atoms-vfs' },
          async (args) => {
            if (args.path === '@atoms/cloud') {
              return { path: '@atoms/cloud', namespace: 'atoms-sdk' };
            }

            if (
              args.path.startsWith('./') ||
              args.path.startsWith('../') ||
              args.path.startsWith('@/')
            ) {
              const importer =
                args.importer === virtualEntryId ? '' : args.importer;
              const resolved = resolveVirtualFile(
                normalizedFs,
                args.path,
                importer
              );
              if (!resolved) {
                return {
                  errors: [
                    {
                      text: `Cannot resolve virtual module "${args.path}" from "${args.importer}"`,
                    },
                  ],
                };
              }
              return { path: resolved, namespace: 'atoms-vfs' };
            }

            if (ALLOWED_PACKAGES.has(args.path)) {
              const resolved = await build.resolve(args.path, {
                kind: args.kind,
                resolveDir,
              });
              if (resolved.errors.length > 0) {
                return { errors: resolved.errors };
              }
              return { path: resolved.path, namespace: 'file' };
            }

            return {
              errors: [
                {
                  text: `Disallowed package import "${args.path}". Allowed packages: react, react-dom, lucide-react, clsx, tailwind-merge, @atoms/cloud.`,
                },
              ],
            };
          }
        );

        build.onLoad({ filter: /.*/, namespace: 'atoms-sdk' }, () => ({
          contents: ATOMS_CLOUD_SDK_SOURCE,
          loader: 'ts',
          resolveDir,
        }));

        build.onLoad({ filter: /.*/, namespace: 'atoms-vfs' }, (args) => {
          if (args.path === virtualEntryId) {
            return { contents: wrapperSource, loader: 'tsx', resolveDir };
          }
          const content = normalizedFs[args.path];
          if (content === undefined) {
            return {
              errors: [{ text: `Virtual file "${args.path}" not found` }],
            };
          }
          const ext = path.posix.extname(args.path).toLowerCase();
          const loader: esbuild.Loader =
            ext === '.ts'
              ? 'ts'
              : ext === '.jsx'
                ? 'jsx'
                : ext === '.js'
                  ? 'js'
                  : ext === '.css'
                    ? 'css'
                    : 'tsx';
          return { contents: content, loader, resolveDir };
        });
      },
    };

    try {
      const result = await esbuild.build({
        entryPoints: [virtualEntryId],
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: ['es2020'],
        charset: 'utf8',
        jsx: 'automatic',
        minify: true,
        plugins: [plugin],
        logLevel: 'silent',
        define: {
          'process.env.NODE_ENV': '"production"',
        },
      });

      const jsFile = result.outputFiles.find((f) => f.path.endsWith('.js')) ?? result.outputFiles[0];
      const bundledJs = jsFile?.text ?? '';
      const extraCss = result.outputFiles
        .filter((f) => f.path.endsWith('.css'))
        .map((f) => f.text)
        .join('\n');

      const tw = await getTailwindCompiler();
      const candidates = extractTailwindCandidates([
        wrapperSource,
        ...Object.values(normalizedFs),
      ]);
      const compiledCss = tw.build(candidates) + (extraCss ? `\n${extraCss}` : '');

      const seoTitle = escapeHtml(input.seo?.title || 'Atoms App');
      const seoDescription = escapeHtml(
        input.seo?.description || 'Built with Mini Atoms'
      );
      const seoUrlMeta = input.seo?.url
        ? `\n  <meta property="og:url" content="${escapeHtml(input.seo.url)}" />`
        : '';

      const runtimeConfig = {
        projectId: input.projectId,
        apiBaseUrl: input.apiBaseUrl,
        capabilities: input.capabilities,
        mode: input.mode,
      };

      const runtimeJson = JSON.stringify(runtimeConfig).replace(/</g, '\\u003c');

      const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${seoTitle}</title>
  <meta name="description" content="${seoDescription}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${seoTitle}" />
  <meta property="og:description" content="${seoDescription}" />${seoUrlMeta}
  <style>${compiledCss}</style>
</head>
<body class="antialiased bg-white text-slate-900">
  <div id="root"></div>
  <script>window.__ATOMS_CONFIG__ = ${runtimeJson};</script>
  <script>${safeInlineScript(bundledJs)}</script>
</body>
</html>`;

      return {
        ok: true,
        html,
        bundleBytes: Buffer.byteLength(html, 'utf8'),
        warnings: result.warnings.map((w) => w.text),
      };
    } catch (err) {
      const esErr = err as {
        errors?: esbuild.Message[];
        message?: string;
      };
      const errors: CompileError[] =
        esErr.errors && esErr.errors.length > 0
          ? esErr.errors.map((m) => ({
              phase: 'compile',
              file: m.location?.file,
              line: m.location?.line,
              column: m.location?.column,
              message: m.text,
            }))
          : [
              {
                phase: 'compile',
                message: esErr.message || String(err),
              },
            ];

      return { ok: false, errors };
    }
  }
}
