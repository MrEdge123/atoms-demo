'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ExternalLink,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';

export interface ProjectItemMenuProps {
  projectId: string;
  title: string;
  publishedSlug?: string | null;
  isReadOnly?: boolean;
  disableDelete?: boolean;
  onOpen: () => void;
  onRename: (projectId: string, nextTitle: string) => Promise<boolean>;
  onDelete: (projectId: string) => void | Promise<void>;
  /** 触发按钮视觉模式：'subtle' 适配侧边栏，'card' 适配大厅卡片 */
  variant?: 'subtle' | 'card';
  alwaysVisible?: boolean;
}

type MenuMode = 'actions' | 'rename' | 'delete';

interface MenuPosition {
  top: number;
  left: number;
}

export function ProjectItemMenu({
  projectId,
  title,
  publishedSlug,
  isReadOnly = false,
  disableDelete = false,
  onOpen,
  onRename,
  onDelete,
  variant = 'subtle',
  alwaysVisible = false,
}: ProjectItemMenuProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<MenuMode>('actions');
  const [draftTitle, setDraftTitle] = useState(title);
  const [submitting, setSubmitting] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition>({ top: 0, left: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function computePosition(): MenuPosition {
    if (typeof window === 'undefined' || !triggerRef.current) {
      return { top: 0, left: 0 };
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = mode === 'rename' ? 236 : 188;
    const estimatedHeight = mode === 'rename' ? 128 : mode === 'delete' ? 116 : 190;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = rect.right - menuWidth;
    if (left < 8) {
      left = Math.min(rect.left, viewportW - menuWidth - 8);
    }
    if (left + menuWidth > viewportW - 8) {
      left = Math.max(8, viewportW - menuWidth - 8);
    }

    let top = rect.bottom + 6;
    if (top + estimatedHeight > viewportH - 8) {
      const aboveTop = rect.top - estimatedHeight - 6;
      if (aboveTop >= 8) {
        top = aboveTop;
      } else {
        top = Math.max(8, viewportH - estimatedHeight - 8);
      }
    }

    return { top, left };
  }

  function closeMenu() {
    setOpen(false);
    setMode('actions');
    setSubmitting(false);
  }

  function openMenu() {
    setDraftTitle(title);
    setMode('actions');
    setSubmitting(false);
    setMenuPos(computePosition());
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    setMenuPos(computePosition());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  useEffect(() => {
    if (!open || mode !== 'rename') return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => window.clearTimeout(timer);
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu();
      }
    }

    function handleResize() {
      setMenuPos(computePosition());
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  async function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || isReadOnly) return;
    const nextTitle = draftTitle.trim();
    if (!nextTitle) return;
    if (nextTitle === title.trim()) {
      closeMenu();
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onRename(projectId, nextTitle);
      if (ok) {
        closeMenu();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (submitting || disableDelete || isReadOnly) return;
    setSubmitting(true);
    try {
      await onDelete(projectId);
      closeMenu();
    } finally {
      setSubmitting(false);
    }
  }

  const visibilityClass =
    alwaysVisible || open
      ? 'opacity-100'
      : 'opacity-75 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100';

  const triggerClass =
    variant === 'card'
      ? `inline-flex items-center justify-center w-7 h-7 rounded-lg border border-black/[0.08] bg-white text-[#0c0c0c]/60 hover:text-[#0c0c0c] hover:bg-black/[0.04] transition cursor-pointer ${visibilityClass}`
      : `inline-flex items-center justify-center w-7 h-7 rounded-lg text-[#0c0c0c]/55 hover:text-[#0c0c0c] hover:bg-black/[0.07] transition cursor-pointer shrink-0 ${
          open ? 'bg-black/[0.08] text-[#0c0c0c]' : ''
        } ${visibilityClass}`;

  const menuPortal =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`${title} 操作菜单`}
            style={{ top: menuPos.top, left: menuPos.left }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={`fixed z-[120] rounded-xl border border-black/[0.08] bg-white shadow-[0_12px_32px_rgba(12,12,12,0.12)] text-xs text-[#0c0c0c] ${
              mode === 'rename' ? 'w-[236px] p-2.5' : 'w-[188px] py-1.5'
            }`}
          >
            {mode === 'actions' && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    onOpen();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#0c0c0c]/85 hover:bg-black/[0.04] transition cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#0c0c0c]/55" />
                  <span>打开工作台</span>
                </button>

                {publishedSlug && (
                  <a
                    role="menuitem"
                    href={`/s/${publishedSlug}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => closeMenu()}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[#0c0c0c]/85 hover:bg-black/[0.04] transition"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[#0c0c0c]/55" />
                    <span>打开发布站</span>
                  </a>
                )}

                <div className="my-1 border-t border-black/[0.06]" />

                <button
                  type="button"
                  role="menuitem"
                  disabled={isReadOnly}
                  onClick={() => {
                    setDraftTitle(title);
                    setMode('rename');
                  }}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-[#0c0c0c]/85 hover:bg-black/[0.04] disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <Pencil className="w-3.5 h-3.5 text-[#0c0c0c]/55" />
                    <span>重命名</span>
                  </span>
                  {isReadOnly && (
                    <span className="text-[10px] text-[#0c0c0c]/40">只读</span>
                  )}
                </button>

                <div className="my-1 border-t border-black/[0.06]" />

                <button
                  type="button"
                  role="menuitem"
                  disabled={disableDelete || isReadOnly}
                  onClick={() => setMode('delete')}
                  className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50/80 disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除</span>
                  </span>
                  {isReadOnly && (
                    <span className="text-[10px] text-red-500/60">只读</span>
                  )}
                </button>
              </>
            )}

            {mode === 'rename' && (
              <form onSubmit={handleRenameSubmit} className="space-y-2">
                <div className="text-[11px] font-medium text-[#0c0c0c]/60">
                  重命名项目
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={draftTitle}
                  maxLength={80}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  disabled={submitting}
                  placeholder="输入新的项目名称"
                  className="w-full rounded-lg border border-black/[0.14] bg-[#f8f8f6] px-2.5 py-1.5 text-xs text-[#0c0c0c] outline-none focus:border-[#0c0c0c]/45"
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode('actions')}
                    disabled={submitting}
                    className="inline-flex items-center gap-1 rounded-lg border border-black/[0.1] bg-white px-2 py-1 text-[11px] text-[#0c0c0c]/65 hover:text-[#0c0c0c] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>取消</span>
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || !draftTitle.trim()}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#0c0c0c] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#262626] disabled:opacity-50 cursor-pointer"
                  >
                    <Check className="w-3 h-3" />
                    <span>{submitting ? '保存中...' : '保存'}</span>
                  </button>
                </div>
              </form>
            )}

            {mode === 'delete' && (
              <div className="px-3 py-1.5 space-y-2">
                <div className="text-[11px] font-medium text-[#0c0c0c]/85 leading-relaxed">
                  确认删除项目「{title}」？此操作不可恢复。
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMode('actions')}
                    disabled={submitting}
                    className="rounded-lg border border-black/[0.1] bg-white px-2 py-1 text-[11px] text-[#0c0c0c]/65 hover:text-[#0c0c0c] cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={submitting || disableDelete}
                    className="rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                  >
                    {submitting ? '删除中...' : '确认删除'}
                  </button>
                </div>
              </div>
            )}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`项目操作：${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="更多操作"
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        className={triggerClass}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {menuPortal}
    </>
  );
}
