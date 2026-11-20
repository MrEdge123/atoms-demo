'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  ExternalLink,
  FolderKanban,
  Home,
  Layers,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { Project, StyleThemeSpec } from '@/domain';
import type { ModelInfo } from '@/ports';
import {
  AgentCluster,
  AtomsLogoMark,
  ModelDropdown,
  StatusPill,
} from './AtomsMark';
import { ProjectItemMenu } from './ProjectItemMenu';

export interface DemoIdeaPreset {
  label: string;
  category?: string;
  desc: string;
  tag: string;
  idea: string;
}

interface LauncherViewProps {
  projects: Project[];
  isLoadingProjects?: boolean;
  models: ModelInfo[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  idea: string;
  onIdeaChange: (value: string) => void;
  presets: DemoIdeaPreset[];
  activeTheme: StyleThemeSpec | null;
  onOpenThemeModal: () => void;
  busyAction: string;
  errorMsg: string;
  onSubmitIdea: (customIdea?: string) => void;
  onOpenProject: (projectId: string) => void;
  onCreateBlankProject: () => void;
  onRenameProject: (projectId: string, nextTitle: string) => Promise<boolean>;
  onDeleteProject: (projectId: string) => void | Promise<void>;
}

/**
 * Atoms-style Launcher view ("/zh/dashboard" pattern) featuring a collapsible
 * 270px left sidebar, three independent navigation views (Home, All Projects,
 * and Templates), warm-paper canvas, clean prompt composer, and project menus.
 */
export function LauncherView({
  projects,
  isLoadingProjects = false,
  models,
  selectedModel,
  onSelectModel,
  idea,
  onIdeaChange,
  presets,
  activeTheme,
  onOpenThemeModal,
  busyAction,
  errorMsg,
  onSubmitIdea,
  onOpenProject,
  onCreateBlankProject,
  onRenameProject,
  onDeleteProject,
}: LauncherViewProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeNav, setActiveNav] = useState<'home' | 'projects' | 'templates'>(
    'home'
  );
  const [homeTab, setHomeTab] = useState<'all' | 'projects' | 'templates'>(
    'all'
  );
  const [projectQuery, setProjectQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<
    'all' | 'published' | 'draft'
  >('all');
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateCategory, setTemplateCategory] = useState<string>('全部');

  const publishedCount = useMemo(
    () => projects.filter((p) => p.publishedVersion > 0).length,
    [projects]
  );
  const draftCount = projects.length - publishedCount;

  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    return projects.filter((p) => {
      if (projectFilter === 'published' && p.publishedVersion <= 0) {
        return false;
      }
      if (projectFilter === 'draft' && p.publishedVersion > 0) {
        return false;
      }
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        (p.plan?.summary ?? '').toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q)
      );
    });
  }, [projects, projectFilter, projectQuery]);

  const templateCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of presets) {
      cats.add(p.category || '其他');
    }
    return ['全部', ...Array.from(cats)];
  }, [presets]);

  const filteredTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    return presets.filter((preset) => {
      const cat = preset.category || '其他';
      if (templateCategory !== '全部' && cat !== templateCategory) {
        return false;
      }
      if (!q) return true;
      return (
        preset.label.toLowerCase().includes(q) ||
        preset.desc.toLowerCase().includes(q) ||
        preset.tag.toLowerCase().includes(q) ||
        preset.idea.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      );
    });
  }, [presets, templateCategory, templateQuery]);

  function renderProjectCard(p: Project, showSlugBadge = false) {
    return (
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
          {showSlugBadge && p.publishedVersion > 0 && (
            <div className="font-atoms-mono text-[10px] text-[#4267ff] bg-[#4267ff]/[0.06] rounded-md px-2 py-0.5 truncate w-fit max-w-full">
              /s/{p.slug}
            </div>
          )}
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
          <div className="flex items-center gap-1.5 shrink-0">
            {p.publishedVersion > 0 && (
              <a
                href={`/s/${p.slug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 rounded-full border border-black/[0.08] bg-white px-2 py-0.5 text-[10px] font-medium text-[#0c0c0c]/75 hover:text-[#4267ff] whitespace-nowrap shrink-0"
              >
                线上站
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
            <button
              type="button"
              onClick={() => onOpenProject(p.id)}
              className="rounded-full bg-[#0c0c0c] px-2.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#0c0c0c]/85 whitespace-nowrap shrink-0 cursor-pointer"
            >
              打开
            </button>
            <ProjectItemMenu
              projectId={p.id}
              title={p.title}
              publishedSlug={p.publishedVersion > 0 ? p.slug : null}
              isReadOnly={p.ownerSid === null}
              disableDelete={Boolean(busyAction)}
              onOpen={() => onOpenProject(p.id)}
              onRename={onRenameProject}
              onDelete={onDeleteProject}
              variant="card"
              alwaysVisible
            />
          </div>
        </div>
      </div>
    );
  }

  function renderProjectCardsSkeleton() {
    return (
      <div
        data-testid="launcher-projects-loading"
        className="grid grid-cols-1 md:grid-cols-3 gap-3"
      >
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            className="rounded-xl border border-black/[0.06] bg-[#fcfcfb] p-3.5 space-y-3 animate-pulse"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="h-3.5 w-1/2 rounded bg-black/[0.08]" />
              <div className="h-4 w-14 rounded-full bg-black/[0.06]" />
            </div>
            <div className="space-y-1.5">
              <div className="h-2.5 w-full rounded bg-black/[0.05]" />
              <div className="h-2.5 w-4/5 rounded bg-black/[0.05]" />
            </div>
            <div className="pt-2 border-t border-black/[0.04] flex items-center justify-between">
              <div className="h-2.5 w-16 rounded bg-black/[0.05]" />
              <div className="h-5 w-12 rounded-full bg-black/[0.07]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

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

          <nav className="px-3 space-y-0.5" aria-label="主导航">
            <button
              type="button"
              onClick={() => setActiveNav('home')}
              className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
                activeNav === 'home'
                  ? 'bg-black/[0.06] text-[#0c0c0c]'
                  : 'text-[#0c0c0c]/70 hover:bg-black/[0.04]'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              首页启动台
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('projects')}
              className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
                activeNav === 'projects'
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
              onClick={() => setActiveNav('templates')}
              className={`w-full flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer ${
                activeNav === 'templates'
                  ? 'bg-black/[0.06] text-[#0c0c0c]'
                  : 'text-[#0c0c0c]/70 hover:bg-black/[0.04]'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <Layers className="w-3.5 h-3.5" />
                场景模板
              </span>
              <span className="text-[11px] text-[#0c0c0c]/45 tabular-nums">
                {presets.length}
              </span>
            </button>
          </nav>

          <div className="mt-5 px-3 flex-1 min-h-0 flex flex-col">
            <div className="px-2 pb-1.5 text-[11px] font-medium text-[#0c0c0c]/45 flex items-center justify-between">
              <span>最近项目</span>
              <span className="tabular-nums">{projects.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {isLoadingProjects && projects.length === 0 ? (
                <div className="space-y-1.5 px-1 py-1">
                  <div className="text-[11px] text-[#0c0c0c]/45 px-1 pb-0.5">
                    正在加载项目...
                  </div>
                  {[0, 1, 2].map((idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-black/[0.05] bg-white/80 px-2.5 py-2 space-y-1.5 animate-pulse"
                    >
                      <div className="h-3 w-3/4 rounded bg-black/[0.07]" />
                      <div className="h-2.5 w-1/3 rounded-full bg-black/[0.05]" />
                    </div>
                  ))}
                </div>
              ) : projects.length === 0 ? (
                <p className="px-2 py-3 text-[11px] text-[#0c0c0c]/40">
                  暂无历史项目，在右侧输入一句话即可生成。
                </p>
              ) : (
                projects.map((p) => (
                  <div
                    key={p.id}
                    className="group flex items-center gap-1 rounded-xl px-2 py-1.5 hover:bg-black/[0.04] transition"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenProject(p.id)}
                      className="flex-1 min-w-0 text-left px-0.5 py-0.5 cursor-pointer"
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
                    <ProjectItemMenu
                      projectId={p.id}
                      title={p.title}
                      publishedSlug={p.publishedVersion > 0 ? p.slug : null}
                      isReadOnly={p.ownerSid === null}
                      disableDelete={Boolean(busyAction)}
                      onOpen={() => onOpenProject(p.id)}
                      onRename={onRenameProject}
                      onDelete={onDeleteProject}
                      variant="subtle"
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="p-3 border-t border-black/[0.06]">
            <div className="rounded-xl border border-black/[0.08] bg-white p-3 space-y-1">
              <div className="text-[11px] font-semibold text-[#0c0c0c]/85">
                全栈应用一键交付
              </div>
              <p className="text-[11px] text-[#0c0c0c]/50 leading-relaxed">
                内置账号认证、云端数据库持久化与一键公网发布，所见即所得
              </p>
            </div>
          </div>
        </aside>
      )}

      {/* Main Launcher Canvas */}
      <div className="flex-1 min-w-0 flex flex-col overflow-y-auto atoms-hero-glow">
        {/* Top Bar */}
        <header className="h-12 shrink-0 px-4 md:px-6 flex items-center justify-between md:grid md:grid-cols-[1fr_auto_1fr] gap-3">
          <div className="flex items-center gap-2.5 md:justify-self-start">
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
            {/* Compact mobile navigation fallback */}
            <div className="flex md:hidden items-center gap-1 rounded-full bg-black/[0.04] p-0.5">
              {(
                [
                  { id: 'home', label: '首页' },
                  { id: 'projects', label: '项目' },
                  { id: 'templates', label: '模板' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium cursor-pointer ${
                    activeNav === item.id
                      ? 'bg-white text-[#0c0c0c] shadow-xs'
                      : 'text-[#0c0c0c]/60'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="hidden md:inline-flex md:justify-self-center items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 backdrop-blur-sm px-3 py-1 text-[11px] font-medium text-[#0c0c0c]/75">
            <Sparkles className="w-3 h-3 text-[#4267ff]" />
            Iris · Emma · Alex 多智能体协作工作台
          </div>

          <div className="flex items-center gap-2 md:justify-self-end">
            <ModelDropdown
              models={models}
              selectedModel={selectedModel}
              onSelect={onSelectModel}
            />
          </div>
        </header>

        {activeNav === 'home' && (
          /* Home View: Centered Hero + Prompt Composer + Quick Access Strip */
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

              {/* Prompt Box */}
              <div className="pt-2 text-left">
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
                      {presets.slice(0, 3).map((preset) => (
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

                    <div className="flex items-center gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={onOpenThemeModal}
                        aria-label="选择或自定义 UI 风格主题"
                        className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-[#fcfcfb] px-3 py-1.5 text-[11px] font-medium text-[#0c0c0c]/80 hover:border-[#4267ff]/45 hover:text-[#4267ff] transition cursor-pointer"
                      >
                        <Palette className="w-3.5 h-3.5 text-[#4267ff]" />
                        <span>
                          {activeTheme ? `主题：${activeTheme.name}` : '主题：智能匹配'}
                        </span>
                        {activeTheme && (
                          <span className="inline-flex items-center -space-x-0.5 ml-0.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-black/15"
                              style={{ backgroundColor: activeTheme.palette.background }}
                            />
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-black/15"
                              style={{ backgroundColor: activeTheme.palette.accent }}
                            />
                          </span>
                        )}
                      </button>

                      <button
                        type="submit"
                        disabled={Boolean(busyAction) || !idea.trim()}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#4267ff] px-4 py-2 text-xs font-semibold text-white hover:bg-[#425ce1] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <span>{busyAction || '开始构建'}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </section>

            {/* Bottom Home Quick Access Strip (Independent from Sidebar Nav) */}
            <section className="rounded-2xl border border-black/[0.08] bg-white/90 p-5 space-y-4 shadow-[0_1px_6px_rgba(12,12,12,0.03)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center rounded-full bg-black/[0.04] p-0.5">
                  {[
                    { id: 'all', label: '推荐视图' },
                    { id: 'projects', label: `最近项目 (${projects.length})` },
                    { id: 'templates', label: '精选模板' },
                  ].map((tab) => {
                    const active = homeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() =>
                          setHomeTab(tab.id as 'all' | 'projects' | 'templates')
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

                <div className="flex items-center gap-3">
                  {homeTab === 'templates' ? (
                    <button
                      type="button"
                      onClick={() => setActiveNav('templates')}
                      className="text-xs font-medium text-[#4267ff] hover:underline cursor-pointer"
                    >
                      浏览全部模板 ({presets.length}) →
                    </button>
                  ) : projects.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setActiveNav('projects')}
                      className="text-xs font-medium text-[#4267ff] hover:underline cursor-pointer"
                    >
                      查看全部项目 ({projects.length}) →
                    </button>
                  ) : null}
                </div>
              </div>

              {(homeTab === 'all' || homeTab === 'projects') && (
                <div className="space-y-2.5">
                  {isLoadingProjects && projects.length === 0 ? (
                    <>
                      <div className="text-xs font-medium text-[#0c0c0c]/55">
                        正在加载最近项目...
                      </div>
                      {renderProjectCardsSkeleton()}
                    </>
                  ) : projects.length > 0 ? (
                    <>
                      <div className="flex items-center justify-between text-xs font-medium text-[#0c0c0c]/55">
                        <span>最近更新的项目</span>
                        {projects.length > 3 && (
                          <button
                            type="button"
                            onClick={() => setActiveNav('projects')}
                            className="text-[11px] text-[#4267ff] hover:underline cursor-pointer"
                          >
                            仅展示最近 3 个 · 展开全部
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {projects.slice(0, 3).map((p) => renderProjectCard(p, false))}
                      </div>
                    </>
                  ) : homeTab === 'projects' ? (
                    <div className="rounded-xl border border-dashed border-black/[0.1] bg-[#fcfcfb] p-6 text-center space-y-2">
                      <p className="text-xs text-[#0c0c0c]/60">
                        当前会话还没有保存的项目
                      </p>
                      <p className="text-[11px] text-[#0c0c0c]/45">
                        直接在上方输入应用想法并点击「开始构建」，或点击下方推荐场景一键填入。
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              {(homeTab === 'all' ||
                homeTab === 'templates' ||
                projects.length === 0) && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-medium text-[#0c0c0c]/55">
                    <span>快速场景模板（点击填入提示词）</span>
                    {homeTab === 'all' && presets.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setActiveNav('templates')}
                        className="text-[11px] text-[#4267ff] hover:underline cursor-pointer"
                      >
                        全部 {presets.length} 个模板 →
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {presets.slice(0, 3).map((preset) => (
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
        )}

        {activeNav === 'projects' && (
          /* Independent Page 2: All Projects Management View */
          <div className="flex-1 w-full max-w-[1040px] mx-auto px-4 md:px-8 pt-6 pb-12 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.06] pb-5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-2xl font-semibold tracking-tight text-[#0c0c0c]">
                    全部项目
                  </h1>
                  <span className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-xs font-medium text-[#0c0c0c]/70 tabular-nums">
                    {projects.length} 个项目
                  </span>
                </div>
                <p className="text-xs text-[#0c0c0c]/55">
                  集中管理当前会话创建的全部应用项目，支持按发布状态筛选、关键词检索、重命名及访问线上站点。
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveNav('home')}
                  className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0c0c0c]/80 hover:bg-black/[0.03] transition cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#4267ff]" />
                  去首页一句话生成
                </button>
                <button
                  type="button"
                  onClick={onCreateBlankProject}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#4267ff] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#425ce1] transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  新建空白项目
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-[#c9444a]/30 bg-[#c9444a]/10 px-3.5 py-2 text-xs text-[#b72027]">
                {errorMsg}
              </div>
            )}

            {/* Search & Status Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="w-3.5 h-3.5 text-[#0c0c0c]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  aria-label="搜索全部项目"
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="搜索项目名称、简介或站点路径..."
                  className="w-full rounded-xl border border-black/[0.1] bg-white pl-8 pr-8 py-2 text-xs text-[#0c0c0c] placeholder:text-[#0c0c0c]/35 focus:border-[#4267ff] focus:outline-none"
                />
                {projectQuery && (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => setProjectQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#0c0c0c]/40 hover:text-[#0c0c0c] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="inline-flex items-center rounded-full bg-black/[0.04] p-0.5 border border-black/[0.05]">
                {(
                  [
                    { id: 'all', label: `全部 (${projects.length})` },
                    { id: 'published', label: `已上线 (${publishedCount})` },
                    { id: 'draft', label: `草稿中 (${draftCount})` },
                  ] as const
                ).map((tab) => {
                  const active = projectFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setProjectFilter(tab.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
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
            </div>

            {isLoadingProjects && projects.length === 0 ? (
              renderProjectCardsSkeleton()
            ) : projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/[0.12] bg-white/80 p-10 text-center space-y-3">
                <FolderKanban className="w-8 h-8 text-[#0c0c0c]/25 mx-auto" />
                <div className="text-sm font-medium text-[#0c0c0c]/85">
                  还没有创建任何项目
                </div>
                <p className="text-xs text-[#0c0c0c]/50 max-w-md mx-auto leading-relaxed">
                  前往首页启动台输入一句话需求，或从场景模板出发，即可在工作台自动规划并生成全栈应用。
                </p>
                <div className="flex items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setActiveNav('home')}
                    className="rounded-full bg-[#4267ff] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#425ce1] cursor-pointer"
                  >
                    前往首页启动台
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveNav('templates')}
                    className="rounded-full border border-black/[0.1] bg-white px-4 py-1.5 text-xs font-medium text-[#0c0c0c]/75 hover:bg-black/[0.03] cursor-pointer"
                  >
                    浏览场景模板
                  </button>
                </div>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="rounded-2xl border border-black/[0.08] bg-white/90 p-8 text-center space-y-2.5">
                <p className="text-xs text-[#0c0c0c]/60">
                  没有符合当前搜索或状态筛选的项目
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setProjectQuery('');
                    setProjectFilter('all');
                  }}
                  className="rounded-full border border-black/[0.1] bg-white px-3.5 py-1 text-xs font-medium text-[#4267ff] hover:bg-[#4267ff]/[0.05] cursor-pointer"
                >
                  重置筛选条件
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {filteredProjects.map((p) => renderProjectCard(p, true))}
              </div>
            )}
          </div>
        )}

        {activeNav === 'templates' && (
          /* Independent Page 3: Scene Templates Library View */
          <div className="flex-1 w-full max-w-[1040px] mx-auto px-4 md:px-8 pt-6 pb-12 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.06] pb-5">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-2xl font-semibold tracking-tight text-[#0c0c0c]">
                    场景模板
                  </h1>
                  <span className="rounded-full bg-[#4267ff]/10 px-2.5 py-0.5 text-xs font-medium text-[#4267ff] tabular-nums">
                    {presets.length} 个精选场景
                  </span>
                </div>
                <p className="text-xs text-[#0c0c0c]/55">
                  覆盖活动预约、效率 SaaS 与品牌展陈等典型场景，支持填入首页微调需求，或直接由 AI 团队立即规划构建。
                </p>
              </div>

              <button
                type="button"
                onClick={() => setActiveNav('home')}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0c0c0c]/80 hover:bg-black/[0.03] transition cursor-pointer"
              >
                自定义想法
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-[#c9444a]/30 bg-[#c9444a]/10 px-3.5 py-2 text-xs text-[#b72027]">
                {errorMsg}
              </div>
            )}

            {/* Category Pills & Search */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {templateCategories.map((cat) => {
                  const active = templateCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setTemplateCategory(cat)}
                      className={`rounded-full px-3.5 py-1 text-xs font-medium transition cursor-pointer ${
                        active
                          ? 'bg-[#0c0c0c] text-white'
                          : 'border border-black/[0.08] bg-white text-[#0c0c0c]/65 hover:text-[#0c0c0c]'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>

              <div className="relative min-w-[220px] w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-[#0c0c0c]/40 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  aria-label="搜索场景模板"
                  value={templateQuery}
                  onChange={(e) => setTemplateQuery(e.target.value)}
                  placeholder="搜索场景、功能关键词..."
                  className="w-full rounded-xl border border-black/[0.1] bg-white pl-8 pr-8 py-1.5 text-xs text-[#0c0c0c] placeholder:text-[#0c0c0c]/35 focus:border-[#4267ff] focus:outline-none"
                />
                {templateQuery && (
                  <button
                    type="button"
                    aria-label="清空模板搜索"
                    onClick={() => setTemplateQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#0c0c0c]/40 hover:text-[#0c0c0c] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {filteredTemplates.length === 0 ? (
              <div className="rounded-2xl border border-black/[0.08] bg-white/90 p-8 text-center space-y-2.5">
                <p className="text-xs text-[#0c0c0c]/60">
                  没有匹配当前分类或关键词的场景模板
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setTemplateCategory('全部');
                    setTemplateQuery('');
                  }}
                  className="rounded-full border border-black/[0.1] bg-white px-3.5 py-1 text-xs font-medium text-[#4267ff] hover:bg-[#4267ff]/[0.05] cursor-pointer"
                >
                  显示全部模板
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTemplates.map((preset) => (
                  <div
                    key={preset.label}
                    className="rounded-2xl border border-black/[0.08] bg-white p-4 flex flex-col justify-between gap-4 shadow-[0_1px_4px_rgba(12,12,12,0.03)] hover:border-[#4267ff]/35 transition"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-[#0c0c0c]/50">
                          {preset.category || '精选场景'}
                        </span>
                        <span className="rounded-full bg-[#4267ff]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#4267ff] whitespace-nowrap">
                          {preset.tag}
                        </span>
                      </div>
                      <h2 className="text-sm font-semibold text-[#0c0c0c]/95">
                        {preset.label}
                      </h2>
                      <p className="text-xs text-[#0c0c0c]/60 leading-relaxed">
                        {preset.desc}
                      </p>
                      <div className="rounded-xl bg-[#f8f8f6] border border-black/[0.05] p-2.5 text-[11px] text-[#0c0c0c]/65 leading-relaxed line-clamp-3">
                        “{preset.idea}”
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/[0.06]">
                      <button
                        type="button"
                        onClick={() => {
                          onIdeaChange(preset.idea);
                          setActiveNav('home');
                        }}
                        className="rounded-full border border-black/[0.1] bg-white px-3 py-1.5 text-[11px] font-medium text-[#0c0c0c]/80 hover:bg-black/[0.03] transition cursor-pointer"
                      >
                        填入并微调
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => onSubmitIdea(preset.idea)}
                        className="inline-flex items-center gap-1 rounded-full bg-[#4267ff] px-3.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#425ce1] disabled:opacity-45 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        <span>{busyAction ? '启动中...' : '立即构建'}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
