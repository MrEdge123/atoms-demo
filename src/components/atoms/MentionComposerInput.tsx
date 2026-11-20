'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentMentionSpan } from '@/domain';
import { AgentBadge } from './AtomsMark';
import {
  MENTION_AGENTS,
  getMentionChipClassName,
  getMentionDotColor,
  type MentionAgentOption,
  type MentionAgentRole,
} from './AgentMentionChip';

export interface ComposerValue {
  text: string;
  mentions: AgentMentionSpan[];
}

interface MentionComposerInputProps {
  value: ComposerValue;
  onChange: (next: ComposerValue) => void;
  onSubmit: () => void;
  enableMentions: boolean;
  disabled: boolean;
  placeholder: string;
  onMentionPick?: (role: MentionAgentRole) => void;
}

interface ActiveMentionTrigger {
  node: Text;
  start: number;
  end: number;
  query: string;
}

interface PopoverCoords {
  bottom: number;
  left: number;
  width: number;
}

function createMentionChipNode(
  role: MentionAgentRole,
  label: string
): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.contentEditable = 'false';
  chip.dataset.mentionRole = role;
  chip.dataset.mentionLabel = label;
  chip.className = getMentionChipClassName(role);

  const dot = document.createElement('span');
  dot.setAttribute('aria-hidden', 'true');
  dot.className = 'w-1.5 h-1.5 rounded-full shrink-0';
  dot.style.backgroundColor = getMentionDotColor(role);

  const labelEl = document.createElement('span');
  labelEl.textContent = label;

  chip.appendChild(dot);
  chip.appendChild(labelEl);
  return chip;
}

function isMentionRole(val: string | undefined): val is MentionAgentRole {
  return val === 'emma' || val === 'iris' || val === 'alex';
}

function serializeEditorDom(root: HTMLElement): ComposerValue {
  let text = '';
  const mentions: AgentMentionSpan[] = [];

  function walk(node: Node, isRootChild: boolean) {
    if (node.nodeType === Node.TEXT_NODE) {
      const clean = (node.textContent ?? '').replace(/\u00A0/g, ' ');
      text += clean;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const mentionRole = el.dataset.mentionRole;
    if (isMentionRole(mentionRole)) {
      const label = (el.dataset.mentionLabel || el.textContent || `@${mentionRole}`).trim();
      const start = text.length;
      text += label;
      const end = text.length;
      mentions.push({ role: mentionRole, label, start, end });
      return;
    }

    if (el.tagName === 'BR') {
      // Ignore the browser's single trailing placeholder <br> at the end of a block
      if (node.nextSibling) {
        text += '\n';
      }
      return;
    }

    if (
      isRootChild &&
      (el.tagName === 'DIV' || el.tagName === 'P') &&
      text.length > 0 &&
      !text.endsWith('\n')
    ) {
      text += '\n';
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child, false);
    }
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child, true);
  }

  return { text, mentions };
}

function renderEditorDom(root: HTMLElement, value: ComposerValue) {
  root.innerHTML = '';
  if (!value.text) return;

  const validMentions = [...value.mentions]
    .filter(
      (m) =>
        m &&
        isMentionRole(m.role) &&
        Number.isInteger(m.start) &&
        Number.isInteger(m.end) &&
        m.start >= 0 &&
        m.end > m.start &&
        m.end <= value.text.length
    )
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const m of validMentions) {
    if (m.start < cursor) continue;
    if (m.start > cursor) {
      root.appendChild(document.createTextNode(value.text.slice(cursor, m.start)));
    }
    const label = value.text.slice(m.start, m.end) || m.label;
    root.appendChild(createMentionChipNode(m.role, label));
    cursor = m.end;
  }

  if (cursor < value.text.length) {
    root.appendChild(document.createTextNode(value.text.slice(cursor)));
  }
}

function valueSignature(v: ComposerValue): string {
  return JSON.stringify({
    text: v.text,
    mentions: v.mentions.map((m) => [m.role, m.label, m.start, m.end]),
  });
}

function detectTriggerFromSelection(
  root: HTMLElement
): ActiveMentionTrigger | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  let textNode: Text | null = null;
  let offset = 0;

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    textNode = range.startContainer as Text;
    offset = range.startOffset;
    // Never trigger inside an immutable mention chip
    let cur: Node | null = textNode.parentNode;
    while (cur && cur !== root) {
      if (cur instanceof HTMLElement && cur.dataset.mentionRole) {
        return null;
      }
      cur = cur.parentNode;
    }
  } else if (
    range.startContainer.nodeType === Node.ELEMENT_NODE &&
    range.startOffset > 0
  ) {
    const prev = range.startContainer.childNodes[range.startOffset - 1];
    if (prev && prev.nodeType === Node.TEXT_NODE) {
      textNode = prev as Text;
      offset = (textNode.textContent ?? '').length;
    }
  }

  if (!textNode) return null;
  const before = (textNode.textContent ?? '')
    .slice(0, offset)
    .replace(/\u00A0/g, ' ');
  // Matches `@query` anywhere (start, after spaces, or after CJK text) while ignoring emails like `foo@bar`
  const match = before.match(/(^|[^a-zA-Z0-9._+-])@([^\s@]{0,20})$/);
  if (!match) return null;
  const query = match[2] ?? '';
  return {
    node: textNode,
    start: offset - query.length - 1,
    end: offset,
    query,
  };
}

function findAdjacentMentionChipForBackspace(root: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    if (range.startOffset > 0) return null;
    const prev = range.startContainer.previousSibling;
    if (prev instanceof HTMLElement && prev.dataset.mentionRole) {
      return prev;
    }
    return null;
  }

  if (range.startContainer === root && range.startOffset > 0) {
    const prev = root.childNodes[range.startOffset - 1];
    if (prev instanceof HTMLElement && prev.dataset.mentionRole) {
      return prev;
    }
  }
  return null;
}

/**
 * Rich composer textbox supporting inline `@` agent autocomplete anywhere in a
 * message and atomic `<AgentMentionChip />` tokens cleanly separated from plain `@`.
 */
export function MentionComposerInput({
  value,
  onChange,
  onSubmit,
  enableMentions,
  disabled,
  placeholder,
  onMentionPick,
}: MentionComposerInputProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const lastEmittedSigRef = useRef<string>('');
  const activeTriggerRef = useRef<ActiveMentionTrigger | null>(null);

  const [triggerQuery, setTriggerQuery] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [popoverCoords, setPopoverCoords] = useState<PopoverCoords | null>(null);

  const filteredAgents = useMemo(() => {
    if (triggerQuery === null) return [];
    const q = triggerQuery.trim().toLowerCase();
    if (!q) return MENTION_AGENTS;
    return MENTION_AGENTS.filter(
      (agent) =>
        agent.id.includes(q) ||
        agent.mention.toLowerCase().includes(q) ||
        agent.title.toLowerCase().includes(q) ||
        agent.keywords.some((kw) => kw.toLowerCase().includes(q))
    );
  }, [triggerQuery]);

  const isMenuOpen =
    enableMentions &&
    !disabled &&
    triggerQuery !== null &&
    filteredAgents.length > 0;

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === 'undefined' || !editorRef.current) return;
    const rect = editorRef.current.getBoundingClientRect();
    const width = Math.max(272, Math.min(rect.width + 16, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const bottom = Math.max(8, window.innerHeight - rect.top + 8);
    setPopoverCoords({ bottom, left, width });
  }, []);

  const closeMenu = useCallback(() => {
    activeTriggerRef.current = null;
    setTriggerQuery(null);
    setHighlightIndex(0);
  }, []);

  // Sync external programmatic value changes (submit clear, quick chip, mode switch)
  useEffect(() => {
    const incomingSig = valueSignature(value);
    if (incomingSig === lastEmittedSigRef.current) return;
    if (!editorRef.current) return;
    renderEditorDom(editorRef.current, value);
    lastEmittedSigRef.current = incomingSig;
    if (!value.text) {
      closeMenu();
    }
  }, [value, closeMenu]);

  useEffect(() => {
    if (!enableMentions || disabled) {
      closeMenu();
    }
  }, [enableMentions, disabled, closeMenu]);

  useEffect(() => {
    if (!isMenuOpen) return;
    updatePopoverPosition();

    function handleOutsideMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (editorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    }

    window.addEventListener('resize', updatePopoverPosition);
    document.addEventListener('mousedown', handleOutsideMouseDown);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      document.removeEventListener('mousedown', handleOutsideMouseDown);
    };
  }, [isMenuOpen, updatePopoverPosition, closeMenu]);

  const syncFromDom = useCallback(() => {
    if (!editorRef.current) return;
    const next = serializeEditorDom(editorRef.current);
    lastEmittedSigRef.current = valueSignature(next);
    onChange(next);
  }, [onChange]);

  const refreshTrigger = useCallback(() => {
    if (!enableMentions || disabled || composingRef.current || !editorRef.current) {
      closeMenu();
      return;
    }
    const found = detectTriggerFromSelection(editorRef.current);
    if (!found) {
      closeMenu();
      return;
    }
    activeTriggerRef.current = found;
    setTriggerQuery((prev) => {
      if (prev !== found.query) {
        setHighlightIndex(0);
      }
      return found.query;
    });
    updatePopoverPosition();
  }, [enableMentions, disabled, closeMenu, updatePopoverPosition]);

  const selectMention = useCallback(
    (agent: MentionAgentOption) => {
      const root = editorRef.current;
      const trigger = activeTriggerRef.current;
      if (!root || !trigger || !trigger.node.isConnected || !root.contains(trigger.node)) {
        closeMenu();
        return;
      }

      const full = trigger.node.textContent ?? '';
      const beforeText = full.slice(0, trigger.start);
      const afterText = full.slice(trigger.end);

      const chipEl = createMentionChipNode(agent.id, agent.mention);
      const parent = trigger.node.parentNode;
      if (!parent) {
        closeMenu();
        return;
      }

      const trailingStartsWithSpace = /^\s/.test(afterText);
      const nextAfterText = trailingStartsWithSpace
        ? afterText
        : ` ${afterText}`;
      const afterNode = document.createTextNode(nextAfterText);

      if (beforeText) {
        trigger.node.textContent = beforeText;
        parent.insertBefore(chipEl, trigger.node.nextSibling);
        parent.insertBefore(afterNode, chipEl.nextSibling);
      } else {
        parent.replaceChild(afterNode, trigger.node);
        parent.insertBefore(chipEl, afterNode);
      }

      closeMenu();
      syncFromDom();
      onMentionPick?.(agent.id);

      window.requestAnimationFrame(() => {
        if (!editorRef.current) return;
        editorRef.current.focus();
        const sel = window.getSelection();
        if (sel && afterNode.isConnected) {
          const range = document.createRange();
          const caretPos = Math.min(1, (afterNode.textContent ?? '').length);
          range.setStart(afterNode, caretPos);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    },
    [closeMenu, syncFromDom, onMentionPick]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (composingRef.current || e.nativeEvent.isComposing) return;

    if (isMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % filteredAgents.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex(
          (i) => (i - 1 + filteredAgents.length) % filteredAgents.length
        );
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        const picked = filteredAgents[highlightIndex] ?? filteredAgents[0];
        if (picked) {
          selectMention(picked);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
        return;
      }
    }

    if (e.key === 'Backspace' && editorRef.current) {
      const adjacentChip = findAdjacentMentionChipForBackspace(editorRef.current);
      if (adjacentChip) {
        e.preventDefault();
        const parent = adjacentChip.parentNode;
        const prevNode = adjacentChip.previousSibling;
        const nextNode = adjacentChip.nextSibling;
        adjacentChip.remove();
        syncFromDom();

        const sel = window.getSelection();
        if (sel && parent) {
          const range = document.createRange();
          if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
            range.setStart(nextNode, 0);
          } else if (prevNode && prevNode.nodeType === Node.TEXT_NODE) {
            range.setStart(prevNode, (prevNode.textContent ?? '').length);
          } else {
            range.setStart(editorRef.current, 0);
          }
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        refreshTrigger();
        return;
      }
    }

    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.getRangeAt(0).startContainer)) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const nl = document.createTextNode('\n');
        range.insertNode(nl);
        range.setStartAfter(nl);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        syncFromDom();
        refreshTrigger();
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.text.trim()) {
        onSubmit();
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (disabled) return;
    e.preventDefault();
    const plain = e.clipboardData.getData('text/plain');
    if (!plain) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.startContainer)) return;
    range.deleteContents();
    const textNode = document.createTextNode(plain);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    syncFromDom();
    refreshTrigger();
  }

  const menuPortal =
    isMenuOpen && popoverCoords && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="选择要 @ 的智能体"
            style={{
              bottom: popoverCoords.bottom,
              left: popoverCoords.left,
              width: popoverCoords.width,
            }}
            onMouseDown={(e) => e.preventDefault()}
            className="fixed z-[130] rounded-2xl border border-black/[0.1] bg-white p-1.5 shadow-[0_14px_36px_rgba(12,12,12,0.14)]"
          >
            <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-medium text-[#0c0c0c]/45">
              <span>选择要 @ 的智能体</span>
              <span>↑↓ 选择 · Enter 确认</span>
            </div>
            <div className="space-y-0.5">
              {filteredAgents.map((agent, idx) => {
                const active = idx === highlightIndex;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setHighlightIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectMention(agent);
                    }}
                    className={`w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition cursor-pointer ${
                      active ? 'bg-[#4267ff]/[0.08]' : 'hover:bg-black/[0.04]'
                    }`}
                  >
                    <div className="pt-0.5">
                      <AgentBadge role={agent.id} size="sm" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-[#0c0c0c]/90">
                          {agent.mention}
                        </span>
                        <span className="text-[11px] text-[#0c0c0c]/55">
                          {agent.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#0c0c0c]/50 leading-snug mt-0.5">
                        {agent.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="relative">
      {!value.text && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 text-xs leading-relaxed text-[#0c0c0c]/35 select-none overflow-hidden"
        >
          {placeholder}
        </div>
      )}
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="工作台消息输入框"
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={() => {
          if (composingRef.current) return;
          syncFromDom();
          refreshTrigger();
        }}
        onClick={() => refreshTrigger()}
        onKeyUp={(e) => {
          if (
            e.key === 'ArrowLeft' ||
            e.key === 'ArrowRight' ||
            e.key === 'Home' ||
            e.key === 'End'
          ) {
            refreshTrigger();
          }
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          syncFromDom();
          refreshTrigger();
        }}
        className={`min-h-[38px] max-h-[120px] overflow-y-auto w-full bg-transparent text-xs leading-relaxed text-[#0c0c0c]/95 whitespace-pre-wrap break-words focus:outline-none ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
      />
      {menuPortal}
    </div>
  );
}
