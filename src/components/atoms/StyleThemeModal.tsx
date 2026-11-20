'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Palette,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { DesignScenarioId, StyleThemeSpec } from '@/domain';
import { DESIGN_SCENARIOS, migrateLegacyStyleTheme, styleThemeSchema } from '@/core';

interface StyleThemeModalProps {
  open: boolean;
  mode: 'launcher' | 'emma';
  onClose: () => void;
  selectedThemeId: string;
  builtinThemes: StyleThemeSpec[];
  customThemes: StyleThemeSpec[];
  onSelectTheme: (theme: StyleThemeSpec | null) => void;
  onSaveCustomTheme: (theme: StyleThemeSpec) => void;
  onDeleteCustomTheme: (themeId: string) => void;
  onImportCustomThemes: (themes: StyleThemeSpec[]) => void;
}

const SCENARIO_OPTIONS: Array<{ id: DesignScenarioId; label: string }> = [
  { id: 'A', label: 'A · 品牌官网' },
  { id: 'B', label: 'B · SaaS 工作台' },
  { id: 'C', label: 'C · 创意作品集' },
  { id: 'D', label: 'D · 消费品牌/体验' },
  { id: 'E', label: 'E · 编辑内容博客' },
  { id: 'F', label: 'F · 移动轻应用' },
  { id: 'G', label: 'G · 深色科技专题' },
];

export function StyleThemeModal({
  open,
  mode,
  onClose,
  selectedThemeId,
  builtinThemes,
  customThemes,
  onSelectTheme,
  onSaveCustomTheme,
  onDeleteCustomTheme,
  onImportCustomThemes,
}: StyleThemeModalProps) {
  const [tab, setTab] = useState<'library' | 'create'>('library');
  const [name, setName] = useState('');
  const [scenario, setScenario] = useState<DesignScenarioId>('D');
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const [headingStyle, setHeadingStyle] = useState<
    'editorial-serif' | 'geometric-sans' | 'minimal-sans'
  >('editorial-serif');
  const [radiusStyle, setRadiusStyle] = useState<'sharp' | 'soft' | 'pill'>(
    'soft'
  );
  const [background, setBackground] = useState('#FAF8F4');
  const [surface, setSurface] = useState('#FFFFFF');
  const [textPrimary, setTextPrimary] = useState('#1D1916');
  const [textMuted, setTextMuted] = useState('#6E665E');
  const [accent, setAccent] = useState('#9A522B');
  const [stylePrompt, setStylePrompt] = useState('');
  const [formError, setFormError] = useState('');

  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;

    const focusTimer = window.setTimeout(() => {
      const container = dialogRef.current;
      if (!container) return;
      const firstFocusable = container.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (firstFocusable ?? container).focus();
    }, 0);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!container.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  const allPreviewColors = useMemo(
    () => [background, surface, textPrimary, textMuted, accent],
    [background, surface, textPrimary, textMuted, accent]
  );

  if (!open) return null;

  function applyColorModeDefaults(nextMode: 'light' | 'dark') {
    setColorMode(nextMode);
    if (nextMode === 'dark') {
      setBackground('#0E0F12');
      setSurface('#16181E');
      setTextPrimary('#F3F2EE');
      setTextMuted('#9B9A94');
      setAccent('#D4894A');
    } else {
      setBackground('#FAF8F4');
      setSurface('#FFFFFF');
      setTextPrimary('#1D1916');
      setTextMuted('#6E665E');
      setAccent('#9A522B');
    }
  }

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const trimmedName = name.trim();
    const trimmedPrompt = stylePrompt.trim();
    if (!trimmedName) {
      setFormError('请填写自定义风格名称');
      return;
    }
    if (!trimmedPrompt) {
      setFormError('请填写风格提示词（氛围、布局、组件语言或禁忌）');
      return;
    }

    const candidate: StyleThemeSpec = {
      id: `custom-${Date.now().toString(36)}`,
      name: trimmedName,
      description: `${DESIGN_SCENARIOS[scenario].shortLabel} · 自定义`,
      scenario,
      colorMode,
      palette: {
        background: background.trim() || '#FAF8F4',
        surface: surface.trim() || '#FFFFFF',
        textPrimary: textPrimary.trim() || '#1D1916',
        textMuted: textMuted.trim() || '#6E665E',
        accent: accent.trim() || '#9A522B',
      },
      typography: {
        headingStyle,
        bodyStyle: 'sans',
      },
      radiusStyle,
      surfaceDepth: colorMode === 'dark' ? 'stepped-dark' : 'hairline',
      stylePrompt: trimmedPrompt,
      isCustom: true,
    };

    const parsed = styleThemeSchema.safeParse(candidate);
    if (!parsed.success) {
      const hasHexError = parsed.error.issues.some((iss) =>
        iss.path.includes('palette')
      );
      setFormError(
        hasHexError
          ? '请输入有效的 Hex 色值（3 位或 6 位，如 #FAF8F4）'
          : '字段格式或长度超限（名称 ≤60 字，提示词 ≤2000 字）'
      );
      return;
    }

    onSaveCustomTheme(parsed.data);
    onSelectTheme(parsed.data);
    setName('');
    setStylePrompt('');
    setTab('library');
    onClose();
  }

  function handleExportJson() {
    const payload = JSON.stringify(customThemes, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'atoms-custom-style-themes.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result ?? '[]'));
        if (!Array.isArray(raw)) {
          setFormError('导入文件格式应为 JSON 数组');
          return;
        }
        const valid: StyleThemeSpec[] = [];
        for (const item of raw) {
          const migrated = migrateLegacyStyleTheme(item);
          if (migrated) {
            valid.push(migrated);
          }
        }
        if (valid.length === 0) {
          setFormError('未识别到有效的自定义风格主题');
          return;
        }
        onImportCustomThemes(valid);
        setFormError('');
      } catch {
        setFormError('JSON 解析失败，请检查文件内容');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const renderThemeCard = (theme: StyleThemeSpec, deletable = false) => {
    const active = selectedThemeId === theme.id;
    const scenarioLabel = theme.scenario
      ? `场景 ${theme.scenario} · ${DESIGN_SCENARIOS[theme.scenario]?.shortLabel ?? ''}`
      : '通用风格';

    return (
      <div
        key={theme.id}
        className={`rounded-2xl border p-3.5 transition flex flex-col justify-between gap-2.5 ${
          active
            ? 'border-[#4267ff] bg-[#4267ff]/[0.05] ring-2 ring-[#4267ff]/15'
            : 'border-black/[0.08] bg-white hover:border-black/[0.2]'
        }`}
      >
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-[#0c0c0c]/95 truncate">
                  {theme.name}
                </span>
                {active && (
                  <Check className="w-3.5 h-3.5 text-[#4267ff] shrink-0" />
                )}
              </div>
              <div className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-[#0c0c0c]/55">
                <span className="rounded-full bg-black/[0.05] px-2 py-0.5">
                  {scenarioLabel}
                </span>
                <span>{theme.colorMode === 'dark' ? '深色' : '浅色'}</span>
              </div>
            </div>

            <div className="flex items-center -space-x-1 shrink-0 pt-0.5">
              {[
                theme.palette.background,
                theme.palette.surface,
                theme.palette.textPrimary,
                theme.palette.accent,
              ].map((hex, i) => (
                <span
                  key={`${theme.id}-swatch-${i}`}
                  title={hex}
                  className="w-3.5 h-3.5 rounded-full border border-black/15"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>

          <p className="text-[11px] text-[#0c0c0c]/65 leading-relaxed line-clamp-2">
            {theme.description || theme.stylePrompt}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onSelectTheme(theme);
              onClose();
            }}
            className={`flex-1 rounded-full py-1.5 text-[11px] font-medium transition cursor-pointer ${
              active
                ? 'bg-[#4267ff] text-white'
                : 'bg-[#0c0c0c] text-white hover:bg-[#0c0c0c]/85'
            }`}
          >
            {active ? '当前使用中' : '应用此风格'}
          </button>
          {deletable && (
            <button
              type="button"
              onClick={() => onDeleteCustomTheme(theme.id)}
              aria-label={`删除主题 ${theme.name}`}
              className="rounded-full border border-black/[0.1] p-1.5 text-[#0c0c0c]/55 hover:border-[#c9444a]/40 hover:text-[#c9444a] transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-theme-modal-title"
        tabIndex={-1}
        className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border border-black/[0.1] bg-[#fcfcfb] shadow-[0_24px_60px_rgba(12,12,12,0.18)] overflow-hidden focus:outline-none"
      >
        {/* Header */}
        <div className="h-14 shrink-0 px-5 border-b border-black/[0.08] bg-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#4267ff]/10 text-[#4267ff] flex items-center justify-center">
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="style-theme-modal-title"
                className="text-sm font-semibold text-[#0c0c0c]/95"
              >
                {mode === 'emma' ? '调整方案 UI 主题与风格' : 'UI 设计风格与主题库'}
              </h2>
              <p className="text-[11px] text-[#0c0c0c]/50">
                遵循《高级网页 UI 设计参考手册》· 选中后自动写入项目 DESIGN.md 并全程生效
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full bg-black/[0.05] p-0.5 border border-black/[0.06]">
              <button
                type="button"
                onClick={() => setTab('library')}
                className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
                  tab === 'library'
                    ? 'bg-white text-[#0c0c0c] shadow-xs'
                    : 'text-[#0c0c0c]/60 hover:text-[#0c0c0c]'
                }`}
              >
                选择主题
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormError('');
                  setTab('create');
                }}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
                  tab === 'create'
                    ? 'bg-white text-[#4267ff] shadow-xs'
                    : 'text-[#0c0c0c]/60 hover:text-[#0c0c0c]'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                新建自定义风格
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="关闭主题弹窗"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#0c0c0c]/55 hover:bg-black/[0.05] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {tab === 'library' ? (
            <>
              {/* Auto Match Option */}
              <div
                className={`rounded-2xl border p-4 flex flex-wrap items-center justify-between gap-3 transition ${
                  selectedThemeId === 'auto'
                    ? 'border-[#4267ff] bg-[#4267ff]/[0.05] ring-2 ring-[#4267ff]/15'
                    : 'border-black/[0.08] bg-white'
                }`}
              >
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#4267ff]" />
                    <span className="text-xs font-semibold text-[#0c0c0c]/95">
                      智能按场景匹配（默认推荐）
                    </span>
                    <span className="rounded-full bg-[#4267ff]/12 px-2 py-0.5 text-[10px] font-medium text-[#4267ff]">
                      Emma 自动识别 A–G
                    </span>
                  </div>
                  <p className="text-xs text-[#0c0c0c]/60 leading-relaxed">
                    不预设固定视觉外壳，由 Emma 根据你的真实业务场景自动判定场景类别（品牌/SaaS/消费/编辑/科技等）、配比色板、字体与留白规范并写入 DESIGN.md。
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onSelectTheme(null);
                    onClose();
                  }}
                  className={`rounded-full px-4 py-1.5 text-xs font-medium transition cursor-pointer ${
                    selectedThemeId === 'auto'
                      ? 'bg-[#4267ff] text-white'
                      : 'border border-black/[0.12] bg-white text-[#0c0c0c] hover:bg-black/[0.04]'
                  }`}
                >
                  {selectedThemeId === 'auto' ? '当前默认' : '恢复智能匹配'}
                </button>
              </div>

              {/* Built-in Presets */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#0c0c0c]/85">
                    内置场景默认主题（7 套精选）
                  </h3>
                  <span className="text-[11px] text-[#0c0c0c]/45">
                    覆盖手册场景 A–G
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {builtinThemes.map((t) => renderThemeCard(t, false))}
                </div>
              </div>

              {/* Custom Themes */}
              <div className="space-y-2.5 pt-2 border-t border-black/[0.06]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold text-[#0c0c0c]/85">
                      我的自定义风格模板（{customThemes.length}）
                    </h3>
                    <span className="text-[11px] text-[#0c0c0c]/45">
                      保存在当前浏览器本地，选中后写入具体项目
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {customThemes.length > 0 && (
                      <button
                        type="button"
                        onClick={handleExportJson}
                        className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] bg-white px-2.5 py-1 text-[11px] text-[#0c0c0c]/75 hover:bg-black/[0.04] cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        导出 JSON
                      </button>
                    )}
                    <label className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] bg-white px-2.5 py-1 text-[11px] text-[#0c0c0c]/75 hover:bg-black/[0.04] cursor-pointer">
                      <Upload className="w-3 h-3" />
                      导入
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={handleImportFile}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {formError && (
                  <p className="text-xs text-[#b72027]">{formError}</p>
                )}

                {customThemes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-black/[0.12] bg-white/60 p-5 text-center space-y-2">
                    <p className="text-xs text-[#0c0c0c]/60">
                      还没有保存的自定义风格，点击上方「新建自定义风格」定义你的品牌色板与风格提示词。
                    </p>
                    <button
                      type="button"
                      onClick={() => setTab('create')}
                      className="inline-flex items-center gap-1 rounded-full bg-[#0c0c0c] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#0c0c0c]/85 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      立即创建
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {customThemes.map((t) => renderThemeCard(t, true))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <form
              onSubmit={handleCreateSubmit}
              className="grid grid-cols-1 md:grid-cols-12 gap-5"
            >
              {/* Left Form Fields */}
              <div className="md:col-span-7 space-y-3.5">
                {formError && (
                  <div className="rounded-xl border border-[#c9444a]/30 bg-[#c9444a]/10 px-3 py-2 text-xs text-[#b72027]">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs">
                    <span className="font-medium text-[#0c0c0c]/80">
                      自定义风格名称
                    </span>
                    <input
                      type="text"
                      maxLength={60}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="例如：京都手作茶器侘寂风"
                      className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-xs focus:border-[#4267ff] focus:outline-none"
                    />
                  </label>

                  <label className="space-y-1 text-xs">
                    <span className="font-medium text-[#0c0c0c]/80">
                      适用场景基准
                    </span>
                    <select
                      value={scenario}
                      onChange={(e) =>
                        setScenario(e.target.value as DesignScenarioId)
                      }
                      className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-xs focus:border-[#4267ff] focus:outline-none"
                    >
                      {SCENARIO_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1 text-xs">
                    <span className="font-medium text-[#0c0c0c]/80">明暗模式</span>
                    <div className="grid grid-cols-2 rounded-xl bg-black/[0.05] p-0.5">
                      {(['light', 'dark'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => applyColorModeDefaults(m)}
                          className={`rounded-lg py-1.5 text-xs font-medium cursor-pointer ${
                            colorMode === m
                              ? 'bg-white text-[#0c0c0c] shadow-xs'
                              : 'text-[#0c0c0c]/60'
                          }`}
                        >
                          {m === 'light' ? '浅色' : '深色'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="space-y-1 text-xs">
                    <span className="font-medium text-[#0c0c0c]/80">
                      标题字体气质
                    </span>
                    <select
                      value={headingStyle}
                      onChange={(e) =>
                        setHeadingStyle(
                          e.target.value as
                            | 'editorial-serif'
                            | 'geometric-sans'
                            | 'minimal-sans'
                        )
                      }
                      className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-xs focus:border-[#4267ff] focus:outline-none"
                    >
                      <option value="editorial-serif">编辑衬线体</option>
                      <option value="geometric-sans">几何无衬线</option>
                      <option value="minimal-sans">极简细无衬线</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-xs">
                    <span className="font-medium text-[#0c0c0c]/80">
                      圆角语言
                    </span>
                    <select
                      value={radiusStyle}
                      onChange={(e) =>
                        setRadiusStyle(
                          e.target.value as 'sharp' | 'soft' | 'pill'
                        )
                      }
                      className="w-full rounded-xl border border-black/[0.12] bg-white px-3 py-2 text-xs focus:border-[#4267ff] focus:outline-none"
                    >
                      <option value="soft">精炼微圆角 (8px)</option>
                      <option value="sharp">瑞士直角 (0–4px)</option>
                      <option value="pill">柔和胶囊风 (16px)</option>
                    </select>
                  </label>
                </div>

                {/* 5 Core Color Roles */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-[#0c0c0c]/80">
                    核心 5 色板（主强调色占比 &lt;10%）
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {[
                      { label: '画布底色', value: background, set: setBackground },
                      { label: '卡片表面', value: surface, set: setSurface },
                      { label: '主文字', value: textPrimary, set: setTextPrimary },
                      { label: '辅助字', value: textMuted, set: setTextMuted },
                      { label: '唯一强调', value: accent, set: setAccent },
                    ].map((c) => (
                      <label
                        key={c.label}
                        className="rounded-xl border border-black/[0.08] bg-white p-2 space-y-1 text-[11px]"
                      >
                        <span className="block text-[#0c0c0c]/60">{c.label}</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={/^#[0-9a-f]{6}$/i.test(c.value) ? c.value : '#000000'}
                            onChange={(e) => c.set(e.target.value)}
                            className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
                          />
                          <input
                            type="text"
                            value={c.value}
                            onChange={(e) => c.set(e.target.value)}
                            className="w-full min-w-0 font-mono text-[10px] text-[#0c0c0c]/85 focus:outline-none"
                          />
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Style Prompt */}
                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-[#0c0c0c]/80">
                    风格提示词
                  </span>
                  <textarea
                    rows={4}
                    maxLength={2000}
                    value={stylePrompt}
                    onChange={(e) => setStylePrompt(e.target.value)}
                    placeholder="请描述视觉氛围、布局、组件语言、图片风格，以及注意事项和禁忌。"
                    className="w-full rounded-xl border border-black/[0.12] bg-white p-3 text-xs leading-relaxed focus:border-[#4267ff] focus:outline-none"
                  />
                </label>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setTab('library')}
                    className="rounded-full border border-black/[0.12] px-4 py-1.5 text-xs font-medium text-[#0c0c0c]/75 hover:bg-black/[0.04] cursor-pointer"
                  >
                    返回列表
                  </button>
                  <button
                    type="submit"
                    className="rounded-full bg-[#4267ff] px-5 py-1.5 text-xs font-semibold text-white hover:bg-[#425ce1] cursor-pointer"
                  >
                    保存并应用主题
                  </button>
                </div>
              </div>

              {/* Right Mini Live Preview */}
              <div className="md:col-span-5 flex flex-col justify-between rounded-2xl border border-black/[0.08] bg-[#f3f3f0] p-4 space-y-3">
                <div className="flex items-center justify-between text-[11px] text-[#0c0c0c]/55">
                  <span>实时质感预览</span>
                  <div className="flex items-center gap-1">
                    {allPreviewColors.map((hex, i) => (
                      <span
                        key={i}
                        className="w-2.5 h-2.5 rounded-full border border-black/15"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>

                <div
                  className="flex-1 rounded-xl border p-5 flex flex-col justify-between gap-4 transition-colors"
                  style={{
                    backgroundColor: background,
                    color: textPrimary,
                    borderColor:
                      colorMode === 'dark'
                        ? 'rgba(255,255,255,0.12)'
                        : 'rgba(12,12,12,0.1)',
                    borderRadius:
                      radiusStyle === 'sharp'
                        ? '2px'
                        : radiusStyle === 'pill'
                          ? '18px'
                          : '10px',
                  }}
                >
                  <div className="space-y-2">
                    <div
                      className="text-[10px] uppercase tracking-[0.14em]"
                      style={{ color: accent }}
                    >
                      01 · EDITORIAL SPEC
                    </div>
                    <h4
                      className="text-xl font-semibold tracking-tight leading-snug"
                      style={{
                        fontFamily:
                          headingStyle === 'editorial-serif'
                            ? 'Georgia, "Songti SC", serif'
                            : 'system-ui, sans-serif',
                      }}
                    >
                      {name.trim() || '器物与风味的慢叙事'}
                    </h4>
                    <p
                      className="text-xs leading-relaxed"
                      style={{ color: textMuted }}
                    >
                      克制留白、精确字阶对比与单一焦点强调，呈现符合业务气质的高完成度体验。
                    </p>
                  </div>

                  <div
                    className="border p-3.5 space-y-2.5"
                    style={{
                      backgroundColor: surface,
                      borderColor:
                        colorMode === 'dark'
                          ? 'rgba(255,255,255,0.1)'
                          : 'rgba(12,12,12,0.08)',
                      borderRadius:
                        radiusStyle === 'sharp'
                          ? '2px'
                          : radiusStyle === 'pill'
                            ? '14px'
                            : '8px',
                    }}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">季度主推体验</span>
                      <span className="font-mono text-[11px]" style={{ color: accent }}>
                        14 / 20
                      </span>
                    </div>
                    <div
                      className="inline-flex items-center rounded-full px-3.5 py-1.5 text-[11px] font-medium"
                      style={{ backgroundColor: accent, color: '#ffffff' }}
                    >
                      立即预约席位
                    </div>
                  </div>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
