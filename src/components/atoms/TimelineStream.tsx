'use client';

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  Eye,
  FileCode,
  Rocket,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { AgentEvent, ProductPlan } from '@/domain';
import type { ResearchOutput } from '@/core';
import { AgentBadge } from './AtomsMark';

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
  timestamp: string;
}

type TimelineItem =
  | { kind: 'user_prompt'; key: string; text: string; timestamp: string }
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

function buildTimelineItems(events: AgentEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let currentAlex: AlexRunBlock | null = null;

  const flushAlex = () => {
    if (currentAlex) {
      items.push(currentAlex);
      currentAlex = null;
    }
  };

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    const payload = (ev.payload ?? {}) as Record<string, unknown>;

    if (ev.type === 'role_start') {
      if (ev.role === 'iris' && typeof payload.idea === 'string' && payload.idea.trim()) {
        flushAlex();
        items.push({
          kind: 'user_prompt',
          key: `user-${ev.seq}-${i}`,
          text: payload.idea,
          timestamp: ev.timestamp,
        });
      } else if (ev.role === 'alex') {
        if (
          typeof payload.instruction === 'string' &&
          payload.instruction.trim()
        ) {
          flushAlex();
          items.push({
            kind: 'user_prompt',
            key: `iter-${ev.seq}-${i}`,
            text: payload.instruction,
            timestamp: ev.timestamp,
          });
        }
        flushAlex();
        currentAlex = {
          kind: 'alex_run',
          key: `alex-${ev.seq}-${i}`,
          mode: payload.mode === 'race' ? 'race' : 'linear',
          thoughts: [],
          files: [],
          autoFixRounds: 0,
          buildResults: [],
          timestamp: ev.timestamp,
        };
      }
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

export function TimelineStream({
  events,
  onOpenPreview,
  onOpenCode,
}: {
  events: AgentEvent[];
  onOpenPreview: () => void;
  onOpenCode: () => void;
}) {
  const items = buildTimelineItems(events);
  const lastAlexIdx = (() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i]?.kind === 'alex_run') return i;
    }
    return -1;
  })();

  if (items.length === 0) {
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
              <div className="max-w-[88%] rounded-2xl rounded-tr-sm bg-[#ebebea] px-3.5 py-2.5 text-xs text-[#0c0c0c]/90 leading-relaxed">
                {item.text}
              </div>
            </div>
          );
        }

        if (item.kind === 'iris_research') {
          return <IrisResearchCard key={item.key} research={item.research} />;
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
