import type {
  AgentEvent,
  AgentRole,
  BuildArtifact,
  ProductPlan,
  Project,
  RaceBranch,
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
  buildAlexFixPrompt,
  buildAlexGeneratePrompt,
  buildAlexIteratePrompt,
  buildEmmaPrompt,
  buildIrisPrompt,
  RACE_STYLE_DIRECTIONS,
} from './roles';
import {
  alexFilesOutputSchema,
  mergeVirtualFS,
  productPlanSchema,
  researchOutputSchema,
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

/**
 * Core SOP orchestrator driving Iris -> Emma (confirmation pause) -> Alex (+ Auto-Fix / Race Mode) -> Publish.
 * Depends purely on domain models and port interfaces.
 */
export class AtomsWorkflowEngine implements WorkflowEngine {
  private readonly llm: LLMProvider;
  private readonly builder: AppBuilder;
  private readonly repo: ProjectRepository;
  private readonly publisher: SitePublisher;
  private readonly apiBaseUrl: string;
  private readonly maxAutoFixRounds: number;

  constructor(deps: WorkflowEngineDeps) {
    this.llm = deps.llm;
    this.builder = deps.builder;
    this.repo = deps.repo;
    this.publisher = deps.publisher;
    this.apiBaseUrl = deps.apiBaseUrl.replace(/\/$/, '');
    this.maxAutoFixRounds = deps.maxAutoFixRounds ?? 2;
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
    opts?: { model?: string }
  ): AsyncIterable<AgentEvent> {
    const project = await this.requireProject(projectId);
    const getSeq = await this.nextSeq(projectId);

    // Clear any stale unchosen Race Mode candidates without touching publishedHtml.
    if (project.raceBranches.length > 0) {
      await this.repo.saveRaceBranches(projectId, []);
    }

    // Phase 1: Iris market research
    await this.repo.saveDraft(projectId, project.draftFiles, 'researching');
    const fallbackStatus: Project['status'] =
      project.publishedVersion > 0 || Object.keys(project.draftFiles).length > 0
        ? 'ready'
        : 'error';
    try {
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
      });

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'iris',
        type: 'research_ready',
        payload: research,
      });

      // Phase 2: Emma product planning (pauses for user confirmation)
      await this.repo.saveDraft(projectId, project.draftFiles, 'planning');
      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'emma',
        type: 'role_start',
        payload: { label: 'Emma 正在拆解产品方案与数据集合...' },
      });

      const emmaPrompt = buildEmmaPrompt(idea, JSON.stringify(research, null, 2));
      const plan = await this.llm.generateObject({
        ...emmaPrompt,
        schema: productPlanSchema,
        model: opts?.model,
      });

      const normalizedPlan: ProductPlan = {
        ...plan,
        seo: plan.seo ?? {
          title: plan.appName,
          description: plan.summary,
        },
      };

      await this.repo.updatePlan(projectId, normalizedPlan);
      await this.repo.saveDraft(projectId, project.draftFiles, 'awaiting_confirmation');

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
      await this.repo
        .saveDraft(projectId, project.draftFiles, fallbackStatus)
        .catch(() => undefined);
      throw err;
    }
  }

  async *confirmPlan(
    projectId: string,
    input?: {
      planPatch?: Partial<ProductPlan>;
      model?: string;
      mode?: 'linear' | 'race';
    }
  ): AsyncIterable<AgentEvent> {
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
    };

    await this.repo.updatePlan(projectId, mergedPlan);
    await this.repo.saveDraft(projectId, project.draftFiles, 'building');

    const getSeq = await this.nextSeq(projectId);
    const mode = input?.mode ?? 'linear';

    try {
      if (mode === 'race') {
        yield await this.emitAndPersist(projectId, getSeq, {
          role: 'alex',
          type: 'role_start',
          payload: {
            label: 'Race Mode 已启动：Alex 正在并行构建 2 套设计风格方案...',
            mode: 'race',
          },
        });

        const branchRuns = await Promise.all(
          RACE_STYLE_DIRECTIONS.map(async (dir) => {
            const buffered: Array<{
              role: AgentRole;
              type: AgentEvent['type'];
              payload: unknown;
              branchId?: string;
            }> = [];

            const prompt = buildAlexGeneratePrompt({
              plan: mergedPlan,
              styleDirection: `${dir.label}: ${dir.styleDirection}`,
            });

            const { files, artifact } = await this.buildWithAutoFix({
              projectId,
              plan: mergedPlan,
              baseFiles: {},
              initialPrompt: prompt,
              model: input?.model,
              branchId: dir.branchId,
              onEvent: (ev) => {
                buffered.push(ev);
              },
            });

            const branch: RaceBranch = {
              branchId: dir.branchId,
              label: dir.label,
              styleDirection: dir.styleDirection,
              files,
              previewHtml: artifact.ok ? artifact.html : null,
              errors: artifact.ok ? [] : artifact.errors,
            };

            return { branch, buffered };
          })
        );

        for (const run of branchRuns) {
          for (const ev of run.buffered) {
            yield await this.emitAndPersist(projectId, getSeq, ev);
          }
        }

        const branches = branchRuns.map((r) => r.branch);
        await this.repo.saveRaceBranches(projectId, branches);

        const hasUsableBranch = branches.some(
          (b) => b.previewHtml !== null && b.errors.length === 0
        );
        const finalStatus = hasUsableBranch ? 'awaiting_branch_selection' : 'error';
        // Keep existing draftFiles (and any prior published version) strictly untouched
        // until the user explicitly chooses a candidate branch via selectBranch().
        await this.repo.saveDraft(projectId, project.draftFiles, finalStatus);

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
        payload: { label: 'Alex 正在编写全栈界面并接入 @atoms/cloud...', mode: 'linear' },
      });

      const buffered: Array<{
        role: AgentRole;
        type: AgentEvent['type'];
        payload: unknown;
        branchId?: string;
      }> = [];

      const { files, artifact } = await this.buildWithAutoFix({
        projectId,
        plan: mergedPlan,
        baseFiles: {},
        initialPrompt: buildAlexGeneratePrompt({ plan: mergedPlan }),
        model: input?.model,
        onEvent: (ev) => {
          buffered.push(ev);
        },
      });

      for (const ev of buffered) {
        yield await this.emitAndPersist(projectId, getSeq, ev);
      }

      await this.repo.saveRaceBranches(projectId, []);
      const finalStatus = artifact.ok ? 'ready' : 'error';
      await this.repo.saveDraft(projectId, files, finalStatus);

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'system',
        type: 'done',
        payload: { status: finalStatus, mode: 'linear' },
      });
    } catch (err) {
      await this.repo
        .saveDraft(projectId, project.draftFiles, 'error')
        .catch(() => undefined);
      throw err;
    }
  }

  async selectBranch(projectId: string, branchId: string): Promise<Project> {
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
    if (!chosen.previewHtml || chosen.errors.length > 0) {
      throw new Error(
        `Race branch "${branchId}" failed compilation and cannot be promoted to draft`
      );
    }

    await this.repo.saveDraft(projectId, chosen.files, 'ready');
    await this.repo.saveRaceBranches(projectId, []);

    const getSeq = await this.nextSeq(projectId);
    await this.emitAndPersist(projectId, getSeq, {
      role: 'system',
      branchId: chosen.branchId,
      type: 'thought',
      payload: {
        message: `已选定 ${chosen.label} 作为当前草稿主分支`,
      },
    });

    const updated = await this.repo.getById(projectId);
    if (!updated) {
      throw new Error(`Project "${projectId}" disappeared after branch selection`);
    }
    return updated;
  }

  async *iterate(
    projectId: string,
    instruction: string,
    opts?: { model?: string }
  ): AsyncIterable<AgentEvent> {
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

    const getSeq = await this.nextSeq(projectId);
    await this.repo.saveDraft(projectId, project.draftFiles, 'building');

    try {
      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'alex',
        type: 'role_start',
        payload: { label: 'Alex 正在按指令迭代改版...', instruction },
      });

      const buffered: Array<{
        role: AgentRole;
        type: AgentEvent['type'];
        payload: unknown;
        branchId?: string;
      }> = [];

      const { files, artifact } = await this.buildWithAutoFix({
        projectId,
        plan: project.plan,
        baseFiles: project.draftFiles,
        initialPrompt: buildAlexIteratePrompt({
          plan: project.plan,
          files: project.draftFiles,
          instruction,
        }),
        model: opts?.model,
        onEvent: (ev) => {
          buffered.push(ev);
        },
      });

      for (const ev of buffered) {
        yield await this.emitAndPersist(projectId, getSeq, ev);
      }

      // Preserve publishedHtml untouched; only update draftFiles and status.
      const nextStatus = artifact.ok ? 'ready' : 'error';
      await this.repo.saveDraft(projectId, files, nextStatus);

      yield await this.emitAndPersist(projectId, getSeq, {
        role: 'system',
        type: 'done',
        payload: { status: nextStatus },
      });
    } catch (err) {
      await this.repo
        .saveDraft(projectId, project.draftFiles, 'ready')
        .catch(() => undefined);
      throw err;
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

    return result;
  }

  private async buildWithAutoFix(params: {
    projectId: string;
    plan: ProductPlan;
    baseFiles: VirtualFS;
    initialPrompt: { system: string; prompt: string };
    model?: string;
    branchId?: string;
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
    });

    params.onEvent({
      role: 'alex',
      branchId: params.branchId,
      type: 'thought',
      payload: { message: generated.summary },
    });

    let files = mergeVirtualFS(params.baseFiles, generated.files, generated.deletes);
    for (const file of generated.files) {
      params.onEvent({
        role: 'alex',
        branchId: params.branchId,
        type: 'file_write',
        payload: { path: file.path, bytes: file.content.length },
      });
    }

    let artifact = await this.compileDraft(params.projectId, params.plan, files);
    let round = 0;

    while (!artifact.ok && round < this.maxAutoFixRounds) {
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
      });

      files = mergeVirtualFS(files, repaired.files, repaired.deletes);
      for (const file of repaired.files) {
        params.onEvent({
          role: 'alex',
          branchId: params.branchId,
          type: 'file_write',
          payload: { path: file.path, bytes: file.content.length, autoFixRound: round },
        });
      }

      artifact = await this.compileDraft(params.projectId, params.plan, files);
    }

    params.onEvent({
      role: 'alex',
      branchId: params.branchId,
      type: 'build_result',
      payload: artifact.ok
        ? { ok: true, bundleBytes: artifact.bundleBytes, warnings: artifact.warnings, autoFixRounds: round }
        : { ok: false, errors: artifact.errors, autoFixRounds: round },
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
