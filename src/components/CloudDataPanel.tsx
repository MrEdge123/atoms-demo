'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Crown, Database, RefreshCw, Trash2, Users } from 'lucide-react';
import type { AppRecord, AppUser } from '@/domain';

interface CollectionSummary {
  name: string;
  count: number;
}

interface CloudDataResponse {
  collections: CollectionSummary[];
  activeCollection: string | null;
  records: AppRecord[];
  users: AppUser[];
}

interface CloudDataPanelProps {
  projectId: string;
}

/**
 * Displays live persisted collections, records, and registered app users
 * for the selected project in Atoms warm-paper Bento styling.
 */
export function CloudDataPanel({ projectId }: CloudDataPanelProps) {
  const [data, setData] = useState<CloudDataResponse | null>(null);
  const [selectedCol, setSelectedCol] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCloud = useCallback(
    async (col?: string | null) => {
      setLoading(true);
      setError('');
      try {
        const qs = col ? `?collection=${encodeURIComponent(col)}` : '';
        const res = await fetch(`/api/projects/${projectId}/cloud${qs}`);
        const json = (await res.json()) as CloudDataResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || '加载 Cloud 数据失败');
        setData(json);
        setSelectedCol(json.activeCollection);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void fetchCloud(null);
  }, [fetchCloud]);

  async function handleDeleteRecord(collection: string, recordId: string) {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/cloud?collection=${encodeURIComponent(collection)}&recordId=${encodeURIComponent(recordId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error || '删除失败');
      }
      await fetchCloud(collection);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="h-full overflow-y-auto p-5 md:p-6 space-y-5 bg-[#fcfcfb] text-[#0c0c0c]/95">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#0c0c0c]/95 flex items-center gap-2">
            <Database className="w-4 h-4 text-[#4267ff]" />
            Atoms Cloud 实时持久化数据
          </h3>
          <p className="text-xs text-[#0c0c0c]/55 mt-0.5">
            线上站点（/s/[slug]）与预览页提交的数据均实时落入 PostgreSQL / PGlite，支持跨重启刷新查看。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchCloud(selectedCol)}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0c0c0c]/85 hover:bg-[#f8f8f6] transition cursor-pointer"
        >
          <RefreshCw
            className={loading ? 'w-3.5 h-3.5 animate-spin text-[#4267ff]' : 'w-3.5 h-3.5'}
          />
          刷新数据
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#c9444a]/30 bg-[#c9444a]/10 p-3 text-xs text-[#b72027]">
          {error}
        </div>
      )}

      {/* Collections Section */}
      <div className="rounded-2xl border border-black/[0.08] bg-white p-5 space-y-4 shadow-[0_1px_4px_rgba(12,12,12,0.03)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#0c0c0c]/50">
            业务数据集合（Collections）
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(data?.collections ?? []).map((col) => (
              <button
                key={col.name}
                type="button"
                onClick={() => void fetchCloud(col.name)}
                className={
                  selectedCol === col.name
                    ? 'rounded-full bg-[#4267ff] px-3 py-1 text-xs font-medium text-white cursor-pointer'
                    : 'rounded-full border border-black/[0.08] bg-[#f8f8f6] px-3 py-1 text-xs text-[#0c0c0c]/75 hover:bg-black/[0.05] cursor-pointer'
                }
              >
                {col.name} ({col.count})
              </button>
            ))}
          </div>
        </div>

        {!selectedCol || (data?.records ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/[0.1] bg-[#fcfcfb] py-8 px-4 text-center text-xs text-[#0c0c0c]/50">
            当前集合暂无持久化记录。可在右侧“实时预览”或公网链接提交表单后点击“刷新数据”。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-black/[0.08] text-[#0c0c0c]/50">
                  <th className="py-2.5 pr-3 font-medium">ID</th>
                  <th className="py-2.5 pr-3 font-medium">记录内容 (JSON)</th>
                  <th className="py-2.5 pr-3 font-medium">创建时间</th>
                  <th className="py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.06]">
                {(data?.records ?? []).map((rec) => (
                  <tr key={rec.id} className="hover:bg-[#f8f8f6]/80 transition-colors">
                    <td className="py-2.5 pr-3 font-atoms-mono text-[#0c0c0c]/55 whitespace-nowrap">
                      {rec.id}
                    </td>
                    <td className="py-2.5 pr-3 font-atoms-mono text-[#0c0c0c]/85 max-w-md break-all">
                      {JSON.stringify(rec.data)}
                    </td>
                    <td
                      suppressHydrationWarning
                      className="py-2.5 pr-3 text-[#0c0c0c]/55 whitespace-nowrap"
                    >
                      {new Date(rec.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDeleteRecord(selectedCol, rec.id)}
                        className="inline-flex items-center gap-1 rounded-full border border-[#c9444a]/25 bg-[#c9444a]/[0.04] px-2.5 py-1 text-[11px] font-medium text-[#b72027] hover:bg-[#c9444a]/10 transition cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* App Users Section */}
      <div className="rounded-2xl border border-black/[0.08] bg-white p-5 space-y-3 shadow-[0_1px_4px_rgba(12,12,12,0.03)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#0c0c0c]/50 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-[#4267ff]" />
            应用注册用户（App Users · {(data?.users ?? []).length}）
          </span>
        </div>

        {(data?.users ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/[0.1] bg-[#fcfcfb] py-6 text-center text-xs text-[#0c0c0c]/50">
            暂无终端注册用户。
          </div>
        ) : (
          <div className="divide-y divide-black/[0.06]">
            {(data?.users ?? []).map((u) => (
              <div
                key={u.id}
                className="py-3 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-[#4267ff]/10 text-[#4267ff] font-semibold flex items-center justify-center shrink-0">
                    {(u.name || u.email).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className="font-medium text-[#0c0c0c]/90">
                        {u.email}
                      </span>
                      {u.name && (
                        <span className="ml-2 text-[#0c0c0c]/55">({u.name})</span>
                      )}
                    </div>
                    <p className="text-[11px] font-atoms-mono text-[#0c0c0c]/45 truncate">
                      {u.id}
                    </p>
                  </div>
                </div>
                <span
                  className={
                    u.plan === 'pro'
                      ? 'inline-flex items-center gap-1 rounded-full bg-[#4267ff]/10 border border-[#4267ff]/25 px-2.5 py-0.5 font-semibold text-[#4267ff] shrink-0'
                      : 'rounded-full bg-black/[0.05] px-2.5 py-0.5 font-medium text-[#0c0c0c]/55 shrink-0'
                  }
                >
                  {u.plan === 'pro' && <Crown className="w-3 h-3" />}
                  {u.plan.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
