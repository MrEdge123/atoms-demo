/**
 * Agent persona identifiers participating in the SOP collaboration pipeline.
 */
export type AgentRole = 'iris' | 'emma' | 'alex' | 'system';

/**
 * Event types emitted over SSE and persisted in the project event log.
 */
export type AgentEventType =
  | 'role_start'
  | 'thought'
  | 'research_ready'
  | 'plan_ready'
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
