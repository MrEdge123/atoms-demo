import type {
  AgentEvent,
  AgentMentionSpan,
  AgentRole,
  BuildArtifact,
  CollaborationStepState,
  ProductPlan,
  Project,
  RaceBranch,
  StyleThemeSpec,
  VirtualFS,
} from '../domain';
import type {
  AppBuilder,
  LLMProvider,
  ProjectRepository,
  PublishResult,
  SitePublisher,
  WorkflowEngine,
} from '../ports';
import {
  buildAlexCodeChangeRepairPrompt,
  buildAlexFixPrompt,
  buildAlexGeneratePrompt,
  buildAlexIteratePrompt,
  buildEmmaDiscussPrompt,
  buildEmmaPrompt,
  buildIntentRouterPrompt,
  buildIrisDiscussPrompt,
  buildIrisPrompt,
  buildMultiMentionPlannerPrompt,
  extractLiveCodeColorSummary,
} from './roles';
import {
  getRaceDirectionsForPlan,
  renderDesignMarkdown,
  resolveBranchDesignSystem,
} from './design-guide';
import { applyThemeToDesignSystem } from './style-presets';
import {
  agentReplySchema,
  alexFilesOutputSchema,
  intentRouteSchema,
  mergeVirtualFS,
  multiMentionPlanSchema,
  normalizePath,
  productPlanSchema,
  researchOutputSchema,
  type AgentReplyOutput,
  type MultiMentionPlanOutput,
} from './schemas';
import {
  getMutationBlockReason,
  isBuildingInProgress,
  isPendingPlanConfirmation,
  isPlanningInProgress,
} from './guards';

export interface WorkflowEngineDeps {
  llm: LLMProvider;
  builder: AppBuilder;
  repo: ProjectRepository;
  publisher: SitePublisher;
  apiBaseUrl: string;
  maxAutoFixRounds?: number;
}

function isCodeFilePath(filePath: string): boolean {
  return !filePath.trim().toLowerCase().endsWith('.md');
}

function sortFilesCodeFirst<T extends { path: string }>(items: T[]): T[] {
  const rank = (p: string): number => {
    const normalized = p.trim();
    if (normalized === 'src/App.tsx') return 0;
    if (isCodeFilePath(normalized)) return 1;
    return 2;
  };
  return items
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => rank(a.item.path) - rank(b.item.path) || a.idx - b.idx)
    .map((entry) => entry.item);
}

function computeFileChanges(
  baseFiles: VirtualFS,
  nextFiles: VirtualFS,
  candidateFiles: Array<{ path: string; content: string }>,
  deletes?: string[]
): {
  changedFiles: Array<{ path: string; content: string }>;
  changedCodeCount: number;
  changedDocCount: number;
  hasCodeDiff: boolean;
  hasDocDiff: boolean;
} {
  const deduped = new Map<string, string>();
  for (const file of candidateFiles) {
    try {
      deduped.set(normalizePath(file.path), file.content);
    } catch {
      // Invalid paths are rejected during mergeVirtualFS
    }
  }

  const changed: Array<{ path: string; content: string }> = [];
  for (const [normPath, content] of deduped.entries()) {
    if (nextFiles[normPath] !== baseFiles[normPath]) {
      changed.push({ path: normPath, content: nextFiles[normPath] ?? content });
    }
  }

  const deletedPaths: string[] = [];
  if (deletes) {
    for (const rawDel of deletes) {
      try {
        const normDel = normalizePath(rawDel);
        if (baseFiles[normDel] !== undefined && nextFiles[normDel] === undefined) {
          deletedPaths.push(normDel);
        }
      } catch {
        // Ignore invalid paths
      }
    }
  }

  const sortedChanged = sortFilesCodeFirst(changed);
  const changedCodeCount = sortedChanged.filter((f) =>
    isCodeFilePath(f.path)
  ).length;
  const changedDocCount = sortedChanged.length - changedCodeCount;

  return {
    changedFiles: sortedChanged,
    changedCodeCount,
    changedDocCount,
    hasCodeDiff:
      changedCodeCount > 0 || deletedPaths.some((p) => isCodeFilePath(p)),
    hasDocDiff:
      changedDocCount > 0 || deletedPaths.some((p) => !isCodeFilePath(p)),
  };
}

function computeFinalDiffSummary(
  baseFiles: VirtualFS,
  finalFiles: VirtualFS
): {
  changedCodeFiles: number;
  changedDocFiles: number;
  hasCodeDiff: boolean;
} {
  let changedCodeFiles = 0;
  let changedDocFiles = 0;
  const allPaths = new Set([
    ...Object.keys(baseFiles),
    ...Object.keys(finalFiles),
  ]);
  for (const p of allPaths) {
    if (baseFiles[p] !== finalFiles[p]) {
      if (isCodeFilePath(p)) {
        changedCodeFiles += 1;
      } else {
        changedDocFiles += 1;
      }
    }
  }
  return {
    changedCodeFiles,
    changedDocFiles,
    hasCodeDiff: changedCodeFiles > 0,
  };
}

/**
 * Core SOP orchestrator driving Iris -> Emma (confirmation pause) -> Alex (+ Auto-Fix / Race Mode) -> Publish.
 * Depends purely on domain models and port interfaces.
 */
function formatLogLabel(value: unknown, fallback = 'default'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeMentionSpans(
  rawMentions: AgentMentionSpan[],
  trimmedText: string,
  leadingTrim: number
): AgentMentionSpan[] {
  const candidates: AgentMentionSpan[] = [];
  for (const item of rawMentions) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (
      (role !== 'iris' && role !== 'emma' && role !== 'alex') ||
      !label ||
      !Number.isInteger(item.start) ||
      !Number.isInteger(item.end)
    ) {
      continue;
    }
    const start = item.start - leadingTrim;
    const end = item.end - leadingTrim;
    if (start >= 0 && end > start && end <= trimmedText.length) {
      candidates.push({ role, label, start, end });
    }
  }
  candidates.sort((a, b) => a.start - b.start);
  const nonOverlapping: AgentMentionSpan[] = [];
  let cursor = 0;
  for (const span of candidates) {
    if (span.start < cursor) continue;
    nonOverlapping.push(span);
    cursor = span.end;
    if (nonOverlapping.length >= 10) break;
  }
  return nonOverlapping;
}

function stripMentionSpans(text: string, spans: AgentMentionSpan[]): string {
  if (spans.length === 0) return text;
  let result = '';
  let cursor = 0;
  for (const span of spans) {
    result += text.slice(cursor, span.start);
    cursor = span.end;
  }
  result += text.slice(cursor);
  return result.replace(/^[\s:：,，-]+/, '').replace(/\s{2,}/g, ' ').trim() || text;
}

function parseExplicitMentions(raw: string): {
  spans: AgentMentionSpan[];
  cleanedText: string;
} {
  const trimmed = raw.trim();
  const regex =
    /(^|\s)@(iris|emma|alex|产品经理|产品|调研员|调研|全栈工程师|全栈|开发)(?=$|[\s:：,，。.!?！？-])/gi;
  const spans: AgentMentionSpan[] = [];

  for (const match of trimmed.matchAll(regex)) {
    if (match.index === undefined) continue;
    const token = match[2].toLowerCase();
    const tokenStart = match.index + match[1].length;
    const tokenEnd = match.index + match[0].length;
    const label = trimmed.slice(tokenStart, tokenEnd);
    const role: 'iris' | 'emma' | 'alex' =
      token === 'iris' || token.startsWith('调研')
        ? 'iris'
        : token === 'emma' || token.startsWith('产品')
          ? 'emma'
          : 'alex';
    spans.push({ role, label, start: tokenStart, end: tokenEnd });
    if (spans.length >= 10) break;
  }

  return {
    spans,
    cleanedText: spans.length > 0 ? stripMentionSpans(trimmed, spans) : trimmed,
  };
}

function normalizeMultiMentionPlan(
  rawPlan: MultiMentionPlanOutput,
  mentionedRoles: Array<'iris' | 'emma' | 'alex'>,
  fallbackInstruction: string
): CollaborationStepState[] {
  const mentionedSet = new Set(mentionedRoles);
  const byRole = new Map<
    'iris' | 'emma' | 'alex',
    MultiMentionPlanOutput['steps'][number]
  >();
  for (const step of rawPlan.steps) {
    if (mentionedSet.has(step.role) && !byRole.has(step.role)) {
      byRole.set(step.role, step);
    }
  }

  const normalized: CollaborationStepState[] = [];
  for (const role of mentionedRoles) {
    const rawStep = byRole.get(role);
    const subTask = rawStep?.subTask?.trim() || fallbackInstruction;
    let dependsOn: Array<'iris' | 'emma'> = [];
    if (role === 'emma' && mentionedSet.has('iris')) {
      dependsOn = rawStep?.dependsOn?.includes('iris') ? ['iris'] : [];
    } else if (role === 'alex') {
      const seen = new Set<'iris' | 'emma'>();
      for (const dep of rawStep?.dependsOn ?? []) {
        if ((dep === 'iris' || dep === 'emma') && mentionedSet.has(dep) && !seen.has(dep)) {
          seen.add(dep);
          dependsOn.push(dep);
        }
      }
    }
    normalized.push({
      stepId: `step-${role}`,
      role,
      subTask,
      dependsOn,
      status: 'pending',
      requireConfirmBeforeRun:
        role === 'alex' && dependsOn.length > 0 && Boolean(rawStep?.requireConfirmBeforeRun),
    });
  }

  const wave1 = normalized.filter((s) => s.role !== 'alex' && s.dependsOn.length === 0);
  if (wave1.length >= 2) {
    for (const s of wave1) {
      s.parallelGroup = 1;
    }
  }
  const wave2 = normalized.filter((s) => s.role !== 'alex' && s.dependsOn.length > 0);
  const wave3 = normalized.filter((s) => s.role === 'alex');
  return [...wave1, ...wave2, ...wave3];
}

function buildFallbackMultiMentionPlan(
  mentionedRoles: Array<'iris' | 'emma' | 'alex'>,
  fallbackInstruction: string
): { rationale: string; steps: CollaborationStepState[] } {
  const mentionedSet = new Set(mentionedRoles);
  const steps: CollaborationStepState[] = [];
  if (mentionedSet.has('iris')) {
    steps.push({
      stepId: 'step-iris',
      role: 'iris',
      subTask: fallbackInstruction,
      dependsOn: [],
      status: 'pending',
    });
  }
  if (mentionedSet.has('emma')) {
    steps.push({
      stepId: 'step-emma',
      role: 'emma',
      subTask: fallbackInstruction,
      dependsOn: mentionedSet.has('iris') ? ['iris'] : [],
      status: 'pending',
    });
  }
  if (mentionedSet.has('alex')) {
    const upstream: Array<'iris' | 'emma'> = [];
    if (mentionedSet.has('iris')) upstream.push('iris');
    if (mentionedSet.has('emma')) upstream.push('emma');
    steps.push({
      stepId: 'step-alex',
      role: 'alex',
      subTask: fallbackInstruction,
      dependsOn: upstream,
      status: 'pending',
      requireConfirmBeforeRun: mentionedSet.has('emma'),
    });
  }
  return {
    rationale: '按团队协同职责分步推进',
    steps,
  };
}

function formatUpstreamReplyForContext(
  role: 'iris' | 'emma',
  reply: AgentReplyOutput
): string {
  const speaker = role === 'iris' ? 'Iris' : 'Emma';
  const topOpt = reply.options?.[0];
  const optText = topOpt
    ? ` [推荐方案 ${topOpt.title}: ${topOpt.executeInstruction}]`
    : '';
  return `${speaker}: ${reply.reply.trim()}${optText}`;
}

function buildAlexMultiAgentInstruction(
  alexStep: CollaborationStepState,
  upstreamReplies: Partial<Record<'iris' | 'emma', AgentReplyOutput>>
): string {
  if (alexStep.dependsOn.length === 0) {
    return alexStep.subTask;
  }
  const decisions: string[] = [];
  for (const dep of alexStep.dependsOn) {
    const reply = upstreamReplies[dep];
    if (!reply) continue;
    const speaker = dep === 'iris' ? 'Iris' : 'Emma';
    decisions.push(`- ${speaker} 结论：${reply.reply.trim()}`);
    if (reply.options?.[0]) {
      decisions.push(
        `- 推荐落实方案「${reply.options[0].title}」：${reply.options[0].executeInstruction}`
      );
    }
  }
  if (decisions.length === 0) {
    return alexStep.subTask;
  }
  return `${alexStep.subTask}\n\n请结合并落实以下协同结论：\n${decisions.join('\n')}`;
}

function formatRecentConversationContext(events: AgentEvent[]): string {
  const lines: string[] = [];
  for (const ev of events) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    if (ev.type === 'collaboration_plan') {
      if (typeof payload.instruction === 'string' && payload.instruction.trim()) {
        lines.push(`User: ${payload.instruction.trim()}`);
      }
    } else if (ev.type === 'role_start') {
      if (payload.continuation === true) continue;
      const msg =
        typeof payload.instruction === 'string'
          ? payload.instruction
          : typeof payload.idea === 'string'
            ? payload.idea
            : '';
      if (msg.trim()) {
        lines.push(`User: ${msg.trim()}`);
      }
    } else if (ev.type === 'agent_message' && typeof payload.reply === 'string') {
      const speaker = ev.role === 'iris' ? 'Iris' : 'Emma';
      const optTitles = Array.isArray(payload.options)
        ? (payload.options as Array<{ title?: string; executeInstruction?: string }>)
            .map((o, idx) =>
              o.title ? `${idx + 1}. ${o.title}${o.executeInstruction ? ` (${o.executeInstruction})` : ''}` : ''
            )
            .filter(Boolean)
            .join('; ')
        : '';
      lines.push(
        `${speaker}: ${payload.reply.trim()}${optTitles ? ` [Options: ${optTitles}]` : ''}`
      );
    } else if (ev.role === 'emma' && ev.type === 'plan_ready') {
      const appName = typeof payload.appName === 'string' ? payload.appName : '';
      const summary = typeof payload.summary === 'string' ? payload.summary : '';
      if (appName || summary) {
        lines.push(`Emma Plan: ${appName} — ${summary}`);
      }
    } else if (ev.role === 'alex' && ev.type === 'thought' && typeof payload.message === 'string') {
      lines.push(`Alex: ${payload.message.trim()}`);
    }
  }
  const recent = lines.slice(-6).join('\n');
  return recent.length > 2400 ? recent.slice(recent.length - 2400) : recent;
}

export class AtomsWorkflowEngine implements WorkflowEngine {
  private readonly llm: LLMProvider;
  private readonly builder: AppBuilder;
  private readonly repo: ProjectRepository;
  private readonly publisher: SitePublisher;
  private readonly apiBaseUrl: string;
  private readonly maxAutoFixRounds: number;
  private readonly activeRuns = new Map<string, symbol>();

  constructor(deps: WorkflowEngineDeps) {
    this.llm = deps.llm;
    this.builder = deps.builder;
    this.repo = deps.repo;
    this.publisher = deps.publisher;
    this.apiBaseUrl = deps.apiBaseUrl.replace(/\/$/, '');
    this.maxAutoFixRounds = deps.maxAutoFixRounds ?? 2;
  }

  private acquireProjectLock(projectId: string): symbol {
    if (this.activeRuns.has(projectId)) {
      throw new Error('当前项目正在执行生成或构建任务，请等待完成后再操作');
    }
    const token = Symbol(projectId);
    this.activeRuns.set(projectId, token);
    return token;
  }

  private releaseProjectLock(projectId: string, token: symbol): boolean {
    if (this.activeRuns.get(projectId) === token) {
      this.activeRuns.delete(projectId);
      return true;
    }
    return false;
  }

  private async nextSeq(projectId: string): Promise<() => number> {
    const existing = await this.repo.listEvents(projectId);
    let current = existing.length;
    return () => {
      current += 1;
      return current;
    };
  }

  private async emitAndPersist(
    projectId: string,
    getSeq: () => number,
    event: {
      role: AgentRole;
      type: AgentEvent['type'];
      payload: unknown;
      branchId?: string;
    }
  ): Promise<AgentEvent> {
    const full: AgentEvent = {
      seq: getSeq(),
      role: event.role,
      branchId: event.branchId,
      type: event.type,
      payload: event.payload,
      timestamp: new Date().toISOString(),
    };
    await this.repo.appendEvent(projectId, full);
    return full;
  }

  async *start(
    projectId: string,
    idea: string,
    opts?: { model?: string; styleTheme?: StyleThemeSpec; signal?: AbortSignal }
  ): AsyncIterable<AgentEvent> {
    const runToken = this.acquireProjectLock(projectId);
    const started = Date.now();
    const modelLabel = formatLogLabel(opts?.model);
    let completed = false;
    let statusDirty = false;
    let fallbackStatus: Project['status'] = 'error';
    let rollbackFiles: VirtualFS = {};

    try {
      const project = await this.requireProject(projectId);
      if (isPlanningInProgress(project)) {
        throw new Error('Iris / Emma 正在分析需求并生成方案，请等待当前流程完成后再重新启动');
      }
      if (isBuildingInProgress(project)) {
        throw new Error('Alex 正在构建中，请等待当前构建完成后再重新启动');
      }
      const getSeq = await this.nextSeq(projectId);

      // Clear any stale unchosen Race Mode candidates without touching publishedHtml.
      if (project.raceBranches.length > 0) {
        await this.repo.saveRaceBranches(projectId, []);
      }

      rollbackFiles = project.draftFiles;
      fallbackStatus =
        project.publishedVersion > 0 || Object.keys(project.draftFiles).length > 0
          ? 'ready'
          : 'error';

      // Phase 1: Iris market research
      console.log(`[Workflow] start begin project=${projectId} model=${modelLabel}`);
      await this.repo.saveDraft(projectId, rollbackFiles, 'researching');
      statusDirty = true;

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'iris',
        type: 'role_start',
        payload: { label: 'Iris 正在开展市场与竞品调研...', idea },
      });

      const irisPrompt = buildIrisPrompt(idea);
      const research = await this.llm.generateObject({
        ...irisPrompt,
        schema: researchOutputSchema,
        model: opts?.model,
        abortSignal: opts?.signal,
      });
      console.log(
        `[Workflow] iris ready project=${projectId} model=${modelLabel} elapsed=${Date.now() - started}ms`
      );

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'iris',
        type: 'research_ready',
        payload: research,
      });

      // Phase 2: Emma product planning (pauses for user confirmation)
      await this.repo.saveDraft(projectId, rollbackFiles, 'planning');
      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'emma',
        type: 'role_start',
        payload: { label: 'Emma 正在拆解产品方案与数据集合...' },
      });

      const emmaPrompt = buildEmmaPrompt(
        idea,
        JSON.stringify(research, null, 2),
        opts?.styleTheme
      );
      const plan = await this.llm.generateObject({
        ...emmaPrompt,
        schema: productPlanSchema,
        model: opts?.model,
        abortSignal: opts?.signal,
      });

      const resolvedDesignSystem = opts?.styleTheme
        ? applyThemeToDesignSystem(plan.designSystem, opts.styleTheme)
        : plan.designSystem;

      const normalizedPlan: ProductPlan = {
        ...plan,
        seo: plan.seo ?? {
          title: plan.appName,
          description: plan.summary,
        },
        ...(resolvedDesignSystem ? { designSystem: resolvedDesignSystem } : {}),
      };

      await this.repo.updatePlan(projectId, normalizedPlan);
      await this.repo.saveDraft(projectId, rollbackFiles, 'awaiting_confirmation');
      completed = true;
      console.log(
        `[Workflow] start done project=${projectId} status=awaiting_confirmation elapsed=${Date.now() - started}ms`
      );

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'emma',
        type: 'plan_ready',
        payload: normalizedPlan,
      });

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'system',
        type: 'done',
        payload: { status: 'awaiting_confirmation' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Workflow] start error project=${projectId} model=${modelLabel} elapsed=${Date.now() - started}ms: ${msg}`
      );
      throw err;
    } finally {
      const released = this.releaseProjectLock(projectId, runToken);
      if (released && statusDirty && !completed) {
        console.warn(
          `[Workflow] start aborted project=${projectId} model=${modelLabel} restoring status=${fallbackStatus} elapsed=${Date.now() - started}ms`
        );
        await this.repo
          .saveDraft(projectId, rollbackFiles, fallbackStatus)
          .catch(() => undefined);
      }
    }
  }

  async *confirmPlan(
    projectId: string,
    input?: {
      planPatch?: Partial<ProductPlan>;
      model?: string;
      mode?: 'linear' | 'race';
      signal?: AbortSignal;
    }
  ): AsyncIterable<AgentEvent> {
    const runToken = this.acquireProjectLock(projectId);
    const mode = input?.mode === 'race' ? 'race' : 'linear';
    const started = Date.now();
    const modelLabel = formatLogLabel(input?.model);
    let completed = false;
    let statusDirty = false;
    let rollbackFiles: VirtualFS = {};

    try {
      const project = await this.requireProject(projectId);
      if (isPlanningInProgress(project)) {
        throw new Error('Iris / Emma 正在分析需求并生成方案，请等待新方案就绪后再确认');
      }
      if (isBuildingInProgress(project)) {
        throw new Error('Alex 正在构建中，请等待当前构建完成后再操作');
      }
      if (!project.plan) {
        throw new Error(`Project "${projectId}" has no product plan to confirm`);
      }

      const mergedPlan: ProductPlan = {
        ...project.plan,
        ...input?.planPatch,
        capabilities: input?.planPatch?.capabilities ?? project.plan.capabilities,
        pages: input?.planPatch?.pages ?? project.plan.pages,
        collections: input?.planPatch?.collections ?? project.plan.collections,
        seo:
          input?.planPatch?.seo ??
          project.plan.seo ?? {
            title: input?.planPatch?.appName ?? project.plan.appName,
            description: input?.planPatch?.summary ?? project.plan.summary,
          },
        ...(input?.planPatch?.designSystem ?? project.plan.designSystem
          ? {
              designSystem:
                input?.planPatch?.designSystem ?? project.plan.designSystem,
            }
          : {}),
      };

      rollbackFiles = project.draftFiles;
      await this.repo.updatePlan(projectId, mergedPlan);
      const getSeq = await this.nextSeq(projectId);
      console.log(
        `[Workflow] confirmPlan begin project=${projectId} mode=${mode} model=${modelLabel}`
      );
      await this.repo.saveDraft(projectId, rollbackFiles, 'building');
      statusDirty = true;
      if (mode === 'race') {
        yield await this.emitAndPersist(projectId, getSeq, {
          role: 'alex',
          type: 'role_start',
          payload: {
            label: 'Race Mode 已启动：Alex 正在并行构建 2 套贴合场景的风格方案...',
            mode: 'race',
          },
        });

        const raceRunId = globalThis.crypto.randomUUID();
        const raceDirections = getRaceDirectionsForPlan(mergedPlan);
        const branchRuns = await Promise.all(
          raceDirections.map(async (dir) => {
            const buffered: Array<{
              role: AgentRole;
              type: AgentEvent['type'];
              payload: unknown;
              branchId?: string;
            }> = [];

            const branchDesignSystem = resolveBranchDesignSystem(
              mergedPlan,
              dir
            );
            const branchPlan: ProductPlan = {
              ...mergedPlan,
              designSystem: branchDesignSystem,
            };

            const designMd = renderDesignMarkdown(branchPlan, {
              branchLabel: dir.label,
              branchStyleDirection: dir.styleDirection,
            });
            buffered.push({
              role: 'alex',
              branchId: dir.branchId,
              type: 'file_write',
              payload: { path: 'DESIGN.md', bytes: designMd.length },
            });

            const prompt = buildAlexGeneratePrompt({
              plan: branchPlan,
              designMd,
              branchId: dir.branchId,
              branchLabel: dir.label,
              styleDirection: `${dir.label}: ${dir.styleDirection}`,
            });

            try {
              const { files, artifact } = await this.buildWithAutoFix({
                projectId,
                plan: branchPlan,
                baseFiles: { 'DESIGN.md': designMd },
                initialPrompt: prompt,
                model: input?.model,
                branchId: dir.branchId,
                abortSignal: input?.signal,
                onEvent: (ev) => {
                  buffered.push(ev);
                },
              });

              const branch: RaceBranch = {
                branchId: dir.branchId,
                runId: raceRunId,
                label: dir.label,
                styleDirection: dir.styleDirection,
                designSystem: branchDesignSystem,
                files: files['DESIGN.md']?.trim()
                  ? files
                  : { ...files, 'DESIGN.md': designMd },
                previewHtml: artifact.ok ? artifact.html : null,
                errors: artifact.ok ? [] : artifact.errors,
              };

              return { branch, buffered };
            } catch (branchErr) {
              if (input?.signal?.aborted) {
                throw branchErr;
              }
              const message =
                branchErr instanceof Error ? branchErr.message : String(branchErr);
              buffered.push({
                role: 'alex',
                branchId: dir.branchId,
                type: 'build_result',
                payload: {
                  ok: false,
                  errors: [{ phase: 'compile', message }],
                  autoFixRounds: 0,
                },
              });
              const branch: RaceBranch = {
                branchId: dir.branchId,
                runId: raceRunId,
                label: dir.label,
                styleDirection: dir.styleDirection,
                designSystem: branchDesignSystem,
                files: {},
                previewHtml: null,
                errors: [{ phase: 'compile', message }],
              };
              return { branch, buffered };
            }
          })
        );

        for (const run of branchRuns) {
          for (const ev of run.buffered) {
            yield await this.emitAndPersist(projectId, getSeq, ev);
          }
        }

        const branches = branchRuns.map((r) => r.branch);
        const hasUsableBranch = branches.some(
          (b) => b.previewHtml !== null && b.errors.length === 0
        );
        // Only persist candidate branches if at least one compiled cleanly;
        // if both failed, keep raceBranches empty so the project can iterate/publish/retry cleanly.
        await this.repo.saveRaceBranches(projectId, hasUsableBranch ? branches : []);

        const finalStatus = hasUsableBranch ? 'awaiting_branch_selection' : 'error';
        // Keep existing draftFiles (and any prior published version) strictly untouched
        // until the user explicitly chooses a candidate branch via selectBranch().
        await this.repo.saveDraft(projectId, rollbackFiles, finalStatus);
        completed = true;
        console.log(
          `[Workflow] confirmPlan done project=${projectId} mode=race status=${finalStatus} elapsed=${Date.now() - started}ms`
        );

        yield await this.emitAndPersist(projectId, getSeq, {
          role: 'system',
          type: 'done',
          payload: {
            status: finalStatus,
            mode: 'race',
            branches: branches.map((b) => ({
              branchId: b.branchId,
              label: b.label,
              ok: b.previewHtml !== null && b.errors.length === 0,
            })),
          },
        });
        return;
      }

      // Standard linear SOP flow
      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'alex',
        type: 'role_start',
        payload: { label: 'Alex 正在编写 DESIGN.md 与全栈界面...', mode: 'linear' },
      });

      const designMd = renderDesignMarkdown(mergedPlan);
      const buffered: Array<{
        role: AgentRole;
        type: AgentEvent['type'];
        payload: unknown;
        branchId?: string;
      }> = [
        {
          role: 'alex',
          type: 'file_write',
          payload: { path: 'DESIGN.md', bytes: designMd.length },
        },
      ];

      const { files, artifact } = await this.buildWithAutoFix({
        projectId,
        plan: mergedPlan,
        baseFiles: { 'DESIGN.md': designMd },
        initialPrompt: buildAlexGeneratePrompt({ plan: mergedPlan, designMd }),
        model: input?.model,
        abortSignal: input?.signal,
        onEvent: (ev) => {
          buffered.push(ev);
        },
      });
      const finalFiles = files['DESIGN.md']?.trim()
        ? files
        : { ...files, 'DESIGN.md': designMd };

      for (const ev of buffered) {
        yield await this.emitAndPersist(projectId, getSeq, ev);
      }

      await this.repo.saveRaceBranches(projectId, []);
      const finalStatus = artifact.ok ? 'ready' : 'error';
      await this.repo.saveDraft(projectId, finalFiles, finalStatus);
      completed = true;
      console.log(
        `[Workflow] confirmPlan done project=${projectId} mode=linear status=${finalStatus} elapsed=${Date.now() - started}ms`
      );

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'system',
        type: 'done',
        payload: { status: finalStatus, mode: 'linear' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Workflow] confirmPlan error project=${projectId} mode=${mode} model=${modelLabel} elapsed=${Date.now() - started}ms: ${msg}`
      );
      throw err;
    } finally {
      const released = this.releaseProjectLock(projectId, runToken);
      if (released && statusDirty && !completed) {
        console.warn(
          `[Workflow] confirmPlan aborted project=${projectId} mode=${mode} model=${modelLabel} elapsed=${Date.now() - started}ms`
        );
        await this.repo
          .saveDraft(projectId, rollbackFiles, 'error')
          .catch(() => undefined);
      }
    }
  }

  async selectBranch(
    projectId: string,
    branchId: string,
    opts?: { runId?: string }
  ): Promise<Project> {
    const project = await this.requireProject(projectId);
    if (isPendingPlanConfirmation(project)) {
      throw new Error('当前存在待确认的 Emma 产品方案，请先确认方案后再选择候选分支');
    }
    if (isBuildingInProgress(project)) {
      throw new Error('Alex 正在构建中，请等待当前构建完成后再选择候选分支');
    }
    const chosen = project.raceBranches.find((b) => b.branchId === branchId);
    if (!chosen) {
      throw new Error(`Race branch "${branchId}" not found on project "${projectId}"`);
    }
    if (opts?.runId && chosen.runId && chosen.runId !== opts.runId) {
      throw new Error(`Race branch "${branchId}" belongs to a stale Race run`);
    }
    if (!chosen.previewHtml || chosen.errors.length > 0) {
      throw new Error(
        `Race branch "${branchId}" failed compilation and cannot be promoted to draft`
      );
    }

    const updated = await this.repo.adoptRaceBranch(projectId, {
      branchId: chosen.branchId,
      expectedRunId: opts?.runId ?? chosen.runId,
      files: chosen.files,
      designSystem: chosen.designSystem,
      auditEvent: {
        role: 'system',
        branchId: chosen.branchId,
        type: 'thought',
        payload: {
          message: `已选定 ${chosen.label} 作为当前草稿主分支`,
        },
        timestamp: new Date().toISOString(),
      },
    });
    if (!updated) {
      throw new Error(
        `Race branch "${branchId}" is no longer available for selection on project "${projectId}"`
      );
    }

    return updated;
  }

  async *iterate(
    projectId: string,
    instruction: string,
    opts?: {
      model?: string;
      targetRole?: 'auto' | 'iris' | 'emma' | 'alex';
      mentions?: AgentMentionSpan[];
      collabStep?: { turnId: string; stepId: string };
      signal?: AbortSignal;
    }
  ): AsyncIterable<AgentEvent> {
    const runToken = this.acquireProjectLock(projectId);
    const started = Date.now();
    const modelLabel = formatLogLabel(opts?.model);
    let completed = false;
    let statusDirty = false;
    let rollbackFiles: VirtualFS = {};
    let restoreStatus: Project['status'] = 'ready';
    let nextSeqFn: (() => number) | null = null;
    let linkedCollabStepRef: { turnId: string; stepId: string } | undefined;
    let linkedCollabStepStarted = false;
    let linkedCollabInstruction = '';

    try {
      const project = await this.requireProject(projectId);
      const blockReason = getMutationBlockReason(project, 'iterate');
      if (blockReason) {
        throw new Error(blockReason);
      }
      if (!project.plan) {
        throw new Error(`Project "${projectId}" must have a confirmed plan before iterating`);
      }
      if (Object.keys(project.draftFiles).length === 0) {
        throw new Error(`Project "${projectId}" has no draft files to iterate on`);
      }

      const leadingTrim = instruction.length - instruction.trimStart().length;
      const rawInstruction = instruction.trim();
      const previousStatus = project.status;
      restoreStatus =
        previousStatus === 'published' || previousStatus === 'error'
          ? previousStatus
          : 'ready';
      rollbackFiles = project.draftFiles;

      const existingEvents = await this.repo.listEvents(projectId);
      let seq = existingEvents.length;
      const getSeq = () => {
        seq += 1;
        return seq;
      };
      nextSeqFn = getSeq;
      const recentContext = formatRecentConversationContext(existingEvents);
      const liveCodeColorSummary = extractLiveCodeColorSummary(rollbackFiles);

      const ds = project.plan.designSystem;
      const designSummary = ds
        ? `场景 ${ds.scenario} ${ds.scenarioName}（${ds.colorMode}），主色 ${ds.palette.accent}，背景 ${ds.palette.background}${ds.themeName ? `，主题「${ds.themeName}」` : ''}`
        : undefined;

      const hasExplicitMentionsParam = opts?.mentions !== undefined;
      const structuredMentions = hasExplicitMentionsParam
        ? normalizeMentionSpans(opts!.mentions!, rawInstruction, leadingTrim)
        : [];
      const fallbackParsedMentions = hasExplicitMentionsParam
        ? { spans: [] as AgentMentionSpan[], cleanedText: rawInstruction }
        : parseExplicitMentions(rawInstruction);
      const effectiveMentions = hasExplicitMentionsParam
        ? structuredMentions
        : fallbackParsedMentions.spans;

      const uniqueMentionRoles: Array<'iris' | 'emma' | 'alex'> = [];
      for (const span of effectiveMentions) {
        if (!uniqueMentionRoles.includes(span.role)) {
          uniqueMentionRoles.push(span.role);
        }
      }

      if (uniqueMentionRoles.length >= 2) {
        let rationale = '按团队协同职责分工推进';
        let steps: CollaborationStepState[];
        try {
          const planned = await this.llm.generateObject({
            ...buildMultiMentionPlannerPrompt({
              plan: project.plan,
              designSummary,
              recentContext,
              message: rawInstruction,
              mentionedRoles: uniqueMentionRoles,
            }),
            schema: multiMentionPlanSchema,
            model: opts?.model,
            abortSignal: opts?.signal,
          });
          rationale = planned.rationale.trim() || rationale;
          steps = normalizeMultiMentionPlan(
            planned,
            uniqueMentionRoles,
            rawInstruction
          );
        } catch (planErr) {
          if (opts?.signal?.aborted) {
            throw planErr;
          }
          const planMsg =
            planErr instanceof Error ? planErr.message : String(planErr);
          console.warn(
            `[Workflow] multi-mention orchestrator failed project=${projectId} model=${modelLabel}, using fallback plan: ${planMsg}`
          );
          const fb = buildFallbackMultiMentionPlan(
            uniqueMentionRoles,
            rawInstruction
          );
          rationale = fb.rationale;
          steps = fb.steps;
        }

        const turnId = `turn_${globalThis.crypto.randomUUID().slice(0, 8)}`;
        const upstreamReplies: Partial<Record<'iris' | 'emma', AgentReplyOutput>> =
          {};
        const emit = (ev: Omit<AgentEvent, 'seq' | 'timestamp'>) =>
          this.emitAndPersist(projectId, getSeq, ev);

        console.log(
          `[Workflow] multi-agent turn=${turnId} project=${projectId} roles=${steps.map((s) => s.role).join('->')} model=${modelLabel}`
        );

        yield await emit({
          role: 'system',
          type: 'collaboration_plan',
          payload: {
            turnId,
            instruction: rawInstruction,
            mentions: effectiveMentions,
            rationale,
            steps,
          },
        });

        const confirmedPlan = project.plan;
        const llm = this.llm;
        const runReadOnlyWave = async function* (
          waveSteps: CollaborationStepState[]
        ): AsyncGenerator<AgentEvent> {
          if (waveSteps.length === 0) return;

          for (const step of waveSteps) {
            yield await emit({
              role: 'system',
              type: 'collaboration_step',
              payload: {
                turnId,
                stepId: step.stepId,
                role: step.role,
                status: 'running',
              },
            });
            yield await emit({
              role: step.role,
              type: 'role_start',
              payload: {
                continuation: true,
                turnId,
                label:
                  step.role === 'emma'
                    ? 'Emma 正在协同梳理产品与视觉建议...'
                    : 'Iris 正在协同开展调研分析...',
                instruction: rawInstruction,
                subTask: step.subTask,
                targetRole: step.role,
                intent: step.role === 'emma' ? 'discuss' : 'research',
                routeReason: rationale,
                explicit: true,
              },
            });
          }

          type WaveOutcome = {
            step: CollaborationStepState;
            reply?: AgentReplyOutput;
            error?: string;
            aborted?: boolean;
          };
          const pending = new Map<string, Promise<[string, WaveOutcome]>>();

          for (const step of waveSteps) {
            const depNotes = step.dependsOn
              .map((dep) => {
                const up = upstreamReplies[dep];
                return up ? formatUpstreamReplyForContext(dep, up) : '';
              })
              .filter(Boolean);
            const stepContext = [recentContext, ...depNotes]
              .filter((s) => s.trim().length > 0)
              .join('\n');
            const promptSpec =
              step.role === 'emma'
                ? buildEmmaDiscussPrompt({
                    plan: confirmedPlan,
                    designMd: rollbackFiles['DESIGN.md'],
                    liveCodeColorSummary,
                    recentContext: stepContext || undefined,
                    message: step.subTask,
                  })
                : buildIrisDiscussPrompt({
                    plan: confirmedPlan,
                    recentContext: stepContext || undefined,
                    message: step.subTask,
                  });

            const promise: Promise<[string, WaveOutcome]> = llm
              .generateObject({
                ...promptSpec,
                schema: agentReplySchema,
                model: opts?.model,
                abortSignal: opts?.signal,
              })
              .then((reply): [string, WaveOutcome] => [
                step.stepId,
                { step, reply },
              ])
              .catch((err): [string, WaveOutcome] => {
                if (opts?.signal?.aborted) {
                  return [
                    step.stepId,
                    {
                      step,
                      aborted: true,
                      error: err instanceof Error ? err.message : String(err),
                    },
                  ];
                }
                return [
                  step.stepId,
                  {
                    step,
                    error: err instanceof Error ? err.message : String(err),
                  },
                ];
              });
            pending.set(step.stepId, promise);
          }

          while (pending.size > 0) {
            const [doneKey, outcome] = await Promise.race(pending.values());
            pending.delete(doneKey);
            if (outcome.aborted) {
              throw (
                opts?.signal?.reason ??
                new Error(outcome.error || 'LLM request aborted')
              );
            }
            if (
              outcome.reply &&
              (outcome.step.role === 'iris' || outcome.step.role === 'emma')
            ) {
              upstreamReplies[outcome.step.role] = outcome.reply;
              yield await emit({
                role: outcome.step.role,
                type: 'agent_message',
                payload: {
                  ...outcome.reply,
                  routeReason: rationale,
                  intent: outcome.step.role === 'emma' ? 'discuss' : 'research',
                  explicit: true,
                },
              });
              yield await emit({
                role: 'system',
                type: 'collaboration_step',
                payload: {
                  turnId,
                  stepId: outcome.step.stepId,
                  role: outcome.step.role,
                  status: 'completed',
                },
              });
            } else {
              const errMsg = outcome.error || '协同分析阶段执行失败';
              yield await emit({
                role: 'system',
                type: 'collaboration_step',
                payload: {
                  turnId,
                  stepId: outcome.step.stepId,
                  role: outcome.step.role,
                  status: 'failed',
                  error: errMsg,
                },
              });
              yield await emit({
                role: outcome.step.role,
                type: 'error',
                payload: { message: errMsg },
              });
            }
          }
        };

        const wave1 = steps.filter(
          (s) => s.role !== 'alex' && s.dependsOn.length === 0
        );
        const wave2 = steps.filter(
          (s) => s.role !== 'alex' && s.dependsOn.length > 0
        );
        const alexStep = steps.find((s) => s.role === 'alex');

        yield* runReadOnlyWave(wave1);
        yield* runReadOnlyWave(wave2);

        if (!alexStep) {
          completed = true;
          console.log(
            `[Workflow] multi-agent discussion done turn=${turnId} project=${projectId} elapsed=${Date.now() - started}ms`
          );
          yield await emit({
            role: 'system',
            type: 'done',
            payload: { status: previousStatus, multiAgent: true, turnId },
          });
          return;
        }

        const alexHandoff = buildAlexMultiAgentInstruction(
          alexStep,
          upstreamReplies
        );
        if (alexStep.requireConfirmBeforeRun) {
          yield await emit({
            role: 'system',
            type: 'collaboration_step',
            payload: {
              turnId,
              stepId: alexStep.stepId,
              role: 'alex',
              status: 'awaiting_confirmation',
              handoffInstruction: alexHandoff,
            },
          });
          completed = true;
          console.log(
            `[Workflow] multi-agent paused for confirmation turn=${turnId} project=${projectId} elapsed=${Date.now() - started}ms`
          );
          yield await emit({
            role: 'system',
            type: 'done',
            payload: {
              status: previousStatus,
              multiAgent: true,
              awaitingConfirmation: true,
              turnId,
            },
          });
          return;
        }

        yield await emit({
          role: 'system',
          type: 'collaboration_step',
          payload: {
            turnId,
            stepId: alexStep.stepId,
            role: 'alex',
            status: 'running',
            handoffInstruction: alexHandoff,
          },
        });
        yield await emit({
          role: 'alex',
          type: 'role_start',
          payload: {
            continuation: true,
            turnId,
            label: 'Alex 正在按协作分工修改代码...',
            instruction: rawInstruction,
            subTask: alexStep.subTask,
            targetRole: 'alex',
            intent: 'implement',
            routeReason: rationale,
            explicit: true,
          },
        });

        try {
          await this.repo.saveDraft(projectId, rollbackFiles, 'building');
          statusDirty = true;

          const alexDepNotes = alexStep.dependsOn
            .map((dep) => {
              const up = upstreamReplies[dep];
              return up ? formatUpstreamReplyForContext(dep, up) : '';
            })
            .filter(Boolean);
          const alexContext = [recentContext, ...alexDepNotes]
            .filter((s) => s.trim().length > 0)
            .join('\n');

          const buffered: Array<{
            role: AgentRole;
            type: AgentEvent['type'];
            payload: unknown;
            branchId?: string;
          }> = [];

          const { files, artifact } = await this.buildWithAutoFix({
            projectId,
            plan: project.plan,
            baseFiles: rollbackFiles,
            initialPrompt: buildAlexIteratePrompt({
              plan: project.plan,
              files: rollbackFiles,
              instruction: alexHandoff,
              recentContext: alexContext || undefined,
              liveCodeColorSummary,
            }),
            model: opts?.model,
            abortSignal: opts?.signal,
            requireCodeChange: !/^\s*(只|仅).*(DESIGN\.md|设计文档)/i.test(
              alexHandoff
            ),
            iterationInstruction: alexHandoff,
            onEvent: (ev) => {
              buffered.push(ev);
            },
          });

          for (const ev of buffered) {
            yield await emit(ev);
          }

          const finalIterFiles =
            rollbackFiles['DESIGN.md']?.trim() && !files['DESIGN.md']?.trim()
              ? { ...files, 'DESIGN.md': rollbackFiles['DESIGN.md'] }
              : files;
          const nextStatus = artifact.ok ? 'ready' : 'error';
          await this.repo.saveDraft(projectId, finalIterFiles, nextStatus);

          yield await emit({
            role: 'system',
            type: 'collaboration_step',
            payload: {
              turnId,
              stepId: alexStep.stepId,
              role: 'alex',
              status: artifact.ok ? 'completed' : 'failed',
              handoffInstruction: alexHandoff,
              ...(artifact.ok
                ? {}
                : {
                    error: artifact.errors[0]?.message ?? '编译未通过',
                  }),
            },
          });

          completed = true;
          console.log(
            `[Workflow] multi-agent alex done turn=${turnId} project=${projectId} status=${nextStatus} elapsed=${Date.now() - started}ms`
          );
          yield await emit({
            role: 'system',
            type: 'done',
            payload: {
              status: nextStatus,
              routedRole: 'alex',
              multiAgent: true,
              turnId,
            },
          });
          return;
        } catch (alexErr) {
          if (opts?.signal?.aborted) {
            throw alexErr;
          }
          const alexMsg =
            alexErr instanceof Error ? alexErr.message : String(alexErr);
          console.warn(
            `[Workflow] multi-agent alex failed turn=${turnId} project=${projectId}, preserving upstream replies: ${alexMsg}`
          );
          await this.repo
            .saveDraft(projectId, rollbackFiles, restoreStatus)
            .catch(() => undefined);
          statusDirty = false;
          yield await emit({
            role: 'system',
            type: 'collaboration_step',
            payload: {
              turnId,
              stepId: alexStep.stepId,
              role: 'alex',
              status: 'failed',
              error: alexMsg,
              handoffInstruction: alexHandoff,
            },
          });
          yield await emit({
            role: 'system',
            type: 'error',
            payload: { message: alexMsg },
          });
          completed = true;
          yield await emit({
            role: 'system',
            type: 'done',
            payload: { status: restoreStatus, multiAgent: true, turnId },
          });
          return;
        }
      }

      const explicitArgRole =
        opts?.targetRole && opts.targetRole !== 'auto' ? opts.targetRole : null;

      let routed: {
        targetRole: 'iris' | 'emma' | 'alex';
        intent: 'research' | 'discuss' | 'implement';
        reason: string;
        explicit: boolean;
      };
      let cleanInstruction = rawInstruction;
      let persistedMentions: AgentMentionSpan[] = [];

      if (effectiveMentions.length > 0) {
        const primaryRole = effectiveMentions[0].role;
        cleanInstruction = stripMentionSpans(rawInstruction, effectiveMentions);
        persistedMentions = effectiveMentions;
        routed = {
          targetRole: primaryRole,
          intent:
            primaryRole === 'iris'
              ? 'research'
              : primaryRole === 'emma'
                ? 'discuss'
                : 'implement',
          reason: `用户通过 @ 提及指定 ${primaryRole}`,
          explicit: true,
        };
      } else if (explicitArgRole) {
        cleanInstruction = rawInstruction;
        routed = {
          targetRole: explicitArgRole,
          intent:
            explicitArgRole === 'iris'
              ? 'research'
              : explicitArgRole === 'emma'
                ? 'discuss'
                : 'implement',
          reason: '用户已手动指定协作智能体',
          explicit: true,
        };
      } else {
        try {
          const decision = await this.llm.generateObject({
            ...buildIntentRouterPrompt({
              plan: project.plan,
              designSummary,
              recentContext,
              message: rawInstruction,
            }),
            schema: intentRouteSchema,
            model: opts?.model,
            abortSignal: opts?.signal,
          });
          routed = {
            targetRole: decision.targetRole,
            intent: decision.intent,
            reason: decision.reason,
            explicit: false,
          };
        } catch (routerErr) {
          if (opts?.signal?.aborted) {
            throw routerErr;
          }
          const routerMsg =
            routerErr instanceof Error ? routerErr.message : String(routerErr);
          console.warn(
            `[Workflow] intent router failed project=${projectId} model=${modelLabel}, defaulting to alex: ${routerMsg}`
          );
          routed = {
            targetRole: 'alex',
            intent: 'implement',
            reason: '意图分析暂不可用，已转交全栈工程师',
            explicit: false,
          };
        }
      }

      console.log(
        `[Workflow] iterate routed project=${projectId} role=${routed.targetRole} intent=${routed.intent} explicit=${routed.explicit} mentions=${persistedMentions.length} model=${modelLabel}`
      );

      const linkedCollabStep =
        opts?.collabStep && routed.targetRole === 'alex'
          ? opts.collabStep
          : undefined;
      if (linkedCollabStep) {
        linkedCollabStepRef = linkedCollabStep;
        linkedCollabInstruction = cleanInstruction;
        linkedCollabStepStarted = true;
        yield await this.emitAndPersist(projectId, getSeq, {
          role: 'system',
          type: 'collaboration_step',
          payload: {
            turnId: linkedCollabStep.turnId,
            stepId: linkedCollabStep.stepId,
            role: 'alex',
            status: 'running',
            handoffInstruction: cleanInstruction,
          },
        });
      }

      const startLabel =
        routed.targetRole === 'emma'
          ? 'Emma 正在梳理产品与视觉建议...'
          : routed.targetRole === 'iris'
            ? 'Iris 正在进行深入调研分析...'
            : 'Alex 正在按指令迭代改版...';

      yield await this.emitAndPersist(projectId, getSeq, {
        role: routed.targetRole,
        type: 'role_start',
        payload: {
          label: startLabel,
          instruction: rawInstruction,
          ...(linkedCollabStep
            ? { continuation: true, turnId: linkedCollabStep.turnId }
            : {}),
          ...(persistedMentions.length > 0
            ? { mentions: persistedMentions }
            : {}),
          targetRole: routed.targetRole,
          intent: routed.intent,
          routeReason: routed.reason,
          explicit: routed.explicit,
        },
      });

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'system',
        type: 'intent_routed',
        payload: {
          targetRole: routed.targetRole,
          intent: routed.intent,
          reason: routed.reason,
          explicit: routed.explicit,
        },
      });

      if (routed.targetRole === 'emma' || routed.targetRole === 'iris') {
        const discussPrompt =
          routed.targetRole === 'emma'
            ? buildEmmaDiscussPrompt({
                plan: project.plan,
                designMd: rollbackFiles['DESIGN.md'],
                liveCodeColorSummary,
                recentContext,
                message: cleanInstruction,
              })
            : buildIrisDiscussPrompt({
                plan: project.plan,
                recentContext,
                message: cleanInstruction,
              });

        const replyOut = await this.llm.generateObject({
          ...discussPrompt,
          schema: agentReplySchema,
          model: opts?.model,
          abortSignal: opts?.signal,
        });

        yield await this.emitAndPersist(projectId, getSeq, {
          role: routed.targetRole,
          type: 'agent_message',
          payload: {
            ...replyOut,
            routeReason: routed.reason,
            intent: routed.intent,
            explicit: routed.explicit,
          },
        });

        completed = true;
        console.log(
          `[Workflow] iterate discussion done project=${projectId} role=${routed.targetRole} elapsed=${Date.now() - started}ms`
        );

        yield await this.emitAndPersist(projectId, getSeq, {
          role: 'system',
          type: 'done',
          payload: { status: previousStatus, routedRole: routed.targetRole },
        });
        return;
      }

      console.log(`[Workflow] iterate begin project=${projectId} model=${modelLabel}`);
      await this.repo.saveDraft(projectId, rollbackFiles, 'building');
      statusDirty = true;

      const buffered: Array<{
        role: AgentRole;
        type: AgentEvent['type'];
        payload: unknown;
        branchId?: string;
      }> = [];

      const { files, artifact } = await this.buildWithAutoFix({
        projectId,
        plan: project.plan,
        baseFiles: rollbackFiles,
        initialPrompt: buildAlexIteratePrompt({
          plan: project.plan,
          files: rollbackFiles,
          instruction: cleanInstruction,
          recentContext,
          liveCodeColorSummary,
        }),
        model: opts?.model,
        abortSignal: opts?.signal,
        requireCodeChange: !/^\s*(只|仅).*(DESIGN\.md|设计文档)/i.test(
          cleanInstruction
        ),
        iterationInstruction: cleanInstruction,
        onEvent: (ev) => {
          buffered.push(ev);
        },
      });

      for (const ev of buffered) {
        yield await this.emitAndPersist(projectId, getSeq, ev);
      }

      // Preserve publishedHtml untouched; only update draftFiles and status.
      const finalIterFiles =
        rollbackFiles['DESIGN.md']?.trim() && !files['DESIGN.md']?.trim()
          ? { ...files, 'DESIGN.md': rollbackFiles['DESIGN.md'] }
          : files;
      const nextStatus = artifact.ok ? 'ready' : 'error';
      await this.repo.saveDraft(projectId, finalIterFiles, nextStatus);
      if (linkedCollabStep) {
        yield await this.emitAndPersist(projectId, getSeq, {
          role: 'system',
          type: 'collaboration_step',
          payload: {
            turnId: linkedCollabStep.turnId,
            stepId: linkedCollabStep.stepId,
            role: 'alex',
            status: artifact.ok ? 'completed' : 'failed',
            handoffInstruction: cleanInstruction,
            ...(artifact.ok
              ? {}
              : {
                  error: artifact.errors[0]?.message ?? '编译未通过',
                }),
          },
        });
      }
      completed = true;
      console.log(
        `[Workflow] iterate done project=${projectId} status=${nextStatus} elapsed=${Date.now() - started}ms`
      );

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'system',
        type: 'done',
        payload: { status: nextStatus, routedRole: 'alex' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!opts?.signal?.aborted && linkedCollabStepStarted && linkedCollabStepRef && nextSeqFn) {
        try {
          yield await this.emitAndPersist(projectId, nextSeqFn, {
            role: 'system',
            type: 'collaboration_step',
            payload: {
              turnId: linkedCollabStepRef.turnId,
              stepId: linkedCollabStepRef.stepId,
              role: 'alex',
              status: 'failed',
              error: msg,
              handoffInstruction: linkedCollabInstruction,
            },
          });
        } catch {
          // Preserve original error
        }
      }
      console.warn(
        `[Workflow] iterate error project=${projectId} model=${modelLabel} elapsed=${Date.now() - started}ms: ${msg}`
      );
      throw err;
    } finally {
      const released = this.releaseProjectLock(projectId, runToken);
      if (released && statusDirty && !completed) {
        console.warn(
          `[Workflow] iterate aborted project=${projectId} model=${modelLabel} elapsed=${Date.now() - started}ms`
        );
        await this.repo
          .saveDraft(projectId, rollbackFiles, restoreStatus)
          .catch(() => undefined);
      }
    }
  }

  async publish(projectId: string): Promise<PublishResult> {
    const project = await this.requireProject(projectId);
    const blockReason = getMutationBlockReason(project, 'publish');
    if (blockReason) {
      throw new Error(blockReason);
    }
    if (Object.keys(project.draftFiles).length === 0) {
      throw new Error(`Project "${projectId}" has no generated files to publish`);
    }

    const started = Date.now();
    console.log(`[Workflow] publish begin project=${projectId} slug=${project.slug}`);

    const seoTitle = project.plan?.seo?.title ?? project.plan?.appName ?? project.title;
    const seoDesc =
      project.plan?.seo?.description ??
      project.plan?.summary ??
      `${project.title} — Built with Mini Atoms`;

    const artifact = await this.builder.compile({
      files: project.draftFiles,
      projectId: project.id,
      apiBaseUrl: this.apiBaseUrl,
      capabilities: project.capabilities,
      mode: 'production',
      seo: {
        title: seoTitle,
        description: seoDesc,
        url: `${this.apiBaseUrl}/s/${project.slug}`,
      },
    });

    if (!artifact.ok) {
      const msg = artifact.errors.map((e) => e.message).join('; ');
      throw new Error(`Cannot publish project with build errors: ${msg}`);
    }

    const result = await this.publisher.publish({
      projectId: project.id,
      slug: project.slug,
      files: project.draftFiles,
      html: artifact.html,
    });

    const getSeq = await this.nextSeq(projectId);
    await this.emitAndPersist(projectId, getSeq, {
      role: 'system',
      type: 'published',
      payload: result,
    });
    console.log(
      `[Workflow] publish done project=${projectId} slug=${project.slug} version=${result.version} elapsed=${Date.now() - started}ms`
    );

    return result;
  }

  private async buildWithAutoFix(params: {
    projectId: string;
    plan: ProductPlan;
    baseFiles: VirtualFS;
    initialPrompt: { system: string; prompt: string };
    model?: string;
    branchId?: string;
    requireCodeChange?: boolean;
    iterationInstruction?: string;
    abortSignal?: AbortSignal;
    onEvent: (event: {
      role: AgentRole;
      type: AgentEvent['type'];
      payload: unknown;
      branchId?: string;
    }) => void;
  }): Promise<{ files: VirtualFS; artifact: BuildArtifact }> {
    const generated = await this.llm.generateObject({
      ...params.initialPrompt,
      schema: alexFilesOutputSchema,
      model: params.model,
      abortSignal: params.abortSignal,
    });

    params.onEvent({
      role: 'alex',
      branchId: params.branchId,
      type: 'thought',
      payload: { message: generated.summary },
    });

    const emitChangedFileEvents = (
      prev: VirtualFS,
      next: VirtualFS,
      candidateFiles: Array<{ path: string; content: string }>,
      deletes?: string[],
      autoFixRound?: number
    ) => {
      const diff = computeFileChanges(prev, next, candidateFiles, deletes);
      for (const file of diff.changedFiles) {
        params.onEvent({
          role: 'alex',
          branchId: params.branchId,
          type: 'file_write',
          payload: {
            path: file.path,
            bytes: file.content.length,
            ...(autoFixRound !== undefined ? { autoFixRound } : {}),
          },
        });
      }
      return diff;
    };

    let files = mergeVirtualFS(
      params.baseFiles,
      generated.files,
      generated.deletes
    );
    const initialDiff = emitChangedFileEvents(
      params.baseFiles,
      files,
      generated.files,
      generated.deletes
    );
    const generatedCodeCandidates = generated.files.filter((f) =>
      isCodeFilePath(f.path)
    ).length;

    let round = 0;

    if (
      params.requireCodeChange &&
      !initialDiff.hasCodeDiff &&
      (initialDiff.hasDocDiff || generatedCodeCandidates === 0)
    ) {
      if (params.abortSignal?.aborted) {
        throw (
          params.abortSignal.reason ?? new Error('Client disconnected')
        );
      }
      round += 1;
      params.onEvent({
        role: 'alex',
        branchId: params.branchId,
        type: 'autofix_start',
        payload: {
          round,
          errors: [
            {
              message:
                '仅改动了设计文档，未修改组件源码，正在要求 Alex 补全代码变更...',
            },
          ],
        },
      });

      const repairCodePrompt = buildAlexCodeChangeRepairPrompt({
        plan: params.plan,
        files,
        instruction: params.iterationInstruction ?? '',
        previousSummary: generated.summary,
        liveCodeColorSummary: extractLiveCodeColorSummary(files),
      });

      const codeRepaired = await this.llm.generateObject({
        ...repairCodePrompt,
        schema: alexFilesOutputSchema,
        model: params.model,
        abortSignal: params.abortSignal,
      });

      const prevBeforeCodeRepair = files;
      files = mergeVirtualFS(files, codeRepaired.files, codeRepaired.deletes);
      emitChangedFileEvents(
        prevBeforeCodeRepair,
        files,
        codeRepaired.files,
        codeRepaired.deletes,
        round
      );
    }

    let artifact = await this.compileDraft(params.projectId, params.plan, files);

    while (!artifact.ok && round < this.maxAutoFixRounds) {
      if (params.abortSignal?.aborted) {
        throw (
          params.abortSignal.reason ?? new Error('Client disconnected')
        );
      }
      round += 1;
      params.onEvent({
        role: 'alex',
        branchId: params.branchId,
        type: 'autofix_start',
        payload: { round, errors: artifact.errors },
      });

      const fixPrompt = buildAlexFixPrompt({
        plan: params.plan,
        files,
        errors: artifact.errors,
      });

      const repaired = await this.llm.generateObject({
        ...fixPrompt,
        schema: alexFilesOutputSchema,
        model: params.model,
        abortSignal: params.abortSignal,
      });

      const prevBeforeCompileFix = files;
      files = mergeVirtualFS(files, repaired.files, repaired.deletes);
      emitChangedFileEvents(
        prevBeforeCompileFix,
        files,
        repaired.files,
        repaired.deletes,
        round
      );

      artifact = await this.compileDraft(params.projectId, params.plan, files);
    }

    const finalDiff = computeFinalDiffSummary(params.baseFiles, files);
    const buildResultDiffMeta = {
      changedCodeFiles: finalDiff.changedCodeFiles,
      changedDocFiles: finalDiff.changedDocFiles,
      noCodeChanges: Boolean(params.requireCodeChange && !finalDiff.hasCodeDiff),
    };

    params.onEvent({
      role: 'alex',
      branchId: params.branchId,
      type: 'build_result',
      payload: artifact.ok
        ? {
            ok: true,
            bundleBytes: artifact.bundleBytes,
            warnings: artifact.warnings,
            autoFixRounds: round,
            ...buildResultDiffMeta,
          }
        : {
            ok: false,
            errors: artifact.errors,
            autoFixRounds: round,
            ...buildResultDiffMeta,
          },
    });

    return { files, artifact };
  }

  private compileDraft(
    projectId: string,
    plan: ProductPlan,
    files: VirtualFS
  ): Promise<BuildArtifact> {
    return this.builder.compile({
      files,
      projectId,
      apiBaseUrl: this.apiBaseUrl,
      capabilities: plan.capabilities,
      mode: 'preview',
      seo: plan.seo ?? {
        title: plan.appName,
        description: plan.summary,
      },
    });
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.repo.getById(projectId);
    if (!project) {
      throw new Error(`Project "${projectId}" not found`);
    }
    return project;
  }
}
