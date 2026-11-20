import type { BuildArtifact } from '../../domain';
import type { AppBuilder, CompileInput } from '../../ports';

/**
 * Fast mock AppBuilder for pure state-machine unit tests.
 */
export class MockAppBuilder implements AppBuilder {
  private readonly shouldFailOnce: boolean;
  private failedOnce = false;

  constructor(opts?: { shouldFailOnce?: boolean }) {
    this.shouldFailOnce = opts?.shouldFailOnce ?? false;
  }

  async compile(input: CompileInput): Promise<BuildArtifact> {
    if (this.shouldFailOnce && !this.failedOnce) {
      this.failedOnce = true;
      return {
        ok: false,
        errors: [
          {
            phase: 'compile',
            file: 'src/App.tsx',
            line: 1,
            message: 'Mock scripted compile error',
          },
        ],
      };
    }

    const title = input.seo?.title ?? 'Mock Atoms App';
    const desc = input.seo?.description ?? 'Mock description';
    const html = `<!doctype html><html><head><title>${title}</title><meta name="description" content="${desc}" /><meta property="og:title" content="${title}" /><meta property="og:description" content="${desc}" /></head><body><div id="root"></div></body></html>`;
    return {
      ok: true,
      html,
      bundleBytes: Buffer.byteLength(html, 'utf8'),
      warnings: [],
    };
  }
}
