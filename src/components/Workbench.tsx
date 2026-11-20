'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FolderPlus,
  Home,
  LayoutGrid,
  Loader2,
  Monitor,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Share2,
  Smartphone,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type {
  AgentEvent,
  AgentMentionSpan,
  CloudCapability,
  CompileError,
  DesignScenarioId,
  ProductPlan,
  Project,
  StyleThemeSpec,
} from '@/domain';
import type { ModelInfo } from '@/ports';
import {
  BUILTIN_STYLE_THEMES,
  DESIGN_SCENARIOS,
  applyThemeToDesignSystem,
  isSameThemeContent,
  migrateLegacyStyleTheme,
} from '@/core';
import {
  getMutationBlockReason,
  hasPendingRaceSelection as checkPendingRaceSelection,
  isBuildingInProgress,
  isPendingPlanConfirmation,
  isPlanningInProgress,
} from '@/core/guards';
import { CloudDataPanel } from './CloudDataPanel';
import {
  AgentBadge,
  AgentCluster,
  AtomsLogoMark,
  ModelDropdown,
  StatusPill,
} from './atoms/AtomsMark';
import { RichMentionText } from './atoms/AgentMentionChip';
import { GoodPathCard } from './atoms/GoodPathCard';
import { LauncherView, type DemoIdeaPreset } from './atoms/LauncherView';
import {
  MentionComposerInput,
  type ComposerValue,
} from './atoms/MentionComposerInput';
import { ProjectItemMenu } from './atoms/ProjectItemMenu';
import { SharePublishPopover } from './atoms/SharePublishPopover';
import { StyleThemeModal } from './atoms/StyleThemeModal';
import { TimelineStream } from './atoms/TimelineStream';
import { workbenchFetch } from '@/lib/workbench-fetch';

const CUSTOM_THEMES_STORAGE_KEY = 'atoms_custom_style_themes_v1';

interface ProjectSnapshotResponse {
  project: Project;
  events: AgentEvent[];
  previewHtml: string | null;
  compileErrors: CompileError[];
  qrDataUrl: string | null;
  publicUrl: string | null;
}

const DEMO_IDEAS: DemoIdeaPreset[] = [
  {
    label: '活动报名与签到站',
    category: '活动与预约',
    tag: '报名 · 签到 · CSV',
    desc: '含参会者注册登录、活动日程、在线报名与现场签到状态切换，支持 Pro 会员导出 CSV。',
    idea: '做一个科技沙龙活动报名与现场签到管理系统，支持参会者注册登录、报名表单提交、签到状态切换与 Pro 会员 CSV 导出。',
  },
  {
    label: 'PulseCRM 轻量客户台',
    category: '效率与 SaaS',
    tag: '线索 · 筛选 · 导出',
    desc: '面向独立顾问的客户线索录入、跟进阶段管理、关键词搜索筛选与 Pro 导出。',
    idea: '做一个独立顾问用的轻量 CRM 客户跟进台，支持线索录入、跟进状态管理、搜索筛选和 Pro 会员导出。',
  },
  {
    label: 'InkVault 云端笔记站',
    category: '效率与 SaaS',
    tag: '认证 · 笔记 · 导出',
    desc: '支持终端账号隔离、标签分类搜索、笔记持久化存储与 Pro 高级导出。',
    idea: '做一个支持账号隔离、标签搜索与 Pro 会员高级导出的云端个人笔记站。',
  },
  {
    label: '精品咖啡烘焙品鉴预约',
    category: '内容与品牌',
    tag: '菜单 · 预约 · 会员',
    desc: '暖色调品牌展陈首页，含当季单品豆单、线下杯测席位预约与品鉴笔记会员记录。',
    idea: '做一个温暖克制的精品咖啡烘焙工坊官网与线下品鉴预约站，包含当季手冲豆单展示、线上杯测席位预约表单与会员收藏记录。',
  },
  {
    label: '独立设计师作品集与约稿',
    category: '内容与品牌',
    tag: '作品集 · 询单 · 表单',
    desc: '高留白画册级案例展示站，支持服务报价方案对比与客户商业合作询单沉淀。',
    idea: '做一个高留白编辑风的独立设计师个人作品集与商业约稿站，展示精选设计案例、服务档位说明与客户合作意向提交表单。',
  },
  {
    label: '团队周报与 OKR 看板',
    category: '效率与 SaaS',
    tag: '目标 · 进度 · 协作',
    desc: '按季度维度管理关键目标、更新进度打分与团队成员周报归档与筛选。',
    idea: '做一个小微团队使用的季度 OKR 进度与周报协作看板，支持成员注册登录、目标拆解、周报提交、状态筛选与数据导出。',
  },
];

const ALL_CAPABILITIES: Array<{ id: CloudCapability; label: string }> = [
  { id: 'db', label: 'DB 持久化' },
  { id: 'auth', label: 'Auth 账号' },
  { id: 'billing', label: 'Billing 订阅' },
  { id: 'ai', label: 'AI 代理' },
];

function extractSseError(ev: AgentEvent): string | null {
  if (
    ev.type === 'error' &&
    ev.payload &&
    typeof (ev.payload as { message?: unknown }).message === 'string'
  ) {
    return (ev.payload as { message: string }).message;
  }
  return null;
}

async function readSseStream(
  res: Response,
  onEvent: (ev: AgentEvent) => void
): Promise<void> {
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed?.error) {
        message = parsed.error;
      }
    } catch {
      // Keep raw text error when not JSON
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const parsed = JSON.parse(line.slice(6)) as AgentEvent;
        onEvent(parsed);
      } catch {
        // Ignore malformed SSE chunks
      }
    }
  }
}

export function Workbench() {
  const [viewMode, setViewMode] = useState<'launcher' | 'workspace'>('launcher');
  const [workspaceSidebarOpen, setWorkspaceSidebarOpen] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshotResponse | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');

  const [launcherIdea, setLauncherIdea] = useState(DEMO_IDEAS[0].idea);
  const [composerMode, setComposerMode] = useState<'iterate' | 'restart'>(
    'restart'
  );
  const [composerValue, setComposerValue] = useState<ComposerValue>({
    text: '',
    mentions: [],
  });
  const [buildMode, setBuildMode] = useState<'linear' | 'race'>('linear');
  const [editablePlan, setEditablePlan] = useState<ProductPlan | null>(null);
  const [optimisticPrompt, setOptimisticPrompt] = useState<{
    projectId: string;
    text: string;
    mentions?: AgentMentionSpan[];
    timestamp: string;
  } | null>(null);
  const [confirmedPlanExpanded, setConfirmedPlanExpanded] = useState(false);
  const [targetAgent, setTargetAgent] = useState<
    'auto' | 'emma' | 'iris' | 'alex'
  >('auto');

  const [customThemes, setCustomThemes] = useState<StyleThemeSpec[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string>('auto');
  const [themeModalMode, setThemeModalMode] = useState<'launcher' | 'emma' | null>(
    null
  );

  const [busyAction, setBusyAction] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [runtimeError, setRuntimeError] = useState<string>('');

  const [rightTab, setRightTab] = useState<
    'preview' | 'code' | 'cloud' | 'overview'
  >('preview');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileFilter, setFileFilter] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [renamingProject, setRenamingProject] = useState(false);
  const [renameTitleInput, setRenameTitleInput] = useState('');
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<
    string | null
  >(null);
  const [shareOpen, setShareOpen] = useState(false);

  const [isEditingCode, setIsEditingCode] = useState(false);
  const [codeDraft, setCodeDraft] = useState('');
  const [savingCode, setSavingCode] = useState(false);
  const [codeSaveBanner, setCodeSaveBanner] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [codeCompileErrors, setCodeCompileErrors] = useState<CompileError[]>(
    []
  );

  const projectMenuRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const snapshotSeqRef = useRef(0);
  const listVersionRef = useRef(0);
  const hasAcceptedSnapshotRef = useRef(false);
  const modelsLoadedRef = useRef(false);
  const planBaselineDsRef = useRef<{
    projectId: string;
    ds: NonNullable<ProductPlan['designSystem']>;
  } | null>(null);
  const unparseableCustomThemesRef = useRef<unknown[]>([]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
      if (!raw) return;
      const parsedJson = JSON.parse(raw);
      if (!Array.isArray(parsedJson)) return;
      const reservedIds = new Set([
        'auto',
        ...BUILTIN_STYLE_THEMES.map((t) => t.id),
      ]);
      const valid: StyleThemeSpec[] = [];
      const preservedInvalid: unknown[] = [];
      for (let i = 0; i < parsedJson.length; i += 1) {
        const migrated = migrateLegacyStyleTheme(parsedJson[i]);
        if (migrated) {
          let id = migrated.id;
          if (reservedIds.has(id)) {
            id = `custom-local-${Date.now().toString(36)}-${i}`;
          }
          reservedIds.add(id);
          valid.push({ ...migrated, id, isCustom: true });
        } else {
          preservedInvalid.push(parsedJson[i]);
        }
      }
      unparseableCustomThemesRef.current = preservedInvalid;
      setCustomThemes(valid);
    } catch {
      // Ignore invalid localStorage payload
    }
  }, []);

  const allThemes = useMemo(
    () => [...BUILTIN_STYLE_THEMES, ...customThemes],
    [customThemes]
  );

  const activeTheme = useMemo(
    () =>
      selectedThemeId === 'auto'
        ? null
        : allThemes.find((t) => t.id === selectedThemeId) ?? null,
    [allThemes, selectedThemeId]
  );

  function persistCustomThemes(next: StyleThemeSpec[]) {
    setCustomThemes(next);
    try {
      window.localStorage.setItem(
        CUSTOM_THEMES_STORAGE_KEY,
        JSON.stringify([...next, ...unparseableCustomThemesRef.current])
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  function handleSaveCustomTheme(theme: StyleThemeSpec) {
    const reserved = new Set([
      'auto',
      ...BUILTIN_STYLE_THEMES.map((t) => t.id),
    ]);
    const safeId = reserved.has(theme.id)
      ? `custom-${Date.now().toString(36)}`
      : theme.id;
    const normalized: StyleThemeSpec = { ...theme, id: safeId, isCustom: true };
    const next = [normalized, ...customThemes.filter((t) => t.id !== safeId)];
    persistCustomThemes(next);
  }

  function handleDeleteCustomTheme(themeId: string) {
    const next = customThemes.filter((t) => t.id !== themeId);
    persistCustomThemes(next);
    if (selectedThemeId === themeId) {
      setSelectedThemeId('auto');
    }
  }

  function handleImportCustomThemes(imported: StyleThemeSpec[]) {
    const usedIds = new Set([
      'auto',
      ...BUILTIN_STYLE_THEMES.map((t) => t.id),
      ...customThemes.map((t) => t.id),
    ]);
    const existingAndAccepted: StyleThemeSpec[] = [...customThemes];
    const accepted: StyleThemeSpec[] = [];
    imported.forEach((item, idx) => {
      if (existingAndAccepted.some((existing) => isSameThemeContent(existing, item))) {
        return;
      }
      let safeId = item.id.trim();
      if (!safeId || usedIds.has(safeId)) {
        safeId = `custom-import-${Date.now().toString(36)}-${idx}`;
      }
      usedIds.add(safeId);
      const normalized: StyleThemeSpec = { ...item, id: safeId, isCustom: true };
      accepted.push(normalized);
      existingAndAccepted.push(normalized);
    });
    if (accepted.length > 0) {
      persistCustomThemes([...accepted, ...customThemes]);
    }
  }

  function handleApplyThemeSelection(theme: StyleThemeSpec | null) {
    if (themeModalMode === 'emma' && editablePlan) {
      if (!theme) {
        if (!editablePlan.designSystem?.themeId) {
          return;
        }
        const baseline =
          activeId && planBaselineDsRef.current?.projectId === activeId
            ? planBaselineDsRef.current.ds
            : null;
        setEditablePlan({
          ...editablePlan,
          designSystem: applyThemeToDesignSystem(
            editablePlan.designSystem,
            null,
            baseline
          ),
        });
        return;
      }

      if (
        activeId &&
        editablePlan.designSystem &&
        !editablePlan.designSystem.themeId
      ) {
        planBaselineDsRef.current = {
          projectId: activeId,
          ds: {
            ...editablePlan.designSystem,
            palette: { ...editablePlan.designSystem.palette },
            typography: { ...editablePlan.designSystem.typography },
            antiPatterns: [...editablePlan.designSystem.antiPatterns],
          },
        };
      }
      const baseline =
        activeId && planBaselineDsRef.current?.projectId === activeId
          ? planBaselineDsRef.current.ds
          : null;
      setEditablePlan({
        ...editablePlan,
        designSystem: applyThemeToDesignSystem(
          editablePlan.designSystem,
          theme,
          baseline
        ),
      });
      return;
    }
    setSelectedThemeId(theme ? theme.id : 'auto');
  }

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        projectMenuRef.current &&
        !projectMenuRef.current.contains(e.target as Node)
      ) {
        setProjectMenuOpen(false);
        setRenamingProject(false);
        setConfirmDeleteProjectId(null);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const loadSnapshot = useCallback(
    async (
      projectId: string
    ): Promise<{ data: ProjectSnapshotResponse | null; superseded: boolean }> => {
      if (activeIdRef.current && activeIdRef.current !== projectId) {
        return { data: null, superseded: true };
      }
      const reqSeq = ++snapshotSeqRef.current;
      const res = await workbenchFetch(`/api/projects/${projectId}`, {
        cache: 'no-store',
      });
      const staleAfterFetch = () =>
        reqSeq !== snapshotSeqRef.current ||
        (Boolean(activeIdRef.current) && activeIdRef.current !== projectId);
      if (staleAfterFetch()) {
        return { data: null, superseded: true };
      }
      if (!res.ok) {
        return { data: null, superseded: false };
      }
      const data = (await res.json()) as ProjectSnapshotResponse;
      if (staleAfterFetch()) {
        return { data: null, superseded: true };
      }
      setSnapshot(data);
      setEvents(data.events);
      setEditablePlan(data.project.plan);
      if (
        data.project.plan?.designSystem &&
        !data.project.plan.designSystem.themeId
      ) {
        planBaselineDsRef.current = {
          projectId: data.project.id,
          ds: data.project.plan.designSystem,
        };
      } else if (planBaselineDsRef.current?.projectId !== data.project.id) {
        planBaselineDsRef.current = null;
      }
      if (!hasAcceptedSnapshotRef.current) {
        hasAcceptedSnapshotRef.current = true;
        const draftCount = Object.keys(data.project.draftFiles).length;
        setComposerMode(draftCount > 0 ? 'iterate' : 'restart');
      }

      const fileKeys = Object.keys(data.project.draftFiles);
      if (fileKeys.length > 0) {
        setSelectedFile((prev) =>
          prev && fileKeys.includes(prev)
            ? prev
            : fileKeys.includes('src/App.tsx')
              ? 'src/App.tsx'
              : fileKeys[0]
        );
      } else {
        setSelectedFile('');
      }
      return { data, superseded: false };
    },
    []
  );

  const refreshProjectsList = useCallback(
    async (
      preferredId?: string | null,
      retryDepth = 0
    ): Promise<{ projects: Project[]; targetId: string | null }> => {
      const reqVersion = listVersionRef.current;
      try {
        const projPromise = workbenchFetch('/api/projects', { cache: 'no-store' });
        const modelPromise = modelsLoadedRef.current
          ? null
          : workbenchFetch('/api/models', { cache: 'no-store' });
        const [projRes, modelRes] = await Promise.all([projPromise, modelPromise]);
        if (modelRes && modelRes.ok) {
          modelsLoadedRef.current = true;
          const mData = (await modelRes.json()) as { models: ModelInfo[] };
          setModels(mData.models);
          setSelectedModel((prev) => prev || mData.models[0]?.id || 'mock-default');
        }
        if (projRes.ok) {
          const pData = (await projRes.json()) as { projects: Project[] };
          if (reqVersion !== listVersionRef.current) {
            if (retryDepth < 1) {
              return refreshProjectsList(preferredId, retryDepth + 1);
            }
            return { projects: pData.projects, targetId: null };
          }
          setProjects(pData.projects);
          const targetId =
            preferredId && pData.projects.some((p) => p.id === preferredId)
              ? preferredId
              : pData.projects[0]?.id ?? null;
          return { projects: pData.projects, targetId };
        }
        return { projects: [] as Project[], targetId: null };
      } finally {
        if (reqVersion === listVersionRef.current) {
          setProjectsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void refreshProjectsList();
  }, [refreshProjectsList]);

  useEffect(() => {
    function handleFrameMessage(event: MessageEvent) {
      const payload = event.data as { type?: string; message?: unknown } | null;
      if (
        payload?.type === 'ATOMS_RUNTIME_ERROR' &&
        typeof payload.message === 'string' &&
        payload.message.length > 0
      ) {
        setRuntimeError(payload.message);
      }
    }
    window.addEventListener('message', handleFrameMessage);
    return () => window.removeEventListener('message', handleFrameMessage);
  }, []);

  const project = snapshot?.project ?? null;
  const activeProjectMeta = useMemo(
    () => (activeId ? projects.find((p) => p.id === activeId) ?? null : null),
    [activeId, projects]
  );
  const displayProject = project ?? activeProjectMeta;
  const isLoadingProject = Boolean(
    activeId && loadingProjectId === activeId && !snapshot
  );
  const draftFiles = useMemo(() => project?.draftFiles ?? {}, [project]);
  const fileNames = useMemo(() => Object.keys(draftFiles), [draftFiles]);
  const filteredFileNames = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return fileNames;
    return fileNames.filter((f) => f.toLowerCase().includes(q));
  }, [fileNames, fileFilter]);

  const hasDraft = fileNames.length > 0;
  const raceBranches = project?.raceBranches ?? [];
  const hasPendingPlanConfirmation = project
    ? isPendingPlanConfirmation(project)
    : false;
  const isPlanning = project ? isPlanningInProgress(project) : false;
  const isBuilding = project ? isBuildingInProgress(project) : false;
  const hasPendingRaceSelection = project
    ? checkPendingRaceSelection(project)
    : false;
  const iterateBlockReason = project
    ? getMutationBlockReason(project, 'iterate')
    : null;
  const publishBlockReason = project
    ? getMutationBlockReason(project, 'publish')
    : null;
  const isMutationLocked = Boolean(iterateBlockReason);

  useEffect(() => {
    if (chatScrollRef.current && viewMode === 'workspace') {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [
    events.length,
    optimisticPrompt,
    busyAction,
    hasPendingPlanConfirmation,
    editablePlan?.appName,
    viewMode,
  ]);

  async function openProjectInWorkspace(projectId: string) {
    setErrorMsg('');
    setRuntimeError('');
    setShareOpen(false);
    setProjectMenuOpen(false);
    setRenamingProject(false);
    setConfirmDeleteProjectId(null);
    setIsEditingCode(false);
    setCodeSaveBanner(null);
    setCodeCompileErrors([]);
    setComposerValue({ text: '', mentions: [] });
    setOptimisticPrompt(null);
    setConfirmedPlanExpanded(false);
    setTargetAgent('auto');
    activeIdRef.current = projectId;
    hasAcceptedSnapshotRef.current = false;
    setActiveId(projectId);
    setLoadingProjectId(projectId);
    setSnapshot(null);
    setEvents([]);
    setEditablePlan(null);
    setSelectedFile('');
    setViewMode('workspace');
    setWorkspaceSidebarOpen(false);
    setRightTab('preview');
    try {
      const res = await loadSnapshot(projectId);
      if (!res.data && !res.superseded) {
        setErrorMsg('无法加载项目详情，请刷新后重试');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingProjectId((cur) => (cur === projectId ? null : cur));
    }
  }

  async function createNewProject(title?: string): Promise<Project> {
    const res = await workbenchFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title || `新项目 ${projects.length + 1}`,
      }),
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `创建项目失败 (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { project: Project };
    listVersionRef.current += 1;
    setProjects((prev) => [data.project, ...prev]);
    activeIdRef.current = data.project.id;
    hasAcceptedSnapshotRef.current = false;
    setActiveId(data.project.id);
    return data.project;
  }

  async function handleNewBlankProject() {
    setErrorMsg('');
    setRuntimeError('');
    setShareOpen(false);
    setProjectMenuOpen(false);
    setRenamingProject(false);
    setConfirmDeleteProjectId(null);
    setIsEditingCode(false);
    setCodeSaveBanner(null);
    setCodeCompileErrors([]);
    setComposerValue({ text: '', mentions: [] });
    setOptimisticPrompt(null);
    setConfirmedPlanExpanded(false);
    setTargetAgent('auto');
    try {
      const created = await createNewProject();
      setLoadingProjectId(created.id);
      setSnapshot(null);
      setEvents([]);
      setEditablePlan(null);
      setSelectedFile('');
      setViewMode('workspace');
      setWorkspaceSidebarOpen(false);
      setRightTab('preview');
      setComposerMode('restart');
      try {
        await loadSnapshot(created.id);
      } finally {
        setLoadingProjectId((cur) => (cur === created.id ? null : cur));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function startSopForProject(
    projectId: string,
    ideaText: string,
    opts?: { clearComposer?: boolean }
  ) {
    const trimmed = ideaText.trim();
    if (!trimmed) return;
    const shouldClearComposer = Boolean(opts?.clearComposer);
    if (shouldClearComposer) {
      setComposerValue({ text: '', mentions: [] });
    }
    setErrorMsg('');
    setRuntimeError('');
    setShareOpen(false);
    setOptimisticPrompt({
      projectId,
      text: trimmed,
      timestamp: new Date().toISOString(),
    });
    setBusyAction('Iris / Emma 正在分析需求...');
    let streamError = '';
    let sawRoleStart = false;
    const isCurrentProject = () =>
      !activeIdRef.current || activeIdRef.current === projectId;
    try {
      const res = await workbenchFetch(`/api/projects/${projectId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: trimmed,
          model: selectedModel || undefined,
          styleTheme: activeTheme ?? undefined,
        }),
      });
      await readSseStream(res, (ev) => {
        if (ev.type === 'role_start') {
          sawRoleStart = true;
          setOptimisticPrompt((cur) =>
            cur?.projectId === projectId ? null : cur
          );
        }
        if (isCurrentProject()) {
          setEvents((prev) => [...prev, ev]);
        }
        const sseErr = extractSseError(ev);
        if (sseErr) streamError = sseErr;
      });
      const latest = await loadSnapshot(projectId);
      void refreshProjectsList(projectId).catch(() => null);
      if (isCurrentProject()) {
        if (latest.data && Object.keys(latest.data.project.draftFiles).length > 0) {
          setComposerMode('iterate');
        }
        if (streamError) {
          setErrorMsg(streamError);
        }
      }
    } catch (err) {
      if (!sawRoleStart && shouldClearComposer && isCurrentProject()) {
        setComposerValue({ text: trimmed, mentions: [] });
      }
      if (isCurrentProject()) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setOptimisticPrompt((cur) =>
        cur?.projectId === projectId ? null : cur
      );
      setBusyAction('');
    }
  }

  async function handleLauncherSubmit(overrideIdea?: string) {
    const trimmed = (overrideIdea ?? launcherIdea).trim();
    if (!trimmed || busyAction) return;
    setErrorMsg('');
    setRuntimeError('');
    setShareOpen(false);
    try {
      const created = await createNewProject('AI 构建新项目');
      if (!overrideIdea) {
        setLauncherIdea('');
      }
      setOptimisticPrompt(null);
      setConfirmedPlanExpanded(false);
      setTargetAgent('auto');
      hasAcceptedSnapshotRef.current = true;
      setSnapshot({
        project: created,
        events: [],
        previewHtml: null,
        compileErrors: [],
        qrDataUrl: null,
        publicUrl: null,
      });
      setEvents([]);
      setEditablePlan(null);
      setSelectedFile('');
      setComposerMode('restart');
      setViewMode('workspace');
      setWorkspaceSidebarOpen(false);
      setRightTab('preview');
      await startSopForProject(created.id, trimmed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleConfirmAndBuild() {
    if (!activeId || !editablePlan || busyAction || isPlanning || isBuilding) {
      return;
    }
    const targetId = activeId;
    setErrorMsg('');
    setRuntimeError('');
    setShareOpen(false);
    setConfirmedPlanExpanded(false);
    setBusyAction(
      buildMode === 'race'
        ? 'Race Mode 并行生成双方案中...'
        : 'Alex 正在编写并编译应用...'
    );
    let streamError = '';
    const isCurrentProject = () =>
      !activeIdRef.current || activeIdRef.current === targetId;
    try {
      const res = await workbenchFetch(`/api/projects/${targetId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planPatch: editablePlan,
          model: selectedModel || undefined,
          mode: buildMode,
        }),
      });
      await readSseStream(res, (ev) => {
        if (isCurrentProject()) {
          setEvents((prev) => [...prev, ev]);
        }
        const sseErr = extractSseError(ev);
        if (sseErr) streamError = sseErr;
      });
      const latest = await loadSnapshot(targetId);
      void refreshProjectsList(targetId).catch(() => null);
      if (isCurrentProject()) {
        setConfirmedPlanExpanded(false);
        if (latest.data && Object.keys(latest.data.project.draftFiles).length > 0) {
          setComposerMode('iterate');
        }
        if (streamError) {
          setErrorMsg(streamError);
        }
        setRightTab('preview');
      }
    } catch (err) {
      if (isCurrentProject()) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusyAction('');
    }
  }

  async function handleSelectBranch(branchId: string) {
    if (!activeId || busyAction || hasPendingPlanConfirmation || isBuilding) {
      return;
    }
    const targetId = activeId;
    const expectedRunId =
      snapshot?.project.id === targetId
        ? snapshot.project.raceBranches.find((b) => b.branchId === branchId)
            ?.runId
        : undefined;
    const isCurrentProject = () =>
      !activeIdRef.current || activeIdRef.current === targetId;
    setErrorMsg('');
    setShareOpen(false);
    setBusyAction('正在切换所选方案...');
    try {
      const res = await workbenchFetch(`/api/projects/${targetId}/select-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, runId: expectedRunId }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error || '切换失败');
      }
      const latest = await loadSnapshot(targetId);
      if (!latest.data && !latest.superseded) {
        throw new Error('所选方案已应用，但刷新预览失败，请点击刷新预览按钮');
      }
      void refreshProjectsList(targetId).catch(() => null);
      if (isCurrentProject()) {
        setComposerMode('iterate');
        setRightTab('preview');
      }
    } catch (err) {
      if (isCurrentProject()) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusyAction('');
    }
  }

  async function handleIterate(
    customInstruction?: string,
    opts?: {
      clearComposer?: boolean;
      targetRole?: 'auto' | 'iris' | 'emma' | 'alex';
      mentions?: AgentMentionSpan[];
      collabStep?: { turnId: string; stepId: string };
    }
  ) {
    const rawSource = customInstruction ?? composerValue.text;
    const instruction = rawSource.trim();
    if (!activeId || !instruction || iterateBlockReason || busyAction) return;
    const leadingTrim = rawSource.length - rawSource.trimStart().length;
    const rawMentions =
      customInstruction !== undefined
        ? (opts?.mentions ?? [])
        : composerValue.mentions;
    const normalizedMentions: AgentMentionSpan[] = rawMentions
      .map((m) => ({
        ...m,
        start: m.start - leadingTrim,
        end: m.end - leadingTrim,
      }))
      .filter(
        (m) => m.start >= 0 && m.end > m.start && m.end <= instruction.length
      );

    const targetId = activeId;
    const resolvedTarget = opts?.targetRole ?? targetAgent;
    const effectiveInitialRole =
      normalizedMentions.length > 0 ? normalizedMentions[0].role : resolvedTarget;
    const shouldClearComposer =
      opts?.clearComposer ?? customInstruction === undefined;
    const previousComposer = composerValue;
    if (shouldClearComposer) {
      setComposerValue({ text: '', mentions: [] });
    }
    setErrorMsg('');
    setRuntimeError('');
    setShareOpen(false);
    if (!opts?.collabStep) {
      setOptimisticPrompt({
        projectId: targetId,
        text: instruction,
        mentions: normalizedMentions.length > 0 ? normalizedMentions : undefined,
        timestamp: new Date().toISOString(),
      });
    }
    setBusyAction(
      effectiveInitialRole === 'emma'
        ? 'Emma 正在梳理产品与视觉建议...'
        : effectiveInitialRole === 'iris'
          ? 'Iris 正在开展调研分析...'
          : effectiveInitialRole === 'alex'
            ? 'Alex 正在按指令迭代修改...'
            : '正在分析意图并分配智能体...'
    );
    let streamError = '';
    let sawRoleStart = false;
    let routedToAlex = effectiveInitialRole === 'alex';
    const isCurrentProject = () =>
      !activeIdRef.current || activeIdRef.current === targetId;
    try {
      const res = await workbenchFetch(`/api/projects/${targetId}/iterate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          model: selectedModel || undefined,
          targetRole: resolvedTarget,
          mentions: normalizedMentions,
          ...(opts?.collabStep ? { collabStep: opts.collabStep } : {}),
        }),
      });
      const activeCollabRoles = new Set<string>();
      await readSseStream(res, (ev) => {
        if (ev.type === 'collaboration_plan') {
          sawRoleStart = true;
          setOptimisticPrompt((cur) =>
            cur?.projectId === targetId ? null : cur
          );
          if (isCurrentProject()) {
            setBusyAction('AI 团队正在按分工协作执行...');
          }
        } else if (ev.type === 'collaboration_step') {
          const stepPayload = (ev.payload ?? {}) as {
            role?: string;
            status?: string;
          };
          if (typeof stepPayload.role === 'string') {
            if (stepPayload.status === 'running') {
              activeCollabRoles.add(stepPayload.role);
            } else {
              activeCollabRoles.delete(stepPayload.role);
            }
          }
          if (stepPayload.role === 'alex' && stepPayload.status === 'running') {
            routedToAlex = true;
            if (isCurrentProject()) {
              setBusyAction('Alex 正在按协作方案迭代代码...');
            }
          } else if (
            activeCollabRoles.has('iris') &&
            activeCollabRoles.has('emma')
          ) {
            if (isCurrentProject()) {
              setBusyAction('Iris & Emma 正在并行分析...');
            }
          } else if (activeCollabRoles.has('emma')) {
            if (isCurrentProject()) {
              setBusyAction('Emma 正在梳理产品与视觉建议...');
            }
          } else if (activeCollabRoles.has('iris')) {
            if (isCurrentProject()) {
              setBusyAction('Iris 正在开展调研分析...');
            }
          } else if (stepPayload.status === 'awaiting_confirmation') {
            if (isCurrentProject()) {
              setBusyAction('等待确认交由 Alex 实施...');
            }
          }
        } else if (ev.type === 'role_start') {
          sawRoleStart = true;
          setOptimisticPrompt((cur) =>
            cur?.projectId === targetId ? null : cur
          );
          if (ev.role === 'emma') {
            routedToAlex = false;
            if (isCurrentProject() && activeCollabRoles.size === 0) {
              setBusyAction('Emma 正在梳理产品与视觉建议...');
            }
          } else if (ev.role === 'iris') {
            routedToAlex = false;
            if (isCurrentProject() && activeCollabRoles.size === 0) {
              setBusyAction('Iris 正在开展调研分析...');
            }
          } else if (ev.role === 'alex') {
            routedToAlex = true;
            if (isCurrentProject() && activeCollabRoles.size === 0) {
              setBusyAction('Alex 正在按指令迭代修改...');
            }
          }
        }
        if (isCurrentProject()) {
          setEvents((prev) => [...prev, ev]);
        }
        const sseErr = extractSseError(ev);
        if (sseErr) streamError = sseErr;
      });
      await loadSnapshot(targetId);
      void refreshProjectsList(targetId).catch(() => null);
      if (isCurrentProject()) {
        if (streamError) {
          setErrorMsg(streamError);
        }
        if (routedToAlex) {
          setRightTab('preview');
        }
      }
    } catch (err) {
      if (!sawRoleStart && shouldClearComposer && isCurrentProject()) {
        setComposerValue(previousComposer);
      }
      if (isCurrentProject()) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setOptimisticPrompt((cur) =>
        cur?.projectId === targetId ? null : cur
      );
      setBusyAction('');
    }
  }

  async function handlePublish() {
    if (!activeId || !hasDraft || publishBlockReason || busyAction) return;
    const targetId = activeId;
    const isCurrentProject = () =>
      !activeIdRef.current || activeIdRef.current === targetId;
    setErrorMsg('');
    setBusyAction('正在构建并发布独立生产站点...');
    try {
      const res = await workbenchFetch(`/api/projects/${targetId}/publish`, {
        method: 'POST',
      });
      const data = (await res.json()) as {
        url?: string;
        version?: number;
        qrDataUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.url || !data.qrDataUrl) {
        throw new Error(data.error || '发布失败');
      }
      await loadSnapshot(targetId);
      void refreshProjectsList(targetId).catch(() => null);
      if (isCurrentProject()) {
        setShareOpen(true);
      }
    } catch (err) {
      if (isCurrentProject()) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusyAction('');
    }
  }

  async function handleWorkspaceComposerSubmit() {
    const text = composerValue.text.trim();
    if (!text || busyAction) return;

    const activeComposerMode = hasDraft ? composerMode : 'restart';
    if (activeComposerMode === 'iterate') {
      if (isMutationLocked) return;
      await handleIterate(composerValue.text, {
        clearComposer: true,
        mentions: composerValue.mentions,
      });
      return;
    }

    const pid = activeId ?? (await createNewProject('新应用项目')).id;
    await startSopForProject(pid, text, { clearComposer: true });
  }

  function toggleCapability(cap: CloudCapability) {
    if (!editablePlan) return;
    const has = editablePlan.capabilities.includes(cap);
    const next = has
      ? editablePlan.capabilities.filter((c) => c !== cap)
      : [...editablePlan.capabilities, cap];
    setEditablePlan({
      ...editablePlan,
      capabilities: next.length > 0 ? next : ['db'],
    });
  }

  async function handleRenameProject(
    projectId: string,
    nextTitle: string
  ): Promise<boolean> {
    const trimmed = nextTitle.trim();
    if (!trimmed) return false;
    setErrorMsg('');
    try {
      const res = await workbenchFetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      const data = (await res.json()) as { project?: Project; error?: string };
      if (!res.ok || !data.project) {
        throw new Error(data.error || '重命名失败');
      }
      listVersionRef.current += 1;
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? data.project! : p))
      );
      setSnapshot((prev) =>
        prev && prev.project.id === projectId
          ? { ...prev, project: data.project! }
          : prev
      );
      setRenamingProject(false);
      return true;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function handleDeleteProject(projectId: string) {
    setErrorMsg('');
    try {
      const res = await workbenchFetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || '删除项目失败');
      }
      listVersionRef.current += 1;
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setConfirmDeleteProjectId(null);
      setProjectMenuOpen(false);
      if (activeId === projectId) {
        activeIdRef.current = null;
        hasAcceptedSnapshotRef.current = false;
        setActiveId(null);
        setSnapshot(null);
        setEvents([]);
        setEditablePlan(null);
        setOptimisticPrompt(null);
        setConfirmedPlanExpanded(false);
        setTargetAgent('auto');
        setSelectedFile('');
        setIsEditingCode(false);
        setCodeSaveBanner(null);
        setCodeCompileErrors([]);
        setShareOpen(false);
        setViewMode('launcher');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveSourceCode() {
    if (
      !activeId ||
      !selectedFile ||
      isMutationLocked ||
      Boolean(busyAction) ||
      savingCode
    ) {
      return;
    }
    const targetId = activeId;
    setSavingCode(true);
    setCodeSaveBanner(null);
    setCodeCompileErrors([]);
    try {
      const nextFiles = { ...draftFiles, [selectedFile]: codeDraft };
      const res = await workbenchFetch(`/api/projects/${targetId}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: nextFiles }),
      });
      const data = (await res.json()) as {
        project?: Project;
        ok?: boolean;
        previewHtml?: string | null;
        compileErrors?: CompileError[];
        error?: string;
      };
      if (!res.ok || !data.project) {
        throw new Error(data.error || '保存源码失败');
      }

      listVersionRef.current += 1;
      setProjects((prev) =>
        prev.map((p) => (p.id === targetId ? data.project! : p))
      );

      if (activeIdRef.current !== targetId) {
        return;
      }

      setSnapshot((prev) =>
        prev && prev.project.id === targetId
          ? {
              ...prev,
              project: data.project!,
              previewHtml: data.previewHtml ?? prev.previewHtml,
              compileErrors: data.compileErrors ?? [],
            }
          : prev
      );
      await loadSnapshot(targetId);

      if (activeIdRef.current !== targetId) {
        return;
      }

      if (data.ok) {
        setIsEditingCode(false);
        setCodeCompileErrors([]);
        setCodeSaveBanner({
          ok: true,
          message: '已保存源码并重新编译通过（仅更新草稿预览，不影响已发布线上版本）',
        });
      } else {
        setCodeCompileErrors(data.compileErrors ?? []);
        setCodeSaveBanner({
          ok: false,
          message: '源码已保存为草稿，但存在编译错误，请按下方提示修正后重编',
        });
      }
    } catch (err) {
      if (activeIdRef.current === targetId) {
        setCodeSaveBanner({
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setSavingCode(false);
    }
  }

  function returnToLauncher() {
    setShareOpen(false);
    setProjectMenuOpen(false);
    setRenamingProject(false);
    setConfirmDeleteProjectId(null);
    setOptimisticPrompt(null);
    setConfirmedPlanExpanded(false);
    setTargetAgent('auto');
    setIsEditingCode(false);
    setCodeSaveBanner(null);
    setCodeCompileErrors([]);
    setWorkspaceSidebarOpen(false);
    setLoadingProjectId(null);
    setErrorMsg('');
    setRuntimeError('');
    setViewMode('launcher');
  }

  if (viewMode === 'launcher') {
    return (
      <>
        <LauncherView
          projects={projects}
          isLoadingProjects={projectsLoading}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          idea={launcherIdea}
          onIdeaChange={setLauncherIdea}
          presets={DEMO_IDEAS}
          activeTheme={activeTheme}
          onOpenThemeModal={() => setThemeModalMode('launcher')}
          busyAction={busyAction}
          errorMsg={errorMsg}
          onSubmitIdea={(customIdea) => void handleLauncherSubmit(customIdea)}
          onOpenProject={(pid) => void openProjectInWorkspace(pid)}
          onCreateBlankProject={() => void handleNewBlankProject()}
          onRenameProject={(pid, nextTitle) =>
            handleRenameProject(pid, nextTitle)
          }
          onDeleteProject={(pid) => void handleDeleteProject(pid)}
        />
        <StyleThemeModal
          open={Boolean(themeModalMode)}
          mode={themeModalMode ?? 'launcher'}
          onClose={() => setThemeModalMode(null)}
          selectedThemeId={selectedThemeId}
          builtinThemes={BUILTIN_STYLE_THEMES}
          customThemes={customThemes}
          onSelectTheme={handleApplyThemeSelection}
          onSaveCustomTheme={handleSaveCustomTheme}
          onDeleteCustomTheme={handleDeleteCustomTheme}
          onImportCustomThemes={handleImportCustomThemes}
        />
      </>
    );
  }

  const effectiveComposerMode = hasDraft ? composerMode : 'restart';
  const composerLocked =
    isLoadingProject ||
    Boolean(busyAction) ||
    (effectiveComposerMode === 'iterate' && isMutationLocked);
  const canSubmitComposer = Boolean(composerValue.text.trim()) && !composerLocked;
  const codeLines =
    selectedFile && draftFiles[selectedFile]
      ? draftFiles[selectedFile].split('\n')
      : [];

  const shouldFoldConfirmedPlan = Boolean(
    editablePlan && hasDraft && !hasPendingPlanConfirmation
  );

  const emmaPlanCard = editablePlan ? (
    <div
      className={`rounded-2xl bg-white p-3.5 space-y-3 shadow-[0_1px_4px_rgba(12,12,12,0.04)] ${
        hasPendingPlanConfirmation
          ? 'border border-[#4267ff]/45 ring-2 ring-[#4267ff]/10'
          : 'border border-black/[0.08]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AgentBadge role="emma" />
          <span className="text-xs font-semibold text-[#0c0c0c]/95">
            Emma 产品方案确认卡
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasPendingPlanConfirmation ? (
            <span className="rounded-full bg-amber-500/12 border border-amber-600/20 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              {isPlanning ? '方案生成中' : '待确认新方案'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              <CheckCircle2 className="w-3 h-3" />
              已确认方案
            </span>
          )}
        </div>
      </div>

      {hasPendingPlanConfirmation && hasDraft && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-2.5 py-2 text-[11px] text-amber-900 leading-relaxed">
          已有草稿与已发布线上版本在确认前保持不变；确认后 Alex 将按新方案重建草稿。
        </div>
      )}

      <div className="space-y-2">
        <input
          type="text"
          aria-label="应用名称"
          value={editablePlan.appName}
          onChange={(e) =>
            setEditablePlan({
              ...editablePlan,
              appName: e.target.value,
            })
          }
          className="w-full rounded-xl border border-black/[0.1] bg-[#fcfcfb] px-3 py-1.5 text-xs font-semibold text-[#0c0c0c]/95 focus:border-[#4267ff] focus:bg-white focus:outline-none"
        />
        <textarea
          rows={2}
          aria-label="应用摘要"
          value={editablePlan.summary}
          onChange={(e) =>
            setEditablePlan({
              ...editablePlan,
              summary: e.target.value,
            })
          }
          className="w-full rounded-xl border border-black/[0.1] bg-[#fcfcfb] px-3 py-1.5 text-xs text-[#0c0c0c]/75 focus:border-[#4267ff] focus:bg-white focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ALL_CAPABILITIES.map((cap) => {
          const active = editablePlan.capabilities.includes(cap.id);
          return (
            <button
              key={cap.id}
              type="button"
              onClick={() => toggleCapability(cap.id)}
              className={
                active
                  ? 'rounded-full bg-[#4267ff]/12 border border-[#4267ff]/30 px-2.5 py-0.5 text-[11px] font-medium text-[#4267ff] cursor-pointer'
                  : 'rounded-full border border-black/[0.08] bg-[#f8f8f6] px-2.5 py-0.5 text-[11px] text-[#0c0c0c]/55 hover:text-[#0c0c0c] cursor-pointer'
              }
            >
              {cap.label}
            </button>
          );
        })}
      </div>

      {/* UI Design System & Style Theme Decision Card */}
      <div className="rounded-xl border border-black/[0.08] bg-[#f8f8f6] p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Palette className="w-3.5 h-3.5 text-[#4267ff] shrink-0" />
            <span className="text-[11px] font-semibold text-[#0c0c0c]/90 truncate">
              {editablePlan.designSystem
                ? `UI 场景 ${editablePlan.designSystem.scenario} · ${editablePlan.designSystem.scenarioName}`
                : 'UI 设计方案'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setThemeModalMode('emma')}
            className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] bg-white px-2.5 py-0.5 text-[10px] font-medium text-[#4267ff] hover:border-[#4267ff]/40 cursor-pointer shrink-0"
          >
            {editablePlan.designSystem?.themeName
              ? `已选：${editablePlan.designSystem.themeName}`
              : '切换主题 / 自定义'}
          </button>
        </div>

        {editablePlan.designSystem && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {(
                  [
                    {
                      label: '底色',
                      hex: editablePlan.designSystem.palette.background,
                    },
                    {
                      label: '表面',
                      hex: editablePlan.designSystem.palette.surface,
                    },
                    {
                      label: '主字',
                      hex: editablePlan.designSystem.palette.textPrimary,
                    },
                    {
                      label: '辅字',
                      hex: editablePlan.designSystem.palette.textMuted,
                    },
                    {
                      label: '强调',
                      hex: editablePlan.designSystem.palette.accent,
                    },
                  ] as const
                ).map((sw) => (
                  <span
                    key={sw.label}
                    title={`${sw.label}: ${sw.hex}`}
                    className="w-4 h-4 rounded-full border border-black/15 shrink-0"
                    style={{ backgroundColor: sw.hex }}
                  />
                ))}
                <span className="text-[10px] text-[#0c0c0c]/55 ml-1">
                  {editablePlan.designSystem.typography.headingStyle ===
                  'editorial-serif'
                    ? '衬线编辑标题'
                    : editablePlan.designSystem.typography.headingStyle ===
                        'geometric-sans'
                      ? '几何无衬线'
                      : '极简无衬线'}
                </span>
              </div>

              <div className="flex items-center gap-1">
                <select
                  aria-label="调整 UI 设计场景"
                  value={editablePlan.designSystem.scenario}
                  onChange={(e) => {
                    const nextId = e.target.value as DesignScenarioId;
                    const nextDef = DESIGN_SCENARIOS[nextId];
                    const prevDs = editablePlan.designSystem!;
                    const matchedTheme = prevDs.themeId
                      ? allThemes.find((t) => t.id === prevDs.themeId)
                      : undefined;
                    const nextCustomStylePrompt =
                      prevDs.themeId &&
                      (!matchedTheme ||
                        prevDs.customStylePrompt === matchedTheme.stylePrompt)
                        ? undefined
                        : prevDs.customStylePrompt;
                    setEditablePlan({
                      ...editablePlan,
                      designSystem: {
                        ...prevDs,
                        scenario: nextId,
                        scenarioName: nextDef.name,
                        tone: nextDef.toneKeywords,
                        colorMode: nextDef.defaultColorMode,
                        palette: { ...nextDef.defaultPalette },
                        typography: { ...nextDef.defaultTypography },
                        radiusStyle: nextDef.defaultRadiusStyle,
                        surfaceDepth: nextDef.defaultSurfaceDepth,
                        layoutBlueprint: nextDef.layoutRules,
                        motionStyle: nextDef.motionRules,
                        mediaStrategy: nextDef.mediaRule,
                        antiPatterns: nextDef.antiPatterns,
                        themeId: undefined,
                        themeName: undefined,
                        customStylePrompt: nextCustomStylePrompt,
                      },
                    });
                  }}
                  className="rounded-lg border border-black/[0.1] bg-white px-1.5 py-0.5 text-[10px] text-[#0c0c0c]/80 focus:border-[#4267ff] focus:outline-none"
                >
                  {(Object.keys(DESIGN_SCENARIOS) as DesignScenarioId[]).map(
                    (sid) => (
                      <option key={sid} value={sid}>
                        场景 {sid} · {DESIGN_SCENARIOS[sid].shortLabel}
                      </option>
                    )
                  )}
                </select>

                <button
                  type="button"
                  onClick={() => {
                    const prevDs = editablePlan.designSystem!;
                    const nextMode =
                      prevDs.colorMode === 'dark' ? 'light' : 'dark';
                    setEditablePlan({
                      ...editablePlan,
                      designSystem: {
                        ...prevDs,
                        colorMode: nextMode,
                        palette:
                          nextMode === 'dark'
                            ? {
                                ...prevDs.palette,
                                background: '#0E0F12',
                                surface: '#16181E',
                                textPrimary: '#F3F2EE',
                                textMuted: '#9B9A94',
                              }
                            : {
                                ...prevDs.palette,
                                background: '#FAF8F4',
                                surface: '#FFFFFF',
                                textPrimary: '#1D1916',
                                textMuted: '#6E665E',
                              },
                      },
                    });
                  }}
                  className="rounded-lg border border-black/[0.1] bg-white px-2 py-0.5 text-[10px] font-medium text-[#0c0c0c]/75 hover:bg-black/[0.04] cursor-pointer"
                >
                  {editablePlan.designSystem.colorMode === 'dark'
                    ? '深色'
                    : '浅色'}
                </button>
              </div>
            </div>

            <p className="text-[11px] text-[#0c0c0c]/65 leading-relaxed line-clamp-2">
              焦点：{editablePlan.designSystem.visualFocalPoint}
            </p>

            <input
              type="text"
              aria-label="自定义风格提示词微调"
              maxLength={2000}
              value={editablePlan.designSystem.customStylePrompt ?? ''}
              onChange={(e) => {
                const prevDs = editablePlan.designSystem!;
                setEditablePlan({
                  ...editablePlan,
                  designSystem: {
                    ...prevDs,
                    customStylePrompt: e.target.value,
                  },
                });
              }}
              placeholder="补充风格微调（如：大留白编辑风、不要统计卡片、用陶土棕点缀）..."
              className="w-full rounded-lg border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] text-[#0c0c0c]/85 placeholder:text-[#0c0c0c]/35 focus:border-[#4267ff] focus:outline-none"
            />
          </>
        )}
      </div>

      {/* Linear vs Race Mode Segmented Switch */}
      <div className="grid grid-cols-2 rounded-full bg-black/[0.04] p-0.5 border border-black/[0.06]">
        <button
          type="button"
          onClick={() => setBuildMode('linear')}
          className={
            buildMode === 'linear'
              ? 'rounded-full bg-white py-1.5 text-xs font-medium text-[#0c0c0c] shadow-[0_1px_2px_rgba(12,12,12,0.06)] cursor-pointer'
              : 'rounded-full py-1.5 text-xs text-[#0c0c0c]/55 hover:text-[#0c0c0c] cursor-pointer'
          }
        >
          标准单路生成
        </button>
        <button
          type="button"
          onClick={() => setBuildMode('race')}
          className={
            buildMode === 'race'
              ? 'rounded-full bg-white py-1.5 text-xs font-medium text-[#4267ff] shadow-[0_1px_2px_rgba(12,12,12,0.06)] inline-flex items-center justify-center gap-1 cursor-pointer'
              : 'rounded-full py-1.5 text-xs text-[#0c0c0c]/55 hover:text-[#0c0c0c] inline-flex items-center justify-center gap-1 cursor-pointer'
          }
        >
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          Race Mode (双风格)
        </button>
      </div>

      <button
        type="button"
        disabled={Boolean(busyAction) || isPlanning || isBuilding}
        onClick={() => void handleConfirmAndBuild()}
        className="w-full rounded-full bg-[#4267ff] px-4 py-2 text-xs font-semibold text-white hover:bg-[#425ce1] transition disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
      >
        {busyAction || '确认方案并让 Alex 开始构建'}
      </button>
    </div>
  ) : null;

  return (
    <div className="h-screen flex flex-col bg-[#f3f3f0] text-[#0c0c0c]/95 overflow-hidden">
      {/* Unified 44px Atoms Top Header */}
      <header className="h-11 shrink-0 px-3 flex items-center justify-between gap-3 border-b border-black/[0.06] bg-[#f3f3f0]">
        {/* Left Navigation & Project Identity */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setWorkspaceSidebarOpen((v) => !v)}
            aria-label={workspaceSidebarOpen ? '收起项目侧栏' : '展开项目侧栏'}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[#0c0c0c]/60 hover:bg-black/[0.05] hover:text-[#0c0c0c] transition shrink-0 cursor-pointer"
          >
            {workspaceSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={returnToLauncher}
            title="返回启动大厅"
            aria-label="返回 Mini Atoms 启动大厅"
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-black/[0.05] transition shrink-0 cursor-pointer"
          >
            <AtomsLogoMark size={20} />
          </button>

          {/* Custom Project Dropdown */}
          <div ref={projectMenuRef} className="relative min-w-0">
            <button
              type="button"
              aria-label="切换或管理项目"
              aria-expanded={projectMenuOpen}
              onClick={() => setProjectMenuOpen((v) => !v)}
              className="h-7 max-w-[180px] xl:max-w-[240px] inline-flex items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-[#0c0c0c]/90 hover:bg-black/[0.05] transition cursor-pointer"
            >
              <span className="truncate">
                {displayProject?.title ??
                  (isLoadingProject ? '正在加载项目...' : '未命名应用')}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[#0c0c0c]/45 shrink-0" />
            </button>

            {projectMenuOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-2xl border border-black/[0.1] bg-white p-1.5 shadow-[0_12px_32px_rgba(12,12,12,0.12)] space-y-1">
                <button
                  type="button"
                  onClick={returnToLauncher}
                  className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-[#0c0c0c]/85 hover:bg-black/[0.04] cursor-pointer"
                >
                  <Home className="w-3.5 h-3.5 text-[#0c0c0c]/55" />
                  返回启动大厅
                </button>
                <button
                  type="button"
                  onClick={() => void handleNewBlankProject()}
                  className="w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-[#4267ff] hover:bg-[#4267ff]/[0.06] cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  新建空白项目
                </button>

                {project && (
                  <div className="px-1.5 py-1 space-y-1">
                    {renamingProject ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void handleRenameProject(project.id, renameTitleInput);
                        }}
                        className="flex items-center gap-1"
                      >
                        <input
                          type="text"
                          aria-label="重命名项目名称"
                          maxLength={80}
                          autoFocus
                          value={renameTitleInput}
                          onChange={(e) => setRenameTitleInput(e.target.value)}
                          className="flex-1 min-w-0 rounded-lg border border-black/[0.15] bg-[#fcfcfb] px-2 py-1 text-xs text-[#0c0c0c]/95 focus:border-[#4267ff] focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!renameTitleInput.trim()}
                          className="rounded-lg bg-[#4267ff] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#425ce1] disabled:opacity-40 cursor-pointer"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingProject(false)}
                          className="rounded-lg px-1.5 py-1 text-[11px] text-[#0c0c0c]/55 hover:text-[#0c0c0c] cursor-pointer"
                        >
                          取消
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteProjectId(null);
                          setRenameTitleInput(project.title);
                          setRenamingProject(true);
                        }}
                        className="w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-medium text-[#0c0c0c]/80 hover:bg-black/[0.04] cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5 text-[#0c0c0c]/55" />
                        重命名当前项目
                      </button>
                    )}

                    {confirmDeleteProjectId === project.id ? (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-[#c9444a]/25 bg-[#c9444a]/[0.06] px-2.5 py-1.5 text-[11px]">
                        <span className="text-[#b72027] font-medium">
                          确认删除此项目？
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleDeleteProject(project.id)}
                            className="rounded-full bg-[#c9444a] px-2 py-0.5 text-[10px] font-medium text-white hover:bg-[#b72027] cursor-pointer"
                          >
                            确认删除
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteProjectId(null)}
                            className="rounded-full bg-white border border-black/10 px-2 py-0.5 text-[10px] text-[#0c0c0c]/70 cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isPlanning || isBuilding || Boolean(busyAction)}
                        onClick={() => {
                          setRenamingProject(false);
                          setConfirmDeleteProjectId(project.id);
                        }}
                        className="w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-medium text-[#b72027] hover:bg-[#c9444a]/[0.08] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        删除当前项目
                      </button>
                    )}
                  </div>
                )}

                <div className="my-1 border-t border-black/[0.06]" />
                <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[#0c0c0c]/45">
                  切换项目 ({projects.length})
                </div>
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {projects.map((p) => {
                    const active = p.id === activeId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => void openProjectInWorkspace(p.id)}
                        className={`w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition cursor-pointer ${
                          active
                            ? 'bg-[#4267ff]/10 text-[#4267ff] font-semibold'
                            : 'text-[#0c0c0c]/80 hover:bg-black/[0.04]'
                        }`}
                      >
                        <span className="truncate">{p.title}</span>
                        <StatusPill
                          status={p.status}
                          publishedVersion={p.publishedVersion}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {isLoadingProject ? (
            <div className="hidden xl:inline-flex items-center gap-1.5 rounded-full bg-[#4267ff]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#4267ff] shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              加载中
            </div>
          ) : displayProject ? (
            <div className="hidden xl:inline-flex shrink-0">
              <StatusPill
                status={displayProject.status}
                publishedVersion={displayProject.publishedVersion}
              />
            </div>
          ) : null}
        </div>

        {/* Center/Right Segmented Stage Bar + Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 30px Segmented Pill Switcher */}
          <div className="inline-flex items-center h-[30px] rounded-full bg-black/[0.04] border border-black/[0.06] p-0.5">
            {(
              [
                { id: 'preview', label: '实时预览', icon: Eye },
                { id: 'code', label: `源码 (${fileNames.length})`, icon: Code2 },
                { id: 'cloud', label: 'Cloud 数据', icon: Database },
                { id: 'overview', label: '概览', icon: LayoutGrid },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = rightTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRightTab(tab.id)}
                  className={
                    active
                      ? 'h-[26px] inline-flex items-center gap-1.5 rounded-full bg-white border border-black/[0.08] px-3 text-xs font-medium text-[#0c0c0c]/95 shadow-[0_1px_2px_rgba(12,12,12,0.05)] cursor-pointer'
                      : 'h-[26px] inline-flex items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-[#0c0c0c]/55 hover:text-[#0c0c0c]/90 cursor-pointer'
                  }
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {rightTab === 'preview' && (
            <div className="hidden lg:inline-flex items-center gap-0.5 rounded-full border border-black/[0.08] bg-white px-1 h-7">
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                aria-label="桌面视图"
                className={`rounded-full p-1 transition cursor-pointer ${
                  viewport === 'desktop'
                    ? 'bg-black/[0.06] text-[#0c0c0c]'
                    : 'text-[#0c0c0c]/45 hover:text-[#0c0c0c]'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                aria-label="手机视图"
                className={`rounded-full p-1 transition cursor-pointer ${
                  viewport === 'mobile'
                    ? 'bg-black/[0.06] text-[#0c0c0c]'
                    : 'text-[#0c0c0c]/45 hover:text-[#0c0c0c]'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
              {activeId && (
                <button
                  type="button"
                  onClick={() => void loadSnapshot(activeId)}
                  aria-label="刷新预览"
                  className="rounded-full p-1 text-[#0c0c0c]/45 hover:text-[#0c0c0c] cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="hidden md:block">
            <ModelDropdown
              models={models}
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
              compact
            />
          </div>

          {hasDraft && activeId && (
            <a
              href={`/api/projects/${activeId}/export`}
              className="hidden sm:inline-flex h-7 items-center gap-1 rounded-full border border-black/[0.1] bg-white px-2.5 text-xs font-medium text-[#0c0c0c]/80 hover:bg-[#f8f8f6] transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>ZIP</span>
            </a>
          )}

          {project && (
            <div className="relative flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShareOpen((v) => !v)}
                className="h-7 inline-flex items-center gap-1 rounded-full border border-black/[0.1] bg-white px-2.5 text-xs font-medium text-[#0c0c0c]/85 hover:bg-[#f8f8f6] transition cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>分享</span>
              </button>

              <button
                type="button"
                disabled={
                  !hasDraft || Boolean(publishBlockReason) || Boolean(busyAction)
                }
                title={publishBlockReason ?? undefined}
                onClick={() => void handlePublish()}
                className="h-7 inline-flex items-center gap-1.5 rounded-full bg-[#4267ff] px-3.5 text-xs font-semibold text-white hover:bg-[#425ce1] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Rocket className="w-3.5 h-3.5" />
                <span>{project.publishedVersion ? '更新发布' : '发布'}</span>
              </button>

              <SharePublishPopover
                open={shareOpen}
                onClose={() => setShareOpen(false)}
                project={project}
                publicUrl={snapshot?.publicUrl ?? null}
                qrDataUrl={snapshot?.qrDataUrl ?? null}
                hasDraft={hasDraft}
                publishBlockReason={publishBlockReason}
                busyAction={busyAction}
                onPublish={() => void handlePublish()}
              />
            </div>
          )}
        </div>
      </header>

      {/* Main Split Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Optional Slide-out Project Sidebar Drawer */}
        {workspaceSidebarOpen && (
          <aside className="hidden md:flex w-[250px] shrink-0 flex-col border-r border-black/[0.08] bg-[#f8f8f6] p-3 space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#0c0c0c]/50">
                全部项目
              </span>
              <button
                type="button"
                onClick={() => void handleNewBlankProject()}
                className="inline-flex items-center gap-1 rounded-full bg-white border border-black/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#4267ff] hover:bg-black/[0.02] cursor-pointer"
              >
                <FolderPlus className="w-3 h-3" />
                新建
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {projects.map((p) => {
                const active = p.id === activeId;
                return (
                  <div
                    key={p.id}
                    className={`group flex items-center gap-1 rounded-xl px-2 py-1.5 transition ${
                      active
                        ? 'bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(12,12,12,0.04)]'
                        : 'hover:bg-black/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void openProjectInWorkspace(p.id)}
                      className="flex-1 min-w-0 text-left px-0.5 py-0.5 cursor-pointer"
                    >
                      <div className="text-xs font-medium text-[#0c0c0c]/90 truncate">
                        {p.title}
                      </div>
                      <div className="mt-1">
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
                      disableDelete={
                        Boolean(busyAction) ||
                        ((isPlanning || isBuilding) && p.id === activeId)
                      }
                      onOpen={() => void openProjectInWorkspace(p.id)}
                      onRename={(pid, title) => handleRenameProject(pid, title)}
                      onDelete={(pid) => void handleDeleteProject(pid)}
                      variant="subtle"
                    />
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={returnToLauncher}
              className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white py-2 text-xs font-medium text-[#0c0c0c]/75 hover:text-[#0c0c0c] cursor-pointer"
            >
              <Home className="w-3.5 h-3.5" />
              回到启动大厅
            </button>
          </aside>
        )}

        {/* Left Collaboration Pane */}
        <aside className="w-full lg:w-[416px] xl:w-[452px] shrink-0 flex flex-col min-h-0 bg-[#f8f8f6] border-r border-black/[0.06]">
          {/* Sticky 4-step Good Path Progress Card */}
          {project && (
            <GoodPathCard
              project={project}
              eventsCount={events.length}
              hasDraft={hasDraft}
              hasPendingPlanConfirmation={hasPendingPlanConfirmation}
              hasPendingRaceSelection={hasPendingRaceSelection}
              publishBlockReason={publishBlockReason}
              busyAction={busyAction}
              onGoPreview={() => setRightTab('preview')}
              onPublish={() => void handlePublish()}
            />
          )}

          {/* Scrollable Collaboration Timeline & Emma Confirmation Card */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4"
          >
            {errorMsg && (
              <div className="rounded-xl border border-[#c9444a]/30 bg-[#c9444a]/10 px-3 py-2.5 text-xs text-[#b72027] flex items-center justify-between gap-2">
                <span className="min-w-0 break-words">{errorMsg}</span>
                {activeId && !snapshot && !isLoadingProject && (
                  <button
                    type="button"
                    onClick={() => void openProjectInWorkspace(activeId)}
                    className="shrink-0 rounded-full border border-[#c9444a]/35 bg-white px-2.5 py-1 text-[11px] font-medium text-[#b72027] hover:bg-[#c9444a]/[0.06] cursor-pointer"
                  >
                    重新加载项目
                  </button>
                )}
              </div>
            )}

            {runtimeError && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/[0.09] p-3 space-y-2 text-xs text-amber-950">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  捕获预览运行期异常
                </div>
                <p className="font-atoms-mono text-[11px] text-amber-900/80 break-words">
                  {runtimeError}
                </p>
                <button
                  type="button"
                  disabled={isMutationLocked || Boolean(busyAction)}
                  title={iterateBlockReason ?? undefined}
                  onClick={() =>
                    void handleIterate(`修复页面运行时错误：${runtimeError}`, {
                      targetRole: 'alex',
                    })
                  }
                  className="inline-flex items-center gap-1 rounded-full bg-[#0c0c0c] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#0c0c0c]/85 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Wrench className="w-3 h-3" />
                  让 Alex 一键修复
                </button>
              </div>
            )}

            {shouldFoldConfirmedPlan && editablePlan && (
              <div className="rounded-2xl border border-black/[0.08] bg-white px-3 py-2 shadow-[0_1px_3px_rgba(12,12,12,0.03)] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AgentBadge role="emma" />
                    <span className="text-xs font-medium text-[#0c0c0c]/85 truncate">
                      已确认产品方案 · {editablePlan.appName}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmedPlanExpanded((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-[#f8f8f6] px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/75 hover:text-[#0c0c0c] transition shrink-0 cursor-pointer"
                  >
                    <span>{confirmedPlanExpanded ? '收起方案' : '展开调整'}</span>
                    {confirmedPlanExpanded ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                </div>
                {confirmedPlanExpanded && emmaPlanCard}
              </div>
            )}

            <TimelineStream
              events={events}
              isLoading={isLoadingProject}
              loadingTitle={displayProject?.title}
              onOpenPreview={() => setRightTab('preview')}
              onOpenCode={() => setRightTab('code')}
              onRunSuggestion={(inst, role, collabStep) =>
                void handleIterate(inst, {
                  clearComposer: false,
                  targetRole: role ?? 'alex',
                  collabStep,
                })
              }
              busy={Boolean(busyAction)}
            />

            {optimisticPrompt && optimisticPrompt.projectId === activeId && (
              <div className="flex flex-col items-end space-y-1">
                <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-[#ebebea] px-3.5 py-2.5 text-xs text-[#0c0c0c]/90 leading-relaxed whitespace-pre-wrap break-words">
                  <RichMentionText
                    text={optimisticPrompt.text}
                    mentions={optimisticPrompt.mentions}
                  />
                </div>
              </div>
            )}

            {!shouldFoldConfirmedPlan && emmaPlanCard}

            {busyAction && (
              <div className="inline-flex items-center gap-2 rounded-full border border-[#4267ff]/20 bg-white px-3 py-1.5 text-[11px] font-medium text-[#4267ff] shadow-xs">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {busyAction}
              </div>
            )}
          </div>

          {/* Bottom Unified Composer */}
          <div className="shrink-0 p-3 pt-2 space-y-2 bg-[#f8f8f6]">
            {/* Quick Suggestion Chips */}
            {effectiveComposerMode === 'iterate' && (
              <div className="flex flex-wrap gap-1.5">
                {['我想改配色', '主色调改成深蓝色', '增加导出 CSV 按钮'].map(
                  (chip) => (
                    <button
                      key={chip}
                      type="button"
                      disabled={isMutationLocked || Boolean(busyAction)}
                      onClick={() =>
                        setComposerValue({ text: chip, mentions: [] })
                      }
                      className="rounded-full border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/75 hover:border-[#4267ff]/40 hover:text-[#4267ff] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    >
                      + {chip}
                    </button>
                  )
                )}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleWorkspaceComposerSubmit();
              }}
              className="atoms-composer rounded-2xl overflow-hidden"
            >
              {effectiveComposerMode === 'iterate' && iterateBlockReason && (
                <div className="border-b border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
                  {hasPendingPlanConfirmation
                    ? '当前存在待确认的新方案，请先在上方 Emma 方案确认卡中点击「确认方案并让 Alex 开始构建」；确认前已有草稿与已发布线上站点保持不变，无法迭代或发布。'
                    : iterateBlockReason}
                </div>
              )}

              {effectiveComposerMode === 'iterate' && !iterateBlockReason && (
                <div className="flex flex-wrap items-center gap-1 border-b border-black/[0.06] px-3 py-1.5 bg-[#fcfcfb]">
                  <span className="text-[10px] font-medium text-[#0c0c0c]/45 mr-0.5">
                    对话对象:
                  </span>
                  {(
                    [
                      { id: 'auto', label: '智能路由' },
                      { id: 'emma', label: 'Emma 产品' },
                      { id: 'iris', label: 'Iris 调研' },
                      { id: 'alex', label: 'Alex 开发' },
                    ] as const
                  ).map((agent) => {
                    const selected = targetAgent === agent.id;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        disabled={composerLocked}
                        onClick={() => setTargetAgent(agent.id)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition cursor-pointer disabled:opacity-45 ${
                          selected
                            ? 'bg-[#4267ff] text-white shadow-xs'
                            : 'bg-black/[0.04] text-[#0c0c0c]/65 hover:text-[#0c0c0c]'
                        }`}
                      >
                        {agent.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="p-3 space-y-2.5">
                <MentionComposerInput
                  value={composerValue}
                  onChange={setComposerValue}
                  onSubmit={() => void handleWorkspaceComposerSubmit()}
                  enableMentions={effectiveComposerMode === 'iterate'}
                  disabled={composerLocked}
                  onMentionPick={() => setTargetAgent('auto')}
                  placeholder={
                    isLoadingProject
                      ? '正在加载项目详情与源码，请稍候...'
                      : effectiveComposerMode === 'restart'
                        ? '输入新的产品想法（将启动 Iris 调研 → Emma 方案确认）...'
                        : hasPendingPlanConfirmation
                          ? isPlanning
                            ? 'Iris / Emma 正在生成新方案，请等待确认后再迭代...'
                            : '请先在上方确认 Emma 新方案并构建...'
                          : hasPendingRaceSelection
                            ? '请先在右侧选择一个 Race Mode 候选方案...'
                            : isBuilding
                              ? 'Alex 正在构建中，请稍候...'
                              : targetAgent === 'emma'
                                ? '和 Emma 探讨产品方案、交互体验或配色建议...'
                                : targetAgent === 'iris'
                                  ? '向 Iris 提问市场需求、竞品做法或用户留存建议...'
                                  : targetAgent === 'alex'
                                    ? '直接向 Alex 下达具体改代码指令（不影响已发布线上版本）...'
                                    : '输入想法或修改需求（默认智能路由，输入 @ 可在任意位置指定智能体）...'
                  }
                />

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  {/* Mode Switch inside Composer Footer */}
                  {isLoadingProject ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#0c0c0c]/45">
                      <Loader2 className="w-3 h-3 animate-spin text-[#4267ff]" />
                      正在同步项目状态...
                    </span>
                  ) : hasDraft ? (
                    <div className="inline-flex items-center rounded-full bg-black/[0.04] p-0.5 border border-black/[0.05]">
                      <button
                        type="button"
                        onClick={() => setComposerMode('iterate')}
                        className={
                          effectiveComposerMode === 'iterate'
                            ? 'rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c] shadow-[0_1px_2px_rgba(12,12,12,0.06)] cursor-pointer'
                            : 'rounded-full px-2.5 py-1 text-[11px] text-[#0c0c0c]/55 hover:text-[#0c0c0c] cursor-pointer'
                        }
                      >
                        迭代当前应用
                      </button>
                      <button
                        type="button"
                        onClick={() => setComposerMode('restart')}
                        className={
                          effectiveComposerMode === 'restart'
                            ? 'rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#4267ff] shadow-[0_1px_2px_rgba(12,12,12,0.06)] cursor-pointer'
                            : 'rounded-full px-2.5 py-1 text-[11px] text-[#0c0c0c]/55 hover:text-[#0c0c0c] cursor-pointer'
                        }
                      >
                        换新想法重规划
                      </button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#0c0c0c]/45">
                      <Sparkles className="w-3 h-3 text-[#4267ff]" />
                      Iris → Emma → Alex 协同流程
                    </span>
                  )}

                  <button
                    type="submit"
                    aria-label={
                      isLoadingProject
                        ? '正在加载项目'
                        : effectiveComposerMode === 'restart'
                          ? '启动 AI 团队规划'
                          : '发送对话或迭代指令'
                    }
                    title={
                      effectiveComposerMode === 'iterate'
                        ? iterateBlockReason ?? undefined
                        : undefined
                    }
                    disabled={!canSubmitComposer}
                    className="h-8 px-3 rounded-[10px] bg-[#4267ff] text-white inline-flex items-center justify-center gap-1 text-xs font-medium hover:bg-[#425ce1] transition disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isLoadingProject ? (
                      <span>加载中</span>
                    ) : effectiveComposerMode === 'restart' ? (
                      <span>启动规划</span>
                    ) : (
                      <span>{targetAgent === 'alex' ? '迭代' : '发送'}</span>
                    )}
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </form>
          </div>
        </aside>

        {/* Right Stage Canvas */}
        <main className="flex-1 min-w-0 bg-[#f3f3f0] p-2.5 flex flex-col min-h-0">
          {isLoadingProject ? (
            <div
              data-testid="project-loading-stage"
              className="flex-1 min-h-0 flex flex-col rounded-2xl border border-black/[0.08] bg-white shadow-[0_2px_10px_rgba(12,12,12,0.04)] overflow-hidden"
            >
              <div className="h-9 shrink-0 border-b border-black/[0.06] bg-[#fcfcfb] px-3.5 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-[#4267ff] animate-spin" />
                <span className="text-[11px] font-medium text-[#0c0c0c]/60">
                  正在拉取项目快照与编译产物...
                </span>
              </div>
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 bg-[#fcfcfb]">
                <div className="relative flex items-center justify-center">
                  <div className="px-3.5 py-3 rounded-2xl border border-black/[0.08] bg-white shadow-xs flex items-center justify-center">
                    <AgentCluster />
                  </div>
                  <span className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#4267ff] text-white flex items-center justify-center shadow-sm">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </span>
                </div>
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-[#0c0c0c]/90">
                    正在加载「{displayProject?.title ?? '项目'}」
                  </h2>
                  <p className="text-xs text-[#0c0c0c]/55 max-w-md leading-relaxed">
                    正在同步对话历史、源码文件与实时预览，请稍候...
                  </p>
                </div>
                <div className="w-full max-w-lg rounded-xl border border-black/[0.06] bg-white p-4 space-y-2.5 animate-pulse">
                  <div className="h-3 w-1/3 rounded bg-black/[0.07]" />
                  <div className="h-24 w-full rounded-lg bg-black/[0.04]" />
                  <div className="grid grid-cols-3 gap-2">
                    <div className="h-8 rounded-lg bg-black/[0.04]" />
                    <div className="h-8 rounded-lg bg-black/[0.04]" />
                    <div className="h-8 rounded-lg bg-black/[0.04]" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
          {rightTab === 'preview' && (
            <div className="flex-1 min-h-0 flex flex-col rounded-2xl border border-black/[0.08] bg-white shadow-[0_2px_10px_rgba(12,12,12,0.04)] overflow-hidden">
              {/* Simulated Browser Chrome / Pending Notices */}
              {raceBranches.length > 0 ? (
                <div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-900">
                    <Zap className="w-4 h-4 text-amber-500" />
                    Race Mode 双方案对比：请先采用一个方案合入草稿，方可迭代或发布
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {raceBranches.map((br) => {
                      const usable =
                        Boolean(br.previewHtml) && br.errors.length === 0;
                      return (
                        <button
                          key={br.branchId}
                          type="button"
                          disabled={!usable || Boolean(busyAction)}
                          onClick={() => void handleSelectBranch(br.branchId)}
                          className="rounded-full border border-black/[0.1] bg-white px-3 py-1 text-xs font-medium text-[#0c0c0c]/90 hover:border-[#4267ff] hover:text-[#4267ff] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {usable ? `采用 ${br.label}` : `${br.label} 编译失败`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                hasPendingPlanConfirmation &&
                hasDraft && (
                  <div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-4 py-2 text-xs text-amber-900">
                    新方案待确认：当前展示已有草稿预览，确认 Emma 新方案前草稿与先前的独立发布页均保持不变。
                  </div>
                )
              )}

              {snapshot?.previewHtml && raceBranches.length === 0 && (
                <div className="h-9 shrink-0 border-b border-black/[0.06] bg-[#fcfcfb] px-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-atoms-mono text-[11px] rounded-full bg-black/[0.04] px-2.5 py-0.5 text-[#0c0c0c]/65 truncate">
                      {project?.publishedVersion
                        ? `/s/${project.slug}`
                        : '草稿实时预览'}
                    </span>
                  </div>
                  {project?.publishedVersion ? (
                    <a
                      href={`/s/${project.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4267ff] hover:underline shrink-0"
                    >
                      打开线上 v{project.publishedVersion}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : null}
                </div>
              )}

              {raceBranches.length > 0 ? (
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-[#f8f8f6] min-h-0">
                  {raceBranches.map((br) => {
                    const usable =
                      Boolean(br.previewHtml) && br.errors.length === 0;
                    return (
                      <div
                        key={br.branchId}
                        className="flex flex-col rounded-xl border border-black/[0.08] bg-white overflow-hidden min-h-0 shadow-[0_1px_4px_rgba(12,12,12,0.04)]"
                      >
                        <div className="h-10 shrink-0 bg-[#fcfcfb] px-3 flex items-center justify-between border-b border-black/[0.06]">
                          <span className="text-xs font-semibold text-[#0c0c0c]/90">
                            {br.label}
                          </span>
                          <button
                            type="button"
                            disabled={!usable || Boolean(busyAction)}
                            onClick={() => void handleSelectBranch(br.branchId)}
                            className="rounded-full bg-[#4267ff] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#425ce1] disabled:bg-black/15 disabled:text-black/40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            {usable ? '采用此方案' : '编译失败不可采用'}
                          </button>
                        </div>
                        {br.previewHtml ? (
                          <iframe
                            title={br.label}
                            srcDoc={br.previewHtml}
                            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
                            className="w-full flex-1 bg-white"
                          />
                        ) : (
                          <div className="p-4 text-xs text-[#b72027]">
                            编译失败：{br.errors.map((e) => e.message).join('; ')}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : snapshot?.previewHtml ? (
                <div className="flex-1 min-h-0 w-full flex items-center justify-center bg-[#f8f8f6] p-3">
                  <iframe
                    title="应用实时预览"
                    srcDoc={snapshot.previewHtml}
                    sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
                    className={
                      viewport === 'mobile'
                        ? 'w-[390px] h-full max-h-[844px] rounded-[28px] border-[6px] border-[#0c0c0c]/85 bg-white shadow-xl'
                        : 'w-full h-full rounded-xl border border-black/[0.06] bg-white'
                    }
                  />
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3 bg-[#fcfcfb]">
                  <div className="w-12 h-12 rounded-2xl border border-black/[0.08] bg-white flex items-center justify-center shadow-xs">
                    <Sparkles className="w-5 h-5 text-[#4267ff]" />
                  </div>
                  <h2 className="text-sm font-semibold text-[#0c0c0c]/90">
                    等待构建首版应用预览
                  </h2>
                  <p className="text-xs text-[#0c0c0c]/55 max-w-md leading-relaxed">
                    {hasPendingPlanConfirmation
                      ? '请在左侧 Emma 产品方案确认卡中审阅需求，点击「确认方案并让 Alex 开始构建」即可在此处渲染实时交互预览。'
                      : '在左侧输入产品想法后，Iris 将完成调研、Emma 给出确认卡，Alex 编译完成后将在此自动呈现。'}
                  </p>
                </div>
              )}
            </div>
          )}

          {rightTab === 'code' && (
            <div className="flex-1 min-h-0 grid grid-cols-12 rounded-2xl border border-black/[0.08] bg-white overflow-hidden shadow-[0_2px_10px_rgba(12,12,12,0.04)]">
              {/* Light File Tree (~240px on desktop) */}
              <div className="col-span-12 md:col-span-4 lg:col-span-3 border-b md:border-b-0 md:border-r border-black/[0.06] bg-[#f8f8f6] flex flex-col min-h-0">
                <div className="p-2.5 border-b border-black/[0.06]">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#0c0c0c]/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={fileFilter}
                      onChange={(e) => setFileFilter(e.target.value)}
                      placeholder="搜索源码文件..."
                      className="w-full rounded-lg border border-black/[0.08] bg-white pl-8 pr-2.5 py-1.5 text-xs text-[#0c0c0c]/85 placeholder:text-[#0c0c0c]/35 focus:border-[#4267ff] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                  {filteredFileNames.length === 0 ? (
                    <p className="text-xs text-[#0c0c0c]/45 p-3 text-center">
                      {fileNames.length === 0
                        ? '尚未生成源码文件'
                        : '没有匹配的文件'}
                    </p>
                  ) : (
                    filteredFileNames.map((filePath) => {
                      const active = selectedFile === filePath;
                      return (
                        <button
                          key={filePath}
                          type="button"
                          onClick={() => {
                            setSelectedFile(filePath);
                            setIsEditingCode(false);
                            setCodeSaveBanner(null);
                            setCodeCompileErrors([]);
                          }}
                          className={
                            active
                              ? 'w-full text-left flex items-center gap-2 rounded-lg bg-[#4267ff]/12 px-2.5 py-1.5 text-xs font-atoms-mono font-medium text-[#4267ff] cursor-pointer'
                              : 'w-full text-left flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-atoms-mono text-[#0c0c0c]/70 hover:bg-black/[0.04] hover:text-[#0c0c0c] cursor-pointer'
                          }
                        >
                          <FileCode className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{filePath}</span>
                        </button>
                      );
                    })
                  )}
                </div>

                {hasDraft && activeId && (
                  <div className="p-2.5 border-t border-black/[0.06]">
                    <a
                      href={`/api/projects/${activeId}/export`}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-full border border-black/[0.1] bg-white py-1.5 text-xs font-medium text-[#0c0c0c]/85 hover:bg-black/[0.03] transition"
                    >
                      <Download className="w-3.5 h-3.5" />
                      导出项目 ZIP
                    </a>
                  </div>
                )}
              </div>

              {/* Light High-Contrast Code Viewer & Inline Editor */}
              <div className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col min-h-0 bg-white">
                {selectedFile && selectedFile in draftFiles ? (
                  <>
                    <div className="h-10 shrink-0 border-b border-black/[0.06] bg-[#fcfcfb] px-4 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-atoms-mono font-medium text-[#0c0c0c]/85 truncate">
                          {selectedFile}
                        </span>
                        {isEditingCode && (
                          <span className="rounded-full bg-[#4267ff]/10 px-2 py-0.5 text-[10px] font-medium text-[#4267ff] shrink-0">
                            编辑中
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(
                              isEditingCode
                                ? codeDraft
                                : (draftFiles[selectedFile] ?? '')
                            );
                            setCopiedCode(true);
                            setTimeout(() => setCopiedCode(false), 1500);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/75 hover:text-[#0c0c0c] cursor-pointer"
                        >
                          {copiedCode ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          {copiedCode ? '已复制' : '复制代码'}
                        </button>

                        {isEditingCode ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setIsEditingCode(false);
                                setCodeDraft(draftFiles[selectedFile] ?? '');
                                setCodeCompileErrors([]);
                                setCodeSaveBanner(null);
                              }}
                              className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-white px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/70 hover:text-[#0c0c0c] cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                              取消
                            </button>
                            <button
                              type="button"
                              disabled={
                                savingCode ||
                                isMutationLocked ||
                                Boolean(busyAction)
                              }
                              title={iterateBlockReason ?? undefined}
                              onClick={() => void handleSaveSourceCode()}
                              className="inline-flex items-center gap-1 rounded-full bg-[#4267ff] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#425ce1] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <Save className="w-3 h-3" />
                              {savingCode ? '编译中...' : '保存并重新编译'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={isMutationLocked || Boolean(busyAction)}
                            title={iterateBlockReason ?? undefined}
                            onClick={() => {
                              setCodeDraft(draftFiles[selectedFile] ?? '');
                              setCodeSaveBanner(null);
                              setCodeCompileErrors([]);
                              setIsEditingCode(true);
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] bg-white px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/85 hover:border-[#4267ff]/40 hover:text-[#4267ff] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <Pencil className="w-3 h-3" />
                            编辑源码
                          </button>
                        )}
                      </div>
                    </div>

                    {codeSaveBanner && (
                      <div
                        className={`border-b px-4 py-2 text-xs flex items-center justify-between gap-2 ${
                          codeSaveBanner.ok
                            ? 'border-emerald-600/20 bg-emerald-500/[0.08] text-emerald-800'
                            : 'border-[#c9444a]/25 bg-[#c9444a]/10 text-[#b72027]'
                        }`}
                      >
                        <span>{codeSaveBanner.message}</span>
                        {codeSaveBanner.ok && (
                          <button
                            type="button"
                            onClick={() => setRightTab('preview')}
                            className="font-semibold text-[#4267ff] hover:underline shrink-0 cursor-pointer"
                          >
                            去预览查看 →
                          </button>
                        )}
                      </div>
                    )}

                    {codeCompileErrors.length > 0 && (
                      <div className="border-b border-[#c9444a]/20 bg-[#c9444a]/[0.05] px-4 py-2.5 space-y-1 text-[11px] text-[#b72027]">
                        {codeCompileErrors.map((err, idx) => (
                          <div key={idx} className="font-atoms-mono">
                            {err.file ? `${err.file}` : selectedFile}
                            {err.line ? `:${err.line}` : ''} — {err.message}
                          </div>
                        ))}
                      </div>
                    )}

                    {isEditingCode ? (
                      <textarea
                        aria-label="在线源码编辑器"
                        value={codeDraft}
                        onChange={(e) => setCodeDraft(e.target.value)}
                        spellCheck={false}
                        className="flex-1 w-full resize-none bg-[#fcfcfb] p-4 font-atoms-mono text-xs leading-6 text-[#0c0c0c]/90 focus:outline-none"
                      />
                    ) : (
                      <div className="flex-1 overflow-auto p-4 font-atoms-mono text-xs leading-6">
                        {codeLines.map((line, i) => (
                          <div key={i} className="flex gap-4 hover:bg-black/[0.02]">
                            <span className="w-8 shrink-0 select-none text-right text-[#0c0c0c]/30 tabular-nums">
                              {i + 1}
                            </span>
                            <span className="whitespace-pre text-[#0c0c0c]/90">
                              {line || ' '}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-[#0c0c0c]/45">
                    请选择左侧源码文件查看内容
                  </div>
                )}
              </div>
            </div>
          )}

          {rightTab === 'cloud' && (
            <div className="flex-1 min-h-0 rounded-2xl border border-black/[0.08] bg-white overflow-hidden shadow-[0_2px_10px_rgba(12,12,12,0.04)]">
              {activeId ? (
                <CloudDataPanel projectId={activeId} />
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-2 text-xs text-[#0c0c0c]/50">
                  <Database className="w-6 h-6 text-[#0c0c0c]/30" />
                  <p>请先创建或选择一个项目，即可查看 Cloud 持久化数据与注册用户。</p>
                </div>
              )}
            </div>
          )}

          {rightTab === 'overview' && project && (
            <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl border border-black/[0.08] bg-[#fcfcfb] p-6 shadow-[0_2px_10px_rgba(12,12,12,0.04)]">
              <div className="max-w-3xl mx-auto space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-[#0c0c0c]/95">
                        {project.title}
                      </h2>
                      <StatusPill
                        status={project.status}
                        publishedVersion={project.publishedVersion}
                      />
                    </div>
                    <p className="text-xs text-[#0c0c0c]/60 max-w-xl leading-relaxed">
                      {project.plan?.summary ?? '等待完成产品规划与构建后展示应用摘要。'}
                    </p>
                  </div>
                </div>

                {/* Publish Hero Bento Card */}
                <div className="rounded-2xl border border-black/[0.08] bg-white p-5 flex flex-wrap items-center justify-between gap-4 shadow-[0_1px_4px_rgba(12,12,12,0.03)]">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-[#0c0c0c]/95">
                      {project.publishedVersion > 0
                        ? `当前线上版本：v${project.publishedVersion}`
                        : '准备就绪后可发布独立生产站点'}
                    </div>
                    <p className="text-xs text-[#0c0c0c]/55">
                      {publishBlockReason ??
                        '发布后通过 /s/[slug] 独立输出生产级 HTML，与草稿编辑严格隔离。'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={
                      !hasDraft ||
                      Boolean(publishBlockReason) ||
                      Boolean(busyAction)
                    }
                    title={publishBlockReason ?? undefined}
                    onClick={() => void handlePublish()}
                    className="rounded-full bg-[#0c0c0c] px-5 py-2 text-xs font-semibold text-white hover:bg-[#0c0c0c]/85 transition disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {project.publishedVersion > 0 ? '更新发布应用' : '发布应用'}
                  </button>
                </div>

                {/* Structured Overview Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div className="rounded-xl border border-black/[0.08] bg-white p-4 space-y-2">
                    <div className="text-xs font-semibold text-[#0c0c0c]/85">
                      独立访问地址 & 二维码
                    </div>
                    {project.publishedVersion > 0 && snapshot?.publicUrl ? (
                      <div className="space-y-2">
                        <a
                          href={snapshot.publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-atoms-mono text-xs text-[#4267ff] hover:underline break-all"
                        >
                          {snapshot.publicUrl}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </div>
                    ) : (
                      <p className="text-xs text-[#0c0c0c]/50">
                        尚未发布，目标路径：<span className="font-atoms-mono">/s/{project.slug}</span>
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border border-black/[0.08] bg-white p-4 space-y-1.5">
                    <div className="text-xs font-semibold text-[#0c0c0c]/85">
                      SEO 与社媒 OpenGraph
                    </div>
                    <div className="text-xs text-[#0c0c0c]/80 font-medium truncate">
                      {project.plan?.seo?.title ?? project.title}
                    </div>
                    <p className="text-[11px] text-[#0c0c0c]/55 line-clamp-2">
                      {project.plan?.seo?.description ??
                        project.plan?.summary ??
                        '发布时自动注入 <title> 与 og:title / og:description 标签'}
                    </p>
                  </div>

                  <div className="rounded-xl border border-black/[0.08] bg-white p-4 space-y-2">
                    <div className="text-xs font-semibold text-[#0c0c0c]/85">
                      已启用云端能力
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {project.capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="rounded-full bg-[#4267ff]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#4267ff] uppercase"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setRightTab('cloud')}
                      className="text-[11px] font-medium text-[#4267ff] hover:underline cursor-pointer"
                    >
                      查看实时持久化集合与用户 →
                    </button>
                  </div>

                  <div className="rounded-xl border border-black/[0.08] bg-white p-4 space-y-2">
                    <div className="text-xs font-semibold text-[#0c0c0c]/85">
                      源码文件与导出
                    </div>
                    <p className="text-xs text-[#0c0c0c]/55">
                      当前草稿包含 {fileNames.length} 个源码文件，支持在线浏览与整站 ZIP 下载。
                    </p>
                    {hasDraft && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setRightTab('code')}
                          className="text-[11px] font-medium text-[#4267ff] hover:underline cursor-pointer"
                        >
                          浏览源码 →
                        </button>
                        <a
                          href={`/api/projects/${project.id}/export`}
                          className="text-[11px] font-medium text-[#0c0c0c]/75 hover:underline"
                        >
                          下载 ZIP
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
            </>
          )}
        </main>
      </div>
      <StyleThemeModal
        open={Boolean(themeModalMode)}
        mode={themeModalMode ?? 'emma'}
        onClose={() => setThemeModalMode(null)}
        selectedThemeId={
          themeModalMode === 'emma'
            ? (editablePlan?.designSystem?.themeId ?? 'auto')
            : selectedThemeId
        }
        builtinThemes={BUILTIN_STYLE_THEMES}
        customThemes={customThemes}
        onSelectTheme={handleApplyThemeSelection}
        onSaveCustomTheme={handleSaveCustomTheme}
        onDeleteCustomTheme={handleDeleteCustomTheme}
        onImportCustomThemes={handleImportCustomThemes}
      />
    </div>
  );
}
