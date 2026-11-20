/**
 * Agent persona identifiers participating in the SOP collaboration pipeline.
 */
export type AgentRole = 'iris' | 'emma' | 'alex' | 'system';

/**
 * Structured inline @mention span created when the user picks an agent from
 * the composer mention selector (distinct from plain literal `@` characters).
 */
export interface AgentMentionSpan {
  role: 'iris' | 'emma' | 'alex';
  label: string;
  start: number;
  end: number;
}

export type CollaborationStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'awaiting_confirmation'
  | 'failed';

export interface CollaborationStepState {
  stepId: string;
  role: 'iris' | 'emma' | 'alex';
  subTask: string;
  dependsOn: Array<'iris' | 'emma'>;
  parallelGroup?: number;
  status: CollaborationStepStatus;
  requireConfirmBeforeRun?: boolean;
  handoffInstruction?: string;
  error?: string;
}

export interface CollaborationPlanPayload {
  turnId: string;
  instruction: string;
  mentions: AgentMentionSpan[];
  rationale: string;
  steps: CollaborationStepState[];
}

export interface CollaborationStepUpdatePayload {
  turnId: string;
  stepId: string;
  role: 'iris' | 'emma' | 'alex';
  status: CollaborationStepStatus;
  handoffInstruction?: string;
  error?: string;
}

/**
 * Event types emitted over SSE and persisted in the project event log.
 */
export type AgentEventType =
  | 'role_start'
  | 'intent_routed'
  | 'collaboration_plan'
  | 'collaboration_step'
  | 'thought'
  | 'research_ready'
  | 'plan_ready'
  | 'agent_message'
  | 'file_write'
  | 'build_result'
  | 'autofix_start'
  | 'published'
  | 'error'
  | 'done';

/**
 * Streaming and persisted event payload shared between the core orchestrator and UI.
 * branchId stays undefined in single-path mode and enables Race Mode parallel branches later.
 */
export interface AgentEvent<TPayload = unknown> {
  seq: number;
  role: AgentRole;
  branchId?: string;
  type: AgentEventType;
  payload: TPayload;
  timestamp: string;
}
