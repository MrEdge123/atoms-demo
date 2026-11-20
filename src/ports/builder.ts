import type { BuildArtifact, CloudCapability, VirtualFS } from '../domain';

/**
 * SEO and Open Graph metadata injected into the generated HTML <head>.
 */
export interface SeoMetadata {
  title: string;
  description: string;
  url?: string;
}

/**
 * Inputs required to bundle a VirtualFS into a self-contained HTML artifact.
 */
export interface CompileInput {
  files: VirtualFS;
  projectId: string;
  apiBaseUrl: string;
  capabilities: CloudCapability[];
  mode: 'preview' | 'production';
  seo?: SeoMetadata;
}

/**
 * Result of executing a headless runtime verification pass on a compiled artifact.
 */
export interface RuntimeCheckResult {
  ok: boolean;
  errors: string[];
}

/**
 * Port 2: Builds generated VirtualFS projects into runnable artifacts and
 * optionally validates runtime rendering.
 */
export interface AppBuilder {
  compile(input: CompileInput): Promise<BuildArtifact>;

  /**
   * Optional L2/runtime verification hook (e.g., Playwright smoke test checking
   * non-empty mount and zero console/runtime errors).
   */
  verifyRuntime?(
    artifact: Extract<BuildArtifact, { ok: true }>
  ): Promise<RuntimeCheckResult>;
}
