'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, CreditCard, Lock, ShieldCheck } from 'lucide-react';

function sanitizeReturnUrl(raw: string | null): string {
  if (!raw) return '/';
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // Ignore malformed return URLs
  }
  return '/';
}

function MockCheckoutInner() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId') ?? '';
  const projectId = searchParams.get('projectId') ?? '';
  const userId = searchParams.get('userId') ?? '';
  const plan = (searchParams.get('plan') ?? 'pro') as 'pro';
  const returnUrl = sanitizeReturnUrl(searchParams.get('returnUrl'));

  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirmPayment() {
    setPaying(true);
    setError('');
    try {
      const res = await fetch('/api/cloud/mock-checkout/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, projectId, userId, plan }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '支付回调校验失败');
      }
      setDone(true);
      setTimeout(() => {
        window.location.assign(returnUrl);
      }, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f8f6] text-[#0c0c0c]/95 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-black/[0.1] bg-white p-7 shadow-[0_8px_30px_rgba(12,12,12,0.06)] space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#4267ff]">
            <CreditCard className="w-4 h-4" />
            Atoms Billing · Mock Checkout
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 border border-emerald-600/20 px-2.5 py-0.5 text-xs font-medium text-emerald-700 whitespace-nowrap shrink-0">
            <Lock className="w-3 h-3 shrink-0" />
            HMAC 签名闭环
          </span>
        </div>

        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-[#0c0c0c]/95">
            升级至 Pro 会员订阅
          </h1>
          <p className="text-sm text-[#0c0c0c]/60 leading-relaxed">
            演示环境走内置模拟收银台并自动签发 HMAC Webhook 回调；生产配置 Creem Key 后将无缝跳转外部真实收银台。
          </p>
        </div>

        <div className="rounded-xl border border-black/[0.08] bg-[#fcfcfb] p-4 space-y-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-[#0c0c0c]/55">订阅方案</span>
            <span className="font-semibold text-[#4267ff]">Pro Monthly</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#0c0c0c]/55">模拟金额</span>
            <span className="font-semibold text-[#0c0c0c]/90">$9.90 / 月（Test Mode）</span>
          </div>
          <div className="flex justify-between text-xs pt-2.5 border-t border-black/[0.06]">
            <span className="text-[#0c0c0c]/45">Project / User</span>
            <span className="text-[#0c0c0c]/65 font-atoms-mono truncate max-w-[200px]">
              {projectId} · {userId}
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-[#c9444a]/30 bg-[#c9444a]/10 p-3 text-xs text-[#b72027]">
            {error}
          </div>
        )}

        {done ? (
          <div className="rounded-xl border border-emerald-600/25 bg-emerald-500/10 p-4 flex items-center gap-3 text-emerald-800 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
            <div>
              <p className="font-semibold">支付成功，Webhook 已签收并升级为 Pro！</p>
              <p className="text-xs text-emerald-700/80 mt-0.5">正在返回原应用页面...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              disabled={paying || !projectId || !userId}
              onClick={() => void handleConfirmPayment()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#4267ff] px-4 py-3 text-sm font-semibold text-white hover:bg-[#425ce1] transition disabled:opacity-50 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              {paying ? '正在校验签名并入账...' : '确认模拟支付（升级 Pro）'}
            </button>
            <a
              href={returnUrl}
              className="block text-center text-xs text-[#0c0c0c]/55 hover:text-[#0c0c0c]"
            >
              取消并返回原站点
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MockCheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f8f8f6] text-[#0c0c0c]/65 flex items-center justify-center text-sm">
          正在加载收银台...
        </div>
      }
    >
      <MockCheckoutInner />
    </Suspense>
  );
}
