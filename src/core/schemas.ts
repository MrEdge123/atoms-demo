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

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, 'Invalid hex color');

const strictStylePaletteSchema = z.object({
  background: hexColorSchema,
  surface: hexColorSchema,
  textPrimary: hexColorSchema,
  textMuted: hexColorSchema,
  accent: hexColorSchema,
});

const stylePaletteSchema = z.object({
  background: z.string().min(1).max(40),
  surface: z.string().min(1).max(40),
  textPrimary: z.string().min(1).max(40),
  textMuted: z.string().min(1).max(40),
  accent: z.string().min(1).max(40),
});

const styleTypographySchema = z.object({
  headingStyle: z.enum(['editorial-serif', 'geometric-sans', 'minimal-sans']),
  bodyStyle: z.enum(['sans', 'serif']),
});

export const designScenarioIdSchema = z.enum([
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
]);

export const styleThemeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  description: z.string().max(240).optional(),
  scenario: designScenarioIdSchema.optional(),
  colorMode: z.enum(['light', 'dark']),
  palette: strictStylePaletteSchema,
  typography: styleTypographySchema,
  radiusStyle: z.enum(['sharp', 'soft', 'pill']).optional(),
  surfaceDepth: z
    .enum(['hairline', 'subtle-shadow', 'stepped-dark'])
    .optional(),
  stylePrompt: z.string().max(2000),
  isCustom: z.boolean().optional(),
});

export const designSystemSchema = z.object({
  scenario: designScenarioIdSchema,
  scenarioName: z.string().min(1),
  tone: z.string().min(1),
  colorMode: z.enum(['light', 'dark']),
  palette: stylePaletteSchema,
  typography: z.object({
    headingStyle: z.enum(['editorial-serif', 'geometric-sans', 'minimal-sans']),
    bodyStyle: z.enum(['sans', 'serif']),
    rationale: z.string(),
  }),
  radiusStyle: z.enum(['sharp', 'soft', 'pill']).optional(),
  surfaceDepth: z
    .enum(['hairline', 'subtle-shadow', 'stepped-dark'])
    .optional(),
  layoutBlueprint: z.string().min(1),
  visualFocalPoint: z.string().min(1),
  motionStyle: z.string().min(1),
  mediaStrategy: z.string().optional(),
  antiPatterns: z.array(z.string()),
  themeId: z.string().max(64).optional(),
  themeName: z.string().max(60).optional(),
  customStylePrompt: z.string().max(2000).optional(),
});

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
  designSystem: designSystemSchema.optional(),
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
 * Structured intent routing decision produced by the LLM Intent Router.
 */
export const intentRouteSchema = z.object({
  targetRole: z.enum(['iris', 'emma', 'alex']),
  intent: z.enum(['research', 'discuss', 'implement']),
  reason: z.string().min(1).max(200),
});

export type IntentRouteOutput = z.infer<typeof intentRouteSchema>;

/**
 * Conversational reply with actionable handoff options produced by Emma or Iris.
 */
export const agentReplySchema = z.object({
  reply: z.string().min(1),
  options: z
    .array(
      z.object({
        title: z.string().min(1).max(60),
        description: z.string().min(1).max(220),
        executeInstruction: z.string().min(1).max(400),
      })
    )
    .max(4)
    .optional(),
  followUpQuestion: z.string().max(200).optional(),
});

export type AgentReplyOutput = z.infer<typeof agentReplySchema>;

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
