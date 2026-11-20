'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronDown } from 'lucide-react';
import type { AgentRole, ProjectStatus } from '@/domain';
import type { ModelInfo } from '@/ports';

export function AtomsLogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="10" fill="#0c0c0c" />
      <circle cx="9.2" cy="12" r="3.4" fill="#fcfcfb" />
      <path
        d="M14.2 7.2a4.8 4.8 0 0 1 0 9.6c-1.1 0-2-.38-2.6-.98 1.35-.72 2.2-2.16 2.2-3.82s-.85-3.1-2.2-3.82c.6-.6 1.5-.98 2.6-.98Z"
        fill="#fcfcfb"
      />
    </svg>
  );
}

const ROLE_META: Record<
  AgentRole,
  { label: string; short: string; bg: string; fg: string }
> = {
  iris: {
    label: 'Iris · 深度调研',
    short: 'I',
    bg: '#b88ade',
    fg: '#ffffff',
  },
  emma: {
    label: 'Emma · 产品经理',
    short: 'E',
    bg: '#ff7fa7',
    fg: '#ffffff',
  },
  alex: {
    label: 'Alex · 全栈工程师',
    short: 'A',
    bg: '#2ba3ff',
    fg: '#ffffff',
  },
  system: {
    label: 'Atoms 系统',
    short: 'S',
    bg: '#0c0c0c',
    fg: '#ffffff',
  },
};

export function getRoleMeta(role: AgentRole) {
  return ROLE_META[role] ?? ROLE_META.system;
}

export function AgentBadge({
  role,
  size = 'sm',
}: {
  role: AgentRole;
  size?: 'sm' | 'md';
}) {
  const meta = getRoleMeta(role);
  const cls =
    size === 'md'
      ? 'w-7 h-7 text-xs'
      : 'w-5 h-5 text-[10px]';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold shrink-0 select-none shadow-xs ${cls}`}
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      title={meta.label}
    >
      {meta.short}
    </span>
  );
}

export function AgentCluster() {
  const roles: AgentRole[] = ['iris', 'emma', 'alex'];
  return (
    <div className="inline-flex items-center -space-x-2">
      {roles.map((role) => {
        const meta = getRoleMeta(role);
        return (
          <span
            key={role}
            title={meta.label}
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white ring-[3px] ring-[#fcfcfb] shadow-xs"
            style={{ backgroundColor: meta.bg }}
          >
            {meta.short}
          </span>
        );
      })}
    </div>
  );
}

export function StatusPill({
  status,
  publishedVersion,
}: {
  status: ProjectStatus;
  publishedVersion?: number;
}) {
  if (status === 'published' || (publishedVersion && publishedVersion > 0 && status === 'ready')) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 border border-emerald-600/20 px-2 py-0.5 text-[11px] font-medium text-emerald-700 whitespace-nowrap shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
        v{publishedVersion} 已上线
      </span>
    );
  }

  switch (status) {
    case 'researching':
    case 'planning':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#b88ade]/15 border border-[#b88ade]/30 px-2 py-0.5 text-[11px] font-medium text-[#6f429c] whitespace-nowrap shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#b88ade] animate-pulse shrink-0" />
          方案生成中
        </span>
      );
    case 'awaiting_confirmation':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 border border-amber-600/25 px-2 py-0.5 text-[11px] font-medium text-amber-800 whitespace-nowrap shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          待确认方案
        </span>
      );
    case 'building':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#4267ff]/10 border border-[#4267ff]/25 px-2 py-0.5 text-[11px] font-medium text-[#4267ff] whitespace-nowrap shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4267ff] animate-pulse shrink-0" />
          构建中
        </span>
      );
    case 'awaiting_branch_selection':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 border border-amber-600/25 px-2 py-0.5 text-[11px] font-medium text-amber-800 whitespace-nowrap shrink-0">
          待选 Race 方案
        </span>
      );
    case 'ready':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#4267ff]/10 border border-[#4267ff]/20 px-2 py-0.5 text-[11px] font-medium text-[#4267ff] whitespace-nowrap shrink-0">
          草稿就绪
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#c9444a]/10 border border-[#c9444a]/25 px-2 py-0.5 text-[11px] font-medium text-[#c9444a] whitespace-nowrap shrink-0">
          存在异常
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-[#0c0c0c]/60 whitespace-nowrap shrink-0">
          未开始
        </span>
      );
  }
}

export function ModelDropdown({
  models,
  selectedModel,
  onSelect,
  align = 'right',
  direction = 'down',
  compact = false,
}: {
  models: ModelInfo[];
  selectedModel: string;
  onSelect: (modelId: string) => void;
  align?: 'left' | 'right';
  direction?: 'up' | 'down';
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const current =
    models.find((m) => m.id === selectedModel) ??
    models[0] ?? {
      id: selectedModel || 'mock-default',
      label: selectedModel || 'Mock Default',
      provider: 'mock',
      available: true,
    };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="模型切换"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-white hover:bg-[#f8f8f6] text-[#0c0c0c]/85 transition cursor-pointer ${
          compact ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs'
        }`}
      >
        <Bot className="w-3.5 h-3.5 text-[#4267ff] shrink-0" />
        <span className="truncate max-w-[132px] font-medium">{current.label}</span>
        <ChevronDown className="w-3 h-3 text-[#0c0c0c]/45 shrink-0" />
      </button>

      {open && (
        <div
          className={`absolute z-40 w-60 rounded-2xl border border-black/[0.1] bg-white p-1.5 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[#0c0c0c]/45">
            选择推理模型
          </div>
          {models.map((m) => {
            const active = m.id === current.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                  active
                    ? 'bg-[#4267ff]/10 text-[#4267ff] font-medium'
                    : 'text-[#0c0c0c]/85 hover:bg-black/[0.04]'
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate">{m.label}</div>
                  <div className="text-[10px] text-[#0c0c0c]/45">{m.provider}</div>
                </div>
                {active && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
