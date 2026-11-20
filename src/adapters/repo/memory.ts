import crypto from 'node:crypto';
import type {
  AgentEvent,
  DesignSystemSpec,
  ProductPlan,
  Project,
  ProjectStatus,
  RaceBranch,
  VirtualFS,
} from '../../domain';
import type { ProjectRepository } from '../../ports';

/**
 * In-memory ProjectRepository for L1 closed-loop unit/contract tests.
 */
export class MemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, Project>();
  private readonly events = new Map<string, AgentEvent[]>();

  async create(input: { title: string; slug: string }): Promise<Project> {
    const now = new Date().toISOString();
    const id = `proj_${crypto.randomUUID().slice(0, 8)}`;
    const baseSlug =
      input.slug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || id;

    let slug = baseSlug;
    const existing = Array.from(this.projects.values()).some(
      (p) => p.slug === slug
    );
    if (existing) {
      slug = `${baseSlug}-${crypto.randomUUID().slice(0, 4)}`;
    }

    const project: Project = {
      id,
      slug,
      title: input.title.trim() || 'Untitled App',
      status: 'idle',
      plan: null,
      draftFiles: {},
      raceBranches: [],
      publishedFiles: null,
      publishedHtml: null,
      publishedVersion: 0,
      capabilities: ['db'],
      createdAt: now,
      updatedAt: now,
    };

    this.projects.set(id, structuredClone(project));
    this.events.set(id, []);
    return structuredClone(project);
  }

  async listAll(): Promise<Project[]> {
    return Array.from(this.projects.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => structuredClone(p));
  }

  async getById(id: string): Promise<Project | null> {
    const found = this.projects.get(id);
    return found ? structuredClone(found) : null;
  }

  async getBySlug(slug: string): Promise<Project | null> {
    for (const p of this.projects.values()) {
      if (p.slug === slug) return structuredClone(p);
    }
    return null;
  }

  async updatePlan(id: string, plan: ProductPlan): Promise<void> {
    const project = this.require(id);
    project.plan = structuredClone(plan);
    project.capabilities = [...plan.capabilities];
    project.title = plan.appName || project.title;
    project.updatedAt = new Date().toISOString();
  }

  async saveDraft(
    id: string,
    files: VirtualFS,
    status: ProjectStatus
  ): Promise<void> {
    const project = this.require(id);
    project.draftFiles = { ...files };
    project.status = status;
    project.updatedAt = new Date().toISOString();
  }

  async saveRaceBranches(id: string, branches: RaceBranch[]): Promise<void> {
    const project = this.require(id);
    project.raceBranches = structuredClone(branches);
    project.updatedAt = new Date().toISOString();
  }

  async adoptRaceBranch(
    id: string,
    input: {
      branchId: string;
      expectedRunId?: string;
      files: VirtualFS;
      designSystem?: DesignSystemSpec;
    }
  ): Promise<Project | null> {
    const project = this.projects.get(id);
    if (!project) return null;
    if (
      project.status === 'planning' ||
      project.status === 'awaiting_confirmation' ||
      project.status === 'building'
    ) {
      return null;
    }
    const exists = project.raceBranches.some(
      (b) =>
        b.branchId === input.branchId &&
        (!input.expectedRunId || b.runId === input.expectedRunId)
    );
    if (!exists) return null;

    project.draftFiles = { ...input.files };
    project.status = 'ready';
    project.raceBranches = [];
    if (input.designSystem && project.plan) {
      project.plan = structuredClone({
        ...project.plan,
        designSystem: input.designSystem,
      });
    }
    project.updatedAt = new Date().toISOString();
    return structuredClone(project);
  }

  async savePublished(
    id: string,
    files: VirtualFS,
    html: string
  ): Promise<{ version: number }> {
    const project = this.require(id);
    const nextVersion = project.publishedVersion + 1;
    project.publishedFiles = { ...files };
    project.publishedHtml = html;
    project.publishedVersion = nextVersion;
    project.status = 'published';
    project.updatedAt = new Date().toISOString();
    return { version: nextVersion };
  }

  async appendEvent(id: string, event: AgentEvent): Promise<void> {
    this.require(id);
    const list = this.events.get(id) ?? [];
    list.push(structuredClone(event));
    this.events.set(id, list);
  }

  async listEvents(id: string): Promise<AgentEvent[]> {
    return structuredClone(this.events.get(id) ?? []);
  }

  async rename(id: string, title: string): Promise<Project> {
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 80) {
      throw new Error('Project title must be 1 to 80 characters');
    }
    const project = this.require(id);
    project.title = trimmed;
    project.updatedAt = new Date().toISOString();
    return structuredClone(project);
  }

  async remove(id: string): Promise<boolean> {
    this.events.delete(id);
    return this.projects.delete(id);
  }

  private require(id: string): Project {
    const p = this.projects.get(id);
    if (!p) throw new Error(`Project "${id}" not found`);
    return p;
  }
}
