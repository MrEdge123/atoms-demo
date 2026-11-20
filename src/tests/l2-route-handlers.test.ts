import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import {
  GET as getCloudDb,
  POST as postCloudDb,
} from '@/app/api/cloud/[projectId]/db/[collection]/route';
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

    const createRes = await postProjects(
      new Request('http://127.0.0.1:3105/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '路由全链路站', slug: 'route-e2e-site' }),
      })
    );
    expect(createRes.status).toBe(201);
    const { project } = (await createRes.json()) as {
      project: { id: string; slug: string };
    };

    const listRes = await getProjects();
    const listJson = (await listRes.json()) as { projects: Array<{ id: string }> };
    expect(listJson.projects.some((p) => p.id === project.id)).toBe(true);

    const invalidThemeStartRes = await postStart(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: '做一个活动报名签到网站，支持会员升级导出' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const startEvents = await readSse(startRes);
    expect(startEvents.some((e) => e.type === 'plan_ready')).toBe(true);

    const confirmRes = await postConfirm(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(blockedPubRes.status).toBe(409);

    const blockedIterRes = await postIterate(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/iterate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: 'branch-x' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(badBranchRes.status).toBe(400);

    const selectRes = await postSelectBranch(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/select-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: 'branch-b' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(selectRes.status).toBe(200);

    const pub1Res = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
        method: 'POST',
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
        headers: { 'Content-Type': 'application/json' },
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
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/cloud`),
      { params: Promise.resolve({ id: project.id }) }
    );
    const cloudPanelJson = (await cloudPanelRes.json()) as {
      users: Array<{ plan: string }>;
      records: Array<{ id: string }>;
    };
    expect(cloudPanelJson.users[0]?.plan).toBe('pro');
    expect(cloudPanelJson.records).toHaveLength(1);

    const zipRes = await getExportZip(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/export`),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(zipRes.status).toBe(200);
    const zipBytes = Buffer.from(await zipRes.arrayBuffer());
    expect(zipBytes.subarray(0, 2).toString('utf8')).toBe('PK');

    // Iterate + v2 republish + preserve data
    const iterRes = await postIterate(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/iterate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: '把主色调改成深蓝色，并增加导出 CSV 按钮' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    const iterEvents = await readSse(iterRes);
    expect(iterEvents.some((e) => e.type === 'build_result')).toBe(true);

    const pub2Res = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
        method: 'POST',
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
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`),
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
        headers: { 'Content-Type': 'application/json' },
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
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`),
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: '主色调改成深蓝色' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(blockedIterDuringConfirm.status).toBe(409);

    const blockedPubDuringConfirm = await postPublish(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/publish`, {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(blockedPubDuringConfirm.status).toBe(409);

    const blockedFilesEditRes = await putProjectFiles(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}/files`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`),
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '   ' }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(badRenameRes.status).toBe(400);

    const renameRes = await patchProject(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: editValidFiles }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );

    // Create + seed + delete a separate project via DELETE /api/projects/[id]
    const createDelRes = await postProjects(
      new Request('http://127.0.0.1:3105/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      }),
      { params: Promise.resolve({ id: delProj.id }) }
    );
    expect(delProjRes.status).toBe(200);
    const getDeletedRes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${delProj.id}`),
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
        { method: 'DELETE' }
      ),
      { params: Promise.resolve({ id: project.id }) }
    );
    expect(delRes.status).toBe(200);

    const snapRes = await getProject(
      new Request(`http://127.0.0.1:3105/api/projects/${project.id}`),
      { params: Promise.resolve({ id: project.id }) }
    );
    const snapJson = (await snapRes.json()) as {
      previewHtml: string | null;
      compileErrors: unknown[];
    };
    expect(snapJson.previewHtml).toBeTruthy();
    expect(snapJson.compileErrors).toHaveLength(0);
  }, 35000);
});
