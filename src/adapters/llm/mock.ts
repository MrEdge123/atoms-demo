import type {
  DesignScenarioId,
  ProductPlan,
  VirtualFS,
} from '../../domain';
import type { LLMProvider, ModelInfo, SchemaLike } from '../../ports';
import { DESIGN_SCENARIOS, type AlexFilesOutput } from '../../core';

function extractSection(text: string, marker: string, stopMarker?: string): string {
  const idx = text.indexOf(marker);
  if (idx === -1) return '';
  const after = text.slice(idx + marker.length);
  if (stopMarker) {
    const stopIdx = after.indexOf(stopMarker);
    if (stopIdx !== -1) {
      return after.slice(0, stopIdx).trim();
    }
  }
  return after.trim();
}

function extractJsonAfterMarker<T>(text: string, marker: string): T | null {
  const markerIdx = text.indexOf(marker);
  if (markerIdx === -1) return null;
  const start = text.indexOf('{', markerIdx + marker.length);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function deriveItemLabel(
  plan: ProductPlan | null,
  existingAppTsx: string,
  fallbackLabel: string
): string {
  const desc = plan?.collections?.[0]?.description?.trim();
  if (desc) {
    const cleaned = desc
      .replace(/(云端持久化集合|持久化集合|数据集合|集合)$/u, '')
      .trim();
    if (cleaned) return cleaned;
  }
  const headingMatch = existingAppTsx.match(/<h2[^>]*>新增([^<]+)<\/h2>/);
  if (headingMatch?.[1]?.trim()) {
    return headingMatch[1].trim();
  }
  return fallbackLabel;
}

function inferDomainTemplate(ideaText: string): {
  appName: string;
  summary: string;
  collection: string;
  itemLabel: string;
  fields: string[];
  scenario: DesignScenarioId;
} {
  const lower = ideaText.toLowerCase();
  if (lower.includes('crm') || lower.includes('客户') || lower.includes('leads')) {
    return {
      appName: 'PulseCRM 轻量客户跟进台',
      summary: '面向独立顾问与小团队的线索管理、跟进记录与成单看板。',
      collection: 'leads',
      itemLabel: '客户线索',
      fields: ['name', 'company', 'stage', 'notes'],
      scenario: 'B',
    };
  }
  if (
    lower.includes('笔记') ||
    lower.includes('note') ||
    lower.includes('知识') ||
    lower.includes('inkvault')
  ) {
    return {
      appName: 'InkVault 云端轻量笔记站',
      summary: '支持账号登录、标签整理与 Pro 会员高级导出的数据持久化笔记应用。',
      collection: 'notes',
      itemLabel: '笔记条目',
      fields: ['title', 'tag', 'content', 'pinned'],
      scenario: 'E',
    };
  }
  return {
    appName: 'EventFlow 活动报名与签到站',
    summary: '支持在线报名提交、签到状态管理、账号登录与 Pro 高级导出的全栈 Web 应用。',
    collection: 'registrations',
    itemLabel: '报名记录',
    fields: ['name', 'contact', 'status', 'remark'],
    scenario: 'B',
  };
}

function parseHexRgba(
  hex: string
): { r: number; g: number; b: number; a: number } | null {
  const cleaned = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  if (cleaned.length === 3 || cleaned.length === 4) {
    const r = Number.parseInt(`${cleaned[0]}${cleaned[0]}`, 16) / 255;
    const g = Number.parseInt(`${cleaned[1]}${cleaned[1]}`, 16) / 255;
    const b = Number.parseInt(`${cleaned[2]}${cleaned[2]}`, 16) / 255;
    const a =
      cleaned.length === 4
        ? Number.parseInt(`${cleaned[3]}${cleaned[3]}`, 16) / 255
        : 1;
    return { r, g, b, a };
  }
  if (cleaned.length === 6 || cleaned.length === 8) {
    const r = Number.parseInt(cleaned.slice(0, 2), 16) / 255;
    const g = Number.parseInt(cleaned.slice(2, 4), 16) / 255;
    const b = Number.parseInt(cleaned.slice(4, 6), 16) / 255;
    const a =
      cleaned.length === 8
        ? Number.parseInt(cleaned.slice(6, 8), 16) / 255
        : 1;
    return { r, g, b, a };
  }
  return null;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function pickReadableButtonTextClass(
  accentHex: string,
  surfaceHex: string
): 'text-white' | 'text-[#0F1115]' | 'text-black' {
  const accent = parseHexRgba(accentHex);
  if (!accent) return 'text-white';
  const rawSurface = parseHexRgba(surfaceHex) ?? { r: 1, g: 1, b: 1, a: 1 };
  // Composite translucent surface over white backdrop first, then composite accent over surface
  const sr = rawSurface.r * rawSurface.a + (1 - rawSurface.a);
  const sg = rawSurface.g * rawSurface.a + (1 - rawSurface.a);
  const sb = rawSurface.b * rawSurface.a + (1 - rawSurface.a);
  const r = accent.r * accent.a + sr * (1 - accent.a);
  const g = accent.g * accent.a + sg * (1 - accent.a);
  const b = accent.b * accent.a + sb * (1 - accent.a);

  const lum = relativeLuminance(r, g, b);
  const whiteContrast = 1.05 / (lum + 0.05);
  const inkLum = relativeLuminance(0x0f / 255, 0x11 / 255, 0x15 / 255);
  const inkContrast = (lum + 0.05) / (inkLum + 0.05);
  const blackContrast = (lum + 0.05) / 0.05;

  if (whiteContrast >= 4.5 && whiteContrast >= inkContrast) {
    return 'text-white';
  }
  if (inkContrast >= 4.5) {
    return 'text-[#0F1115]';
  }
  if (blackContrast >= 4.5) {
    return 'text-black';
  }
  return whiteContrast >= blackContrast ? 'text-white' : 'text-black';
}

function buildMockReactFiles(opts: {
  appName: string;
  summary: string;
  collection: string;
  itemLabel: string;
  darkTheme: boolean;
  deepBlueAccent: boolean;
  includeCsvButton: boolean;
  palette?: {
    background: string;
    surface: string;
    textPrimary: string;
    textMuted: string;
    accent: string;
  };
  headingStyle?: 'editorial-serif' | 'geometric-sans' | 'minimal-sans';
  actionSummary?: string;
}): AlexFilesOutput {
  const customBg = opts.palette?.background;
  const customSurface = opts.palette?.surface;
  const customText = opts.palette?.textPrimary;
  const customMuted = opts.palette?.textMuted;
  const customAccent = opts.palette?.accent;

  const bgClass = customBg
    ? opts.darkTheme && customBg.toLowerCase() === '#020617'
      ? `min-h-screen bg-slate-950 text-[${customText ?? '#F1F5F9'}]`
      : `min-h-screen bg-[${customBg}] text-[${customText ?? (opts.darkTheme ? '#F3F4F6' : '#141413')}]`
    : opts.darkTheme
      ? 'min-h-screen bg-slate-950 text-slate-100'
      : 'min-h-screen bg-slate-50 text-slate-900';

  const cardClass = customSurface
    ? opts.darkTheme
      ? `rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[${customSurface}]`
      : `rounded-2xl border border-[rgba(12,12,12,0.08)] bg-[${customSurface}]`
    : opts.darkTheme
      ? 'rounded-2xl border border-slate-800 bg-slate-900/90 shadow-lg'
      : 'rounded-2xl border border-slate-200 bg-white shadow-sm';

  const inputClass = opts.darkTheme
    ? 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none'
    : 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none';
  const effectiveSurfaceHex =
    customSurface ?? customBg ?? (opts.darkTheme ? '#0F172A' : '#FFFFFF');
  const primaryBtn = opts.deepBlueAccent
    ? 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-900 transition disabled:opacity-50'
    : customAccent
      ? `inline-flex items-center justify-center gap-1.5 rounded-full bg-[${customAccent}] px-4 py-2.5 text-sm font-semibold ${pickReadableButtonTextClass(customAccent, effectiveSurfaceHex)} hover:shadow-md hover:ring-2 hover:ring-offset-1 hover:ring-current/25 transition disabled:opacity-50`
      : opts.darkTheme
        ? 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition disabled:opacity-50'
        : 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-50';
  const mutedText = customMuted
    ? `text-[${customMuted}]`
    : opts.darkTheme
      ? 'text-slate-400'
      : 'text-slate-500';
  const rowBorder = opts.darkTheme ? 'border-slate-800' : 'border-slate-100';
  const headingFontClass =
    opts.headingStyle === 'editorial-serif' ? 'font-editorial ' : '';

  const authCardTsx = `import React, { useState } from 'react';
import { auth, type CloudUser } from '@atoms/cloud';
import { LogIn, LogOut, UserPlus, Crown } from 'lucide-react';

interface AuthBarProps {
  user: CloudUser | null;
  onUserChange: (user: CloudUser | null) => void;
  onUpgrade: () => void;
  upgrading: boolean;
}

export function AuthBar({ user, onUserChange, onUpgrade, upgrading }: AuthBarProps) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res =
        mode === 'register'
          ? await auth.register(email, password, name || undefined)
          : await auth.login(email, password);
      onUserChange(res.user);
      setPassword('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className="${cardClass} p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-indigo-500/15 text-indigo-500 flex items-center justify-center font-bold text-sm">
            {(user.name || user.email).slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span>{user.name || user.email}</span>
              <span className={user.plan === 'pro' ? 'rounded-full bg-amber-500/20 text-amber-500 px-2 py-0.5 text-xs font-semibold' : 'rounded-full bg-slate-500/15 px-2 py-0.5 text-xs ${mutedText}'}>
                {user.plan === 'pro' ? 'PRO 会员' : 'Free 免费版'}
              </span>
            </div>
            <p className="text-xs ${mutedText}">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user.plan !== 'pro' && (
            <button
              type="button"
              disabled={upgrading}
              onClick={onUpgrade}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition disabled:opacity-50"
            >
              <Crown className="w-3.5 h-3.5" />
              {upgrading ? '创建收银台...' : '升级 Pro 解锁导出'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              auth.logout();
              onUserChange(null);
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-300/30 px-3 py-2 text-xs font-medium hover:opacity-80"
          >
            <LogOut className="w-3.5 h-3.5" />
            退出
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="${cardClass} p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">账号认证（支持跨设备持久化与 Pro 订阅）</span>
        <button
          type="button"
          onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
          className="text-xs font-medium text-indigo-500 hover:underline"
        >
          {mode === 'register' ? '已有账号？去登录' : '没有账号？去注册'}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {mode === 'register' && (
          <input
            type="text"
            placeholder="昵称（可选）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="${inputClass}"
          />
        )}
        <input
          type="email"
          required
          placeholder="邮箱地址"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="${inputClass}"
        />
        <input
          type="password"
          required
          minLength={4}
          placeholder="密码（至少4位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="${inputClass}"
        />
      </div>
      {err && <p className="text-xs text-rose-500">{err}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="${primaryBtn}">
          {mode === 'register' ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          {busy ? '处理中...' : mode === 'register' ? '注册并登录' : '立即登录'}
        </button>
      </div>
    </form>
  );
}
`;

  const appTsx = `import React, { useEffect, useMemo, useState } from 'react';
import { auth, billing, db, type CloudRecord, type CloudUser } from '@atoms/cloud';
import { CheckCircle2, Download, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import { AuthBar } from './components/AuthBar';

interface ItemPayload {
  title: string;
  contact: string;
  status: 'pending' | 'done';
  note: string;
}

const COLLECTION = ${JSON.stringify(opts.collection)};

export default function App() {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [records, setRecords] = useState<CloudRecord<ItemPayload>[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const [title, setTitle] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [me, list] = await Promise.all([
        auth.me(),
        db.list<ItemPayload>(COLLECTION),
      ]);
      setUser(me);
      setRecords(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await db.create<ItemPayload>(COLLECTION, {
        title: title.trim(),
        contact: contact.trim() || '未填写',
        status: 'pending',
        note: note.trim(),
      });
      setRecords((prev) => [created, ...prev]);
      setTitle('');
      setContact('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(record: CloudRecord<ItemPayload>) {
    try {
      const nextStatus = record.data.status === 'done' ? 'pending' : 'done';
      const updated = await db.update<ItemPayload>(COLLECTION, record.id, {
        status: nextStatus,
      });
      setRecords((prev) => prev.map((r) => (r.id === record.id ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    try {
      await db.remove(COLLECTION, id);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleUpgrade() {
    setUpgrading(true);
    setError('');
    try {
      await billing.checkout('pro');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpgrading(false);
    }
  }

  function handleExportCsv() {
    const header = 'ID,名称,联系信息,状态,备注,创建时间\\n';
    const rows = records
      .map((r) =>
        [r.id, r.data.title, r.data.contact, r.data.status, r.data.note, r.createdAt]
          .map((cell) => '"' + String(cell || '').replace(/"/g, '""') + '"')
          .join(',')
      )
      .join('\\n');
    const blob = new Blob(['\\ufeff' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = COLLECTION + '-export.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.data.title.toLowerCase().includes(q) ||
        r.data.contact.toLowerCase().includes(q) ||
        (r.data.note || '').toLowerCase().includes(q)
    );
  }, [records, query]);

  const doneCount = records.filter((r) => r.data.status === 'done').length;
  const canExportCsv = ${opts.includeCsvButton ? 'true' : "user?.plan === 'pro'"};

  return (
    <div className="${bgClass}" data-color-mode="${opts.darkTheme ? 'dark' : 'light'}">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-500">
              <Sparkles className="w-3.5 h-3.5" />
              在线实时工作台
            </div>
            <h1 className="${headingFontClass}text-2xl sm:text-3xl font-bold tracking-tight">${opts.appName}</h1>
            <p className="text-sm ${mutedText}">${opts.summary}</p>
          </div>
          <div className="flex items-center gap-2">
            {canExportCsv && (
              <button type="button" onClick={handleExportCsv} className="${primaryBtn}">
                <Download className="w-4 h-4" />
                导出 CSV
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadAll()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300/30 px-3.5 py-2.5 text-sm font-medium hover:opacity-80"
            >
              <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
              刷新同步
            </button>
          </div>
        </header>

        <AuthBar
          user={user}
          onUserChange={setUser}
          onUpgrade={() => void handleUpgrade()}
          upgrading={upgrading}
        />

        <div className="grid grid-cols-3 gap-3">
          <div className="${cardClass} p-4">
            <p className="text-xs ${mutedText}">总记录数</p>
            <p className="mt-1 text-2xl font-bold">{records.length}</p>
          </div>
          <div className="${cardClass} p-4">
            <p className="text-xs ${mutedText}">已完成 / 已签到</p>
            <p className="mt-1 text-2xl font-bold text-emerald-500">{doneCount}</p>
          </div>
          <div className="${cardClass} p-4">
            <p className="text-xs ${mutedText}">待处理</p>
            <p className="mt-1 text-2xl font-bold text-amber-500">{records.length - doneCount}</p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="${cardClass} p-5 space-y-3">
          <h2 className="text-base font-semibold">新增${opts.itemLabel}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              required
              placeholder="标题 / 姓名"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="${inputClass}"
            />
            <input
              type="text"
              placeholder="联系方式 / 公司"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="${inputClass}"
            />
            <input
              type="text"
              placeholder="备注信息"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="${inputClass}"
            />
          </div>
          {error && <p className="text-xs text-rose-500">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={submitting} className="${primaryBtn}">
              <Plus className="w-4 h-4" />
              {submitting ? '写入云端中...' : '提交并持久化'}
            </button>
          </div>
        </form>

        <section className="${cardClass} p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">云端实时数据列表（跨设备刷新保留）</h2>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${mutedText}" />
              <input
                type="text"
                placeholder="搜索记录..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="${inputClass} pl-9"
              />
            </div>
          </div>

          {loading ? (
            <p className="text-sm ${mutedText} py-6 text-center">正在从云端加载数据...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm ${mutedText} py-6 text-center">暂无记录，请先在上方提交第一条数据。</p>
          ) : (
            <div className="divide-y ${rowBorder}">
              {filtered.map((item) => (
                <div key={item.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{item.data.title}</span>
                      <span className={item.data.status === 'done' ? 'rounded-full bg-emerald-500/15 text-emerald-500 px-2 py-0.5 text-xs' : 'rounded-full bg-amber-500/15 text-amber-500 px-2 py-0.5 text-xs'}>
                        {item.data.status === 'done' ? '已完成' : '待处理'}
                      </span>
                    </div>
                    <p className="text-xs ${mutedText} truncate mt-0.5">
                      {item.data.contact} {item.data.note ? '· ' + item.data.note : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleToggle(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300/30 px-2.5 py-1.5 text-xs hover:opacity-80"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      切换状态
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item.id)}
                      className="inline-flex items-center rounded-lg border border-rose-500/30 p-1.5 text-xs text-rose-500 hover:bg-rose-500/10"
                      aria-label="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
`;

  return {
    summary:
      opts.actionSummary ??
      `已生成 ${opts.appName} 全栈前端应用并接入 @atoms/cloud`,
    files: [
      { path: 'src/components/AuthBar.tsx', content: authCardTsx },
      { path: 'src/App.tsx', content: appTsx },
    ],
  };
}

function resolveMockThemeLabel(input: {
  prompt: string;
  plan: ProductPlan | null;
  darkTheme: boolean;
}): string | undefined {
  const explicitBranchLabel = extractSection(
    input.prompt,
    'Branch Label:',
    '\n'
  );
  if (explicitBranchLabel) {
    return explicitBranchLabel;
  }

  const styleDirSection = extractSection(
    input.prompt,
    'Visual Style Direction:',
    '\n\nReturn all code files'
  );
  if (styleDirSection) {
    const firstLine = styleDirSection.split(/\r?\n/)[0]?.trim() ?? '';
    const colonIdx = firstLine.search(/[:：]/);
    if (colonIdx > 0 && colonIdx <= 48) {
      const candidate = firstLine.slice(0, colonIdx).trim();
      if (candidate) return candidate;
    }
  }

  const ds = input.plan?.designSystem;
  if (ds && (ds.colorMode === 'dark') === input.darkTheme) {
    const label = ds.themeName?.trim() || ds.scenarioName?.trim();
    if (label) return label;
  }

  return undefined;
}

function resolveMockActionSummary(input: {
  prompt: string;
  appName: string;
  plan: ProductPlan | null;
  darkTheme: boolean;
  isFix: boolean;
  isIteration: boolean;
}): string {
  if (input.isFix) {
    return `已修复 ${input.appName} 编译错误并接入 @atoms/cloud`;
  }
  if (input.isIteration) {
    return `已按迭代指令更新 ${input.appName} 全栈前端应用并接入 @atoms/cloud`;
  }
  const themeLabel = resolveMockThemeLabel({
    prompt: input.prompt,
    plan: input.plan,
    darkTheme: input.darkTheme,
  });
  return themeLabel
    ? `已生成 ${input.appName} 全栈前端应用并接入 @atoms/cloud（${themeLabel}）`
    : `已生成 ${input.appName} 全栈前端应用并接入 @atoms/cloud`;
}

/**
 * Deterministic MockLLMProvider for zero-cost L1/L2 testing and offline demos.
 * Supports scripted syntax-error injection to verify the Auto-Fix feedback loop.
 */
export class MockLLMProvider implements LLMProvider {
  private scriptedErrorsRemaining: number;

  constructor(opts?: { scriptedErrorsBeforeFix?: number }) {
    this.scriptedErrorsRemaining = opts?.scriptedErrorsBeforeFix ?? 0;
  }

  listModels(): ModelInfo[] {
    return [
      {
        id: 'mock-default',
        label: 'Mock Studio (离线极速 SOP)',
        provider: 'mock',
        available: true,
      },
      {
        id: 'mock-fast',
        label: 'Mock Turbo (离线轻量响应)',
        provider: 'mock',
        available: true,
      },
    ];
  }

  async generateObject<T>(input: {
    system: string;
    prompt: string;
    schema: SchemaLike<T>;
    model?: string;
    abortSignal?: AbortSignal;
  }): Promise<T> {
    if (input.abortSignal?.aborted) {
      throw (
        input.abortSignal.reason ?? new Error('LLM request aborted')
      );
    }
    if (input.system.startsWith('You are Iris,')) {
      const idea =
        extractSection(
          input.prompt,
          'User Idea:',
          '\n\nProduce a focused'
        ) || input.prompt;
      const template = inferDomainTemplate(idea);
      const output = {
        marketSummary: `围绕“${idea.slice(0, 60)}”，当前中小团队与独立创业者普遍缺乏零配置、开箱即可收款与沉淀数据的轻量化 Web 应用。`,
        targetAudience: '独立开发者、活动主理人、小微团队运营负责人',
        competitorPainPoints: [
          '传统表单工具缺乏独立账号体系与定制工作流',
          '纯静态 AI 原型无法跨设备持久化存储真实业务数据',
          '外包或自建全栈后端部署与支付联调成本过高',
        ],
        differentiators: [
          '自带云端数据持久化与账号体系，刷新或换设备数据不丢',
          '内置 Pro 订阅升级收银台与原生 SEO/OG 分享卡片',
          '一键发布独立公网页面，微信/手机 4G 秒开',
        ],
        recommendedPositioning: `定位为可即刻上线并具备订阅变现能力的「${template.appName}」。`,
      };
      return input.schema.parse(output);
    }

    if (input.system.startsWith('You are Emma,')) {
      const idea =
        extractSection(
          input.prompt,
          'Original Idea:',
          '\n\nIris Research Insights:'
        ) || input.prompt;
      const template = inferDomainTemplate(idea);
      const scenarioDef = DESIGN_SCENARIOS[template.scenario];
      const output = {
        appName: template.appName,
        summary: template.summary,
        targetUsers: '独立创业者、运营人员及终端访客',
        capabilities: ['db', 'auth', 'billing'] as const,
        seo: {
          title: `${template.appName} — 在线实时协作与管理平台`,
          description: template.summary,
        },
        pages: [
          { name: '主工作台与实时列表', purpose: '提交记录、搜索筛选与状态流转' },
          { name: '账号与 Pro 订阅中心', purpose: '注册登录、订阅升级与 CSV 导出' },
        ],
        collections: [
          {
            name: template.collection,
            fields: template.fields,
            description: `${template.itemLabel}云端持久化集合`,
          },
        ],
        designSystem: {
          scenario: scenarioDef.id,
          scenarioName: scenarioDef.name,
          tone: scenarioDef.toneKeywords,
          colorMode: scenarioDef.defaultColorMode,
          palette: scenarioDef.defaultPalette,
          typography: scenarioDef.defaultTypography,
          radiusStyle: scenarioDef.defaultRadiusStyle,
          surfaceDepth: scenarioDef.defaultSurfaceDepth,
          layoutBlueprint: scenarioDef.layoutRules,
          visualFocalPoint: '首屏主标题与核心业务列表形成唯一视觉焦点',
          motionStyle: scenarioDef.motionRules,
          mediaStrategy: scenarioDef.mediaRule,
          antiPatterns: scenarioDef.antiPatterns,
        },
      };
      return input.schema.parse(output);
    }

    // Alex (generate / fix / iterate)
    const isFix = input.prompt.includes('failed compilation/verification');
    if (!isFix && this.scriptedErrorsRemaining > 0) {
      this.scriptedErrorsRemaining -= 1;
      return input.schema.parse({
        summary: 'Initial draft with intentional syntax error for Auto-Fix testing',
        files: [
          {
            path: 'src/App.tsx',
            content:
              'import React from "react";\nexport default function App() { return (<div><<broken_tsx; }',
          },
        ],
      });
    }

    const plan =
      extractJsonAfterMarker<ProductPlan>(input.prompt, 'Product Plan:') ??
      extractJsonAfterMarker<ProductPlan>(
        input.prompt,
        'confirmed ProductPlan:'
      );
    const existingFiles =
      extractJsonAfterMarker<VirtualFS>(
        input.prompt,
        'Current VirtualFS files:'
      ) ?? {};
    const existingAppTsx = existingFiles['src/App.tsx'] ?? '';

    const existingAppName = existingAppTsx
      .match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]
      ?.trim();
    const existingCollection = existingAppTsx.match(
      /const COLLECTION = "([^"]+)";/
    )?.[1];
    const fallbackTemplate = inferDomainTemplate(
      [
        plan?.appName ?? existingAppName ?? '',
        plan?.summary ?? '',
        plan?.collections?.[0]?.name ?? existingCollection ?? '',
      ].join(' ')
    );

    const appName =
      plan?.appName || existingAppName || fallbackTemplate.appName;
    const summary = plan?.summary || fallbackTemplate.summary;
    const collection =
      plan?.collections?.[0]?.name ||
      existingCollection ||
      fallbackTemplate.collection;
    const itemLabel = deriveItemLabel(
      plan,
      existingAppTsx,
      fallbackTemplate.itemLabel
    );

    const isBranchB =
      input.prompt.includes('Branch ID: branch-b') ||
      input.prompt.includes('branch-b') ||
      input.prompt.includes('暗夜极客') ||
      input.prompt.includes('暗调');
    const isIteration = input.prompt.includes('User Iteration Instruction:');
    const instruction = isIteration
      ? extractSection(
          input.prompt,
          'User Iteration Instruction:',
          '\n\nUpdate the necessary files'
        )
      : '';

    const existingDarkTheme =
      existingAppTsx.includes('bg-slate-950') ||
      existingAppTsx.includes('data-color-mode="dark"');
    const existingDeepBlue = existingAppTsx.includes('bg-blue-800');
    const existingCsvAlwaysVisible = existingAppTsx.includes(
      'const canExportCsv = true'
    );
    const planDarkTheme = plan?.designSystem
      ? plan.designSystem.colorMode === 'dark'
      : undefined;

    let darkTheme: boolean;
    let deepBlueAccent: boolean;
    let includeCsvButton: boolean;

    if (isIteration) {
      const wantsLight =
        /(浅色|亮色|白色背景|light\s*mode|light\s*theme)/i.test(instruction);
      const wantsDark =
        /(暗夜|暗色|深色背景|dark\s*mode|dark\s*theme)/i.test(instruction);
      darkTheme = wantsLight ? false : wantsDark ? true : existingDarkTheme;

      const wantsOtherPrimary =
        /(靛蓝|翡翠绿|默认主色|恢复默认|indigo|emerald|purple|rose)/i.test(
          instruction
        );
      const wantsDeepBlue = /(深蓝|蓝色|deep\s*blue|navy)/i.test(instruction);
      deepBlueAccent = wantsOtherPrimary
        ? false
        : wantsDeepBlue
          ? true
          : existingDeepBlue;

      const wantsRemoveCsv =
        /(移除|隐藏|删除|关闭|仅.*pro).*?(csv|导出)/i.test(instruction) ||
        /(csv|导出).*?(仅.*pro|移除|隐藏|删除)/i.test(instruction);
      const wantsCsv = /(csv|导出)/i.test(instruction);
      includeCsvButton = wantsRemoveCsv
        ? false
        : wantsCsv
          ? true
          : existingCsvAlwaysVisible;
    } else if (isFix) {
      darkTheme = existingDarkTheme || (planDarkTheme ?? isBranchB);
      deepBlueAccent = existingDeepBlue;
      includeCsvButton = existingCsvAlwaysVisible;
    } else {
      darkTheme = planDarkTheme ?? isBranchB;
      deepBlueAccent = false;
      includeCsvButton = false;
    }

    const effectivePalette =
      plan?.designSystem &&
      (plan.designSystem.colorMode === 'dark') === darkTheme
        ? plan.designSystem.palette
        : undefined;

    const files = buildMockReactFiles({
      appName,
      summary,
      collection,
      itemLabel,
      darkTheme,
      deepBlueAccent,
      includeCsvButton,
      palette: effectivePalette,
      headingStyle: plan?.designSystem?.typography?.headingStyle,
      actionSummary: resolveMockActionSummary({
        prompt: input.prompt,
        appName,
        plan,
        darkTheme,
        isFix,
        isIteration,
      }),
    });

    return input.schema.parse(files);
  }

  async *streamText(input: {
    system: string;
    prompt: string;
    model?: string;
    maxTokens?: number;
    abortSignal?: AbortSignal;
  }): AsyncIterable<string> {
    if (input.abortSignal?.aborted) {
      throw (
        input.abortSignal.reason ?? new Error('LLM request aborted')
      );
    }
    const text = `MockLLM(${input.model ?? 'mock-default'}): 已响应 "${input.prompt.slice(0, 60)}"`;
    yield input.maxTokens ? text.slice(0, input.maxTokens) : text;
  }
}
