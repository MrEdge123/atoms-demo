'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Globe, Rocket, X } from 'lucide-react';
import type { Project } from '@/domain';

interface SharePublishPopoverProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  publicUrl: string | null;
  qrDataUrl: string | null;
  hasDraft: boolean;
  publishBlockReason: string | null;
  busyAction: string;
  onPublish: () => void;
}

/**
 * Atoms-style compact share & publish popover showing live URL, QR code,
 * SEO metadata preview, ZIP export, and primary Publish trigger.
 */
export function SharePublishPopover({
  open,
  onClose,
  project,
  publicUrl,
  qrDataUrl,
  hasDraft,
  publishBlockReason,
  busyAction,
  onPublish,
}: SharePublishPopoverProps) {
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open, onClose]);

  if (!open) return null;

  const isPublished = project.publishedVersion > 0 && Boolean(publicUrl);
  const publishDisabled =
    !hasDraft || Boolean(publishBlockReason) || Boolean(busyAction);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="分享与发布设置"
      className="absolute right-0 top-full mt-2 z-50 w-[340px] rounded-2xl border border-black/[0.1] bg-white p-4 shadow-[0_12px_36px_rgba(12,12,12,0.12)] space-y-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isPublished ? 'bg-emerald-500' : 'bg-black/25'
            }`}
          />
          <span className="text-xs font-semibold text-[#0c0c0c]/95">
            {isPublished
              ? `线上站点 · v${project.publishedVersion} 已上线`
              : '发布独立生产站点'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭发布弹窗"
          className="rounded-full p-1 text-[#0c0c0c]/45 hover:bg-black/[0.05] hover:text-[#0c0c0c] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {isPublished && publicUrl ? (
        <>
          <div className="rounded-xl border border-black/[0.08] bg-[#f8f8f6] p-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-3.5 h-3.5 text-[#4267ff] shrink-0" />
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="font-atoms-mono text-[11px] text-[#0c0c0c]/85 hover:text-[#4267ff] truncate"
              >
                {publicUrl}
              </a>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(publicUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-white border border-black/10 px-2.5 py-1 text-[11px] font-medium text-[#0c0c0c]/80 hover:bg-black/[0.03] shrink-0 cursor-pointer"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-600" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              {copied ? '已复制' : '复制'}
            </button>
          </div>

          {qrDataUrl && (
            <div className="rounded-xl border border-black/[0.06] bg-[#fcfcfb] p-3 flex items-center gap-3.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrDataUrl}
                alt="站点二维码"
                className="w-20 h-20 rounded-lg border border-black/[0.06] bg-white p-1 shrink-0"
              />
              <div className="min-w-0 space-y-1">
                <div className="text-xs font-medium text-[#0c0c0c]/90 truncate">
                  {project.plan?.seo?.title ?? project.title}
                </div>
                <p className="text-[11px] text-[#0c0c0c]/55 line-clamp-2">
                  {project.plan?.seo?.description ??
                    project.plan?.summary ??
                    '扫码直接在手机端打开独立发布的站点'}
                </p>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4267ff] hover:underline"
                >
                  新窗口打开站点
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-black/[0.06] bg-[#f8f8f6] p-3 space-y-1">
          <div className="text-xs font-medium text-[#0c0c0c]/85">
            访问路径：/s/{project.slug}
          </div>
          <p className="text-[11px] text-[#0c0c0c]/55 leading-relaxed">
            发布后将注入真实 SEO & OpenGraph 元信息、生成分享二维码，并与当前工作台草稿保持隔离。
          </p>
        </div>
      )}

      {publishBlockReason && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900">
          {publishBlockReason}
        </div>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        {hasDraft && (
          <a
            href={`/api/projects/${project.id}/export`}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-black/[0.1] bg-white px-3.5 py-2 text-xs font-medium text-[#0c0c0c]/85 hover:bg-[#f8f8f6] transition shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            导出 ZIP
          </a>
        )}
        <button
          type="button"
          disabled={publishDisabled}
          title={publishBlockReason ?? undefined}
          onClick={onPublish}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-[#4267ff] px-4 py-2 text-xs font-semibold text-white hover:bg-[#425ce1] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Rocket className="w-3.5 h-3.5" />
          {isPublished
            ? `更新发布 v${project.publishedVersion + 1}`
            : '立即发布独立站点'}
        </button>
      </div>
    </div>
  );
}
