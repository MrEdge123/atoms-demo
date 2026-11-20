import type {
  AgentEvent,
  ProductPlan,
  Project,
  StyleThemeSpec,
} from '../domain';
import type { PublishResult } from './publisher';

/**
 * Orchestration entrypoint driving the multi-agent SOP lifecycle
 * (Iris -> Emma confirmation pause -> Alex + Auto-Fix / Race Mode -> Publish).
 */
export interface WorkflowEngine {
  start(
    projectId: string,
    idea: string,
    opts?: { model?: string; styleTheme?: StyleThemeSpec }
  ): AsyncIterable<AgentEvent>;

  confirmPlan(
    projectId: string,
    input?: {
      planPatch?: Partial<ProductPlan>;
      model?: string;
      mode?: 'linear' | 'race';
    }
  ): AsyncIterable<AgentEvent>;

  selectBranch(projectId: string, branchId: string): Promise<Project>;

  iterate(
    projectId: string,
    instruction: string,
    opts?: { model?: string }
  ): AsyncIterable<AgentEvent>;

  publish(projectId: string): Promise<PublishResult>;
}
