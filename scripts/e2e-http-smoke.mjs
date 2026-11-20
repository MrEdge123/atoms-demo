import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const PORT = 3105;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atoms-e2e-http-'));
const PGLITE_DIR = path.join(TEMP_DIR, 'pglite');

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(child, getLogs, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `next start exited early with code ${child.exitCode}\n${getLogs()}`
      );
    }
    try {
      const res = await fetch(`${BASE_URL}/api/models`);
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    await sleep(300);
  }
  throw new Error(
    `Timed out waiting for next start to accept connections (lastErr: ${lastErr})\n${getLogs()}`
  );
}

async function readSseEvents(res) {
  assert.equal(res.ok, true, `SSE endpoint returned HTTP ${res.status}`);
  const text = await res.text();
  const events = [];
  for (const chunk of text.split('\n\n')) {
    const line = chunk.split('\n').find((l) => l.startsWith('data: '));
    if (line) {
      events.push(JSON.parse(line.slice(6)));
    }
  }
  return events;
}

async function main() {
  const nextBin = path.join(ROOT_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      APP_BASE_URL: BASE_URL,
      LLM_ADAPTER: 'mock',
      BUILDER_ADAPTER: 'esbuild',
      STORAGE_ADAPTER: 'pglite',
      PGLITE_DATA_DIR: PGLITE_DIR,
      PUBLISHER_ADAPTER: 'same-origin',
      BILLING_ADAPTER: 'mock',
      APP_AUTH_SECRET: 'e2e-smoke-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderrBuf += d.toString();
  });
  const getLogs = () =>
    `--- STDOUT ---\n${stdoutBuf}\n--- STDERR ---\n${stderrBuf}`;

  try {
    await waitForServer(child, getLogs);
    console.log('1. Server ready on', BASE_URL);

    // 1. GET /
    const homeRes = await fetch(`${BASE_URL}/`);
    assert.equal(homeRes.status, 200);
    const homeHtml = await homeRes.text();
    assert.match(homeHtml, /Mini Atoms/);
    console.log('2. GET / passed');

    // 2. GET /api/models
    const modelsRes = await fetch(`${BASE_URL}/api/models`);
    assert.equal(modelsRes.status, 200);
    const modelsJson = await modelsRes.json();
    assert.ok(Array.isArray(modelsJson.models) && modelsJson.models.length >= 2);
    console.log('3. GET /api/models passed:', modelsJson.models.map((m) => m.id));

    // 3. POST /api/projects
    const createRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '端到端活动站', slug: 'e2e-event-hub' }),
    });
    assert.equal(createRes.status, 201);
    const { project } = await createRes.json();
    assert.ok(project.id);
    console.log('4. POST /api/projects passed:', project.id, project.slug);

    // 4. POST /api/projects/:id/start (SSE)
    const startRes = await fetch(`${BASE_URL}/api/projects/${project.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idea: '做一个科技沙龙活动报名与签到管理系统，支持账号登录和 Pro 会员导出',
        model: 'mock-default',
      }),
    });
    const startEvents = await readSseEvents(startRes);
    assert.ok(startEvents.some((e) => e.type === 'research_ready'));
    assert.ok(startEvents.some((e) => e.type === 'plan_ready'));
    console.log('5. POST /api/projects/:id/start SSE passed');

    // 5. POST /api/projects/:id/confirm (Race Mode)
    const confirmRes = await fetch(`${BASE_URL}/api/projects/${project.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'race', model: 'mock-default' }),
    });
    const confirmEvents = await readSseEvents(confirmRes);
    assert.ok(confirmEvents.some((e) => e.branchId === 'branch-a' && e.type === 'build_result'));
    assert.ok(confirmEvents.some((e) => e.branchId === 'branch-b' && e.type === 'build_result'));
    console.log('6. POST /api/projects/:id/confirm (Race Mode) passed');

    // 5b. Unselected Race Mode guardrails: publish/iterate must return 409, /s/:slug stays 404
    const blockedPubRes = await fetch(`${BASE_URL}/api/projects/${project.id}/publish`, {
      method: 'POST',
    });
    assert.equal(blockedPubRes.status, 409);

    const blockedIterRes = await fetch(`${BASE_URL}/api/projects/${project.id}/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '主色调改成深蓝色' }),
    });
    assert.equal(blockedIterRes.status, 409);

    const unpubSiteRes = await fetch(`${BASE_URL}/s/${project.slug}`);
    assert.equal(unpubSiteRes.status, 404);

    const badBranchRes = await fetch(`${BASE_URL}/api/projects/${project.id}/select-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId: 'branch-unknown' }),
    });
    assert.equal(badBranchRes.status, 400);
    console.log('6b. Unselected Race Mode 409/404/400 guardrails passed');

    // 6. POST /api/projects/:id/select-branch
    const branchRes = await fetch(`${BASE_URL}/api/projects/${project.id}/select-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId: 'branch-b' }),
    });
    assert.equal(branchRes.status, 200);
    const branchJson = await branchRes.json();
    assert.match(branchJson.project.draftFiles['src/App.tsx'], /bg-slate-950/);
    console.log('7. POST /api/projects/:id/select-branch passed');

    // 7. POST /api/projects/:id/publish
    const pub1Res = await fetch(`${BASE_URL}/api/projects/${project.id}/publish`, {
      method: 'POST',
    });
    assert.equal(pub1Res.status, 200);
    const pub1Json = await pub1Res.json();
    assert.equal(pub1Json.version, 1);
    assert.equal(pub1Json.url, `${BASE_URL}/s/${project.slug}`);
    assert.ok(pub1Json.qrDataUrl.startsWith('data:image/png;base64,'));
    console.log('8. POST /api/projects/:id/publish v1 passed');

    // 8. GET /s/:slug
    const siteRes = await fetch(`${BASE_URL}/s/${project.slug}`);
    assert.equal(siteRes.status, 200);
    assert.match(siteRes.headers.get('content-type') || '', /text\/html/);
    const siteHtml = await siteRes.text();
    assert.match(siteHtml, /<title>.*<\/title>/);
    assert.match(siteHtml, /property="og:title"/);
    assert.match(siteHtml, /property="og:description"/);
    assert.match(siteHtml, /<style>/);
    assert.match(siteHtml, /window\.__ATOMS_CONFIG__/);
    console.log('9. GET /s/:slug HTML + SEO/OG + Tailwind passed');

    // 9. Cloud Auth register + login + me + cross-project isolation
    const regRes = await fetch(`${BASE_URL}/api/cloud/${project.id}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'e2e@example.com',
        password: 'password123',
        name: 'E2E User',
      }),
    });
    assert.equal(regRes.status, 201);
    const regJson = await regRes.json();
    assert.ok(regJson.token);

    const loginRes = await fetch(`${BASE_URL}/api/cloud/${project.id}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@example.com', password: 'password123' }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    const token = loginJson.token;

    const meRes = await fetch(`${BASE_URL}/api/cloud/${project.id}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.user.email, 'e2e@example.com');

    const crossRes = await fetch(`${BASE_URL}/api/cloud/proj_other/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(crossRes.status, 401);
    console.log('10. Cloud Auth + cross-project JWT isolation passed');

    // 10. Cloud DB create + list
    const recCreateRes = await fetch(
      `${BASE_URL}/api/cloud/${project.id}/db/registrations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          data: { title: '张三参会', contact: '13800001111', status: 'pending', note: 'VIP' },
        }),
      }
    );
    assert.equal(recCreateRes.status, 201);
    const recListRes = await fetch(
      `${BASE_URL}/api/cloud/${project.id}/db/registrations`
    );
    assert.equal(recListRes.status, 200);
    const recListJson = await recListRes.json();
    assert.equal(recListJson.records.length, 1);
    assert.equal(recListJson.records[0].data.title, '张三参会');
    console.log('11. Cloud DB create & list passed');

    // 11. Billing checkout + mock webhook completion + tampered webhook rejection
    const checkoutRes = await fetch(
      `${BASE_URL}/api/cloud/${project.id}/billing/checkout`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: 'pro',
          returnUrl: `${BASE_URL}/s/${project.slug}`,
        }),
      }
    );
    assert.equal(checkoutRes.status, 200);
    const checkoutJson = await checkoutRes.json();
    const checkoutUrl = new URL(checkoutJson.checkoutUrl);
    assert.equal(checkoutUrl.pathname, '/checkout/mock');

    const mockPageRes = await fetch(checkoutJson.checkoutUrl);
    assert.equal(mockPageRes.status, 200);

    const tamperedWebhookRes = await fetch(`${BASE_URL}/api/cloud/webhooks/billing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-signature': 'deadbeef',
      },
      body: JSON.stringify({ orderId: 'bad', projectId: project.id, userId: regJson.user.id, plan: 'pro' }),
    });
    assert.equal(tamperedWebhookRes.status, 401);

    const completeRes = await fetch(`${BASE_URL}/api/cloud/mock-checkout/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: checkoutUrl.searchParams.get('sessionId'),
        projectId: checkoutUrl.searchParams.get('projectId'),
        userId: checkoutUrl.searchParams.get('userId'),
        plan: 'pro',
      }),
    });
    assert.equal(completeRes.status, 200);

    const planRes = await fetch(`${BASE_URL}/api/cloud/${project.id}/billing/plan`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(planRes.status, 200);
    const planJson = await planRes.json();
    assert.equal(planJson.plan, 'pro');
    console.log('12. Billing checkout + webhook + Pro upgrade passed');

    // 12. Workbench Cloud Data panel endpoint & ZIP export
    const cloudPanelRes = await fetch(`${BASE_URL}/api/projects/${project.id}/cloud`);
    assert.equal(cloudPanelRes.status, 200);
    const cloudPanelJson = await cloudPanelRes.json();
    assert.equal(cloudPanelJson.users.length, 1);
    assert.equal(cloudPanelJson.users[0].plan, 'pro');
    assert.equal(cloudPanelJson.records.length, 1);

    const zipRes = await fetch(`${BASE_URL}/api/projects/${project.id}/export`);
    assert.equal(zipRes.status, 200);
    assert.match(zipRes.headers.get('content-type') || '', /application\/zip/);
    const zipBytes = Buffer.from(await zipRes.arrayBuffer());
    assert.equal(zipBytes.subarray(0, 2).toString('utf8'), 'PK');
    console.log('13. Workbench Cloud Data panel & ZIP export passed');

    // 13. Iterate + republish v2 + verify historical data preserved
    const iterRes = await fetch(`${BASE_URL}/api/projects/${project.id}/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '把主色调改成深蓝色，并增加导出 CSV 按钮' }),
    });
    const iterEvents = await readSseEvents(iterRes);
    assert.ok(iterEvents.some((e) => e.type === 'build_result' && e.payload.ok === true));

    const pub2Res = await fetch(`${BASE_URL}/api/projects/${project.id}/publish`, {
      method: 'POST',
    });
    assert.equal(pub2Res.status, 200);
    const pub2Json = await pub2Res.json();
    assert.equal(pub2Json.version, 2);

    const site2Res = await fetch(`${BASE_URL}/s/${project.slug}`);
    const site2Html = await site2Res.text();
    assert.match(site2Html, /导出 CSV/);

    const recordsAfterRes = await fetch(
      `${BASE_URL}/api/cloud/${project.id}/db/registrations`
    );
    const recordsAfterJson = await recordsAfterRes.json();
    assert.equal(recordsAfterJson.records.length, 1);
    assert.equal(recordsAfterJson.records[0].data.title, '张三参会');
    console.log('14. Iterate + v2 republish + lossless data preservation passed');

    // 14. Interleaved Project B (InkVault) + return to Project A Round 2 iteration
    const createBRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'InkVault 笔记站', slug: 'e2e-inkvault' }),
    });
    assert.equal(createBRes.status, 201);
    const { project: projB } = await createBRes.json();

    const startBRes = await fetch(`${BASE_URL}/api/projects/${projB.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idea: '做一个支持账号隔离、标签搜索与 Pro 会员高级导出的云端个人笔记站。',
        model: 'mock-default',
      }),
    });
    await readSseEvents(startBRes);

    const confirmBRes = await fetch(`${BASE_URL}/api/projects/${projB.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'linear', model: 'mock-default' }),
    });
    await readSseEvents(confirmBRes);

    // Switch back to Project A and run Round 2 ("将主色调调整为深蓝色")
    const iterA2Res = await fetch(`${BASE_URL}/api/projects/${project.id}/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '将主色调调整为深蓝色' }),
    });
    const iterA2Events = await readSseEvents(iterA2Res);
    assert.ok(iterA2Events.some((e) => e.type === 'build_result' && e.payload.ok === true));

    const snapA2Res = await fetch(`${BASE_URL}/api/projects/${project.id}`);
    assert.equal(snapA2Res.status, 200);
    const snapA2Json = await snapA2Res.json();
    const appA2 = snapA2Json.project.draftFiles['src/App.tsx'];
    assert.match(appA2, /EventFlow/);
    assert.match(appA2, /新增报名记录/);
    assert.doesNotMatch(appA2, /新增笔记条目/);
    assert.match(appA2, /bg-slate-950/);
    assert.match(appA2, /bg-blue-800/);
    assert.match(appA2, /const canExportCsv = true/);

    const pub3Res = await fetch(`${BASE_URL}/api/projects/${project.id}/publish`, {
      method: 'POST',
    });
    assert.equal(pub3Res.status, 200);
    const pub3Json = await pub3Res.json();
    assert.equal(pub3Json.version, 3);

    const site3Res = await fetch(`${BASE_URL}/s/${project.slug}`);
    const site3Html = await site3Res.text();
    assert.match(site3Html, /EventFlow/);
    assert.match(site3Html, /新增报名记录/);
    assert.match(site3Html, /导出 CSV/);
    assert.match(site3Html, /bg-slate-950/);
    assert.match(site3Html, /bg-blue-800/);
    assert.doesNotMatch(site3Html, /新增笔记条目/);

    const recordsAfterA2Res = await fetch(
      `${BASE_URL}/api/cloud/${project.id}/db/registrations`
    );
    const recordsAfterA2Json = await recordsAfterA2Res.json();
    assert.equal(recordsAfterA2Json.records.length, 1);
    assert.equal(recordsAfterA2Json.records[0].data.title, '张三参会');
    console.log('15. Interleaved Project B + Project A Round 2 incremental iteration + v3 publish passed');

    // 16. Existing draft/published Emma confirmation gate regression check
    const beforeGateFileWrites = snapA2Json.events.filter(
      (e) => e.type === 'file_write'
    ).length;

    const restartARes = await fetch(`${BASE_URL}/api/projects/${project.id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idea: '换一个新想法：做一个独立顾问轻量 CRM 客户跟进台，支持线索录入与跟进',
        model: 'mock-default',
      }),
    });
    const restartAEvents = await readSseEvents(restartARes);
    assert.ok(restartAEvents.some((e) => e.type === 'plan_ready'));
    assert.ok(!restartAEvents.some((e) => e.type === 'file_write'));

    const pendingSnapRes = await fetch(`${BASE_URL}/api/projects/${project.id}`);
    assert.equal(pendingSnapRes.status, 200);
    const pendingSnapJson = await pendingSnapRes.json();
    assert.equal(pendingSnapJson.project.status, 'awaiting_confirmation');
    assert.ok(pendingSnapJson.previewHtml);
    assert.equal(pendingSnapJson.compileErrors.length, 0);
    assert.equal(pendingSnapJson.project.draftFiles['src/App.tsx'], appA2);
    assert.equal(
      pendingSnapJson.events.filter((e) => e.type === 'file_write').length,
      beforeGateFileWrites
    );

    const gateIterRes = await fetch(`${BASE_URL}/api/projects/${project.id}/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '主色调改成深蓝色' }),
    });
    assert.equal(gateIterRes.status, 409);

    const gatePubRes = await fetch(`${BASE_URL}/api/projects/${project.id}/publish`, {
      method: 'POST',
    });
    assert.equal(gatePubRes.status, 409);

    const pendingSnapAfterRes = await fetch(`${BASE_URL}/api/projects/${project.id}`);
    const pendingSnapAfterJson = await pendingSnapAfterRes.json();
    assert.equal(pendingSnapAfterJson.project.status, 'awaiting_confirmation');
    assert.equal(pendingSnapAfterJson.project.publishedVersion, 3);
    assert.equal(pendingSnapAfterJson.project.draftFiles['src/App.tsx'], appA2);
    assert.equal(
      pendingSnapAfterJson.events.filter((e) => e.type === 'file_write').length,
      beforeGateFileWrites
    );

    const siteStillV3Res = await fetch(`${BASE_URL}/s/${project.slug}`);
    assert.equal(siteStillV3Res.status, 200);
    assert.equal(await siteStillV3Res.text(), site3Html);

    const recordsPendingRes = await fetch(
      `${BASE_URL}/api/cloud/${project.id}/db/registrations`
    );
    const recordsPendingJson = await recordsPendingRes.json();
    assert.equal(recordsPendingJson.records.length, 1);
    assert.equal(recordsPendingJson.records[0].data.title, '张三参会');

    // Explicit confirm restores Alex build, iteration, and publish
    const confirmNewARes = await fetch(`${BASE_URL}/api/projects/${project.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'linear', model: 'mock-default' }),
    });
    const confirmNewAEvents = await readSseEvents(confirmNewARes);
    assert.ok(confirmNewAEvents.some((e) => e.type === 'file_write'));
    assert.ok(
      confirmNewAEvents.some((e) => e.type === 'build_result' && e.payload.ok === true)
    );

    const iterAfterGateRes = await fetch(`${BASE_URL}/api/projects/${project.id}/iterate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: '主色调改成深蓝色' }),
    });
    const iterAfterGateEvents = await readSseEvents(iterAfterGateRes);
    assert.ok(
      iterAfterGateEvents.some((e) => e.type === 'build_result' && e.payload.ok === true)
    );

    const pub4Res = await fetch(`${BASE_URL}/api/projects/${project.id}/publish`, {
      method: 'POST',
    });
    assert.equal(pub4Res.status, 200);
    const pub4Json = await pub4Res.json();
    assert.equal(pub4Json.version, 4);

    const site4Res = await fetch(`${BASE_URL}/s/${project.slug}`);
    assert.equal(site4Res.status, 200);
    const site4Html = await site4Res.text();
    assert.match(site4Html, /PulseCRM/);
    assert.match(site4Html, /bg-blue-800/);

    const recordsAfterV4Res = await fetch(
      `${BASE_URL}/api/cloud/${project.id}/db/registrations`
    );
    const recordsAfterV4Json = await recordsAfterV4Res.json();
    assert.equal(recordsAfterV4Json.records.length, 1);
    assert.equal(recordsAfterV4Json.records[0].data.title, '张三参会');
    console.log('16. Existing draft/published Emma confirmation gate 409 guardrails + confirm recovery passed');

    // 17. Project rename, inline source edit/recompile, and cascade delete on Project B
    const renameBRes = await fetch(`${BASE_URL}/api/projects/${projB.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'InkVault 重命名验收版' }),
    });
    assert.equal(renameBRes.status, 200);
    const renameBJson = await renameBRes.json();
    assert.equal(renameBJson.project.title, 'InkVault 重命名验收版');

    const putFilesBRes = await fetch(`${BASE_URL}/api/projects/${projB.id}/files`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: {
          'src/App.tsx':
            'import React from "react";\nexport default function App() { return <main className="p-8">源码在线编辑实测标记</main>; }',
        },
      }),
    });
    assert.equal(putFilesBRes.status, 200);
    const putFilesBJson = await putFilesBRes.json();
    assert.equal(putFilesBJson.ok, true);
    assert.match(putFilesBJson.previewHtml, /源码在线编辑实测标记/);

    const delBRes = await fetch(`${BASE_URL}/api/projects/${projB.id}`, {
      method: 'DELETE',
    });
    assert.equal(delBRes.status, 200);

    const getBDeletedRes = await fetch(`${BASE_URL}/api/projects/${projB.id}`);
    assert.equal(getBDeletedRes.status, 404);

    // Project A remains intact after deleting Project B
    const snapAFinalRes = await fetch(`${BASE_URL}/api/projects/${project.id}`);
    assert.equal(snapAFinalRes.status, 200);
    const snapAFinalJson = await snapAFinalRes.json();
    assert.equal(snapAFinalJson.project.publishedVersion, 4);
    console.log('17. Project rename, inline source recompile & cascade delete passed');

    console.log('\nALL E2E HTTP SMOKE ASSERTIONS PASSED!');
  } catch (err) {
    console.error('E2E smoke failed.\n' + getLogs());
    throw err;
  } finally {
    child.kill('SIGTERM');
    await sleep(400);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    try {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    } catch {
      // Ignore Windows temp file lock race on immediate exit
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
