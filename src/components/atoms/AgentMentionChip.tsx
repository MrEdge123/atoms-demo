'use client';

import React from 'react';
import type { AgentMentionSpan } from '@/domain';

export type MentionAgentRole = 'emma' | 'iris' | 'alex';

export interface MentionAgentOption {
  id: MentionAgentRole;
  mention: '@Emma' | '@Iris' | '@Alex';
  title: string;
  desc: string;
  keywords: string[];
}

export const MENTION_AGENTS: MentionAgentOption[] = [
  {
    id: 'emma',
    mention: '@Emma',
    title: 'Emma · 产品经理',
    desc: '探讨产品方案、交互体验与配色方向（不直接改代码）',
    keywords: ['emma', 'pm', '产品', '产品经理', '设计', '配色'],
  },
  {
    id: 'iris',
    mention: '@Iris',
    title: 'Iris · 深度调研员',
    desc: '分析市场趋势、竞品做法与用户留存策略',
    keywords: ['iris', 'research', '调研', '调研员', '市场', '竞品'],
  },
  {
    id: 'alex',
    mention: '@Alex',
    title: 'Alex · 全栈工程师',
    desc: '直接按指令修改代码、样式与修复页面异常',
    keywords: ['alex', 'dev', '开发', '工程师', '全栈', '代码'],
  },
];

const CHIP_STYLE_MAP: Record<
  MentionAgentRole,
  { badgeClass: string; dotColor: string }
> = {
  emma: {
    badgeClass:
      'border-[#ff7fa7]/45 bg-[#ff7fa7]/14 text-[#b81d52]',
    dotColor: '#ff7fa7',
  },
  iris: {
    badgeClass:
      'border-[#b88ade]/45 bg-[#b88ade]/15 text-[#5b2c86]',
    dotColor: '#b88ade',
  },
  alex: {
    badgeClass:
      'border-[#2ba3ff]/45 bg-[#2ba3ff]/14 text-[#0b5ca8]',
    dotColor: '#2ba3ff',
  },
};

export function getMentionChipClassName(role: MentionAgentRole): string {
  const palette = CHIP_STYLE_MAP[role] ?? CHIP_STYLE_MAP.alex;
  return `inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-none align-baseline mx-0.5 select-none ${palette.badgeClass}`;
}

export function getMentionDotColor(role: MentionAgentRole): string {
  return (CHIP_STYLE_MAP[role] ?? CHIP_STYLE_MAP.alex).dotColor;
}

/**
 * Dedicated visual pill component for selected @agent mentions, visually
 * distinct from literal `@` characters (e.g. emails or plain text).
 */
export function AgentMentionChip({
  role,
  label,
}: {
  role: MentionAgentRole;
  label?: string;
}) {
  const defaultLabel =
    MENTION_AGENTS.find((a) => a.id === role)?.mention ?? `@${role}`;
  return (
    <span
      data-mention-chip={role}
      className={getMentionChipClassName(role)}
    >
      <span
        aria-hidden="true"
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: getMentionDotColor(role) }}
      />
      <span>{label || defaultLabel}</span>
    </span>
  );
}

/**
 * Renders user message text while replacing ONLY confirmed `mentions` spans
 * with `<AgentMentionChip />` components and leaving literal `@` characters
 * untouched as plain text.
 */
export function RichMentionText({
  text,
  mentions,
}: {
  text: string;
  mentions?: AgentMentionSpan[];
}) {
  if (!mentions || mentions.length === 0) {
    return <>{text}</>;
  }

  const validSpans = [...mentions]
    .filter(
      (m) =>
        m &&
        Number.isInteger(m.start) &&
        Number.isInteger(m.end) &&
        m.start >= 0 &&
        m.end > m.start &&
        m.end <= text.length
    )
    .sort((a, b) => a.start - b.start);

  if (validSpans.length === 0) {
    return <>{text}</>;
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < validSpans.length; i += 1) {
    const span = validSpans[i];
    if (span.start < cursor) continue;
    if (span.start > cursor) {
      nodes.push(
        <React.Fragment key={`txt-${cursor}`}>
          {text.slice(cursor, span.start)}
        </React.Fragment>
      );
    }
    const displayLabel = text.slice(span.start, span.end) || span.label;
    nodes.push(
      <AgentMentionChip
        key={`mention-${span.start}-${i}`}
        role={span.role}
        label={displayLabel}
      />
    );
    cursor = span.end;
  }

  if (cursor < text.length) {
    nodes.push(
      <React.Fragment key={`txt-tail-${cursor}`}>
        {text.slice(cursor)}
      </React.Fragment>
    );
  }

  return <>{nodes}</>;
}
