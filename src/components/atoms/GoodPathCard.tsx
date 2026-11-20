'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { Project } from '@/domain';

interface GoodPathCardProps {
  project: Project;
  eventsCount: number;
  hasDraft: boolean;
  hasPendingPlanConfirmation: boolean;
  hasPendingRaceSelection: boolean;
  publishBlockReason: string | null;
  busyAction: string;
  onGoPreview: () => void;
  onPublish: () => void;
}

/**
 * Atoms-inspired sticky 4-step workflow guide card ("持续构建 · X / 4").
 */
export function GoodPathCard({
  project,
  eventsCount,
  hasDraft,
  hasPendingPlanConfirmation,
  hasPendingRaceSelection,
  publishBlockReason,
  busyAction,
  onGoPreview,
  onPublish,
}: GoodPathCardProps) {
  const [expanded, setExpanded] = useState(false);

  const step1Done = eventsCount > 0 || Boolean(project.plan);
  const step2Done = Boolean(project.plan) && !hasPendingPlanConfirmation;
  const step3Done = hasDraft && !hasPendingRaceSelection;
  const step4Done = project.publishedVersion > 0;

  const doneCount = [step1Done, step2Done, step3Done, step4Done].filter(
    Boolean
  ).length;

  const publishDisabled =
    !hasDraft || Boolean(publishBlockReason) || Boolean(busyAction);

  const steps = [
    {
      title: '描述你想搭建的内容',
      desc: '告诉 Iris 和 Emma 你的产品目标',
      done: step1Done,
    },
    {
      title: '确认 Emma 产品方案',
      desc: '审阅页面架构、数据集合并拍板构建',
      done: step2Done,
    },
    {
      title: '完成构建并查看预览',
      desc: '试跑应用交互，验证数据保存与页面体验',
      done: step3Done,
      actionLabel: hasDraft ? '预览' : undefined,
      onAction: hasDraft ? onGoPreview : undefined,
      actionDisabled: false,
    },
    {
      title: '发布独立线上站点',
      desc: '生成带真实 SEO/OG 的独立公网访问页',
      done: step4Done,
      actionLabel: '发布',
      onAction: onPublish,
      actionDisabled: publishDisabled,
      actionTitle: publishBlockReason ?? undefined,
    },
  ];

  return (
    <div className="mx-3 mt-2.5 mb-1 shrink-0 rounded-2xl border border-black/[0.08] bg-white shadow-[0_1px_4px_rgba(12,12,12,0.04)] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full h-11 px-3.5 flex items-center justify-between gap-3 text-left hover:bg-black/[0.02] transition cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-[#0c0c0c]/90">
            持续构建
          </span>
          {hasPendingPlanConfirmation && (
            <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              待确认方案
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((idx) => (
              <span
                key={idx}
                className={`h-1.5 w-3.5 rounded-full transition-colors ${
                  idx < doneCount ? 'bg-[#4267ff]' : 'bg-black/[0.08]'
                }`}
              />
            ))}
          </div>
          <span className="text-[11px] font-medium text-[#0c0c0c]/55 tabular-nums">
            {doneCount} / 4
          </span>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-[#0c0c0c]/45" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-[#0c0c0c]/45" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-black/[0.06] divide-y divide-black/[0.06] px-3.5 py-1 bg-[#fcfcfb]">
          {steps.map((step) => (
            <div
              key={step.title}
              className="py-2.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                    step.done
                      ? 'bg-[#0c0c0c] text-white'
                      : 'border border-dashed border-black/25 bg-white'
                  }`}
                >
                  {step.done && <Check className="w-2.5 h-2.5" />}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#0c0c0c]/90">
                    {step.title}
                  </div>
                  <div className="text-[11px] text-[#0c0c0c]/50">
                    {step.desc}
                  </div>
                </div>
              </div>

              {step.actionLabel && step.onAction && (
                <button
                  type="button"
                  disabled={step.actionDisabled}
                  title={step.actionTitle}
                  onClick={step.onAction}
                  className="shrink-0 rounded-full bg-[#0c0c0c] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#0c0c0c]/85 transition disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                >
                  {step.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
