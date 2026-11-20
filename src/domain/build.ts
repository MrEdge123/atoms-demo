/**
 * Structured build or runtime diagnostic fed back into the AI auto-fix loop.
 */
export interface CompileError {
  phase: 'compile' | 'runtime';
  file?: string;
  line?: number;
  column?: number;
  message: string;
}

/**
 * Unified output returned by an AppBuilder implementation.
 * Success carries a self-contained HTML artifact; failure carries diagnostics.
 */
export type BuildArtifact =
  | {
      ok: true;
      html: string;
      bundleBytes: number;
      warnings: string[];
    }
  | {
      ok: false;
      errors: CompileError[];
    };
