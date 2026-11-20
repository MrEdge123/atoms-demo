import type { CompileError, ProductPlan, VirtualFS } from '../domain';
import { getCloudSdkPromptDocs } from './sdk-client';

export interface RaceStyleDirection {
  branchId: string;
  label: string;
  styleDirection: string;
}

/**
 * Parallel style variants explored during Race Mode.
 */
export const RACE_STYLE_DIRECTIONS: RaceStyleDirection[] = [
  {
    branchId: 'branch-a',
    label: '方案 A · 极简亮色 SaaS 风',
    styleDirection:
      'Clean light SaaS workspace (slate-50 background, crisp white cards, indigo-600 primary buttons, generous whitespace, high-clarity data tables).',
  },
  {
    branchId: 'branch-b',
    label: '方案 B · 暗夜极客高转化风',
    styleDirection:
      'Modern dark executive dashboard (slate-950 canvas, slate-900/80 glass cards, emerald/cyan accents, bold hero KPI metrics, sleek interactive drawers).',
  },
];

export function buildIrisPrompt(idea: string): { system: string; prompt: string } {
  return {
    system: `You are Iris, an AI Deep Researcher at Atoms.
Analyze the user's product idea concisely and realistically before any code is written.
Return structured JSON matching the requested schema. Use the user's language (Chinese if the prompt is Chinese).`,
    prompt: `User Idea:
${idea}

Produce a focused market and opportunity analysis: marketSummary, targetAudience, competitorPainPoints (3 items), differentiators (3 items), and recommendedPositioning.`,
  };
}

export function buildEmmaPrompt(
  idea: string,
  researchJson: string
): { system: string; prompt: string } {
  return {
    system: `You are Emma, an AI Product Manager at Atoms.
Convert the market research into a tight, buildable MVP ProductPlan.
Only include capabilities that the product genuinely needs from: "db", "auth", "billing", "ai".
Always include "db" when the app stores records. Include "auth" for user accounts/admin login. Include "billing" for Pro/paid subscription tiers.
Also populate "seo" with concise title and description. Use the user's language.`,
    prompt: `Original Idea:
${idea}

Iris Research Insights:
${researchJson}

Produce a clean MVP ProductPlan with 1-3 focused pages/views and concrete data collections.`,
  };
}

export function buildAlexGeneratePrompt(input: {
  plan: ProductPlan;
  styleDirection?: string;
}): { system: string; prompt: string } {
  const sdkDocs = getCloudSdkPromptDocs(input.plan.capabilities);
  return {
    system: `You are Alex, an AI Full-Stack Engineer at Atoms.
Generate a complete, production-ready React 19 + TypeScript + Tailwind CSS v4 SPA.
STRICT RULES:
1. Entry file MUST be "src/App.tsx" exporting a default function App(). You may split subcomponents into "src/components/*.tsx".
2. Allowed third-party packages ONLY: "react", "react-dom", "lucide-react", "clsx", "tailwind-merge", and "@atoms/cloud". Do NOT import any other npm packages!
3. Never use browser alert()/confirm()/prompt() — build clean inline states or modals.
4. Use Tailwind CSS utility classes directly. Make the UI polished, responsive (mobile + desktop), and genuinely interactive with loading/error feedback.
5. Persist real user data with @atoms/cloud instead of fake in-memory arrays:

${sdkDocs}`,
    prompt: `Build the application described by this confirmed ProductPlan:
${JSON.stringify(input.plan, null, 2)}

${input.styleDirection ? `Visual Style Direction:\n${input.styleDirection}` : ''}

Return all files needed to run the app, ensuring "src/App.tsx" is the root component.`,
  };
}

export function buildAlexFixPrompt(input: {
  plan: ProductPlan;
  files: VirtualFS;
  errors: CompileError[];
}): { system: string; prompt: string } {
  const sdkDocs = getCloudSdkPromptDocs(input.plan.capabilities);
  return {
    system: `You are Alex, fixing build/runtime errors in an Atoms React + TypeScript application.
Return only the modified/repaired files (keep "src/App.tsx" valid with a default export).
Allowed packages ONLY: "react", "react-dom", "lucide-react", "clsx", "tailwind-merge", "@atoms/cloud".

${sdkDocs}`,
    prompt: `Product Plan:
${JSON.stringify(input.plan, null, 2)}

The current application failed compilation/verification with these errors:
${JSON.stringify(input.errors, null, 2)}

Current VirtualFS files:
${JSON.stringify(input.files, null, 2)}

Fix all reported errors cleanly without breaking existing cloud data integrations.`,
  };
}

export function buildAlexIteratePrompt(input: {
  plan: ProductPlan;
  files: VirtualFS;
  instruction: string;
}): { system: string; prompt: string } {
  const sdkDocs = getCloudSdkPromptDocs(input.plan.capabilities);
  return {
    system: `You are Alex, iterating on an existing Atoms React + TypeScript application.
Preserve existing @atoms/cloud collection names and data shapes so previously stored user records remain compatible!
Allowed packages ONLY: "react", "react-dom", "lucide-react", "clsx", "tailwind-merge", "@atoms/cloud".

${sdkDocs}`,
    prompt: `Product Plan:
${JSON.stringify(input.plan, null, 2)}

Current VirtualFS files:
${JSON.stringify(input.files, null, 2)}

User Iteration Instruction:
${input.instruction}

Update the necessary files cleanly and return the updated files.`,
  };
}
