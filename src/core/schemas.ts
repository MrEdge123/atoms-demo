import { z } from 'zod';
import type { VirtualFS } from '../domain';

/**
 * Structured output produced by Iris (Deep Research Agent).
 */
export const researchOutputSchema = z.object({
  marketSummary: z.string(),
  targetAudience: z.string(),
  competitorPainPoints: z.array(z.string()).min(1),
  differentiators: z.array(z.string()).min(1),
  recommendedPositioning: z.string(),
});

export type ResearchOutput = z.infer<typeof researchOutputSchema>;

/**
 * Structured product blueprint produced by Emma (Product Manager Agent).
 */
export const productPlanSchema = z.object({
  appName: z.string().min(1),
  summary: z.string().min(1),
  targetUsers: z.string().min(1),
  capabilities: z.array(z.enum(['db', 'auth', 'billing', 'ai'])).min(1),
  seo: z
    .object({
      title: z.string(),
      description: z.string(),
    })
    .optional(),
  pages: z
    .array(
      z.object({
        name: z.string(),
        purpose: z.string(),
      })
    )
    .min(1),
  collections: z.array(
    z.object({
      name: z.string(),
      fields: z.array(z.string()),
      description: z.string(),
    })
  ),
});

/**
 * Structured multi-file code output produced by Alex (Full-Stack Engineer Agent).
 */
export const alexFilesOutputSchema = z.object({
  summary: z.string(),
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
      })
    )
    .min(1),
  deletes: z.array(z.string()).optional(),
});

export type AlexFilesOutput = z.infer<typeof alexFilesOutputSchema>;

/**
 * Normalizes virtual file paths to clean POSIX relative paths (e.g. "src/App.tsx").
 * Rejects path traversal attempts.
 */
export function normalizePath(inputPath: string): string {
  const posix = inputPath.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const parts = posix.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (parts.length === 0 || parts.some((segment) => segment === '..')) {
    throw new Error(`Invalid virtual file path: "${inputPath}"`);
  }
  return parts.join('/');
}

/**
 * Applies file upserts and deletions onto a VirtualFS snapshot without mutating the base object.
 */
export function mergeVirtualFS(
  base: VirtualFS,
  upserts: Array<{ path: string; content: string }>,
  deletes?: string[]
): VirtualFS {
  const next: VirtualFS = { ...base };
  if (deletes) {
    for (const rawPath of deletes) {
      const normalized = normalizePath(rawPath);
      delete next[normalized];
    }
  }
  for (const file of upserts) {
    const normalized = normalizePath(file.path);
    next[normalized] = file.content;
  }
  return next;
}
