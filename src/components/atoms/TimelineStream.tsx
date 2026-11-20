'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  ExternalLink,
  Eye,
  FileCode,
  Loader2,
  Rocket,
  RotateCcw,
  Sparkles,
  Users,
  Wrench,
} from 'lucide-react';
import type {
  AgentEvent,
  AgentMentionSpan,
  CollaborationStepState,
  ProductPlan,
} from '@/domain';
import type { ResearchOutput } from '@/core';
import { AgentBadge } from './AtomsMark';
import { RichMentionText } from './AgentMentionChip';

interface FileWriteItem {
  path: string;
  bytes: number;
  branchId?: string;
  autoFixRound?: number;
}

interface AlexRunBlock {
  kind: 'alex_run';
  key: string;
  mode: 'linear' | 'race';
  thoughts: Array<{ message: string; branchId?: string }>;
  files: FileWriteItem[];
  autoFixRounds: number;
  buildResults: Array<{
    branchId?: string;
    ok: boolean;
    bundleBytes?: number;
    errors?: Array<{ message: string }>;
  }>;
  routeReason?: string;
  explicitRoute?: boolean;
  timestamp: string;
}

interface AgentReplyOption {
  title: string;
  description: string;
  executeInstruction: string;
}

interface CollaborationCardBlock {
  kind: 'collaboration_plan';
  key: string;
  turnId: string;
  rationale: string;
  steps: CollaborationStepState[];
  timestamp: string;
}

type TimelineItem =
  | {
      kind: 'user_prompt';
      key: string;
      text: string;
      mentions?: AgentMentionSpan[];
      timestamp: string;
    }
  | CollaborationCardBlock
  | {
      kind: 'iris_research';
      key: string;
      research: ResearchOutput;
      timestamp: string;
    }
  | {
      kind: 'emma_plan';
      key: string;
      plan: ProductPlan;
      timestamp: string;
    }
  | {
      kind: 'agent_reply';
      key: string;
      role: 'emma' | 'iris';
      reply: string;
      options?: AgentReplyOption[];
      followUpQuestion?: string;
      routeReason?: string;
      explicit?: boolean;
      timestamp: string;
    }
  | AlexRunBlock
  | {
      kind: 'published_card';
      key: string;
      version: number;
      url: string;
      timestamp: string;
    }
  | { kind: 'system_note'; key: string; message: string; timestamp: string }
  | { kind: 'error_card'; key: string; message: string; timestamp: string };

function extractValidatedMentions(raw: unknown): AgentMentionSpan[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const filtered = (raw as AgentMentionSpan[]).filter(
    (m) =>
      m &&
      (m.role === 'emma' || m.role === 'iris' || m.role === 'alex') &&
      typeof m.label === 'string' &&
      Number.isInteger(m.start) &&
      Number.isInteger(m.end)
  );
  return filtered.length > 0 ? filtered : undefined;
}

function buildTimelineItems(events: AgentEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let currentAlex: AlexRunBlock | null = null;
  const collabByTurn = new Map<string, CollaborationCardBlock>();

  const flushAlex = () => {
    if (currentAlex) {
      items.push(currentAlex);
      currentAlex = null;
    }
  };

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    const payload = (ev.payload ?? {}) as Record<string, unknown>;

    if (ev.type === 'collaboration_plan') {
      flushAlex();
      const turnId =
        typeof payload.turnId === 'string' ? payload.turnId : `turn-${ev.seq}-${i}`;
      const instruction =
        typeof payload.instruction === 'string' ? payload.instruction.trim() : '';
      const mentions = extractValidatedMentions(payload.mentions);
      if (instruction) {
        items.push({
          kind: 'user_prompt',
          key: `collab-user-${ev.seq}-${i}`,
          text: instruction,
          mentions,
          timestamp: ev.timestamp,
        });
      }
      const rawSteps = Array.isArray(payload.steps)
        ? (payload.steps as CollaborationStepState[]).map((step) => ({
            ...step,
            dependsOn: Array.isArray(step.dependsOn) ? [...step.dependsOn] : [],
          }))
        : [];
      const block: CollaborationCardBlock = {
        kind: 'collaboration_plan',
        key: `collab-${turnId}-${ev.seq}-${i}`,
        turnId,
        rationale:
          typeof payload.rationale === 'string'
            ? payload.rationale
            : '按团队协同职责分工推进',
        steps: rawSteps,
        timestamp: ev.timestamp,
      };
      collabByTurn.set(turnId, block);
      items.push(block);
      continue;
    }

    if (ev.type === 'collaboration_step') {
      const turnId = typeof payload.turnId === 'string' ? payload.turnId : '';
      const stepId = typeof payload.stepId === 'string' ? payload.stepId : '';
      const role = payload.role;
      const status = payload.status;
      const block = collabByTurn.get(turnId);
      if (
        block &&
        (status === 'pending' ||
          status === 'running' ||
          status === 'completed' ||
          status === 'awaiting_confirmation' ||
          status === 'failed')
      ) {
        const target = block.steps.find(
          (s) => (stepId && s.stepId === stepId) || (role && s.role === role)
        );
        if (target) {
          target.status = status;
          if (typeof payload.handoffInstruction === 'string') {
            target.handoffInstruction = payload.handoffInstruction;
          }
          if (typeof payload.error === 'string') {
            target.error = payload.error;
          }
        }
      }
      continue;
    }

    if (ev.type === 'role_start') {
      if (ev.role === 'iris' && typeof payload.idea === 'string' && payload.idea.trim()) {
        flushAlex();
        items.push({
          kind: 'user_prompt',
          key: `user-${ev.seq}-${i}`,
          text: payload.idea,
          timestamp: ev.timestamp,
        });
      } else if (
        payload.continuation !== true &&
        typeof payload.instruction === 'string' &&
        payload.instruction.trim()
      ) {
        flushAlex();
        items.push({
          kind: 'user_prompt',
          key: `iter-${ev.seq}-${i}`,
          text: payload.instruction,
          mentions: extractValidatedMentions(payload.mentions),
          timestamp: ev.timestamp,
        });
      }
      if (ev.role === 'alex') {
        flushAlex();
        currentAlex = {
          kind: 'alex_run',
          key: `alex-${ev.seq}-${i}`,
          mode: payload.mode === 'race' ? 'race' : 'linear',
          thoughts: [],
          files: [],
          autoFixRounds: 0,
          buildResults: [],
          routeReason:
            typeof payload.routeReason === 'string'
              ? payload.routeReason
              : undefined,
          explicitRoute:
            typeof payload.explicit === 'boolean' ? payload.explicit : undefined,
          timestamp: ev.timestamp,
        };
      }
      continue;
    }

    if (ev.type === 'intent_routed') {
      continue;
    }

    if (ev.type === 'error') {
      flushAlex();
      items.push({
        kind: 'error_card',
        key: `err-${ev.seq}-${i}`,
        message:
          typeof payload.message === 'string'
            ? payload.message
            : '执行过程中发生异常',
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (
      ev.type === 'agent_message' &&
      (ev.role === 'emma' || ev.role === 'iris') &&
      typeof payload.reply === 'string'
    ) {
      flushAlex();
      items.push({
        kind: 'agent_reply',
        key: `reply-${ev.seq}-${i}`,
        role: ev.role,
        reply: payload.reply,
        options: Array.isArray(payload.options)
          ? (payload.options as AgentReplyOption[]).filter(
              (o) =>
                o &&
                typeof o.title === 'string' &&
                typeof o.description === 'string' &&
                typeof o.executeInstruction === 'string'
            )
          : undefined,
        followUpQuestion:
          typeof payload.followUpQuestion === 'string'
            ? payload.followUpQuestion
            : undefined,
        routeReason:
          typeof payload.routeReason === 'string'
            ? payload.routeReason
            : undefined,
        explicit:
          typeof payload.explicit === 'boolean' ? payload.explicit : undefined,
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (ev.type === 'research_ready') {
      flushAlex();
      items.push({
        kind: 'iris_research',
        key: `iris-${ev.seq}-${i}`,
        research: ev.payload as ResearchOutput,
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (ev.type === 'plan_ready') {
      flushAlex();
      items.push({
        kind: 'emma_plan',
        key: `emma-${ev.seq}-${i}`,
        plan: ev.payload as ProductPlan,
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (ev.role === 'alex') {
      if (!currentAlex) {
        currentAlex = {
          kind: 'alex_run',
          key: `alex-${ev.seq}-${i}`,
          mode: ev.branchId ? 'race' : 'linear',
          thoughts: [],
          files: [],
          autoFixRounds: 0,
          buildResults: [],
          timestamp: ev.timestamp,
        };
      }

      if (ev.type === 'thought' && typeof payload.message === 'string') {
        currentAlex.thoughts.push({
          message: payload.message,
          branchId: ev.branchId,
        });
      } else if (ev.type === 'file_write' && typeof payload.path === 'string') {
        currentAlex.files.push({
          path: payload.path,
          bytes: Number(payload.bytes ?? 0),
          branchId: ev.branchId,
          autoFixRound:
            typeof payload.autoFixRound === 'number'
              ? payload.autoFixRound
              : undefined,
        });
      } else if (ev.type === 'autofix_start') {
        currentAlex.autoFixRounds = Math.max(
          currentAlex.autoFixRounds,
          Number(payload.round ?? 1)
        );
      } else if (ev.type === 'build_result') {
        currentAlex.buildResults.push({
          branchId: ev.branchId,
          ok: Boolean(payload.ok),
          bundleBytes:
            typeof payload.bundleBytes === 'number'
              ? payload.bundleBytes
              : undefined,
          errors: Array.isArray(payload.errors)
            ? (payload.errors as Array<{ message: string }>)
            : undefined,
        });
      }
      continue;
    }

    if (ev.type === 'thought' && typeof payload.message === 'string') {
      flushAlex();
      items.push({
        kind: 'system_note',
        key: `note-${ev.seq}-${i}`,
        message: payload.message,
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (ev.type === 'published') {
      flushAlex();
      items.push({
        kind: 'published_card',
        key: `pub-${ev.seq}-${i}`,
        version: Number(payload.version ?? 1),
        url: typeof payload.url === 'string' ? payload.url : '',
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (ev.type === 'done') {
      flushAlex();
    }
  }

  flushAlex();
  return items;
}

function AlexRunCard({
  run,
  defaultExpanded,
  onOpenPreview,
  onOpenCode,
}: {
  run: AlexRunBlock;
  defaultExpanded: boolean;
  onOpenPreview: () => void;
  onOpenCode: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [filesExpanded, setFilesExpanded] = useState(false);

  const stepCount =
    run.thoughts.length +
    (run.files.length > 0 ? 1 : 0) +
    run.autoFixRounds +
    run.buildResults.length;

  const allPassed =
    run.buildResults.length > 0 && run.buildResults.every((b) => b.ok);
  const firstFile = run.files[0];
  const extraFilesCount = Math.max(0, run.files.length - 1);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AgentBadge role="alex" />
          <span className="text-xs font-semibold text-[#0c0c0c]/90">
            Alex · 全栈工程师
          </span>
          {run.mode === 'race' && (
            <span className="rounded-full bg-amber-500/12 border border-amber-600/20 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              Race 双路并行
            </span>
          )}
          {run.routeReason && (
            <span
              title={run.routeReason}
              className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-[#0c0c0c]/55"
            >
              {run.explicitRoute ? '指定开发' : '智能路由'}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-[#0c0c0c]/55 hover:text-[#0c0c0c]/90 transition cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          已处理 {Math.max(stepCount, 1)} 步
        </button>
      </div>

      {expanded && (
        <div className="ml-2.5 pl-4 border-l border-dashed border-black/15 space-y-2.5 py-0.5">
          {run.thoughts.length > 0 &&
            (run.mode === 'race' ? (
              <div className="space-y-1">
                {run.thoughts.map((t, idx) => (
                  <p
                    key={`${t.branchId ?? 'thought'}-${idx}`}
                    className="text-xs text-[#0c0c0c]/75 leading-relaxed"
                  >
                    {t.branchId ? `[${t.branchId}] ` : ''}
                    {t.message}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#0c0c0c]/75 leading-relaxed">
                {run.thoughts[run.thoughts.length - 1]?.message}
              </p>
            ))}

          {firstFile && (
            <div className="space-y-1.5">
              <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-2.5 py-1.5 text-[11px] text-[#0c0c0c]/80 shadow-[0_1px_2px_rgba(12,12,12,0.03)]">
                <FileCode className="w-3.5 h-3.5 text-[#2ba3ff] shrink-0" />
                <span className="font-atoms-mono">
                  写入文件 {firstFile.path}
                </span>
                {extraFilesCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilesExpanded((v) => !v)}
                    className="border-l border-black/10 pl-1.5 text-[#4267ff] font-medium hover:underline cursor-pointer"
                  >
                    {filesExpanded ? '收起' : `显示 ${extraFilesCount} 个更多`}
                  </button>
                )}
              </div>

              {filesExpanded && (
                <div className="rounded-xl border border-black/[0.08] bg-white p-2 space-y-1">
                  {run.files.map((f, idx) => (
                    <div
                      key={`${f.path}-${idx}`}
                      className="flex items-center justify-between gap-2 text-[11px] px-1.5 py-0.5 rounded hover:bg-black/[0.02]"
                    >
                      <span className="font-atoms-mono text-[#0c0c0c]/80 truncate">
                        {f.branchId ? `[${f.branchId}] ` : ''}
                        {f.path}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0 text-[#0c0c0c]/45">
                        {f.autoFixRound ? (
                          <span className="rounded bg-amber-500/12 px-1.5 py-0.5 text-[10px] text-amber-800">
                            Auto-Fix #{f.autoFixRound}
                          </span>
                        ) : null}
                        <span className="tabular-nums">{f.bytes} B</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {run.autoFixRounds > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-800">
              <Wrench className="w-3 h-3" />
              编译自愈完成（{run.autoFixRounds} 轮 Auto-Fix）
            </div>
          )}

          {run.buildResults.length > 0 && (
            <div className="space-y-1.5">
              {run.buildResults.map((br, idx) => (
                <div
                  key={`${br.branchId ?? 'main'}-${idx}`}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium mr-1.5 ${
                    br.ok
                      ? 'bg-emerald-500/10 border border-emerald-600/20 text-emerald-700'
                      : 'bg-[#c9444a]/10 border border-[#c9444a]/25 text-[#c9444a]'
                  }`}
                >
                  {br.ok ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" />
                      {br.branchId ? `${br.branchId} ` : ''}编译通过 (
                      {Math.max(1, Math.round((br.bundleBytes ?? 0) / 1024))} KB)
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3 h-3" />
                      {br.errors?.[0]?.message ?? '编译失败'}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {allPassed && run.mode === 'linear' && (
        <div className="rounded-xl border border-[#4267ff]/35 bg-[#4267ff]/[0.06] px-3.5 py-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#0c0c0c]/90">
              草稿构建已就绪
            </div>
            <div className="text-[11px] text-[#0c0c0c]/55 truncate">
              共生成 {run.files.length} 个模块文件，可直接预览或迭代
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onOpenPreview}
              className="inline-flex items-center gap-1 rounded-full bg-white border border-black/10 px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/85 hover:bg-black/[0.03] cursor-pointer"
            >
              <Eye className="w-3 h-3" />
              预览
            </button>
            <button
              type="button"
              onClick={onOpenCode}
              className="inline-flex items-center gap-1 rounded-full bg-white border border-black/10 px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/85 hover:bg-black/[0.03] cursor-pointer"
            >
              <Code2 className="w-3 h-3" />
              源码
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IrisResearchCard({ research }: { research: ResearchOutput }) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AgentBadge role="iris" />
        <span className="text-xs font-semibold text-[#0c0c0c]/90">
          Iris · 深度调研员
        </span>
      </div>
      <div className="ml-2.5 pl-4 border-l border-dashed border-black/15">
        <div className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-2 shadow-[0_1px_2px_rgba(12,12,12,0.03)]">
          <p className="text-xs font-medium text-[#0c0c0c]/90 leading-relaxed">
            {research.marketSummary}
          </p>
          <p className="text-[11px] text-[#0c0c0c]/60 leading-relaxed">
            推荐定位：{research.recommendedPositioning}
          </p>

          {(research.targetAudience ||
            research.competitorPainPoints?.length > 0 ||
            research.differentiators?.length > 0) && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="text-[11px] font-medium text-[#4267ff] hover:underline cursor-pointer"
              >
                {showDetails ? '收起调研明细' : '查看目标受众、痛点与差异化'}
              </button>
              {showDetails && (
                <div className="mt-2 space-y-1.5 border-t border-black/[0.06] pt-2 text-[11px] text-[#0c0c0c]/70">
                  {research.targetAudience && (
                    <div>目标受众：{research.targetAudience}</div>
                  )}
                  {research.competitorPainPoints?.length > 0 && (
                    <div>竞品痛点：{research.competitorPainPoints.join('；')}</div>
                  )}
                  {research.differentiators?.length > 0 && (
                    <div>核心差异化：{research.differentiators.join('；')}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentReplyCard({
  role,
  reply,
  options,
  followUpQuestion,
  routeReason,
  explicit,
  busy,
  onRunSuggestion,
}: {
  role: 'emma' | 'iris';
  reply: string;
  options?: AgentReplyOption[];
  followUpQuestion?: string;
  routeReason?: string;
  explicit?: boolean;
  busy?: boolean;
  onRunSuggestion?: (
    instruction: string,
    targetRole?: 'alex' | 'emma' | 'iris'
  ) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AgentBadge role={role} />
          <span className="text-xs font-semibold text-[#0c0c0c]/90">
            {role === 'emma' ? 'Emma · 产品经理' : 'Iris · 深度调研员'}
          </span>
          <span
            title={routeReason}
            className="rounded-full bg-[#4267ff]/10 px-2 py-0.5 text-[10px] font-medium text-[#4267ff]"
          >
            {explicit ? '指定对话' : '智能路由'}
          </span>
        </div>
      </div>

      <div className="ml-2.5 pl-4 border-l border-dashed border-black/15 space-y-2.5">
        <div className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-3 shadow-[0_1px_2px_rgba(12,12,12,0.03)]">
          {routeReason && (
            <div className="text-[10px] text-[#0c0c0c]/45">
              路由依据：{routeReason}
            </div>
          )}
          <p className="text-xs text-[#0c0c0c]/85 leading-relaxed whitespace-pre-wrap">
            {reply}
          </p>

          {options && options.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-medium text-[#0c0c0c]/55">
                可选推进方案（点击可直接交由 Alex 实现）
              </div>
              <div className="space-y-1.5">
                {options.map((opt, idx) => (
                  <div
                    key={`${opt.title}-${idx}`}
                    className="rounded-xl border border-black/[0.08] bg-[#f8f8f6] p-2.5 flex items-start justify-between gap-2.5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-xs font-semibold text-[#0c0c0c]/90">
                        {opt.title}
                      </div>
                      <p className="text-[11px] text-[#0c0c0c]/60 leading-relaxed">
                        {opt.description}
                      </p>
                    </div>
                    {onRunSuggestion && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          onRunSuggestion(opt.executeInstruction, 'alex')
                        }
                        className="shrink-0 rounded-full bg-[#4267ff] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-[#425ce1] disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        交给 Alex 实现 →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {followUpQuestion && (
            <p className="border-t border-black/[0.06] pt-2 text-[11px] text-[#0c0c0c]/60 leading-relaxed">
              {followUpQuestion}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const COLLAB_ROLE_META: Record<
  CollaborationStepState['role'],
  { label: string; dotColor: string }
> = {
  iris: { label: 'Iris 调研', dotColor: '#b88ade' },
  emma: { label: 'Emma 产品', dotColor: '#ff7fa7' },
  alex: { label: 'Alex 开发', dotColor: '#2ba3ff' },
};

function CollaborationStepStatusBadge({
  status,
}: {
  status: CollaborationStepState['status'];
}) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#4267ff]/10 px-2 py-0.5 text-[10px] font-medium text-[#4267ff] whitespace-nowrap shrink-0">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        进行中
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-2.5 h-2.5" />
        已完成
      </span>
    );
  }
  if (status === 'awaiting_confirmation') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/14 px-2 py-0.5 text-[10px] font-medium text-amber-800 whitespace-nowrap shrink-0">
        <Clock className="w-2.5 h-2.5" />
        待确认
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#c9444a]/12 px-2 py-0.5 text-[10px] font-medium text-[#b72027] whitespace-nowrap shrink-0">
        <AlertCircle className="w-2.5 h-2.5" />
        失败
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2 py-0.5 text-[10px] font-medium text-[#0c0c0c]/55 whitespace-nowrap shrink-0">
      <Clock className="w-2.5 h-2.5" />
      待开始
    </span>
  );
}

function CollaborationPlanCard({
  plan,
  busy,
  onRunSuggestion,
}: {
  plan: CollaborationCardBlock;
  busy?: boolean;
  onRunSuggestion?: (
    instruction: string,
    targetRole?: 'alex' | 'emma' | 'iris'
  ) => void;
}) {
  const doneCount = plan.steps.filter((s) => s.status === 'completed').length;
  const hasAwaiting = plan.steps.some(
    (s) => s.status === 'awaiting_confirmation'
  );
  const allCompleted =
    plan.steps.length > 0 && doneCount === plan.steps.length;

  const groupCounts = new Map<number, number>();
  for (const s of plan.steps) {
    if (s.parallelGroup !== undefined) {
      groupCounts.set(s.parallelGroup, (groupCounts.get(s.parallelGroup) ?? 0) + 1);
    }
  }

  return (
    <div
      data-collaboration-plan={plan.turnId}
      className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-2.5 shadow-[0_1px_2px_rgba(12,12,12,0.03)]"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Users className="w-3.5 h-3.5 text-[#4267ff] shrink-0" />
          <span className="text-xs font-semibold text-[#0c0c0c]/90 truncate">
            团队协作分工
          </span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap shrink-0 ${
            allCompleted
              ? 'bg-emerald-500/12 text-emerald-700'
              : hasAwaiting
                ? 'bg-amber-500/14 text-amber-800'
                : 'bg-[#4267ff]/10 text-[#4267ff]'
          }`}
        >
          {allCompleted
            ? '协作完成'
            : hasAwaiting
              ? '待确认实施'
              : `${doneCount}/${plan.steps.length} 已完成`}
        </span>
      </div>

      {plan.rationale && (
        <p className="text-[11px] text-[#0c0c0c]/55 leading-relaxed">
          {plan.rationale}
        </p>
      )}

      <div className="space-y-1.5">
        {plan.steps.map((step) => {
          const meta = COLLAB_ROLE_META[step.role];
          const isParallel =
            step.parallelGroup !== undefined &&
            (groupCounts.get(step.parallelGroup) ?? 0) >= 2;
          const isRelay = !isParallel && step.dependsOn.length > 0;

          return (
            <div
              key={step.stepId}
              data-collab-step={step.role}
              data-collab-status={step.status}
              className="rounded-lg border border-black/[0.06] bg-[#fcfcfb] px-2.5 py-2 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    aria-hidden="true"
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: meta.dotColor }}
                  />
                  <span className="text-[11px] font-semibold text-[#0c0c0c]/88 whitespace-nowrap">
                    {meta.label}
                  </span>
                  {isParallel && (
                    <span className="rounded bg-[#4267ff]/10 px-1.5 py-0.5 text-[9px] font-medium text-[#4267ff] whitespace-nowrap">
                      并行
                    </span>
                  )}
                  {isRelay && (
                    <span className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[9px] font-medium text-[#0c0c0c]/60 whitespace-nowrap">
                      接力
                    </span>
                  )}
                </div>
                <CollaborationStepStatusBadge status={step.status} />
              </div>

              <p className="text-[11px] text-[#0c0c0c]/75 leading-snug">
                {step.subTask}
              </p>

              {step.status === 'awaiting_confirmation' &&
                step.handoffInstruction &&
                onRunSuggestion && (
                  <div className="pt-0.5 flex justify-end">
                    <button
                      type="button"
                      data-collab-confirm={step.role}
                      disabled={busy}
                      onClick={() =>
                        onRunSuggestion(step.handoffInstruction!, 'alex')
                      }
                      className="rounded-full bg-[#4267ff] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-[#425ce1] disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      确认交由 Alex 实施 →
                    </button>
                  </div>
                )}

              {step.status === 'failed' && (
                <div className="pt-0.5 space-y-1">
                  {step.error && (
                    <p className="text-[10px] text-[#b72027] leading-snug">
                      {step.error}
                    </p>
                  )}
                  {step.handoffInstruction && onRunSuggestion && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-collab-retry={step.role}
                        disabled={busy}
                        onClick={() =>
                          onRunSuggestion(step.handoffInstruction!, 'alex')
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-[#c9444a]/30 bg-white px-2.5 py-0.5 text-[10px] font-medium text-[#b72027] hover:bg-[#c9444a]/[0.06] disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        重试 Alex 实施
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimelineStream({
  events,
  isLoading,
  loadingTitle,
  onOpenPreview,
  onOpenCode,
  onRunSuggestion,
  busy,
}: {
  events: AgentEvent[];
  isLoading?: boolean;
  loadingTitle?: string;
  onOpenPreview: () => void;
  onOpenCode: () => void;
  onRunSuggestion?: (
    instruction: string,
    targetRole?: 'alex' | 'emma' | 'iris'
  ) => void;
  busy?: boolean;
}) {
  const items = buildTimelineItems(events);
  const lastAlexIdx = (() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i]?.kind === 'alex_run') return i;
    }
    return -1;
  })();

  if (items.length === 0) {
    if (isLoading) {
      return (
        <div
          data-testid="project-loading-timeline"
          className="space-y-3"
        >
          <div className="rounded-2xl border border-black/[0.08] bg-white p-3.5 flex items-center gap-2.5 shadow-[0_1px_2px_rgba(12,12,12,0.03)]">
            <Loader2 className="w-4 h-4 text-[#4267ff] animate-spin shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-[#0c0c0c]/85 truncate">
                正在加载「{loadingTitle || '项目'}」历史记录...
              </div>
              <div className="text-[11px] text-[#0c0c0c]/50">
                正在恢复 AI 团队对话与构建进度
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <div className="h-9 w-44 rounded-2xl rounded-tr-sm bg-[#ebebea]/80 animate-pulse" />
          </div>
          <div className="rounded-2xl border border-black/[0.06] bg-white p-3.5 space-y-2 animate-pulse">
            <div className="h-3.5 w-32 rounded bg-black/[0.06]" />
            <div className="h-3 w-full rounded bg-black/[0.05]" />
            <div className="h-3 w-4/5 rounded bg-black/[0.05]" />
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-dashed border-black/[0.12] bg-white/70 p-4 text-center space-y-1.5">
        <Sparkles className="w-5 h-5 text-[#4267ff] mx-auto" />
        <p className="text-xs font-medium text-[#0c0c0c]/80">
          AI 团队待命就绪
        </p>
        <p className="text-[11px] text-[#0c0c0c]/50">
          在下方输入产品想法，Iris 将先开展市场调研，随后交由 Emma 输出可确认的产品方案。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item, idx) => {
        if (item.kind === 'user_prompt') {
          return (
            <div key={item.key} className="flex flex-col items-end space-y-1">
              <span
                suppressHydrationWarning
                className="text-[10px] text-[#0c0c0c]/40 px-1"
              >
                {new Date(item.timestamp).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-[#ebebea] px-3.5 py-2.5 text-xs text-[#0c0c0c]/90 leading-relaxed whitespace-pre-wrap break-words">
                <RichMentionText text={item.text} mentions={item.mentions} />
              </div>
            </div>
          );
        }

        if (item.kind === 'collaboration_plan') {
          return (
            <CollaborationPlanCard
              key={item.key}
              plan={item}
              busy={busy}
              onRunSuggestion={onRunSuggestion}
            />
          );
        }

        if (item.kind === 'iris_research') {
          return <IrisResearchCard key={item.key} research={item.research} />;
        }

        if (item.kind === 'agent_reply') {
          return (
            <AgentReplyCard
              key={item.key}
              role={item.role}
              reply={item.reply}
              options={item.options}
              followUpQuestion={item.followUpQuestion}
              routeReason={item.routeReason}
              explicit={item.explicit}
              busy={busy}
              onRunSuggestion={onRunSuggestion}
            />
          );
        }

        if (item.kind === 'emma_plan') {
          const ds = item.plan.designSystem;
          return (
            <div key={item.key} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <AgentBadge role="emma" />
                <span className="text-xs font-semibold text-[#0c0c0c]/90">
                  Emma · 产品经理
                </span>
              </div>
              <div className="ml-2.5 pl-4 border-l border-dashed border-black/15 space-y-1">
                <p className="text-xs text-[#0c0c0c]/75">
                  已整理「<span className="font-medium text-[#0c0c0c]/95">{item.plan.appName}</span>
                  」产品规格与 {item.plan.collections.length} 个云端数据集合，请在下方方案卡确认后启动构建。
                </p>
                {ds && (
                  <p className="text-[11px] text-[#0c0c0c]/55">
                    UI 设计：场景 {ds.scenario} · {ds.scenarioName}（{ds.colorMode === 'dark' ? '深色' : '浅色'}
                    {ds.themeName ? ` · 主题「${ds.themeName}」` : ''}）
                  </p>
                )}
              </div>
            </div>
          );
        }

        if (item.kind === 'alex_run') {
          return (
            <AlexRunCard
              key={item.key}
              run={item}
              defaultExpanded={idx === lastAlexIdx}
              onOpenPreview={onOpenPreview}
              onOpenCode={onOpenCode}
            />
          );
        }

        if (item.kind === 'published_card') {
          return (
            <div
              key={item.key}
              className="rounded-xl border border-emerald-600/25 bg-emerald-500/[0.08] px-3.5 py-2.5 flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Rocket className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="text-xs font-medium text-emerald-900 truncate">
                  独立生产站点 v{item.version} 已上线
                </span>
              </div>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-white border border-emerald-600/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50 shrink-0"
                >
                  访问
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          );
        }

        if (item.kind === 'system_note') {
          return (
            <div
              key={item.key}
              className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.04] px-3 py-1 text-[11px] text-[#0c0c0c]/65"
            >
              <CheckCircle2 className="w-3 h-3 text-[#4267ff]" />
              {item.message}
            </div>
          );
        }

        return (
          <div
            key={item.key}
            className="rounded-xl border border-[#c9444a]/30 bg-[#c9444a]/10 px-3 py-2 text-xs text-[#b72027]"
          >
            {item.message}
          </div>
        );
      })}
    </div>
  );
}
