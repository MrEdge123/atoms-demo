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

/**
 * Event types emitted over SSE and persisted in the project event log.
 */
export type AgentEventType =
  | 'role_start'
  | 'intent_routed'
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
