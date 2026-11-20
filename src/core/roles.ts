import type {
  CompileError,
  ProductPlan,
  StyleThemeSpec,
  VirtualFS,
} from '../domain';
import {
  DESIGN_SCENARIOS,
  type RaceStyleDirection,
  getAlexDesignGuidePrompt,
  getAlexIterateDesignGuardrail,
  getEmmaDesignGuidePrompt,
  renderDesignMarkdown,
} from './design-guide';
import { getCloudSdkPromptDocs } from './sdk-client';

export type { RaceStyleDirection };

/**
 * Default Race Mode style variants (Scenario B baseline for backward compatibility).
 * Dynamic scenario-aware Race Mode selection uses getRaceDirectionsForPlan(plan).
 */
export const RACE_STYLE_DIRECTIONS: RaceStyleDirection[] =
  DESIGN_SCENARIOS.B.raceDirections;

export function buildIrisPrompt(idea: string): { system: string; prompt: string } {
  return {
    system: `You are Iris, an AI Deep Researcher at Atoms.
Analyze the user's product idea concisely and realistically before any code is written.
Also identify the target users' aesthetic expectations and visual experience gaps in competing tools.
Return structured JSON matching the requested schema. Use the user's language (Chinese if the prompt is Chinese).`,
    prompt: `User Idea:
${idea}

Produce a focused market, aesthetic, and opportunity analysis: marketSummary, targetAudience, competitorPainPoints (3 items), differentiators (3 items), and recommendedPositioning.`,
  };
}

export function buildEmmaPrompt(
  idea: string,
  researchJson: string,
  styleTheme?: StyleThemeSpec
): { system: string; prompt: string } {
  const designPrompt = getEmmaDesignGuidePrompt(styleTheme);
  return {
    system: `You are Emma, an AI Product Manager & Design Director at Atoms.
Convert the market research into a tight, buildable MVP ProductPlan AND a tailored "designSystem" blueprint.
Only include capabilities that the product genuinely needs from: "db", "auth", "billing", "ai".
Always include "db" when the app stores records. Include "auth" for user accounts/admin login. Include "billing" for Pro/paid subscription tiers.
Also populate "seo" with concise title and description. Use the user's language.
${designPrompt}`,
    prompt: `Original Idea:
${idea}

Iris Research Insights:
${researchJson}

Produce a clean MVP ProductPlan with 1-3 focused pages/views, concrete data collections, and a scenario-authentic "designSystem" (scenario A-G, scenarioName, tone, colorMode, palette, typography, radiusStyle, surfaceDepth, layoutBlueprint, visualFocalPoint, motionStyle, mediaStrategy, antiPatterns).`,
  };
}

export function buildAlexGeneratePrompt(input: {
  plan: ProductPlan;
  designMd?: string;
  styleDirection?: string;
  branchId?: string;
  branchLabel?: string;
}): { system: string; prompt: string } {
  const sdkDocs = getCloudSdkPromptDocs(input.plan.capabilities);
  const designMd =
    input.designMd ??
    renderDesignMarkdown(input.plan, {
      branchStyleDirection: input.styleDirection,
    });
  const designGuide = getAlexDesignGuidePrompt(
    input.plan,
    designMd,
    input.styleDirection
  );

  return {
    system: `You are Alex, an AI Full-Stack & Design Engineer at Atoms.
Generate a complete, gallery-grade React 19 + TypeScript + Tailwind CSS v4 SPA that strictly honors the project's DESIGN.md.
STRICT RULES:
1. Entry file MUST be "src/App.tsx" exporting a default function App(). Split cohesive subcomponents cleanly into "src/components/*.tsx" when helpful.
2. Allowed third-party packages ONLY: "react", "react-dom", "lucide-react", "clsx", "tailwind-merge", and "@atoms/cloud". Do NOT import any other npm packages!
3. Never use browser alert()/confirm()/prompt() — build clean inline states or modals.
4. Use Tailwind CSS utility classes directly (supports arbitrary hex [#...], rgba(...), clamp(...), cubic-bezier(...)). Make the UI gallery-grade, mobile+desktop responsive, and genuinely interactive with loading/error feedback.
5. Persist real user data with @atoms/cloud instead of fake in-memory arrays:

${sdkDocs}

${designGuide}
6. Never display internal SDK, builder, or platform terms ('@atoms/cloud', 'Powered by @atoms/cloud', '数据自主可控', 'PGlite', 'Esbuild', 'Route A+') anywhere in visible UI headings, badges, or footers — all visible UI copy must belong strictly to the user's product brand.
7. Target ~300-520 lines total across 2-4 clean modular files ("src/App.tsx" + "src/components/*.tsx"; you do NOT need to rewrite "DESIGN.md" unless refining tokens). Keep code concise with zero bloated mock arrays or redundant comments.
8. Return strictly valid JSON matching { "summary": string, "files": Array<{ "path": string, "content": string }> } (with optional "deletes").`,
    prompt: `Build the application described by this confirmed ProductPlan:
${JSON.stringify(input.plan, null, 2)}

${input.branchId ? `Branch ID: ${input.branchId}` : ''}
${input.branchLabel ? `Branch Label: ${input.branchLabel}` : ''}
${input.styleDirection ? `Visual Style Direction:\n${input.styleDirection}` : ''}

Return all code files needed to run the app, ensuring "src/App.tsx" is the root component and follows DESIGN.md faithfully.`,
  };
}

export function buildAlexFixPrompt(input: {
  plan: ProductPlan;
  files: VirtualFS;
  errors: CompileError[];
}): { system: string; prompt: string } {
  const sdkDocs = getCloudSdkPromptDocs(input.plan.capabilities);
  const designGuardrail = getAlexIterateDesignGuardrail(input.plan);
  return {
    system: `You are Alex, fixing build/runtime errors in an Atoms React + TypeScript application.
Return only the modified/repaired files (keep "src/App.tsx" valid with a default export, and do not delete "DESIGN.md").
Allowed packages ONLY: "react", "react-dom", "lucide-react", "clsx", "tailwind-merge", "@atoms/cloud".
Return strictly valid JSON matching { "summary": string, "files": Array<{ "path": string, "content": string }> }.

${sdkDocs}
${designGuardrail}`,
    prompt: `Product Plan:
${JSON.stringify(input.plan, null, 2)}

The current application failed compilation/verification with these errors:
${JSON.stringify(input.errors, null, 2)}

Current VirtualFS files:
${JSON.stringify(input.files, null, 2)}

Fix all reported errors cleanly without breaking existing cloud data integrations or design quality.`,
  };
}

export function buildAlexIteratePrompt(input: {
  plan: ProductPlan;
  files: VirtualFS;
  instruction: string;
}): { system: string; prompt: string } {
  const sdkDocs = getCloudSdkPromptDocs(input.plan.capabilities);
  const designGuardrail = getAlexIterateDesignGuardrail(input.plan);
  return {
    system: `You are Alex, iterating on an existing Atoms React + TypeScript application.
Preserve existing @atoms/cloud collection names and data shapes so previously stored user records remain compatible!
Never render internal SDK or platform jargon ('@atoms/cloud', 'Powered by @atoms/cloud', '数据自主可控', 'PGlite', 'Esbuild', 'Route A+') in any visible UI badges, headings, or footers — preserve clean product branding.
Allowed packages ONLY: "react", "react-dom", "lucide-react", "clsx", "tailwind-merge", "@atoms/cloud".
Return strictly valid JSON matching { "summary": string, "files": Array<{ "path": string, "content": string }> }.

${sdkDocs}
${designGuardrail}`,
    prompt: `Product Plan:
${JSON.stringify(input.plan, null, 2)}

Current VirtualFS files:
${JSON.stringify(input.files, null, 2)}

User Iteration Instruction:
${input.instruction}

Update the necessary files cleanly while preserving DESIGN.md aesthetic consistency, and return the updated files.`,
  };
}
