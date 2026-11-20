import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATOMS_CLOUD_SDK_SOURCE } from '@/core';
import {
  buildSessionCookieHeader,
  mintSignedSessionToken,
  shouldUseSecureCookie,
  verifySignedSessionToken,
} from '@/lib/workbench-session';
import { getContainer } from '@/container';
import { PostgresProjectRepository } from '@/adapters/repo/postgres';
import { PGliteSqlClient } from '@/adapters/storage/sql-client';
import { GET as getModels } from '@/app/api/models/route';
import {
  GET as getProjects,
  POST as postProjects,
} from '@/app/api/projects/route';
import {
  DELETE as deleteProject,
  GET as getProject,
  PATCH as patchProject,
} from '@/app/api/projects/[id]/route';
import { PUT as putProjectFiles } from '@/app/api/projects/[id]/files/route';
import { POST as postStart } from '@/app/api/projects/[id]/start/route';
import { POST as postConfirm } from '@/app/api/projects/[id]/confirm/route';
import { POST as postSelectBranch } from '@/app/api/projects/[id]/select-branch/route';
import { POST as postPublish } from '@/app/api/projects/[id]/publish/route';
import { POST as postIterate } from '@/app/api/projects/[id]/iterate/route';
import { GET as getExportZip } from '@/app/api/projects/[id]/export/route';
import {
  DELETE as deleteCloudRecord,
  GET as getCloudPanel,
} from '@/app/api/projects/[id]/cloud/route';
import { POST as postCloudRegister } from '@/app/api/cloud/[projectId]/auth/register/route';
import { POST as postCloudLogin } from '@/app/api/cloud/[projectId]/auth/login/route';
import { GET as getCloudMe } from '@/app/api/cloud/[projectId]/auth/me/route';
import { POST as postCloudAi } from '@/app/api/cloud/[projectId]/ai/route';
import {
  GET as getCloudDb,
  POST as postCloudDb,
} from '@/app/api/cloud/[projectId]/db/[collection]/route';
import {
  DELETE as deleteCloudDb,
  PATCH as patchCloudDb,
} from '@/app/api/cloud/[projectId]/db/[collection]/[recordId]/route';
import { resetAiRateLimiterForTest } from '@/app/api/_rate-limit';
import { POST as postCloudCheckout } from '@/app/api/cloud/[projectId]/billing/checkout/route';
import { GET as getCloudPlan } from '@/app/api/cloud/[projectId]/billing/plan/route';
import { POST as postMockCheckoutComplete } from '@/app/api/cloud/mock-checkout/complete/route';
import { POST as postBillingWebhook } from '@/app/api/cloud/webhooks/billing/route';
import { GET as getPublicSite } from '@/app/s/[slug]/route';
import type { AgentEvent } from '@/domain';

async function readSse(res: Response): Promise<AgentEvent[]> {
  const text = await res.text();
  const out: AgentEvent[] = [];
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '));
    if (line) out.push(JSON.parse(line.slice(6)) as AgentEvent);
  }
  return out;
}

describe('L2b: Next.js Route Handlers end-to-end with PGlite', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atoms-routes-'));
  const prevEnv = {
    LLM_ADAPTER: process.env.LLM_ADAPTER,
    STORAGE_ADAPTER: process.env.STORAGE_ADAPTER,
    PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR,
    APP_BASE_URL: process.env.APP_BASE_URL,
    APP_AUTH_SECRET: process.env.APP_AUTH_SECRET,
  };

  beforeAll(async () => {
    if (globalThis.__atomsContainerPromise) {
      const prev = await globalThis.__atomsContainerPromise;
      await prev.close();
      globalThis.__atomsContainerPromise = undefined;
    }
    process.env.LLM_ADAPTER = 'mock';
    process.env.STORAGE_ADAPTER = 'pglite';
    process.env.PGLITE_DATA_DIR = path.join(tempRoot, 'pglite');
    process.env.APP_BASE_URL = 'http://127.0.0.1:3105';
    process.env.APP_AUTH_SECRET = 'route-test-secret';
  });

  afterAll(async () => {
    if (globalThis.__atomsContainerPromise) {
      const c = await globalThis.__atomsContainerPromise;
      await c.close();
      globalThis.__atomsContainerPromise = undefined;
    }
    process.env.LLM_ADAPTER = prevEnv.LLM_ADAPTER;
    process.env.STORAGE_ADAPTER = prevEnv.STORAGE_ADAPTER;
    process.env.PGLITE_DATA_DIR = prevEnv.PGLITE_DATA_DIR;
    process.env.APP_BASE_URL = prevEnv.APP_BASE_URL;
    process.env.APP_AUTH_SECRET = prevEnv.APP_AUTH_SECRET;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('executes full project -> race -> publish -> /s/[slug] -> cloud db/auth/billing -> iterate flow', async () => {
    const modelsRes = await getModels();
    expect(modelsRes.status).toBe(200);
    const modelsJson = (await modelsRes.json()) as { models: Array<{ id: string }> };
    expect(modelsJson.models.length).toBeGreaterThanOrEqual(2);

    const bootstrapRes = await getProjects(
      new Request('http://127.0.0.1:3105/api/projects')
    );
    expect(bootstrapRes.status).toBe(200);
    const rawSetCookie = bootstrapRes.headers.get('set-cookie') ?? '';
    expect(rawSetCookie).toContain('atoms_sid=');
    expect(rawSetCookie).toContain('HttpOnly');
    expect(rawSetCookie).toContain('SameSite=Lax');
    const sidCookie = rawSetCookie.split(';')[0]!;

    const wbHeaders = (extra?: Record<string, string>) => ({
      Cookie: sidCookie,
      Origin: 'http://127.0.0.1:3105',
      'X-Atoms-Workbench': '1',
      ...extra,
    });

    const createRes = await postProjects(
      new Request('http://127.0.0.1:3105/api/projects', {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: '路由全链路站', slug: 'route-e2e-site' }),
      })
    );
    expect(createRes.status).toBe(201);
    const { project } = (await createRes.json()) as {
      project: { id: string; slug: string; ownerSid?: string | null };
    };
    expect(project.ownerSid).toMatch(/^sid_[0-9a-f]{32}$/);

    const listRes = await getProjects(
      new Request('http://127.0.0.1:3105/api/projects', {
        headers: wbHeaders(),
      })
    );
    const listJson = (await listRes.json()) as { projects: Array<{ id: string }> };
    expect(listJson.projects.some((p) => p.id === project.id)).toBe(true);

    const invalidThemeStartRes = await postStart(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/start`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          idea: '做一个活动报名签到网站',
          styleTheme: { id: 'broken' },
        }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(invalidThemeStartRes.status).toBe(400);

    const startRes = await postStart(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/start`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ idea: '做一个活动报名签到网站，支持会员升级导出' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const startEvents = await readSse(startRes);
    expect(startEvents.some((e) => e.type === 'plan_ready')).toBe(true);

    const confirmRes = await postConfirm(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/confirm`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode: 'race' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const confirmEvents = await readSse(confirmRes);
    expect(confirmEvents.some((e) => e.branchId === 'branch-a')).toBe(true);
    expect(confirmEvents.some((e) => e.branchId === 'branch-b')).toBe(true);

    // Before selecting a branch: publish & iterate must be blocked (409), and /s/[slug] stays 404
    const blockedPubRes = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
        method: 'POST',
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(blockedPubRes.status).toBe(409);

    const blockedIterRes = await postIterate(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/iterate`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ instruction: '把主色调改成深蓝色' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(blockedIterRes.status).toBe(409);

    const unpubSiteRes = await getPublicSite(
      new Request(`http://127.0.0.1:3105/s/${project.slug}`),
      { params: Promise.resolve({ slug: project.slug }) }
    );
    expect(unpubSiteRes.status).toBe(404);

    const badBranchRes = await postSelectBranch(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/select-branch`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ branchId: 'branch-x' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(badBranchRes.status).toBe(400);

    const selectRes = await postSelectBranch(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/select-branch`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ branchId: 'branch-b' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(selectRes.status).toBe(200);

    const pub1Res = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
        method: 'POST',
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const pub1 = (await pub1Res.json()) as {
      url: string;
      version: number;
      qrDataUrl: string;
    };
    expect(pub1.version).toBe(1);
    expect(pub1.url).toBe(`http://127.0.0.1:3105/s/${project.slug}`);
    expect(pub1.qrDataUrl).toContain('data:image/png;base64,');

    const siteRes = await getPublicSite(
      new Request(`http://127.0.0.1:3105/s/${project.slug}`),
      { params: Promise.resolve({ slug: project.slug }) }
    );
    expect(siteRes.status).toBe(200);
    const siteHtml = await siteRes.text();
    expect(siteHtml).toContain('<title>');
    expect(siteHtml).toContain('property="og:title"');
    expect(siteHtml).toContain('window.__ATOMS_CONFIG__');

    // Auth register + login + me + isolation
    const regRes = await postCloudRegister(
      new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'route@example.com',
          password: 'password123',
          name: 'RouteTester',
        }),
      }),
      { params: Promise.resolve({ projectId: project.id }) }
    );
    expect(regRes.status).toBe(201);
    const regData = (await regRes.json()) as {
      token: string;
      user: { id: string };
    };

    const loginRes = await postCloudLogin(
      new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'route@example.com', password: 'password123' }),
      }),
      { params: Promise.resolve({ projectId: project.id }) }
    );
    expect(loginRes.status).toBe(200);

    const meOther = await getCloudMe(
      new Request(`http://127.0.0.1:3105/api/cloud/other_proj/auth/me`, {
        headers: { Authorization: `Bearer ${regData.token}` },
      }),
      { params: Promise.resolve({ projectId: 'other_proj' }) }
    );
    expect(meOther.status).toBe(401);

    // DB create + list
    const postDbRes = await postCloudDb(
      new Request(
        `http://127.0.0.1:3105/api/cloud/${project.id}/db/registrations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${regData.token}`,
          },
          body: JSON.stringify({ data: { title: '李四报名', status: 'pending' } }),
        }
      ),
      { params: Promise.resolve({ projectId: project.id, collection: 'registrations' }) }
    );
    expect(postDbRes.status).toBe(201);
    const postDbJson = (await postDbRes.json()) as { record: { id: string } };

    // Billing checkout + tampered webhook 401 + mock checkout complete
    const checkoutRes = await postCloudCheckout(
      new Request(
        `http://127.0.0.1:3105/api/cloud/${project.id}/billing/checkout`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${regData.token}`,
          },
          body: JSON.stringify({
            plan: 'pro',
            returnUrl: `http://127.0.0.1:3105/s/${project.slug}`,
          }),
        }
      ),
      { params: Promise.resolve({ projectId: project.id }) }
    );
    const checkoutJson = (await checkoutRes.json()) as { checkoutUrl: string };
    const checkoutUrl = new URL(checkoutJson.checkoutUrl);

    const badWebhook = await postBillingWebhook(
      new Request('http://127.0.0.1:3105/api/cloud/webhooks/billing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': 'tampered',
        },
        body: JSON.stringify({ orderId: 'bad', projectId: project.id, userId: regData.user.id, plan: 'pro' }),
      })
    );
    expect(badWebhook.status).toBe(401);

    const completeRes = await postMockCheckoutComplete(
      new Request('http://127.0.0.1:3105/api/cloud/mock-checkout/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${regData.token}`,
        },
        body: JSON.stringify({
          sessionId: checkoutUrl.searchParams.get('sessionId'),
          projectId: project.id,
          userId: regData.user.id,
          plan: 'pro',
        }),
      })
    );
    expect(completeRes.status).toBe(200);

    const planRes = await getCloudPlan(
      new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/billing/plan`, {
        headers: { Authorization: `Bearer ${regData.token}` },
      }),
      { params: Promise.resolve({ projectId: project.id }) }
    );
    const planJson = (await planRes.json()) as { plan: string };
    expect(planJson.plan).toBe('pro');

    // Cloud Data panel & ZIP export & Project Snapshot
    const cloudPanelRes = await getCloudPanel(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/cloud`, {
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const cloudPanelJson = (await cloudPanelRes.json()) as {
      users: Array<{ plan: string }>;
      records: Array<{ id: string }>;
    };
    expect(cloudPanelJson.users[0]?.plan).toBe('pro');
    expect(cloudPanelJson.records).toHaveLength(1);

    const zipRes = await getExportZip(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/export`, {
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(zipRes.status).toBe(200);
    const zipBytes = Buffer.from(await zipRes.arrayBuffer());
    expect(zipBytes.subarray(0, 2).toString('utf8')).toBe('PK');

    // Iterate + v2 republish + preserve data
    const iterRes = await postIterate(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/iterate`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ instruction: '把主色调改成深蓝色，并增加导出 CSV 按钮' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const iterEvents = await readSse(iterRes);
    expect(iterEvents.some((e) => e.type === 'build_result')).toBe(true);

    const pub2Res = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
        method: 'POST',
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const pub2 = (await pub2Res.json()) as { version: number };
    expect(pub2.version).toBe(2);

    const dbListAfter = await getCloudDb(
      new Request(
        `http://127.0.0.1:3105/api/cloud/${project.id}/db/registrations`
      ),
      { params: Promise.resolve({ projectId: project.id, collection: 'registrations' }) }
    );
    const dbListJson = (await dbListAfter.json()) as {
      records: Array<{ id: string }>;
    };
    expect(dbListJson.records).toHaveLength(1);
    expect(dbListJson.records[0]?.id).toBe(postDbJson.record.id);

    // Re-trigger start with a new idea on an already built & published project -> must guard iterate/publish (409)
    const v2SiteRes = await getPublicSite(
      new Request(`http://127.0.0.1:3105/s/${project.slug}`),
      { params: Promise.resolve({ slug: project.slug }) }
    );
    const v2SiteHtml = await v2SiteRes.text();

    const beforeRestartSnapRes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`, {
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const beforeRestartSnap = (await beforeRestartSnapRes.json()) as {
      project: { draftFiles: Record<string, string> };
      events: AgentEvent[];
    };
    const beforeRestartDraft = beforeRestartSnap.project.draftFiles['src/App.tsx'];
    const beforeRestartFileWrites = beforeRestartSnap.events.filter(
      (e) => e.type === 'file_write'
    ).length;

    const restartRes = await postStart(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/start`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          idea: '换一个新想法：做一个独立顾问轻量 CRM 客户跟进台',
        }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const restartEvents = await readSse(restartRes);
    expect(restartEvents.some((e) => e.type === 'plan_ready')).toBe(true);
    expect(restartEvents.some((e) => e.type === 'file_write')).toBe(false);

    // Existing draft preview & /s/[slug] v2 site remain viewable while awaiting_confirmation
    const pendingSnapRes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`, {
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const pendingSnap = (await pendingSnapRes.json()) as {
      project: {
        status: string;
        publishedVersion: number;
        draftFiles: Record<string, string>;
      };
      events: AgentEvent[];
      previewHtml: string | null;
      compileErrors: unknown[];
    };
    expect(pendingSnap.project.status).toBe('awaiting_confirmation');
    expect(pendingSnap.previewHtml).toBeTruthy();
    expect(pendingSnap.compileErrors).toHaveLength(0);
    expect(pendingSnap.project.draftFiles['src/App.tsx']).toBe(beforeRestartDraft);
    expect(
      pendingSnap.events.filter((e) => e.type === 'file_write')
    ).toHaveLength(beforeRestartFileWrites);

    const blockedIterDuringConfirm = await postIterate(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/iterate`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ instruction: '主色调改成深蓝色' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(blockedIterDuringConfirm.status).toBe(409);

    const blockedPubDuringConfirm = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
        method: 'POST',
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(blockedPubDuringConfirm.status).toBe(409);

    const blockedFilesEditRes = await putProjectFiles(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/files`, {
        method: 'PUT',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          files: {
            'src/App.tsx': 'export default function App() { return <div>Blocked</div>; }',
          },
        }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(blockedFilesEditRes.status).toBe(409);

    // Re-check: zero new file_write events, v2 site unchanged, Cloud DB data untouched
    const pendingSnapAfterRes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`, {
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const pendingSnapAfter = (await pendingSnapAfterRes.json()) as {
      project: { status: string; publishedVersion: number };
      events: AgentEvent[];
    };
    expect(pendingSnapAfter.project.status).toBe('awaiting_confirmation');
    expect(pendingSnapAfter.project.publishedVersion).toBe(2);
    expect(
      pendingSnapAfter.events.filter((e) => e.type === 'file_write')
    ).toHaveLength(beforeRestartFileWrites);

    const v2SiteStillRes = await getPublicSite(
      new Request(`http://127.0.0.1:3105/s/${project.slug}`),
      { params: Promise.resolve({ slug: project.slug }) }
    );
    expect(v2SiteStillRes.status).toBe(200);
    expect(await v2SiteStillRes.text()).toBe(v2SiteHtml);

    // Confirm the new plan explicitly -> Alex writes new files, iterate & v3 publish succeed
    const confirmNewRes = await postConfirm(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/confirm`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode: 'linear' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const confirmNewEvents = await readSse(confirmNewRes);
    expect(confirmNewEvents.some((e) => e.type === 'file_write')).toBe(true);
    expect(confirmNewEvents.some((e) => e.type === 'build_result')).toBe(true);

    const iterAfterConfirmRes = await postIterate(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/iterate`, {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ instruction: '主色调改成深蓝色' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(iterAfterConfirmRes.status).toBe(200);
    const iterAfterConfirmEvents = await readSse(iterAfterConfirmRes);
    expect(iterAfterConfirmEvents.some((e) => e.type === 'build_result')).toBe(
      true
    );

    const pub3Res = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
        method: 'POST',
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(pub3Res.status).toBe(200);
    const pub3 = (await pub3Res.json()) as { version: number };
    expect(pub3.version).toBe(3);

    // Rename validation & persistence
    const badRenameRes = await patchProject(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: '   ' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(badRenameRes.status).toBe(400);

    const renameRes = await patchProject(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: '路由重命名终版' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(renameRes.status).toBe(200);
    const renameJson = (await renameRes.json()) as {
      project: { title: string };
    };
    expect(renameJson.project.title).toBe('路由重命名终版');

    // Online source edit + recompile while isolating published v3 site
    const v3SiteRes = await getPublicSite(
      new Request(`http://127.0.0.1:3105/s/${project.slug}`),
      { params: Promise.resolve({ slug: project.slug }) }
    );
    const v3SiteHtml = await v3SiteRes.text();

    const editValidFiles = {
      'src/App.tsx':
        'import React from "react";\nexport default function App() { return <div className="p-6">手动源码编辑生效</div>; }',
    };
    const putValidRes = await putProjectFiles(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/files`, {
        method: 'PUT',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ files: editValidFiles }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(putValidRes.status).toBe(200);
    const putValidJson = (await putValidRes.json()) as {
      ok: boolean;
      previewHtml: string | null;
      compileErrors: unknown[];
    };
    expect(putValidJson.ok).toBe(true);
    expect(putValidJson.previewHtml).toContain('手动源码编辑生效');
    expect(putValidJson.compileErrors).toHaveLength(0);

    // Broken manual edit returns compile error without corrupting published v3
    const putBrokenRes = await putProjectFiles(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/files`, {
        method: 'PUT',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          files: { 'src/App.tsx': 'export default function Broken() { return <<<; }' },
        }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(putBrokenRes.status).toBe(200);
    const putBrokenJson = (await putBrokenRes.json()) as {
      ok: boolean;
      compileErrors: unknown[];
    };
    expect(putBrokenJson.ok).toBe(false);
    expect(putBrokenJson.compileErrors.length).toBeGreaterThan(0);

    const v3AfterManualEdit = await getPublicSite(
      new Request(`http://127.0.0.1:3105/s/${project.slug}`),
      { params: Promise.resolve({ slug: project.slug }) }
    );
    expect(v3AfterManualEdit.status).toBe(200);
    expect(await v3AfterManualEdit.text()).toBe(v3SiteHtml);

    // Restore valid manual draft before final snapshot assertion
    await putProjectFiles(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/files`, {
        method: 'PUT',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ files: editValidFiles }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );

    // Create + seed + delete a separate project via DELETE /api/projects/[id]
    const createDelRes = await postProjects(
      new Request('http://127.0.0.1:3105/api/projects', {
        method: 'POST',
        headers: wbHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: '临时待删项目', slug: 'temp-del-proj' }),
      })
    );
    const { project: delProj } = (await createDelRes.json()) as {
      project: { id: string };
    };
    await postCloudDb(
      new Request(
        `http://127.0.0.1:3105/api/cloud/${delProj.id}/db/items`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { title: 'Will purge' } }),
        }
      ),
      { params: Promise.resolve({ projectId: delProj.id, collection: 'items' }) }
    );
    const delProjRes = await deleteProject(
      new Request(`http://127.0.0.1:3105/api/projects/${delProj.id}`, {
        method: 'DELETE',
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: delProj.id }) }
    );
    expect(delProjRes.status).toBe(200);
    const getDeletedRes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${delProj.id}`, {
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: delProj.id }) }
    );
    expect(getDeletedRes.status).toBe(404);

    const dbListAfterNewConfirm = await getCloudDb(
      new Request(
        `http://127.0.0.1:3105/api/cloud/${project.id}/db/registrations`
      ),
      { params: Promise.resolve({ projectId: project.id, collection: 'registrations' }) }
    );
    const dbListAfterNewJson = (await dbListAfterNewConfirm.json()) as {
      records: Array<{ id: string }>;
    };
    expect(dbListAfterNewJson.records).toHaveLength(1);
    expect(dbListAfterNewJson.records[0]?.id).toBe(postDbJson.record.id);

    // Delete via Cloud Data panel & check project snapshot
    const delRes = await deleteCloudRecord(
      new Request(
        `http://127.0.0.1:3105/api/projects/${project.id}/cloud?collection=registrations&recordId=${postDbJson.record.id}`,
        { method: 'DELETE', headers: wbHeaders() }
      ),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(delRes.status).toBe(200);

    const snapRes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`, {
        headers: wbHeaders(),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const snapJson = (await snapRes.json()) as {
      previewHtml: string | null;
      compileErrors: unknown[];
    };
    expect(snapJson.previewHtml).toBeTruthy();
    expect(snapJson.compileErrors).toHaveLength(0);
  }, 35000);

  it('enforces anonymous atoms_sid ownership, read-only legacy/example projects, anti-spoofing headers, CSP, and per-project storage keys', async () => {
    // 1. Session signing helper + Secure attribute in production HTTPS vs HTTP
    const mintedA = await mintSignedSessionToken('route-test-secret');
    expect(await verifySignedSessionToken(mintedA.cookieValue, 'route-test-secret')).toBe(
      mintedA.sid
    );
    expect(
      await verifySignedSessionToken(`${mintedA.sid}.${'0'.repeat(64)}`, 'route-test-secret')
    ).toBeNull();
    expect(buildSessionCookieHeader(mintedA.cookieValue, true)).toContain('; Secure');
    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    try {
      expect(
        shouldUseSecureCookie(
          new Request('https://xcodea.online/', {
            headers: { 'x-forwarded-proto': 'https' },
          })
        )
      ).toBe(true);
      expect(
        shouldUseSecureCookie(
          new Request('http://127.0.0.1:3105/', {
            headers: { 'x-forwarded-proto': 'http' },
          })
        )
      ).toBe(false);
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevNodeEnv;
    }

    // 2. Auto-migration adds owner_sid column to a legacy projects table lacking owner_sid
    const legacyDbDir = path.join(tempRoot, 'legacy-mig');
    const rawPg = new PGlite(legacyDbDir);
    await rawPg.waitReady;
    await rawPg.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        capabilities_json JSONB NOT NULL DEFAULT '["db"]',
        plan_json JSONB,
        draft_files_json JSONB NOT NULL DEFAULT '{}',
        race_branches_json JSONB NOT NULL DEFAULT '[]',
        published_files_json JSONB,
        published_html TEXT,
        published_version INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      INSERT INTO projects (
        id, slug, title, status, capabilities_json, draft_files_json,
        race_branches_json, published_html, published_version, created_at, updated_at
      ) VALUES (
        'proj_legacy_otqlo', 'legacy-otqlo', 'Legacy Roastery', 'published',
        '["db"]'::jsonb, '{}'::jsonb, '[]'::jsonb,
        '<html><title>Legacy</title></html>', 1, NOW(), NOW()
      );
    `);
    await rawPg.close();

    const migratedSql = new PGliteSqlClient(legacyDbDir);
    const migratedRepo = new PostgresProjectRepository(migratedSql);
    const colCheck = await migratedSql.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'owner_sid'`
    );
    expect(colCheck.rows).toHaveLength(1);
    const legacyRow = await migratedRepo.getBySlug('legacy-otqlo');
    expect(legacyRow?.ownerSid).toBeNull();
    await migratedSql.close();

    // Insert a legacy read-only project (ownerSid = null) directly into the active test container
    const activeContainer = await getContainer();
    const legacyExample = await activeContainer.repo.create({
      title: '山丘只读示例站',
      slug: 'app-otqlo-readonly',
      ownerSid: null,
    });
    await activeContainer.repo.saveDraft(
      legacyExample.id,
      {
        'src/App.tsx': 'export default function App() { return <main>Readonly</main>; }',
      },
      'ready'
    );

    const cookieA = `atoms_sid=${mintedA.cookieValue}`;
    const mintedB = await mintSignedSessionToken('route-test-secret');
    const cookieB = `atoms_sid=${mintedB.cookieValue}`;
    const headersA = (extra?: Record<string, string>) => ({
      Cookie: cookieA,
      Origin: 'http://127.0.0.1:3105',
      'X-Atoms-Workbench': '1',
      ...extra,
    });
    const headersB = (extra?: Record<string, string>) => ({
      Cookie: cookieB,
      Origin: 'http://127.0.0.1:3105',
      'X-Atoms-Workbench': '1',
      ...extra,
    });

    // Session A creates a project and publishes it
    const createARes = await postProjects(
      new Request('http://127.0.0.1:3105/api/projects', {
        method: 'POST',
        headers: headersA({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: 'Session A App', slug: 'sec-sess-a' }),
      })
    );
    expect(createARes.status).toBe(201);
    const { project: projA } = (await createARes.json()) as {
      project: { id: string; slug: string };
    };
    await readSse(
      await postStart(
        new Request(`http://127.0.0.1:3105/api/projects/${projA.id}/start`, {
          method: 'POST',
          headers: headersA({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ idea: '活动报名系统' }),
        }),
        { params: Promise.resolve({ id: projA.id }) }
      )
    );
    await readSse(
      await postConfirm(
        new Request(`http://127.0.0.1:3105/api/projects/${projA.id}/confirm`, {
          method: 'POST',
          headers: headersA({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ mode: 'linear' }),
        }),
        { params: Promise.resolve({ id: projA.id }) }
      )
    );
    const pubARes = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${projA.id}/publish`, {
        method: 'POST',
        headers: headersA(),
      }),
      { params: Promise.resolve({ id: projA.id }) }
    );
    expect(pubARes.status).toBe(200);

    // 3. Session B cannot list, view, cloud-inspect, rename, mutate, or delete Session A's project (403)
    const listB = (await (
      await getProjects(
        new Request('http://127.0.0.1:3105/api/projects', { headers: headersB() })
      )
    ).json()) as { projects: Array<{ id: string }> };
    expect(listB.projects.some((p) => p.id === projA.id)).toBe(false);
    expect(listB.projects.some((p) => p.id === legacyExample.id)).toBe(false);

    expect(
      (
        await getProject(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}`, {
            headers: headersB(),
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await getCloudPanel(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}/cloud`, {
            headers: headersB(),
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await getExportZip(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}/export`, {
            headers: headersB(),
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await patchProject(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}`, {
            method: 'PATCH',
            headers: headersB({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ title: 'Hijack' }),
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await deleteProject(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}`, {
            method: 'DELETE',
            headers: headersB(),
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);

    // 4. Legacy read-only project (ownerSid = null) is readable via GET, rejected (403) on all write/cloud ops
    const readLegacyRes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${legacyExample.id}`, {
        headers: headersB(),
      }),
      { params: Promise.resolve({ id: legacyExample.id }) }
    );
    expect(readLegacyRes.status).toBe(200);
    expect(
      (
        await deleteProject(
          new Request(`http://127.0.0.1:3105/api/projects/${legacyExample.id}`, {
            method: 'DELETE',
            headers: headersA(),
          }),
          { params: Promise.resolve({ id: legacyExample.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await patchProject(
          new Request(`http://127.0.0.1:3105/api/projects/${legacyExample.id}`, {
            method: 'PATCH',
            headers: headersA({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ title: 'Mutate Legacy' }),
          }),
          { params: Promise.resolve({ id: legacyExample.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await getCloudPanel(
          new Request(`http://127.0.0.1:3105/api/projects/${legacyExample.id}/cloud`, {
            headers: headersA(),
          }),
          { params: Promise.resolve({ id: legacyExample.id }) }
        )
      ).status
    ).toBe(403);

    // 5. Anti-spoofing write checks: missing cookie, missing X-Atoms-Workbench, wrong Origin, /s/ Referer
    expect(
      (
        await deleteProject(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}`, {
            method: 'DELETE',
            headers: {
              Origin: 'http://127.0.0.1:3105',
              'X-Atoms-Workbench': '1',
            },
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await patchProject(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}`, {
            method: 'PATCH',
            headers: {
              Cookie: cookieA,
              Origin: 'http://127.0.0.1:3105',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: 'No Header' }),
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await patchProject(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}`, {
            method: 'PATCH',
            headers: {
              ...headersA({ 'Content-Type': 'application/json' }),
              Origin: 'https://evil.example',
            },
            body: JSON.stringify({ title: 'Wrong Origin' }),
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await patchProject(
          new Request(`http://127.0.0.1:3105/api/projects/${projA.id}`, {
            method: 'PATCH',
            headers: {
              ...headersA({ 'Content-Type': 'application/json' }),
              Referer: `http://127.0.0.1:3105/s/${projA.slug}`,
            },
            body: JSON.stringify({ title: 'From Published Referer' }),
          }),
          { params: Promise.resolve({ id: projA.id }) }
        )
      ).status
    ).toBe(403);

    // 6. CSP on /s/[slug] & preview HTML + per-project localStorage token key in SDK
    const siteCspRes = await getPublicSite(
      new Request(`http://127.0.0.1:3105/s/${projA.slug}`),
      { params: Promise.resolve({ slug: projA.slug }) }
    );
    expect(siteCspRes.status).toBe(200);
    const siteCsp = siteCspRes.headers.get('content-security-policy') ?? '';
    expect(siteCsp).toContain('connect-src http://127.0.0.1:3105/api/cloud/');
    expect(siteCsp).toContain("frame-ancestors 'self'");
    expect(siteCsp).toContain("object-src 'none'");

    const snapARes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${projA.id}`, {
        headers: headersA(),
      }),
      { params: Promise.resolve({ id: projA.id }) }
    );
    const snapAJson = (await snapARes.json()) as { previewHtml: string | null };
    expect(snapAJson.previewHtml).toContain('http-equiv="Content-Security-Policy"');
    expect(snapAJson.previewHtml).toContain(
      'connect-src http://127.0.0.1:3105/api/cloud/'
    );
    expect(snapAJson.previewHtml).toContain("object-src &#39;none&#39;");
    expect(ATOMS_CLOUD_SDK_SOURCE).toContain(
      "'atoms_cloud_token_' + getConfig().projectId"
    );
  }, 35000);

  it('enforces Cloud AI rate limits & auth, Cloud DB owner/public-collection permissions & pagination, and Mock Checkout user binding', async () => {
    const prevLimits = {
      AI_RATE_LIMIT_IP_PER_MIN: process.env.AI_RATE_LIMIT_IP_PER_MIN,
      AI_RATE_LIMIT_PROJECT_PER_DAY: process.env.AI_RATE_LIMIT_PROJECT_PER_DAY,
      AI_PROXY_MAX_INPUT_CHARS: process.env.AI_PROXY_MAX_INPUT_CHARS,
      AI_PROXY_MAX_TOKENS: process.env.AI_PROXY_MAX_TOKENS,
      CLOUD_DB_MAX_LIMIT: process.env.CLOUD_DB_MAX_LIMIT,
      CLOUD_PUBLIC_COLLECTIONS: process.env.CLOUD_PUBLIC_COLLECTIONS,
    };

    try {
      const secret = process.env.APP_AUTH_SECRET!;
      const minted = await mintSignedSessionToken(secret);
      const cookie = buildSessionCookieHeader(minted.cookieValue, false);
      const wb = (extra?: Record<string, string>) => ({
        Cookie: cookie,
        Origin: 'http://127.0.0.1:3105',
        'X-Atoms-Workbench': '1',
        ...extra,
      });

      const createRes = await postProjects(
        new Request('http://127.0.0.1:3105/api/projects', {
          method: 'POST',
          headers: wb({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ title: 'Cloud Guard App' }),
        })
      );
      const { project } = (await createRes.json()) as {
        project: { id: string; slug: string };
      };

      const startEvents = await readSse(
        await postStart(
          new Request(`http://127.0.0.1:3105/api/projects/${project.id}/start`, {
            method: 'POST',
            headers: wb({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              idea: 'Build an AI community notes & study workspace',
            }),
          }),
          { params: Promise.resolve({ id: project.id }) }
        )
      );
      const planEv = startEvents.find((e) => e.type === 'plan_ready');
      const basePlan = planEv?.payload as Record<string, unknown>;

      await readSse(
        await postConfirm(
          new Request(`http://127.0.0.1:3105/api/projects/${project.id}/confirm`, {
            method: 'POST',
            headers: wb({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              mode: 'linear',
              planPatch: {
                ...basePlan,
                capabilities: ['db', 'auth', 'billing', 'ai'],
              },
            }),
          }),
          { params: Promise.resolve({ id: project.id }) }
        )
      );

      await postPublish(
        new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
          method: 'POST',
          headers: wb(),
        }),
        { params: Promise.resolve({ id: project.id }) }
      );

      const regA = (await (
        await postCloudRegister(
          new Request(
            `http://127.0.0.1:3105/api/cloud/${project.id}/auth/register`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'alice@example.com',
                password: 'password123',
                name: 'Alice',
              }),
            }
          ),
          { params: Promise.resolve({ projectId: project.id }) }
        )
      ).json()) as { user: { id: string }; token: string };

      const regB = (await (
        await postCloudRegister(
          new Request(
            `http://127.0.0.1:3105/api/cloud/${project.id}/auth/register`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: 'bob@example.com',
                password: 'password123',
                name: 'Bob',
              }),
            }
          ),
          { params: Promise.resolve({ projectId: project.id }) }
        )
      ).json()) as { user: { id: string }; token: string };

      // 1. Cloud DB ownership, public collection mode, and ?mine=1 + pagination cap
      const createDb = async (
        collection: string,
        data: Record<string, unknown>,
        token?: string
      ) => {
        const res = await postCloudDb(
          new Request(
            `http://127.0.0.1:3105/api/cloud/${project.id}/db/${collection}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ data }),
            }
          ),
          { params: Promise.resolve({ projectId: project.id, collection }) }
        );
        expect(res.status).toBe(201);
        return ((await res.json()) as { record: { id: string; ownerUserId: string | null } }).record;
      };

      const recA1 = await createDb('tasks', { title: 'Alice Task 1' }, regA.token);
      expect(recA1.ownerUserId).toBe(regA.user.id);
      const recA2 = await createDb('tasks', { title: 'Alice Task 2' }, regA.token);
      const recUnowned = await createDb('tasks', { title: 'Unowned Task' });
      const recGuestUnowned = await createDb('guestbook', { msg: 'Hello Public' });

      // PATCH / DELETE without token -> 401
      expect(
        (
          await patchCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks/${recA1.id}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patch: { title: 'Anon Hack' } }),
              }
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'tasks',
                recordId: recA1.id,
              }),
            }
          )
        ).status
      ).toBe(401);
      expect(
        (
          await deleteCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks/${recA1.id}`,
              { method: 'DELETE' }
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'tasks',
                recordId: recA1.id,
              }),
            }
          )
        ).status
      ).toBe(401);

      // User B cannot PATCH/DELETE User A's record or unowned private record -> 403
      expect(
        (
          await patchCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks/${recA1.id}`,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${regB.token}`,
                },
                body: JSON.stringify({ patch: { title: 'Bob Hijack' } }),
              }
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'tasks',
                recordId: recA1.id,
              }),
            }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await deleteCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks/${recA1.id}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${regB.token}` },
              }
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'tasks',
                recordId: recA1.id,
              }),
            }
          )
        ).status
      ).toBe(403);
      expect(
        (
          await deleteCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks/${recUnowned.id}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${regB.token}` },
              }
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'tasks',
                recordId: recUnowned.id,
              }),
            }
          )
        ).status
      ).toBe(403);

      // Configured public collection (guestbook) allows authenticated modification of unowned records -> 200
      expect(
        (
          await patchCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/guestbook/${recGuestUnowned.id}`,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${regB.token}`,
                },
                body: JSON.stringify({ patch: { msg: 'Moderated Public' } }),
              }
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'guestbook',
                recordId: recGuestUnowned.id,
              }),
            }
          )
        ).status
      ).toBe(200);

      // User A can PATCH/DELETE own record -> 200
      expect(
        (
          await patchCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks/${recA1.id}`,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${regA.token}`,
                },
                body: JSON.stringify({ patch: { title: 'Alice Updated' } }),
              }
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'tasks',
                recordId: recA1.id,
              }),
            }
          )
        ).status
      ).toBe(200);
      expect(
        (
          await deleteCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks/${recA2.id}`,
              {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${regA.token}` },
              }
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'tasks',
                recordId: recA2.id,
              }),
            }
          )
        ).status
      ).toBe(200);

      // ?mine=1 filtering and pagination cap
      expect(
        (
          await getCloudDb(
            new Request(
              `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks?mine=1`
            ),
            {
              params: Promise.resolve({
                projectId: project.id,
                collection: 'tasks',
              }),
            }
          )
        ).status
      ).toBe(401);
      const mineA = (await (
        await getCloudDb(
          new Request(
            `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks?mine=1`,
            { headers: { Authorization: `Bearer ${regA.token}` } }
          ),
          { params: Promise.resolve({ projectId: project.id, collection: 'tasks' }) }
        )
      ).json()) as { records: Array<{ id: string }> };
      expect(mineA.records.map((r) => r.id)).toEqual([recA1.id]);

      for (let i = 0; i < 6; i += 1) {
        await createDb('tasks', { title: `Extra ${i}` }, regA.token);
      }
      process.env.CLOUD_DB_MAX_LIMIT = '5';
      const cappedList = (await (
        await getCloudDb(
          new Request(
            `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks?limit=500`
          ),
          { params: Promise.resolve({ projectId: project.id, collection: 'tasks' }) }
        )
      ).json()) as { records: Array<{ id: string }> };
      expect(cappedList.records).toHaveLength(5);
      const offsetList = (await (
        await getCloudDb(
          new Request(
            `http://127.0.0.1:3105/api/cloud/${project.id}/db/tasks?limit=2&offset=2`
          ),
          { params: Promise.resolve({ projectId: project.id, collection: 'tasks' }) }
        )
      ).json()) as { records: Array<{ id: string }> };
      expect(offsetList.records).toHaveLength(2);
      expect(offsetList.records[0]?.id).toBe(cappedList.records[2]?.id);

      // 2. Mock Checkout user verification
      expect(
        (
          await postMockCheckoutComplete(
            new Request('http://127.0.0.1:3105/api/cloud/mock-checkout/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: 'sess_no_auth',
                projectId: project.id,
                userId: regA.user.id,
              }),
            })
          )
        ).status
      ).toBe(401);
      expect(
        (
          await postMockCheckoutComplete(
            new Request('http://127.0.0.1:3105/api/cloud/mock-checkout/complete', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${regB.token}`,
              },
              body: JSON.stringify({
                sessionId: 'sess_cross_user',
                projectId: project.id,
                userId: regA.user.id,
              }),
            })
          )
        ).status
      ).toBe(403);
      expect(
        (
          await postMockCheckoutComplete(
            new Request('http://127.0.0.1:3105/api/cloud/mock-checkout/complete', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${regA.token}`,
              },
              body: JSON.stringify({
                sessionId: 'sess_self_ok',
                projectId: project.id,
                userId: regA.user.id,
              }),
            })
          )
        ).status
      ).toBe(200);
      const bobPlan = (await (
        await getCloudPlan(
          new Request(
            `http://127.0.0.1:3105/api/cloud/${project.id}/billing/plan`,
            { headers: { Authorization: `Bearer ${regB.token}` } }
          ),
          { params: Promise.resolve({ projectId: project.id }) }
        )
      ).json()) as { plan: string };
      expect(bobPlan.plan).toBe('free');

      // 3. Cloud AI Proxy auth, length cap, and IP/project rate limits
      resetAiRateLimiterForTest();
      process.env.AI_PROXY_MAX_INPUT_CHARS = '25';
      process.env.AI_RATE_LIMIT_IP_PER_MIN = '2';
      process.env.AI_RATE_LIMIT_PROJECT_PER_DAY = '3';

      expect(
        (
          await postCloudAi(
            new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/ai`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt: 'hello' }),
            }),
            { params: Promise.resolve({ projectId: project.id }) }
          )
        ).status
      ).toBe(401);

      expect(
        (
          await postCloudAi(
            new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/ai`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${regA.token}`,
              },
              body: JSON.stringify({
                prompt: 'This prompt intentionally exceeds twenty five chars',
              }),
            }),
            { params: Promise.resolve({ projectId: project.id }) }
          )
        ).status
      ).toBe(400);

      // Token-authenticated AI call -> 200
      expect(
        (
          await postCloudAi(
            new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/ai`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${regA.token}`,
                'x-forwarded-for': '198.51.100.10',
              },
              body: JSON.stringify({ prompt: 'Summarize', maxTokens: 16 }),
            }),
            { params: Promise.resolve({ projectId: project.id }) }
          )
        ).status
      ).toBe(200);

      // Published same-origin + /s/<slug> Referer without token -> 200
      expect(
        (
          await postCloudAi(
            new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/ai`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: 'http://127.0.0.1:3105',
                Referer: `http://127.0.0.1:3105/s/${project.slug}`,
                'x-forwarded-for': '198.51.100.10',
              },
              body: JSON.stringify({ prompt: 'Second hit' }),
            }),
            { params: Promise.resolve({ projectId: project.id }) }
          )
        ).status
      ).toBe(200);

      // 3rd hit from same IP -> 429 (ip limit = 2)
      const ipLimited = await postCloudAi(
        new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/ai`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${regA.token}`,
            'x-forwarded-for': '198.51.100.10',
          },
          body: JSON.stringify({ prompt: 'Third IP hit' }),
        }),
        { params: Promise.resolve({ projectId: project.id }) }
      );
      expect(ipLimited.status).toBe(429);
      expect(ipLimited.headers.get('retry-after')).toBeTruthy();

      // Another IP consumes 3rd daily project slot -> 200, then 4th hit -> 429 (project limit = 3)
      expect(
        (
          await postCloudAi(
            new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/ai`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${regA.token}`,
                'x-forwarded-for': '198.51.100.11',
              },
              body: JSON.stringify({ prompt: 'Day slot 3' }),
            }),
            { params: Promise.resolve({ projectId: project.id }) }
          )
        ).status
      ).toBe(200);
      const projLimited = await postCloudAi(
        new Request(`http://127.0.0.1:3105/api/cloud/${project.id}/ai`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${regA.token}`,
            'x-forwarded-for': '198.51.100.11',
          },
          body: JSON.stringify({ prompt: 'Day slot 4' }),
        }),
        { params: Promise.resolve({ projectId: project.id }) }
      );
      expect(projLimited.status).toBe(429);
      const projLimitedJson = (await projLimited.json()) as { scope: string };
      expect(projLimitedJson.scope).toBe('project');
    } finally {
      for (const [k, v] of Object.entries(prevLimits)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetAiRateLimiterForTest();
    }
  }, 35000);
});
