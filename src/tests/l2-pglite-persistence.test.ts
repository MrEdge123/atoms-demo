import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { signHmacSha256 } from '@/adapters/app-cloud/crypto';
import { createContainer } from '@/container';
import type { AgentEvent } from '@/domain';

async function drain(iter: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const _ev of iter) {
    // consume stream
  }
}

describe('L2: Real PGlite persistence across container restarts and iterative republish', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atoms-l2-pglite-'));
  const dataDir = path.join(tempRoot, 'db');

  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('persists projects, events, users, pro upgrades, and records across PGlite restarts and v2 republish', async () => {
    let projectId = '';
    let projectSlug = '';
    let userId = '';
    let userToken = '';

    // Session 1: build, publish v1, register user, create 2 records, upgrade plan to pro
    const c1 = await createContainer({
      storageAdapter: 'pglite',
      pgliteDataDir: dataDir,
      builderAdapter: 'esbuild',
      publisherAdapter: 'same-origin',
      billingAdapter: 'mock',
      apiBaseUrl: 'http://127.0.0.1:3000',
      authSecret: 'l2-test-secret',
    });

    const created = await c1.repo.create({
      title: '黑客松活动报名',
      slug: 'hackathon-signup',
    });
    projectId = created.id;
    projectSlug = created.slug;

    await drain(c1.workflow.start(projectId, '做一个黑客松活动报名与签到站'));
    await drain(c1.workflow.confirmPlan(projectId));
    const pubV1 = await c1.workflow.publish(projectId);
    expect(pubV1.version).toBe(1);

    const reg = await c1.appCloud.auth.register(
      projectId,
      'alice@example.com',
      'secret123',
      'Alice'
    );
    userId = reg.user.id;
    userToken = reg.token;

    await c1.appCloud.db.create(
      projectId,
      'registrations',
      { title: 'Alice Team', contact: 'alice@example.com', status: 'pending' },
      userId
    );
    await c1.appCloud.db.create(
      projectId,
      'registrations',
      { title: 'Bob Team', contact: 'bob@example.com', status: 'done' },
      userId
    );

    const webhookBody = JSON.stringify({
      orderId: 'ord_l2_001',
      projectId,
      userId,
      plan: 'pro',
    });
    const hookRes = await c1.appCloud.billing.handleWebhook({
      rawBody: webhookBody,
      signature: signHmacSha256(webhookBody, 'l2-test-secret'),
    });
    expect(hookRes?.plan).toBe('pro');

    await c1.close();

    // Session 2: brand new container pointing to the exact same PGlite directory
    const c2 = await createContainer({
      storageAdapter: 'pglite',
      pgliteDataDir: dataDir,
      builderAdapter: 'esbuild',
      publisherAdapter: 'same-origin',
      billingAdapter: 'mock',
      apiBaseUrl: 'http://127.0.0.1:3000',
      authSecret: 'l2-test-secret',
    });

    const reloaded = await c2.repo.getBySlug(projectSlug);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.publishedVersion).toBe(1);
    expect(reloaded?.publishedHtml).toContain('<title>');
    expect(reloaded?.publishedHtml).toContain('property="og:title"');

    const events = await c2.repo.listEvents(projectId);
    expect(events.length).toBeGreaterThanOrEqual(4);

    const verifiedUser = await c2.appCloud.auth.verifyToken(projectId, userToken);
    expect(verifiedUser?.email).toBe('alice@example.com');
    expect(verifiedUser?.plan).toBe('pro');

    const collections = await c2.appCloud.db.listCollections(projectId);
    expect(collections).toEqual([{ name: 'registrations', count: 2 }]);

    const recordsBeforeIterate = await c2.appCloud.db.list(
      projectId,
      'registrations'
    );
    expect(recordsBeforeIterate).toHaveLength(2);

    // Iterate UI (deep blue + CSV) and republish v2 — existing user & records MUST remain intact
    await drain(
      c2.workflow.iterate(projectId, '把主色调改成深蓝色，并增加导出 CSV 按钮')
    );
    const pubV2 = await c2.workflow.publish(projectId);
    expect(pubV2.version).toBe(2);

    const v2Project = await c2.repo.getById(projectId);
    expect(v2Project?.publishedHtml).toContain('导出 CSV');

    const recordsAfterIterate = await c2.appCloud.db.list(
      projectId,
      'registrations'
    );
    expect(recordsAfterIterate).toHaveLength(2);

    const usersAfterIterate = await c2.appCloud.auth.listUsers(projectId);
    expect(usersAfterIterate).toHaveLength(1);
    expect(usersAfterIterate[0]?.plan).toBe('pro');

    await c2.close();
  }, 25000);

  it('preserves project template, cumulative UI features, and per-project data across interleaved multi-project PGlite operations', async () => {
    const tempMulti = fs.mkdtempSync(
      path.join(os.tmpdir(), 'atoms-l2-multi-')
    );
    const multiDir = path.join(tempMulti, 'db');

    try {
      const c = await createContainer({
        storageAdapter: 'pglite',
        pgliteDataDir: multiDir,
        builderAdapter: 'esbuild',
        publisherAdapter: 'same-origin',
        billingAdapter: 'mock',
        apiBaseUrl: 'http://127.0.0.1:3000',
        authSecret: 'l2-multi-secret',
      });

      // Project A: EventFlow + Branch B + Round 1 (deep blue + CSV) + publish v1 + DB record
      const projA = await c.repo.create({
        title: 'EventFlow 沙龙',
        slug: 'pglite-multi-a',
      });
      await drain(
        c.workflow.start(projA.id, '做一个活动报名与现场签到管理系统')
      );
      await drain(c.workflow.confirmPlan(projA.id, { mode: 'race' }));
      await c.workflow.selectBranch(projA.id, 'branch-b');
      await drain(
        c.workflow.iterate(projA.id, '主色调改成深蓝色、增加导出 CSV 按钮')
      );
      const pubA1 = await c.workflow.publish(projA.id);
      expect(pubA1.version).toBe(1);

      await c.appCloud.db.create(projA.id, 'registrations', {
        title: '王五报名',
        contact: '13900002222',
        status: 'pending',
      });

      // Project B: InkVault preset + confirmPlan + DB record
      const projB = await c.repo.create({
        title: 'InkVault 笔记站',
        slug: 'pglite-multi-b',
      });
      await drain(
        c.workflow.start(
          projB.id,
          '做一个支持账号隔离、标签搜索与 Pro 会员高级导出的云端个人笔记站。'
        )
      );
      await drain(c.workflow.confirmPlan(projB.id, { mode: 'linear' }));
      await c.appCloud.db.create(projB.id, 'notes', {
        title: '架构笔记',
        contact: 'work',
        status: 'done',
      });

      // Switch back to Project A: Round 2 ("将主色调调整为深蓝色") + publish v2
      await drain(c.workflow.iterate(projA.id, '将主色调调整为深蓝色'));
      const pubA2 = await c.workflow.publish(projA.id);
      expect(pubA2.version).toBe(2);

      const projAAfter = await c.repo.getById(projA.id);
      const appA = projAAfter?.draftFiles['src/App.tsx'] ?? '';
      expect(appA).toContain('EventFlow');
      expect(appA).toContain('新增报名记录');
      expect(appA).not.toContain('新增笔记条目');
      expect(appA).toContain('bg-slate-950');
      expect(appA).toContain('bg-blue-800');
      expect(appA).toContain('const canExportCsv = true');
      expect(projAAfter?.publishedHtml).toContain('新增报名记录');
      expect(projAAfter?.publishedHtml).toContain('导出 CSV');
      expect(projAAfter?.publishedHtml).not.toContain('新增笔记条目');

      const recordsA = await c.appCloud.db.list(projA.id, 'registrations');
      const recordsB = await c.appCloud.db.list(projB.id, 'notes');
      expect(recordsA).toHaveLength(1);
      expect(recordsA[0]?.data.title).toBe('王五报名');
      expect(recordsB).toHaveLength(1);
      expect(recordsB[0]?.data.title).toBe('架构笔记');

      await c.close();
    } finally {
      fs.rmSync(tempMulti, { recursive: true, force: true });
    }
  }, 25000);

  it('atomically adopts Race branch via PostgresProjectRepository preserving renamed title and persisting designSystem across restart', async () => {
    const { BUILTIN_STYLE_THEMES } = await import('@/core');
    const tempRaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'atoms-l2-race-adopt-')
    );
    const raceDbDir = path.join(tempRaceDir, 'db');

    try {
      const c1 = await createContainer({
        storageAdapter: 'pglite',
        pgliteDataDir: raceDbDir,
        builderAdapter: 'esbuild',
        publisherAdapter: 'same-origin',
        billingAdapter: 'mock',
        apiBaseUrl: 'http://127.0.0.1:3000',
        authSecret: 'l2-race-secret',
      });

      const obsidianTheme = BUILTIN_STYLE_THEMES.find(
        (t) => t.id === 'preset-obsidian-tech'
      )!;
      const proj = await c1.repo.create({
        title: 'Initial Race Title',
        slug: 'pglite-atomic-race',
      });
      await drain(
        c1.workflow.start(proj.id, 'Build a real-time AI telemetry studio', {
          styleTheme: obsidianTheme,
        })
      );
      await drain(c1.workflow.confirmPlan(proj.id, { mode: 'race' }));
      await c1.repo.rename(proj.id, 'User Renamed Title');
      const raceRunId = (await c1.repo.getById(proj.id))?.raceBranches[0]?.runId;
      expect(raceRunId).toBeTruthy();

      await expect(
        c1.workflow.selectBranch(proj.id, 'branch-b', { runId: 'stale-run-id' })
      ).rejects.toThrow(/stale Race run/);
      const staleAtomic = await c1.repo.adoptRaceBranch(proj.id, {
        branchId: 'branch-b',
        expectedRunId: 'stale-run-id',
        files: { 'src/App.tsx': 'stale' },
      });
      expect(staleAtomic).toBeNull();

      const selected = await c1.workflow.selectBranch(proj.id, 'branch-b', {
        runId: raceRunId,
      });
      expect(selected.title).toBe('User Renamed Title');
      expect(selected.plan?.designSystem?.colorMode).toBe('light');
      expect(selected.plan?.designSystem?.palette.background).toBe('#F8F9FB');
      expect(selected.raceBranches).toHaveLength(0);

      await expect(
        c1.workflow.selectBranch(proj.id, 'branch-a')
      ).rejects.toThrow(/not found/);

      await c1.close();

      const c2 = await createContainer({
        storageAdapter: 'pglite',
        pgliteDataDir: raceDbDir,
        builderAdapter: 'esbuild',
        publisherAdapter: 'same-origin',
        billingAdapter: 'mock',
        apiBaseUrl: 'http://127.0.0.1:3000',
        authSecret: 'l2-race-secret',
      });

      const reloaded = await c2.repo.getById(proj.id);
      expect(reloaded?.title).toBe('User Renamed Title');
      expect(reloaded?.plan?.designSystem?.colorMode).toBe('light');
      expect(reloaded?.plan?.designSystem?.palette.background).toBe('#F8F9FB');
      expect(reloaded?.raceBranches).toHaveLength(0);

      await c2.close();
    } finally {
      fs.rmSync(tempRaceDir, { recursive: true, force: true });
    }
  }, 25000);
});
