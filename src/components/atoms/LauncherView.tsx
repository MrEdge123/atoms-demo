'use client';

import React, { useState } from 'react';
import {
  ArrowRight,
  Clock,
  ExternalLink,
  FolderKanban,
  Home,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { Project } from '@/domain';
import type { ModelInfo } from '@/ports';
import {
  AgentCluster,
  AtomsLogoMark,
  ModelDropdown,
  StatusPill,
} from './AtomsMark';

export interface DemoIdeaPreset {
  label: string;
  desc: string;
  tag: string;
  idea: string;
}

interface LauncherViewProps {
  projects: Project[];
  models: ModelInfo[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  idea: string;
  onIdeaChange: (value: string) => void;
  presets: DemoIdeaPreset[];
  busyAction: string;
  errorMsg: string;
  onSubmitIdea: () => void;
  onOpenProject: (projectId: string) => void;
  onCreateBlankProject: () => void;
  onDeleteProject: (projectId: string) => void;
}

/**
 * Atoms-style Launcher view ("/zh/dashboard" pattern) featuring a collapsible
 * 270px left sidebar, warm-paper canvas, notched 720px composer, starter cards,
 * and recent project grid.
 */
export function LauncherView({
  projects,
  models,
  selectedModel,
  onSelectModel,
  idea,
  onIdeaChange,
  presets,
  busyAction,
  errorMsg,
  onSubmitIdea,
  onOpenProject,
  onCreateBlankProject,
  onDeleteProject,
}: LauncherViewProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [feedTab, setFeedTab] = useState<'all' | 'projects' | 'templates'>(
    'all'
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className="h-screen flex bg-[#fcfcfb] text-[#0c0c0c]/95 overflow-hidden">
      {/* Collapsible 270px Sidebar */}
      {sidebarOpen && (
        <aside className="hidden md:flex w-[270px] shrink-0 flex-col border-r border-black/[0.08] bg-[#f8f8f6]">
          <div className="h-12 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-sm tracking-tight">
              <AtomsLogoMark size={20} />
              <span>Mini Atoms</span>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="收起侧边栏"
              className="rounded-lg p-1.5 text-[#0c0c0c]/50 hover:bg-black/[0.05] hover:text-[#0c0c0c] cursor-pointer"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={onCreateBlankProject}
              className="w-full flex items-center justify-between rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-xs font-medium text-[#0c0c0c]/90 hover:bg-[#fcfcfb] shadow-[0_1px_2px_rgba(12,12,12,0.03)] transition cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <Plus className="w-3.5 h-3.5 text-[#4267ff]" />
                新建空白项目
              </span>
              <span className="text-[10px] text-[#0c0c0c]/45">工作台</span>
            </button>
          </div>

          <nav className="px-3 space-y-0.5">
            <button
              type="button"
              onClick={() => setFeedTab('all')}
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
                feedTab === 'all'
                  ? 'bg-black/[0.06] text-[#0c0c0c]'
                  : 'text-[#0c0c0c]/70 hover:bg-black/[0.04]'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              首页启动台
            </button>
            <button
              type="button"
              onClick={() => setFeedTab('projects')}
              className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
                feedTab === 'projects'
                  ? 'bg-black/[0.06] text-[#0c0c0c]'
                  : 'text-[#0c0c0c]/70 hover:bg-black/[0.04]'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <FolderKanban className="w-3.5 h-3.5" />
                全部项目
              </span>
              <span className="text-[11px] text-[#0c0c0c]/45 tabular-nums">
                {projects.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFeedTab('templates')}
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
                feedTab === 'templates'
                  ? 'bg-black/[0.06] text-[#0c0c0c]'
                  : 'text-[#0c0c0c]/70 hover:bg-black/[0.04]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              场景模板
            </button>
          </nav>

          <div className="mt-5 px-3 flex-1 min-h-0 flex flex-col">
            <div className="px-2 pb-1.5 text-[11px] font-medium text-[#0c0c0c]/45 flex items-center justify-between">
              <span>最近项目</span>
              <span className="tabular-nums">{projects.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {projects.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-[#0c0c0c]/40">
                  暂无历史项目，在右侧输入一句话即可生成。
                </p>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onOpenProject(p.id)}
                    className="w-full text-left rounded-xl px-2.5 py-2 hover:bg-black/[0.04] transition group cursor-pointer"
                  >
                    <div className="text-xs font-medium text-[#0c0c0c]/85 truncate group-hover:text-[#0c0c0c]">
                      {p.title}
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <StatusPill
                        status={p.status}
                        publishedVersion={p.publishedVersion}
                      />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="p-3 border-t border-black/[0.06]">
            <div className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-1">
              <div className="text-[11px] font-semibold text-[#0c0c0c]/85">
                Route A+ 本地全栈闭环
              </div>
              <p className="text-[11px] text-[#0c0c0c]/50 leading-relaxed">
                内存 Esbuild 编译 · PGlite 持久化 · 真实 SEO/OG 与 Mock/Creem 收银台
              </p>
            </div>
          </div>
        </aside>
      )}

      {/* Main Launcher Canvas */}
      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto atoms-hero-glow">
        {/* Top Bar */}
        <header className="h-12 shrink-0 px-4 md:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="展开侧边栏"
                className="rounded-lg p-1.5 text-[#0c0c0c]/55 hover:bg-black/[0.05] cursor-pointer"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}
            <div className="md:hidden flex items-center gap-2 font-semibold text-sm">
              <AtomsLogoMark size={20} />
              <span>Mini Atoms</span>
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 backdrop-blur-sm px-3 py-1 text-[11px] font-medium text-[#0c0c0c]/75">
            <Sparkles className="w-3 h-3 text-[#4267ff]" />
            Iris · Emma · Alex 多智能体协作工作台
          </div>

          <div className="flex items-center gap-2">
            <ModelDropdown
              models={models}
              selectedModel={selectedModel}
              onSelect={onSelectModel}
            />
          </div>
        </header>

        {/* Centered Hero + Notched Composer */}
        <div className="flex-1 w-full max-w-[920px] mx-auto px-4 md:px-8 pt-8 md:pt-12 pb-12 space-y-10">
          <section className="max-w-[720px] mx-auto text-center space-y-4">
            <AgentCluster />
            <h1 className="text-3xl md:text-[40px] font-medium tracking-tight text-[#0c0c0c]/95 leading-tight">
              你想用 AI 团队创造什么？
            </h1>
            <p className="text-sm text-[#0c0c0c]/55">
              一句话启动 Iris 深度调研与 Emma 产品规划，审阅确认后由 Alex 编码构建并一键发布。
            </p>

            {errorMsg && (
              <div className="rounded-xl border border-[#c9444a]/30 bg-[#c9444a]/10 px-3.5 py-2 text-xs text-[#b72027] text-left">
                {errorMsg}
              </div>
            )}

            {/* Notched Prompt Box matching Atoms /zh/dashboard */}
            <div className="pt-2 text-left">
              <div className="flex justify-end pr-4">
                <div className="inline-flex items-center gap-1.5 rounded-t-xl border border-b-0 border-black/[0.1] bg-[#f8f8f6] px-3 py-1 text-[11px] font-medium text-[#0c0c0c]/65">
                  <span>@atoms/cloud 已就绪</span>
                  <span className="rounded-full bg-[#4267ff]/12 px-1.5 py-0.2 text-[10px] text-[#4267ff]">
                    DB · Auth · Billing
                  </span>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onSubmitIdea();
                }}
                className="atoms-composer rounded-[24px] p-4 space-y-3"
              >
                <textarea
                  rows={3}
                  value={idea}
                  onChange={(e) => onIdeaChange(e.target.value)}
                  placeholder="请描述你想搭建的应用，例如：做一个科技沙龙活动报名与现场签到站，支持 Pro 会员导出 CSV..."
                  className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[#0c0c0c]/95 placeholder:text-[#0c0c0c]/30 focus:outline-none"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {presets.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => onIdeaChange(preset.idea)}
                        className="rounded-full border border-black/[0.08] bg-[#f8f8f6] px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/75 hover:bg-black/[0.05] transition cursor-pointer"
                      >
                        + {preset.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="submit"
                    disabled={Boolean(busyAction) || !idea.trim()}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#4267ff] px-4 py-2 text-xs font-semibold text-white hover:bg-[#425ce1] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>{busyAction || '开始构建'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            </div>
          </section>

          {/* Bottom Bento Section: Projects & Templates */}
          <section className="rounded-2xl border border-black/[0.08] bg-white/90 p-5 space-y-4 shadow-[0_1px_6px_rgba(12,12,12,0.03)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center rounded-full bg-black/[0.04] p-0.5">
                {[
                  { id: 'all', label: '推荐视图' },
                  { id: 'projects', label: `我的项目 (${projects.length})` },
                  { id: 'templates', label: '场景灵感' },
                ].map((tab) => {
                  const active = feedTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() =>
                        setFeedTab(tab.id as 'all' | 'projects' | 'templates')
                      }
                      className={`rounded-full px-3.5 py-1 text-xs font-medium transition cursor-pointer ${
                        active
                          ? 'bg-white text-[#0c0c0c] shadow-[0_1px_2px_rgba(12,12,12,0.06)]'
                          : 'text-[#0c0c0c]/60 hover:text-[#0c0c0c]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {projects[0] && (
                <button
                  type="button"
                  onClick={() => onOpenProject(projects[0].id)}
                  className="text-xs font-medium text-[#4267ff] hover:underline cursor-pointer"
                >
                  继续最近项目 →
                </button>
              )}
            </div>

            {(feedTab === 'all' || feedTab === 'projects') &&
              projects.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs font-medium text-[#0c0c0c]/55">
                    最近项目
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {projects.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-xl border border-black/[0.08] bg-[#fcfcfb] p-3.5 flex flex-col justify-between gap-3 hover:border-[#4267ff]/40 transition"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => onOpenProject(p.id)}
                              className="min-w-0 flex-1 text-left text-xs font-semibold text-[#0c0c0c]/95 hover:text-[#4267ff] truncate cursor-pointer"
                            >
                              {p.title}
                            </button>
                            <StatusPill
                              status={p.status}
                              publishedVersion={p.publishedVersion}
                            />
                          </div>
                          <p className="text-[11px] text-[#0c0c0c]/55 line-clamp-2 leading-relaxed">
                            {p.plan?.summary ?? '点击打开工作台继续规划或构建'}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-black/[0.05]">
                          <span
                            suppressHydrationWarning
                            className="inline-flex items-center gap-1 text-[10px] text-[#0c0c0c]/40"
                          >
                            <Clock className="w-3 h-3" />
                            {new Date(p.updatedAt).toLocaleDateString('zh-CN')}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {confirmDeleteId === p.id ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmDeleteId(null);
                                    onDeleteProject(p.id);
                                  }}
                                  className="rounded-full bg-[#c9444a] px-2 py-0.5 text-[10px] font-medium text-white hover:bg-[#b72027] cursor-pointer"
                                >
                                  确认删除
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="rounded-full border border-black/[0.08] bg-white px-2 py-0.5 text-[10px] text-[#0c0c0c]/65 hover:text-[#0c0c0c] cursor-pointer"
                                >
                                  取消
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  aria-label={`删除 ${p.title}`}
                                  onClick={() => setConfirmDeleteId(p.id)}
                                  className="rounded-full p-1 text-[#0c0c0c]/40 hover:bg-[#c9444a]/10 hover:text-[#b72027] transition cursor-pointer"
                                  title="删除项目"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                                {p.publishedVersion > 0 && (
                                  <a
                                    href={`/s/${p.slug}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-0.5 rounded-full border border-black/[0.08] bg-white px-2 py-0.5 text-[10px] font-medium text-[#0c0c0c]/75 hover:text-[#4267ff]"
                                  >
                                    线上站
                                    <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onOpenProject(p.id)}
                                  className="rounded-full bg-[#0c0c0c] px-2.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#0c0c0c]/85 cursor-pointer"
                                >
                                  打开
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {(feedTab === 'all' ||
              feedTab === 'templates' ||
              projects.length === 0) && (
              <div className="space-y-2.5">
                <div className="text-xs font-medium text-[#0c0c0c]/55">
                  快速场景模板（点击一键填入提示词）
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {presets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onIdeaChange(preset.idea)}
                      className="text-left rounded-xl border border-black/[0.08] bg-[#f8f8f6] p-3.5 space-y-2 hover:bg-white hover:border-[#4267ff]/35 transition cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-[#0c0c0c]/90 truncate">
                          {preset.label}
                        </span>
                        <span className="rounded-full bg-white border border-black/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#4267ff] whitespace-nowrap shrink-0">
                          {preset.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#0c0c0c]/55 leading-relaxed">
                        {preset.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
