import type {
  AgentEvent,
  DesignSystemSpec,
  ProductPlan,
  Project,
  ProjectStatus,
  RaceBranch,
  VirtualFS,
} from '../domain';

/**
 * Port 4: Platform persistence for projects, draft vs published snapshots,
 * Race Mode branches, and collaborative event streams.
 */
export interface ProjectRepository {
  create(input: { title: string; slug: string }): Promise<Project>;

  listAll(): Promise<Project[]>;

  getById(id: string): Promise<Project | null>;

  getBySlug(slug: string): Promise<Project | null>;

  updatePlan(id: string, plan: ProductPlan): Promise<void>;

  saveDraft(
    id: string,
    files: VirtualFS,
    status: ProjectStatus
  ): Promise<void>;

  saveRaceBranches(id: string, branches: RaceBranch[]): Promise<void>;

  adoptRaceBranch(
    id: string,
    input: {
      branchId: string;
      expectedRunId?: string;
      files: VirtualFS;
      designSystem?: DesignSystemSpec;
    }
  ): Promise<Project | null>;

  savePublished(
    id: string,
    files: VirtualFS,
    html: string
  ): Promise<{ version: number }>;

  appendEvent(id: string, event: AgentEvent): Promise<void>;

  listEvents(id: string): Promise<AgentEvent[]>;

  rename(id: string, title: string): Promise<Project>;

  remove(id: string): Promise<boolean>;
}
