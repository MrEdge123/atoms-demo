import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATOMS_CLOUD_SDK_SOURCE,
  BUILTIN_STYLE_THEMES,
  agentReplySchema,
  alexFilesOutputSchema,
  buildAlexGeneratePrompt,
  buildAlexIteratePrompt,
  getCloudSdkPromptDocs,
  getRaceDirectionsForPlan,
  renderDesignMarkdown,
} from '@/core';
import { MockLLMProvider } from '@/adapters/llm/mock';
import {
  CreemBillingAdapter,
  MockBillingAdapter,
  type BillingStore,
} from '@/adapters/app-cloud/billing';
import { signHmacSha256 } from '@/adapters/app-cloud/crypto';
import { EsbuildStaticBuilder } from '@/adapters/builder/esbuild-static';
import { SameOriginSitePublisher } from '@/adapters/publisher/same-origin';
import { MemoryProjectRepository } from '@/adapters/repo/memory';
import { createSseResponse } from '@/app/api/_utils';
import { AtomsWorkflowEngine } from '@/core/workflow';
import { createContainer } from '@/container';
import type { AgentEvent } from '@/domain';
import type { LLMProvider } from '@/ports';

async function collect(iter: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of iter) {
    out.push(ev);
  }
  return out;
}

describe('L1: Core contracts, SOP orchestration, Esbuild, Race Mode & Billing', () => {
  it('enforces SOP confirmation gate before Alex writes any code', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'esbuild',
      llmAdapter: 'mock',
    });

    const project = await c.repo.create({
      title: '活动报名站',
      slug: 'event-gate-test',
    });

    const startEvents = await collect(
      c.workflow.start(project.id, '做一个活动报名和签到系统')
    );

    expect(startEvents.some((e) => e.type === 'research_ready')).toBe(true);
    expect(startEvents.some((e) => e.type === 'plan_ready')).toBe(true);
    expect(startEvents.some((e) => e.type === 'file_write')).toBe(false);

    const afterStart = await c.repo.getById(project.id);
    expect(afterStart?.status).toBe('awaiting_confirmation');
    expect(Object.keys(afterStart?.draftFiles ?? {})).toHaveLength(0);

    await c.close();
  });

  it('blocks iterate and publish throughout pending Emma confirmation even when draft and published v1 already exist, then resumes after confirm', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'esbuild',
      llmAdapter: 'mock',
    });

    const project = await c.repo.create({
      title: '已上线活动站',
      slug: 'emma-gate-existing-draft',
    });

    await collect(
      c.workflow.start(project.id, '做一个科技沙龙活动报名与现场签到管理系统')
    );
    await collect(c.workflow.confirmPlan(project.id, { mode: 'linear' }));
    const pub1 = await c.workflow.publish(project.id);
    expect(pub1.version).toBe(1);

    await c.appCloud.db.create(project.id, 'registrations', {
      title: '旧报名记录',
    });

    const v1Project = await c.repo.getById(project.id);
    const v1DraftApp = v1Project?.draftFiles['src/App.tsx'];
    const v1Html = v1Project?.publishedHtml;
    expect(v1DraftApp).toContain('EventFlow');
    expect(v1Html).toBeTruthy();

    // Start a brand new idea without confirming Emma's new plan
    const restartEvents = await collect(
      c.workflow.start(
        project.id,
        '换一个新想法：做一个独立顾问轻量 CRM 客户跟进台，支持线索录入与跟进'
      )
    );
    expect(restartEvents.some((e) => e.type === 'plan_ready')).toBe(true);
    expect(restartEvents.some((e) => e.type === 'file_write')).toBe(false);

    const eventsBeforeBlocked = await c.repo.listEvents(project.id);
    const fileWritesBefore = eventsBeforeBlocked.filter(
      (e) => e.type === 'file_write'
    ).length;

    const pendingProject = await c.repo.getById(project.id);
    expect(pendingProject?.status).toBe('awaiting_confirmation');
    expect(pendingProject?.draftFiles['src/App.tsx']).toBe(v1DraftApp);
    expect(pendingProject?.publishedHtml).toBe(v1Html);
    expect(pendingProject?.publishedVersion).toBe(1);

    // Must block iterate and publish during awaiting_confirmation without touching draft/published/events
    await expect(
      collect(c.workflow.iterate(project.id, '主色调改成深蓝色'))
    ).rejects.toThrow(/待确认/);
    await expect(c.workflow.publish(project.id)).rejects.toThrow(/待确认/);

    // Must also block across intermediate planning phases (researching / planning)
    for (const phase of ['researching', 'planning'] as const) {
      await c.repo.saveDraft(project.id, pendingProject!.draftFiles, phase);
      await expect(
        collect(c.workflow.iterate(project.id, '主色调改成深蓝色'))
      ).rejects.toThrow(/正在生成新产品方案/);
      await expect(c.workflow.publish(project.id)).rejects.toThrow(
        /正在生成新产品方案/
      );
      await expect(
        collect(c.workflow.confirmPlan(project.id, { mode: 'linear' }))
      ).rejects.toThrow(/等待新方案就绪/);
    }
    await c.repo.saveDraft(
      project.id,
      pendingProject!.draftFiles,
      'awaiting_confirmation'
    );

    const eventsAfterBlocked = await c.repo.listEvents(project.id);
    expect(eventsAfterBlocked.filter((e) => e.type === 'file_write')).toHaveLength(
      fileWritesBefore
    );
    const stillUnchanged = await c.repo.getById(project.id);
    expect(stillUnchanged?.status).toBe('awaiting_confirmation');
    expect(stillUnchanged?.draftFiles['src/App.tsx']).toBe(v1DraftApp);
    expect(stillUnchanged?.publishedHtml).toBe(v1Html);
    expect(stillUnchanged?.publishedVersion).toBe(1);

    // Explicitly confirm the new Emma plan -> normal build, iterate & publish resume cleanly
    const confirmNewEvents = await collect(
      c.workflow.confirmPlan(project.id, { mode: 'linear' })
    );
    expect(confirmNewEvents.some((e) => e.type === 'file_write')).toBe(true);
    const afterConfirm = await c.repo.getById(project.id);
    expect(afterConfirm?.status).toBe('ready');
    expect(afterConfirm?.draftFiles['src/App.tsx']).toContain('PulseCRM');

    await collect(c.workflow.iterate(project.id, '主色调改成深蓝色'));
    const pub2 = await c.workflow.publish(project.id);
    expect(pub2.version).toBe(2);

    const v2Project = await c.repo.getById(project.id);
    expect(v2Project?.publishedHtml).toContain('PulseCRM');
    expect(v2Project?.publishedHtml).toContain('bg-blue-800');

    const preservedRecords = await c.appCloud.db.list(project.id, 'registrations');
    expect(preservedRecords).toHaveLength(1);
    expect((preservedRecords[0]?.data as { title?: string }).title).toBe(
      '旧报名记录'
    );

    await c.close();
  }, 15000);

  it('auto-fixes scripted syntax errors using real EsbuildStaticBuilder and embeds Tailwind + SEO/OG', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'esbuild',
      llmAdapter: 'mock',
      scriptedErrorsBeforeFix: 1,
    });

    const project = await c.repo.create({
      title: '自愈测试项目',
      slug: 'autofix-test',
    });

    await collect(c.workflow.start(project.id, '做一个轻量 CRM'));
    const buildEvents = await collect(c.workflow.confirmPlan(project.id));

    expect(buildEvents.some((e) => e.type === 'autofix_start')).toBe(true);
    const buildResult = buildEvents.find((e) => e.type === 'build_result');
    expect((buildResult?.payload as { ok: boolean }).ok).toBe(true);

    const pub = await c.workflow.publish(project.id);
    expect(pub.version).toBe(1);

    const publishedProject = await c.repo.getById(project.id);
    const html = publishedProject?.publishedHtml ?? '';
    expect(html).toContain('<title>');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('<style>');
    expect(html).toContain('window.__ATOMS_CONFIG__');

    // Verify preview mode injects RuntimeErrorBoundary reporter
    const previewArtifact = await c.builder.compile({
      files: publishedProject!.draftFiles,
      projectId: project.id,
      apiBaseUrl: c.apiBaseUrl,
      capabilities: publishedProject!.capabilities,
      mode: 'preview',
      seo: { title: 'Preview Title', description: 'Preview Desc' },
    });
    expect(previewArtifact.ok).toBe(true);
    if (previewArtifact.ok) {
      expect(previewArtifact.html).toContain('ATOMS_RUNTIME_ERROR');
    }

    await c.close();
  }, 15000);

  it('rejects disallowed package imports in EsbuildStaticBuilder', async () => {
    const builder = new EsbuildStaticBuilder();
    const res = await builder.compile({
      files: {
        'src/App.tsx': `import React from 'react';\nimport axios from 'axios';\nexport default function App() { return <div>{typeof axios}</div>; }`,
      },
      projectId: 'proj_allowlist',
      apiBaseUrl: 'http://localhost:3000',
      capabilities: ['db'],
      mode: 'preview',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]?.message).toContain('Disallowed package import "axios"');
    }
  });

  it('isolates draft edits from published HTML', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'esbuild',
    });

    const project = await c.repo.create({
      title: '版本隔离站',
      slug: 'draft-isolation',
    });
    await collect(c.workflow.start(project.id, '做一个活动报名系统'));
    await collect(c.workflow.confirmPlan(project.id));
    await c.workflow.publish(project.id);

    const v1 = await c.repo.getById(project.id);
    const v1Html = v1?.publishedHtml;
    expect(v1Html).toBeTruthy();

    // Corrupt draft directly — published HTML must remain intact
    await c.repo.saveDraft(
      project.id,
      { 'src/App.tsx': 'export default function Broken() { return <<<; }' },
      'error'
    );

    const afterDraftBreak = await c.repo.getById(project.id);
    expect(afterDraftBreak?.publishedHtml).toBe(v1Html);
    expect(afterDraftBreak?.publishedVersion).toBe(1);

    await c.close();
  });

  it('strictly isolates records and JWT tokens across projects', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'mock',
    });

    const p1 = await c.repo.create({ title: 'Site A', slug: 'site-a' });
    const p2 = await c.repo.create({ title: 'Site B', slug: 'site-b' });

    const regA = await c.appCloud.auth.register(
      p1.id,
      'user@example.com',
      'pass1234',
      'Alice'
    );
    expect(await c.appCloud.auth.verifyToken(p1.id, regA.token)).not.toBeNull();
    expect(await c.appCloud.auth.verifyToken(p2.id, regA.token)).toBeNull();

    await c.appCloud.db.create(p1.id, 'orders', { item: 'Pro Plan' }, regA.user.id);
    const p1Orders = await c.appCloud.db.list(p1.id, 'orders');
    const p2Orders = await c.appCloud.db.list(p2.id, 'orders');

    expect(p1Orders).toHaveLength(1);
    expect(p2Orders).toHaveLength(0);

    await c.close();
  });

  it('enforces Race Mode candidate/draft/published isolation and blocks publish/iterate until branch selection', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'esbuild',
    });

    const project = await c.repo.create({
      title: 'Race Mode App',
      slug: 'race-mode',
    });

    await collect(c.workflow.start(project.id, '做一个极客笔记站'));
    const raceEvents = await collect(
      c.workflow.confirmPlan(project.id, { mode: 'race' })
    );

    expect(raceEvents.some((e) => e.branchId === 'branch-a')).toBe(true);
    expect(raceEvents.some((e) => e.branchId === 'branch-b')).toBe(true);

    const afterRace = await c.repo.getById(project.id);
    expect(afterRace?.status).toBe('awaiting_branch_selection');
    expect(afterRace?.raceBranches).toHaveLength(2);
    expect(afterRace?.raceBranches[0]?.previewHtml).toBeTruthy();
    expect(afterRace?.raceBranches[1]?.previewHtml).toBeTruthy();
    // Candidate branches must NOT pollute draftFiles before explicit adoption
    expect(Object.keys(afterRace?.draftFiles ?? {})).toHaveLength(0);

    // Publish and iterate must both be rejected while selection is pending
    await expect(c.workflow.publish(project.id)).rejects.toThrow(/Race Mode/);
    await expect(
      collect(c.workflow.iterate(project.id, '把主色调改成深蓝色'))
    ).rejects.toThrow(/Race Mode/);
    expect((await c.repo.getById(project.id))?.publishedVersion).toBe(0);

    // Invalid or compile-failed branch cannot be selected
    await expect(
      c.workflow.selectBranch(project.id, 'nonexistent-branch')
    ).rejects.toThrow(/not found/);

    const selected = await c.workflow.selectBranch(project.id, 'branch-b');
    expect(selected.status).toBe('ready');
    expect(selected.draftFiles['src/App.tsx']).toContain('bg-slate-950');
    expect(selected.raceBranches).toHaveLength(0);

    const pub1 = await c.workflow.publish(project.id);
    expect(pub1.version).toBe(1);
    const v1Html = (await c.repo.getById(project.id))?.publishedHtml;
    expect(v1Html).toContain('bg-slate-950');

    // Re-running Race Mode on an already-published project must preserve v1 online HTML
    await collect(c.workflow.confirmPlan(project.id, { mode: 'race' }));
    const pendingV2 = await c.repo.getById(project.id);
    expect(pendingV2?.status).toBe('awaiting_branch_selection');
    expect(pendingV2?.publishedVersion).toBe(1);
    expect(pendingV2?.publishedHtml).toBe(v1Html);
    await expect(c.workflow.publish(project.id)).rejects.toThrow(/Race Mode/);
    await expect(
      collect(c.workflow.iterate(project.id, '增加导出按钮'))
    ).rejects.toThrow(/Race Mode/);

    // Simulate branch-a compile failure in raceBranches and ensure failed branch is rejected
    await c.repo.saveRaceBranches(project.id, [
      {
        ...pendingV2!.raceBranches[0]!,
        previewHtml: null,
        errors: [{ phase: 'compile', message: 'Simulated compile error' }],
      },
      pendingV2!.raceBranches[1]!,
    ]);
    await expect(
      c.workflow.selectBranch(project.id, 'branch-a')
    ).rejects.toThrow(/failed compilation/);

    // Choosing valid branch-b clears candidates without touching prior v1 publishedHtml
    const selectedAgain = await c.workflow.selectBranch(project.id, 'branch-b');
    expect(selectedAgain.status).toBe('ready');
    expect(selectedAgain.raceBranches).toHaveLength(0);
    expect(selectedAgain.publishedHtml).toBe(v1Html);

    await c.close();
  }, 15000);

  it('keeps MockLLMProvider templates and incremental features isolated across interleaved projects', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'esbuild',
      llmAdapter: 'mock',
    });

    // Project A: EventFlow with Branch B (dark), then iterate Round 1 (deep blue + CSV) and publish v1
    const projA = await c.repo.create({
      title: 'EventFlow 沙龙',
      slug: 'interleave-a',
    });
    await collect(
      c.workflow.start(
        projA.id,
        '做一个科技沙龙活动报名与现场签到管理系统，支持报名表单提交和签到'
      )
    );
    await collect(c.workflow.confirmPlan(projA.id, { mode: 'race' }));
    await c.workflow.selectBranch(projA.id, 'branch-b');
    await collect(
      c.workflow.iterate(projA.id, '主色调改成深蓝色、增加导出 CSV 按钮')
    );
    await c.workflow.publish(projA.id);

    // Project B: InkVault preset runs start + confirmPlan in between
    const projB = await c.repo.create({
      title: 'InkVault 笔记',
      slug: 'interleave-b',
    });
    await collect(
      c.workflow.start(
        projB.id,
        '做一个支持账号隔离、标签搜索与 Pro 会员高级导出的云端个人笔记站。'
      )
    );
    await collect(c.workflow.confirmPlan(projB.id, { mode: 'linear' }));

    const bAfter = await c.repo.getById(projB.id);
    expect(bAfter?.draftFiles['src/App.tsx']).toContain('新增笔记条目');

    // Switch back to Project A and iterate Round 2 with ONLY color adjustment
    await collect(c.workflow.iterate(projA.id, '将主色调调整为深蓝色'));
    const aAfterRound2 = await c.repo.getById(projA.id);
    const appTsxA = aAfterRound2?.draftFiles['src/App.tsx'] ?? '';

    expect(appTsxA).toContain('EventFlow');
    expect(appTsxA).toContain('新增报名记录');
    expect(appTsxA).not.toContain('新增笔记条目');
    expect(appTsxA).toContain('const COLLECTION = "registrations"');
    expect(appTsxA).toContain('bg-slate-950');
    expect(appTsxA).toContain('bg-blue-800');
    expect(appTsxA).toContain('const canExportCsv = true');

    await c.close();
  }, 15000);

  it('verifies Mock and Creem webhook signatures and enforces order idempotency', async () => {
    let currentPlan: 'free' | 'pro' = 'free';
    const seenOrders = new Set<string>();
    let setPlanCalls = 0;

    const store: BillingStore = {
      getUserPlan: async () => currentPlan,
      setUserPlan: async (_pid, _uid, plan) => {
        setPlanCalls += 1;
        currentPlan = plan;
      },
      recordOrderIfNew: async (order) => {
        if (seenOrders.has(order.orderId)) return false;
        seenOrders.add(order.orderId);
        return true;
      },
    };

    const secret = 'test-webhook-secret';
    const mockBilling = new MockBillingAdapter({
      apiBaseUrl: 'http://localhost:3000',
      webhookSecret: secret,
      store,
    });

    const mockSession = await mockBilling.createCheckoutSession({
      projectId: 'p1',
      userId: 'u1',
      plan: 'pro',
      returnUrl: 'http://localhost:3000/s/demo',
    });
    expect(mockSession.checkoutUrl).toContain('/checkout/mock');

    const mockPayload = JSON.stringify({
      orderId: 'ord_mock_1',
      projectId: 'p1',
      userId: 'u1',
      plan: 'pro',
    });

    // Tampered signature fails
    expect(
      await mockBilling.handleWebhook({
        rawBody: mockPayload,
        signature: 'deadbeef',
      })
    ).toBeNull();
    expect(currentPlan).toBe('free');

    // Valid signature upgrades plan
    const okMock = await mockBilling.handleWebhook({
      rawBody: mockPayload,
      signature: signHmacSha256(mockPayload, secret),
    });
    expect(okMock?.plan).toBe('pro');
    expect(currentPlan).toBe('pro');
    expect(setPlanCalls).toBe(1);

    // Duplicate orderId is idempotent
    await mockBilling.handleWebhook({
      rawBody: mockPayload,
      signature: signHmacSha256(mockPayload, secret),
    });
    expect(setPlanCalls).toBe(1);

    // Creem Test Mode adapter test with mocked fetch
    currentPlan = 'free';
    const creemBilling = new CreemBillingAdapter({
      apiKey: 'creem_test_key',
      webhookSecret: secret,
      productId: 'prod_123',
      store,
      fetchFn: async (url, init) => {
        expect(String(url)).toBe('https://test-api.creem.io/v1/checkouts');
        expect((init?.headers as Record<string, string>)['x-api-key']).toBe(
          'creem_test_key'
        );
        return new Response(
          JSON.stringify({
            id: 'ch_creem_1',
            checkout_url: 'https://test.creem.io/pay/ch_creem_1',
          }),
          { status: 200 }
        );
      },
    });

    const creemSession = await creemBilling.createCheckoutSession({
      projectId: 'p2',
      userId: 'u2',
      plan: 'pro',
      returnUrl: 'http://localhost:3000/s/creem-demo',
    });
    expect(creemSession.checkoutUrl).toBe('https://test.creem.io/pay/ch_creem_1');

    const creemPayload = JSON.stringify({
      id: 'evt_1',
      eventType: 'checkout.completed',
      object: {
        id: 'ch_creem_1',
        order: { id: 'ord_creem_1' },
        metadata: { projectId: 'p2', userId: 'u2', plan: 'pro' },
      },
    });

    expect(
      await creemBilling.handleWebhook({
        rawBody: creemPayload,
        signature: 'bad-sig',
      })
    ).toBeNull();

    const okCreem = await creemBilling.handleWebhook({
      rawBody: creemPayload,
      signature: signHmacSha256(creemPayload, secret),
    });
    expect(okCreem?.orderId).toBe('ord_creem_1');
    expect(currentPlan).toBe('pro');
    expect(setPlanCalls).toBe(2);

    // Replay Creem duplicate orderId does not re-trigger setUserPlan
    await creemBilling.handleWebhook({
      rawBody: creemPayload,
      signature: signHmacSha256(creemPayload, secret),
    });
    expect(setPlanCalls).toBe(2);
  });

  it('supports project rename and cascading purge/delete without touching sibling projects', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'mock',
    });

    const pKeep = await c.repo.create({ title: '保留项目', slug: 'keep-proj' });
    const pDel = await c.repo.create({ title: '待删项目', slug: 'del-proj' });

    const renamed = await c.repo.rename(pKeep.id, '重命名后项目');
    expect(renamed.title).toBe('重命名后项目');

    await expect(c.repo.rename(pKeep.id, '   ')).rejects.toThrow();

    await c.repo.appendEvent(pDel.id, {
      seq: 1,
      role: 'iris',
      type: 'thought',
      payload: { message: 'hello' },
      timestamp: new Date().toISOString(),
    });
    await c.appCloud.db.create(pDel.id, 'notes', { title: '待清理记录' });
    const regDel = await c.appCloud.auth.register(
      pDel.id,
      'del@example.com',
      'pass1234'
    );
    await c.appCloud.db.create(pKeep.id, 'notes', { title: '保留记录' });

    await c.appCloud.purgeProject(pDel.id);
    const removed = await c.repo.remove(pDel.id);
    expect(removed).toBe(true);
    expect(await c.repo.getById(pDel.id)).toBeNull();
    expect(await c.repo.listEvents(pDel.id)).toHaveLength(0);
    expect(await c.appCloud.db.list(pDel.id, 'notes')).toHaveLength(0);
    expect(await c.appCloud.auth.listUsers(pDel.id)).toHaveLength(0);
    expect(await c.appCloud.auth.verifyToken(pDel.id, regDel.token)).toBeNull();

    // Sibling project remains intact
    expect((await c.repo.getById(pKeep.id))?.title).toBe('重命名后项目');
    expect(await c.appCloud.db.list(pKeep.id, 'notes')).toHaveLength(1);

    await c.close();
  });

  it('integrates UI design guide, generates DESIGN.md after confirmation, differentiates scenarios, and compiles arbitrary Tailwind utilities', async () => {
    const guidePath = path.resolve(
      process.cwd(),
      'docs/08-ui-design-guide.md'
    );
    expect(fs.existsSync(guidePath)).toBe(true);
    const guideText = fs.readFileSync(guidePath, 'utf8');
    expect(guideText).toContain('通用设计原则');
    expect(guideText).toContain('交付前自查清单');

    const craftTheme = BUILTIN_STYLE_THEMES.find(
      (t) => t.id === 'preset-craft-atelier'
    );
    expect(craftTheme).toBeTruthy();

    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'esbuild',
      llmAdapter: 'mock',
    });

    const proj = await c.repo.create({
      title: '器物集测试',
      slug: 'craft-design-test',
    });

    await collect(
      c.workflow.start(proj.id, '做一个手作陶瓷茶器与预约品鉴官网', {
        styleTheme: craftTheme,
      })
    );

    const afterStart = await c.repo.getById(proj.id);
    expect(Object.keys(afterStart?.draftFiles ?? {})).toHaveLength(0);
    expect(afterStart?.plan?.designSystem?.scenario).toBe('D');
    expect(afterStart?.plan?.designSystem?.themeId).toBe('preset-craft-atelier');
    expect(afterStart?.plan?.designSystem?.palette.accent).toBe('#9A522B');

    const raceDirsD = getRaceDirectionsForPlan(afterStart?.plan);
    const raceDirsB = getRaceDirectionsForPlan(null);
    expect(raceDirsD[0]?.label).not.toBe(raceDirsB[0]?.label);
    expect(raceDirsD[1]?.label).toContain('暗调');

    const alexPrompt = buildAlexGeneratePrompt({
      plan: afterStart!.plan!,
      designMd: renderDesignMarkdown(afterStart!.plan!),
    });
    expect(alexPrompt.system).toContain('SCENARIO D SPECIFIC CRAFT RULES');
    expect(alexPrompt.system).toContain('#9A522B');
    expect(alexPrompt.system).toContain('Pre-Delivery Self-Checklist');

    await collect(c.workflow.confirmPlan(proj.id, { mode: 'linear' }));
    const afterBuild = await c.repo.getById(proj.id);
    const designMd = afterBuild?.draftFiles['DESIGN.md'] ?? '';
    expect(designMd).toContain('## Direction & Layout');
    expect(designMd).toContain('## Tokens');
    expect(designMd).toContain('#9A522B');
    expect(designMd).toContain('匠心器物');

    const builder = new EsbuildStaticBuilder();
    const compiled = await builder.compile({
      files: {
        'DESIGN.md': '# DESIGN\nKeep class-[should_not_break]',
        'src/App.tsx': `import React from 'react';
export default function App() {
  return (
    <main className="min-h-screen bg-[#FAF8F4] text-[clamp(1.25rem,3vw,2.5rem)] border border-[rgba(12,12,12,0.08)] transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] font-editorial">
      器物集
    </main>
  );
}`,
      },
      projectId: 'proj_design_css',
      apiBaseUrl: 'http://localhost:3000',
      capabilities: ['db'],
      mode: 'preview',
    });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) {
      const styleSection = compiled.html.slice(
        compiled.html.indexOf('<style>'),
        compiled.html.indexOf('</style>')
      );
      expect(styleSection).toContain('.font-editorial');
      expect(styleSection).toContain('prefers-reduced-motion');
      expect(styleSection).toContain('rgba(12,12,12,0.08)');
      expect(styleSection).toContain('cubic-bezier(0.22,1,0.36,1)');
      expect(styleSection).toContain('clamp(1.25rem, 3vw, 2.5rem)');
    }

    await c.close();
  }, 15000);

  it('prevents role name collisions and applies confirmed themes, Race Mode tokens, and CSS cascade layers', async () => {
    const {
      BUILTIN_STYLE_THEMES,
      applyThemeToDesignSystem,
      createUnthemedDesignSystem,
      isPendingPlanConfirmation,
      styleThemeSchema,
    } = await import('@/core');

    const c = await createContainer({
      storageAdapter: 'memory',
      llmAdapter: 'mock',
      builderAdapter: 'esbuild',
    });

    try {
      // (a) Role collision regression: theme "Iris Studio" + project "Emma Studio"
      const collisionTheme = {
        id: 'custom-iris-studio',
        name: 'Iris Studio',
        description: 'Warm editorial test theme named Iris Studio',
        scenario: 'B' as const,
        colorMode: 'light' as const,
        palette: {
          background: '#FAF9F6',
          surface: '#FFFFFF',
          textPrimary: '#1A1816',
          textMuted: '#6C665E',
          accent: '#8B4A2B',
        },
        typography: {
          headingStyle: 'editorial-serif' as const,
          bodyStyle: 'sans' as const,
        },
        stylePrompt: 'Warm gallery layout with editorial serif headings',
        builtIn: false,
      };
      const pCollision = await c.repo.create({
        title: 'Emma Studio',
        slug: 'emma-studio-collision',
      });
      for await (const _ of c.workflow.start(
        pCollision.id,
        'Build an atelier portfolio for Emma Studio',
        { styleTheme: collisionTheme }
      )) {
        // drain SSE events
      }
      const afterStart = await c.repo.getById(pCollision.id);
      expect(afterStart).not.toBeNull();
      expect(isPendingPlanConfirmation(afterStart!)).toBe(true);
      expect(afterStart?.plan?.designSystem?.themeName).toBe('Iris Studio');

      for await (const _ of c.workflow.confirmPlan(pCollision.id, {
        mode: 'linear',
      })) {
        // drain SSE events
      }
      const afterConfirm = await c.repo.getById(pCollision.id);
      expect(afterConfirm).not.toBeNull();
      expect(isPendingPlanConfirmation(afterConfirm!)).toBe(false);
      expect(afterConfirm?.draftFiles['DESIGN.md']).toContain('Iris Studio');
      expect(afterConfirm?.draftFiles['src/App.tsx']).toContain('bg-[#FAF9F6]');

      // (b) Obsidian tech dark palette in linear mode & contrasting Race Mode branches
      const obsidianTheme = BUILTIN_STYLE_THEMES.find(
        (t) => t.id === 'preset-obsidian-tech'
      );
      expect(obsidianTheme).toBeDefined();

      const pObsLinear = await c.repo.create({
        title: 'Obsidian Linear App',
        slug: 'obsidian-linear-app',
      });
      for await (const _ of c.workflow.start(
        pObsLinear.id,
        'Build a dark AI telemetry product landing page',
        { styleTheme: obsidianTheme! }
      )) {
        // drain
      }
      for await (const _ of c.workflow.confirmPlan(pObsLinear.id, {
        mode: 'linear',
      })) {
        // drain
      }
      const obsLinear = await c.repo.getById(pObsLinear.id);
      expect(obsLinear?.draftFiles['src/App.tsx']).toContain(
        'data-color-mode="dark"'
      );
      expect(obsLinear?.draftFiles['src/App.tsx']).toContain('bg-[#0A0B10]');

      const pObsRace = await c.repo.create({
        title: 'Obsidian Race App',
        slug: 'obsidian-race-app',
      });
      for await (const _ of c.workflow.start(
        pObsRace.id,
        'Build an AI telemetry workspace with dual style branches',
        { styleTheme: obsidianTheme! }
      )) {
        // drain
      }
      for await (const _ of c.workflow.confirmPlan(pObsRace.id, {
        mode: 'race',
      })) {
        // drain
      }
      const obsRace = await c.repo.getById(pObsRace.id);
      const branchA = obsRace?.raceBranches.find(
        (b) => b.branchId === 'branch-a'
      );
      const branchB = obsRace?.raceBranches.find(
        (b) => b.branchId === 'branch-b'
      );
      expect(branchA?.designSystem?.colorMode).toBe('dark');
      expect(branchA?.files['src/App.tsx']).toContain('bg-[#0A0B10]');
      expect(branchB?.designSystem?.colorMode).toBe('light');
      expect(branchB?.files['DESIGN.md']).toContain('#F8F9FB');
      expect(branchB?.files['src/App.tsx']).toContain('data-color-mode="light"');
      expect(branchB?.files['src/App.tsx']).toContain('bg-[#F8F9FB]');

      const selectedBranch = await c.workflow.selectBranch(
        pObsRace.id,
        'branch-b'
      );
      expect(selectedBranch.plan?.designSystem?.colorMode).toBe('light');
      expect(selectedBranch.plan?.designSystem?.palette.background).toBe(
        '#F8F9FB'
      );

      // (c) Theme application scenario rebase (B -> D), null restore, and hex validation
      const baselineB = createUnthemedDesignSystem('B');
      const themeD = BUILTIN_STYLE_THEMES.find((t) => t.scenario === 'D');
      expect(themeD).toBeDefined();
      const rebasedD = applyThemeToDesignSystem(
        baselineB,
        themeD!,
        baselineB
      );
      expect(rebasedD?.scenario).toBe('D');
      expect(rebasedD?.layoutBlueprint).not.toBe(baselineB.layoutBlueprint);
      expect(rebasedD?.mediaStrategy).not.toBe(baselineB.mediaStrategy);

      const restoredB = applyThemeToDesignSystem(rebasedD, null, baselineB);
      expect(restoredB?.scenario).toBe('B');
      expect(restoredB?.themeId).toBeUndefined();
      expect(restoredB?.layoutBlueprint).toBe(baselineB.layoutBlueprint);

      const badHex = styleThemeSchema.safeParse({
        ...themeD!,
        palette: { ...themeD!.palette, background: '#GGGGGG' },
      });
      expect(badHex.success).toBe(false);

      // (d) EsbuildStaticBuilder CSS cascade layers & responsive font stack
      const baseFiles = {
        ...afterConfirm!.draftFiles,
        'src/App.tsx': `import React from 'react';
export default function App() {
  return (
    <main className="min-h-screen bg-[#FAF9F6] text-[#1A1816]">
      <h1 className="font-editorial md:font-sans font-serif text-[clamp(1.25rem,3vw,2.5rem)]">
        Cascade Layer Check
      </h1>
    </main>
  );
}`,
      };
      const compiledCssCheck = await c.builder.compile({
        files: baseFiles,
        projectId: pCollision.id,
        apiBaseUrl: 'http://localhost:3000',
        capabilities: [],
        mode: 'preview',
      });
      expect(compiledCssCheck.ok).toBe(true);
      if (compiledCssCheck.ok) {
        const styleSection = compiledCssCheck.html.slice(
          compiledCssCheck.html.indexOf('<style>'),
          compiledCssCheck.html.indexOf('</style>')
        );
        expect(styleSection).toMatch(/overflow-x:\s*clip/);
        expect(styleSection).not.toMatch(/overflow-x:\s*hidden/);
        const layerCompIdx = styleSection.indexOf('@layer components');
        const editorialIdx = styleSection.indexOf('.font-editorial');
        const mdSansIdx = styleSection.indexOf('.md\\:font-sans');
        expect(layerCompIdx).toBeGreaterThanOrEqual(0);
        expect(editorialIdx).toBeGreaterThan(layerCompIdx);
        expect(mdSansIdx).toBeGreaterThan(editorialIdx);
      }
    } finally {
      await c.close();
    }
  }, 20000);

  it('enforces atomic branch selection, unthemed Race tokens, palette fidelity, WCAG contrast, theme migration, and editorial font stack', async () => {
    const {
      BUILTIN_STYLE_THEMES,
      createUnthemedDesignSystem,
      getRaceDirectionsForPlan,
      isSameThemeContent,
      migrateLegacyStyleTheme,
      renderDesignMarkdown,
      resolveBranchDesignSystem,
    } = await import('@/core');

    const c = await createContainer({
      storageAdapter: 'memory',
      llmAdapter: 'mock',
      builderAdapter: 'esbuild',
    });

    try {
      // 1. Title preservation & atomic concurrent branch selection
      const projAtomic = await c.repo.create({
        title: 'Initial Title',
        slug: 'atomic-race-title',
      });
      await collect(
        c.workflow.start(
          projAtomic.id,
          'Build an SaaS analytics workspace with race branches'
        )
      );
      await collect(c.workflow.confirmPlan(projAtomic.id, { mode: 'race' }));
      await c.repo.rename(projAtomic.id, 'Renamed Custom Title');

      const raceResults = await Promise.allSettled([
        c.workflow.selectBranch(projAtomic.id, 'branch-a'),
        c.workflow.selectBranch(projAtomic.id, 'branch-b'),
      ]);
      const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
      const rejected = raceResults.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const afterAtomic = await c.repo.getById(projAtomic.id);
      expect(afterAtomic?.title).toBe('Renamed Custom Title');
      expect(afterAtomic?.raceBranches).toHaveLength(0);
      const adoptedMode = afterAtomic?.plan?.designSystem?.colorMode;
      expect(adoptedMode === 'light' || adoptedMode === 'dark').toBe(true);
      expect(afterAtomic?.draftFiles['src/App.tsx']).toContain(
        `data-color-mode="${adoptedMode}"`
      );

      // 2. Unthemed Race branch A consistency & neutral contrast branch B tone
      const unthemedDs = createUnthemedDesignSystem('B');
      const bespokePlan = {
        appName: 'Bespoke Canvas',
        summary: 'Scenario B plan with custom warm background',
        targetUsers: 'product teams',
        capabilities: ['db' as const],
        collections: [
          { name: 'items', fields: ['title'], description: 'Main records' },
        ],
        pages: [{ name: 'home', purpose: 'Overview dashboard' }],
        designSystem: {
          ...unthemedDs,
          palette: {
            ...unthemedDs.palette,
            background: '#FAF8F4',
          },
        },
      };
      const bespokeDirs = getRaceDirectionsForPlan(bespokePlan);
      const resolvedBespokeA = resolveBranchDesignSystem(
        bespokePlan,
        bespokeDirs[0]!
      );
      expect(bespokeDirs[0]?.palette.background).toBe('#FAF8F4');
      expect(bespokeDirs[0]?.styleDirection).toContain('#FAF8F4');
      expect(resolvedBespokeA.palette.background).toBe('#FAF8F4');

      const obsidianTheme = BUILTIN_STYLE_THEMES.find(
        (t) => t.id === 'preset-obsidian-tech'
      )!;
      const obsPlan = {
        ...bespokePlan,
        appName: 'Obsidian Contrast Check',
        designSystem: {
          ...createUnthemedDesignSystem('G'),
          colorMode: obsidianTheme.colorMode,
          palette: obsidianTheme.palette,
          tone: '深空 #0A0B10 光学玻璃暗色风格',
          themeId: obsidianTheme.id,
          themeName: obsidianTheme.name,
          customStylePrompt: obsidianTheme.stylePrompt,
        },
      };
      const obsDirs = getRaceDirectionsForPlan(obsPlan);
      const resolvedObsB = resolveBranchDesignSystem(obsPlan, obsDirs[1]!);
      const mdObsB = renderDesignMarkdown({
        ...obsPlan,
        designSystem: resolvedObsB,
      });
      expect(resolvedObsB.colorMode).toBe('light');
      expect(resolvedObsB.palette.background).toBe('#F8F9FB');
      expect(resolvedObsB.tone).not.toContain('#0A0B10');
      expect(resolvedObsB.layoutBlueprint).not.toContain('#0A0B10');
      expect(mdObsB).not.toContain('#0A0B10');

      // 3. Precision SaaS accent + Obsidian deep-blue edit + WCAG button text contrast
      const saasTheme = BUILTIN_STYLE_THEMES.find(
        (t) => t.id === 'preset-saas-precision'
      )!;
      const projSaas = await c.repo.create({
        title: 'Precision SaaS App',
        slug: 'precision-saas-palette',
      });
      await collect(
        c.workflow.start(projSaas.id, 'Build a precision B2B analytics workspace', {
          styleTheme: saasTheme,
        })
      );
      await collect(c.workflow.confirmPlan(projSaas.id, { mode: 'linear' }));
      const saasDone = await c.repo.getById(projSaas.id);
      const saasApp = saasDone?.draftFiles['src/App.tsx'] ?? '';
      expect(saasApp).toContain('bg-[#F7F7F5]');
      expect(saasApp).toContain('bg-[#2554D7]');
      expect(saasApp).toContain('text-white');
      expect(saasApp).not.toContain('bg-indigo-600');

      const projObs = await c.repo.create({
        title: 'Obsidian Accent Edit',
        slug: 'obsidian-accent-edit',
      });
      await collect(
        c.workflow.start(projObs.id, 'Build an AI inference telemetry dashboard', {
          styleTheme: obsidianTheme,
        })
      );
      await collect(c.workflow.confirmPlan(projObs.id, { mode: 'linear' }));
      const obsInitial = await c.repo.getById(projObs.id);
      const obsInitialApp = obsInitial?.draftFiles['src/App.tsx'] ?? '';
      expect(obsInitialApp).toContain('bg-[#0A0B10]');
      expect(obsInitialApp).toContain('bg-[#5B8CFF]');
      expect(obsInitialApp).toContain('text-[#0F1115]');

      await collect(c.workflow.iterate(projObs.id, '把主色调改成深蓝色'));
      const obsAfterDeepBlue = await c.repo.getById(projObs.id);
      const obsIterApp = obsAfterDeepBlue?.draftFiles['src/App.tsx'] ?? '';
      expect(obsIterApp).toContain('bg-[#0A0B10]');
      expect(obsIterApp).toContain('bg-blue-800');

      // 4. Legacy CSS color migration & duplicate theme content detection
      const legacyTheme = migrateLegacyStyleTheme({
        id: 'legacy-1',
        name: 'Legacy Theme',
        description: 'Old saved theme using rgb/hsl/named colors',
        scenario: 'D',
        colorMode: 'light',
        palette: {
          background: 'rgb(255, 255, 255)',
          surface: 'rgba(10, 11, 16, 1)',
          textPrimary: 'hsl(210, 50%, 40%)',
          textMuted: 'white',
          accent: '#abc',
        },
        typography: {
          headingStyle: 'editorial-serif',
          bodyStyle: 'sans',
        },
        stylePrompt: 'Warm gallery layout with editorial typography',
      });
      expect(legacyTheme).not.toBeNull();
      expect(legacyTheme?.palette.background).toBe('#FFFFFF');
      expect(legacyTheme?.palette.surface).toBe('#0A0B10');
      expect(legacyTheme?.palette.textPrimary).toBe('#336699');
      expect(legacyTheme?.palette.textMuted).toBe('#FFFFFF');
      expect(legacyTheme?.palette.accent).toBe('#AABBCC');

      expect(
        migrateLegacyStyleTheme({
          ...legacyTheme!,
          palette: { ...legacyTheme!.palette, accent: '#GGGGGG' },
        })
      ).toBeNull();

      const sameDiffId = {
        ...legacyTheme!,
        id: 'other-id',
        palette: { ...legacyTheme!.palette, background: '#ffffff' },
      };
      expect(isSameThemeContent(legacyTheme!, sameDiffId)).toBe(true);
      expect(
        isSameThemeContent(legacyTheme!, {
          ...sameDiffId,
          stylePrompt: 'Changed prompt',
        })
      ).toBe(false);

      // 5. Standalone .font-editorial retains full serif font stack when font-serif is unused
      const standaloneEditorialFiles = {
        ...saasDone!.draftFiles,
        'src/App.tsx': `import React from 'react';
export default function App() {
  return (
    <main className="min-h-screen bg-[#FAF8F4] text-[#1D1916]">
      <h1 className="font-editorial text-4xl">Editorial Headline Only</h1>
    </main>
  );
}`,
      };
      const compiledStandalone = await c.builder.compile({
        files: standaloneEditorialFiles,
        projectId: projSaas.id,
        apiBaseUrl: 'http://localhost:3000',
        capabilities: [],
        mode: 'preview',
      });
      expect(compiledStandalone.ok).toBe(true);
      if (compiledStandalone.ok) {
        const styleSection = compiledStandalone.html.slice(
          compiledStandalone.html.indexOf('<style>'),
          compiledStandalone.html.indexOf('</style>')
        );
        expect(styleSection).toContain('Playfair Display');
        expect(styleSection).toContain('STZhongsong');
      }
    } finally {
      await c.close();
    }
  }, 20000);

  it('binds Race adoption to runId, handles RGBA opacity & scenario dedup, ensures WCAG button contrast, and retains mode-independent Race constraints', async () => {
    const {
      BUILTIN_STYLE_THEMES,
      createUnthemedDesignSystem,
      getRaceDirectionsForPlan,
      isSameThemeContent,
      normalizeCssColorToHex,
      renderDesignMarkdown,
      resolveBranchDesignSystem,
    } = await import('@/core');

    const c = await createContainer({
      storageAdapter: 'memory',
      llmAdapter: 'mock',
      builderAdapter: 'esbuild',
    });

    try {
      // (a) Stale Race runId rejection
      const projStale = await c.repo.create({
        title: 'Race Run Guard',
        slug: 'race-run-guard',
      });
      await collect(
        c.workflow.start(projStale.id, 'Build a workspace supporting race runs')
      );
      await collect(c.workflow.confirmPlan(projStale.id, { mode: 'race' }));
      const run1Snap = await c.repo.getById(projStale.id);
      const run1Id = run1Snap?.raceBranches[0]?.runId;
      expect(run1Id).toBeTruthy();

      await collect(c.workflow.confirmPlan(projStale.id, { mode: 'race' }));
      const run2Snap = await c.repo.getById(projStale.id);
      const run2Id = run2Snap?.raceBranches[0]?.runId;
      expect(run2Id).toBeTruthy();
      expect(run2Id).not.toBe(run1Id);

      await expect(
        c.workflow.selectBranch(projStale.id, 'branch-a', { runId: run1Id })
      ).rejects.toThrow(/stale Race run/);
      const staleAtomic = await c.repo.adoptRaceBranch(projStale.id, {
        branchId: 'branch-a',
        expectedRunId: run1Id,
        files: { 'src/App.tsx': 'stale' },
      });
      expect(staleAtomic).toBeNull();
      expect((await c.repo.getById(projStale.id))?.raceBranches).toHaveLength(2);

      const validSelected = await c.workflow.selectBranch(
        projStale.id,
        'branch-b',
        { runId: run2Id }
      );
      expect(validSelected.status).toBe('ready');

      // (b) Contrast with #777777 (pure black >= 4.5:1), #2062E8 (non-fading hover), and #00000020 alpha compositing
      const makeContrastTheme = (accent: string, surface = '#FFFFFF') => ({
        id: `contrast-${accent}`,
        name: `Contrast ${accent}`,
        description: 'Contrast check theme',
        scenario: 'B' as const,
        colorMode: 'light' as const,
        palette: {
          background: '#FAF8F4',
          surface,
          textPrimary: '#1D1916',
          textMuted: '#6E665E',
          accent,
        },
        typography: {
          headingStyle: 'editorial-serif' as const,
          bodyStyle: 'sans' as const,
        },
        stylePrompt: 'Contrast test directive',
        isCustom: true,
      });

      const pMidGray = await c.repo.create({
        title: 'Gray Accent CTA',
        slug: 'gray-accent-cta',
      });
      await collect(
        c.workflow.start(pMidGray.id, 'Gray button contrast app', {
          styleTheme: makeContrastTheme('#777777'),
        })
      );
      await collect(c.workflow.confirmPlan(pMidGray.id, { mode: 'linear' }));
      const grayApp = (await c.repo.getById(pMidGray.id))?.draftFiles['src/App.tsx'] ?? '';
      expect(grayApp).toContain('bg-[#777777]');
      expect(grayApp).toContain('text-black');

      const mobileTheme = BUILTIN_STYLE_THEMES.find(
        (t) => t.id === 'preset-mobile-companion'
      )!;
      const pMob = await c.repo.create({
        title: 'Mobile Contrast App',
        slug: 'mobile-contrast-app',
      });
      await collect(
        c.workflow.start(pMob.id, 'Mobile daily tracker app', {
          styleTheme: mobileTheme,
        })
      );
      await collect(c.workflow.confirmPlan(pMob.id, { mode: 'linear' }));
      const mobApp = (await c.repo.getById(pMob.id))?.draftFiles['src/App.tsx'] ?? '';
      expect(mobApp).toContain('bg-[#2062E8]');
      expect(mobApp).toContain('text-white');
      expect(mobApp).not.toContain('hover:opacity-90');

      const pAlpha = await c.repo.create({
        title: 'Translucent Accent CTA',
        slug: 'translucent-accent-cta',
      });
      await collect(
        c.workflow.start(pAlpha.id, 'Translucent button overlay check', {
          styleTheme: makeContrastTheme('#00000020', '#FFFFFF'),
        })
      );
      await collect(c.workflow.confirmPlan(pAlpha.id, { mode: 'linear' }));
      const alphaApp = (await c.repo.getById(pAlpha.id))?.draftFiles['src/App.tsx'] ?? '';
      expect(alphaApp).toContain('bg-[#00000020]');
      expect(alphaApp).toContain('text-[#0F1115]');

      // (c) RGBA opacity preservation & Scenario F dedup defaults
      expect(normalizeCssColorToHex('rgba(255, 255, 255, 0.25)')).toBe(
        '#FFFFFF40'
      );
      expect(normalizeCssColorToHex('rgba(255, 255, 255, 2)')).toBeNull();
      const baseF = makeContrastTheme('#2062E8');
      const scenarioFOmitted = { ...baseF, scenario: 'F' as const };
      const scenarioFExplicitSoft = {
        ...scenarioFOmitted,
        radiusStyle: 'soft' as const,
        surfaceDepth: 'hairline' as const,
      };
      expect(isSameThemeContent(scenarioFOmitted, scenarioFExplicitSoft)).toBe(
        false
      );

      // (d) Mode-independent layoutBlueprint & antiPatterns preserved in alternate Race branch
      const obsidianTheme = BUILTIN_STYLE_THEMES.find(
        (t) => t.id === 'preset-obsidian-tech'
      )!;
      const customConstrainedPlan = {
        appName: 'Constrained Race App',
        summary: 'Plan with explicit layout constraint',
        targetUsers: 'engineers',
        capabilities: ['db' as const],
        collections: [
          { name: 'items', fields: ['title'], description: 'Records' },
        ],
        pages: [{ name: 'Home', purpose: 'Main view' }],
        designSystem: {
          ...createUnthemedDesignSystem('G'),
          colorMode: obsidianTheme.colorMode,
          palette: obsidianTheme.palette,
          layoutBlueprint: '左侧固定导航栏 + 右侧主内容区',
          antiPatterns: ['禁止轮播图', '禁用 #0A0B10 暗色卡片'],
          themeId: obsidianTheme.id,
          themeName: obsidianTheme.name,
          customStylePrompt: obsidianTheme.stylePrompt,
        },
      };
      const dirs = getRaceDirectionsForPlan(customConstrainedPlan);
      const resolvedAlt = resolveBranchDesignSystem(
        customConstrainedPlan,
        dirs[1]!
      );
      const altMd = renderDesignMarkdown({
        ...customConstrainedPlan,
        designSystem: resolvedAlt,
      });
      expect(resolvedAlt.layoutBlueprint).toContain('左侧固定导航栏 + 右侧主内容区');
      expect(resolvedAlt.antiPatterns).toContain('禁止轮播图');
      expect(resolvedAlt.antiPatterns).not.toContain('禁用 #0A0B10 暗色卡片');
      expect(altMd).toContain('左侧固定导航栏 + 右侧主内容区');
      expect(altMd).toContain('禁止轮播图');
      expect(altMd).not.toContain('#0A0B10');
    } finally {
      await c.close();
    }
  }, 20000);

  it('cancels in-flight LLM call via AbortController on SSE disconnect and rolls back project state', async () => {
    const repo = new MemoryProjectRepository();
    let capturedAbortSignal: AbortSignal | undefined;
    let notifyLlmStarted: (() => void) | null = null;
    const llmStarted = new Promise<void>((resolve) => {
      notifyLlmStarted = resolve;
    });

    const slowAbortableLlm: LLMProvider = {
      listModels: () => [
        { id: 'slow-abort', label: 'Slow', provider: 'mock', available: true },
      ],
      generateObject: async (input) => {
        capturedAbortSignal = input.abortSignal;
        notifyLlmStarted?.();
        return new Promise((_, reject) => {
          if (input.abortSignal?.aborted) {
            reject(input.abortSignal.reason ?? new Error('Aborted'));
            return;
          }
          input.abortSignal?.addEventListener(
            'abort',
            () => reject(input.abortSignal?.reason ?? new Error('Aborted')),
            { once: true }
          );
        });
      },
      async *streamText() {
        yield 'unused';
      },
    };

    const workflow = new AtomsWorkflowEngine({
      repo,
      llm: slowAbortableLlm,
      builder: new EsbuildStaticBuilder(),
      publisher: new SameOriginSitePublisher(repo, 'http://localhost:3000'),
      apiBaseUrl: 'http://localhost:3000',
    });

    const project = await repo.create({
      title: 'Abort Disconnect Test',
      slug: 'abort-disconnect-test',
    });

    const reqAbort = new AbortController();
    const req = new Request(
      `http://localhost:3000/api/projects/${project.id}/start`,
      {
        method: 'POST',
        signal: reqAbort.signal,
      }
    );
    const sseRes = createSseResponse(
      (signal) => workflow.start(project.id, 'Cancel test idea', { signal }),
      req
    );
    const reader = sseRes.body!.getReader();
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);

    await llmStarted;
    expect(capturedAbortSignal?.aborted).toBe(false);
    reqAbort.abort(new Error('Client closed tab'));

    while (!(await reader.read()).done) {
      // drain remaining SSE bytes
    }

    expect(capturedAbortSignal?.aborted).toBe(true);
    const afterAbort = await repo.getById(project.id);
    expect(afterAbort?.status).toBe('error');

    // Verify project run lock was released cleanly
    const secondRun = workflow.start(project.id, 'Retry after abort');
    const secondIter = secondRun[Symbol.asyncIterator]();
    const firstRetryEv = await secondIter.next();
    expect(firstRetryEv.done).toBe(false);
    expect(firstRetryEv.value?.type).toBe('role_start');
    await secondIter.return?.();
  }, 15000);

  it('matches Alex Race summaries to branch themes across initial Race, re-plan Race, and neutral fallback', async () => {
    const c = await createContainer({
      storageAdapter: 'memory',
      publisherAdapter: 'memory',
      builderAdapter: 'esbuild',
      llmAdapter: 'mock',
    });

    try {
      const amberCustomTheme = {
        id: 'custom-amber-exp',
        name: '琥珀实验主题',
        description: '温暖纸感与琥珀实验视觉',
        scenario: 'D' as const,
        colorMode: 'light' as const,
        palette: {
          background: '#FAF6EE',
          surface: '#FFFFFF',
          textPrimary: '#241C15',
          textMuted: '#6D6257',
          accent: '#B45309',
        },
        typography: {
          headingStyle: 'editorial-serif' as const,
          bodyStyle: 'sans' as const,
        },
        stylePrompt: '暖纸底配合琥珀焦点与清晰留白',
        isCustom: true,
      };

      const proj = await c.repo.create({
        title: '活动报名琥珀 Race 测试',
        slug: 'mock-race-amber-summary',
      });

      await collect(
        c.workflow.start(
          proj.id,
          '做一个科技沙龙活动报名与签到管理系统，支持嘉宾议程与在线报名',
          { model: 'mock-fast', styleTheme: amberCustomTheme }
        )
      );

      const raceEvents1 = await collect(
        c.workflow.confirmPlan(proj.id, { mode: 'race', model: 'mock-fast' })
      );
      const afterRace1 = await c.repo.getById(proj.id);
      const labels1 = afterRace1?.raceBranches.map((b) => ({
        branchId: b.branchId,
        label: b.label,
      }));
      expect(labels1).toHaveLength(2);
      expect(labels1?.[0]?.label).toBe('方案 A · 琥珀实验主题');
      expect(labels1?.[1]?.label).toContain('暗调精品工坊风（同场景对比）');

      for (const b of labels1 ?? []) {
        const thought = raceEvents1.find(
          (ev) => ev.type === 'thought' && ev.branchId === b.branchId
        );
        const msg = String(
          (thought?.payload as { message?: string } | undefined)?.message ?? ''
        );
        expect(msg).toContain(b.label);
        expect(msg).not.toContain('极简亮色 SaaS 风');
        expect(msg).not.toContain('暗夜高转化风');
      }

      // Select Branch A, then re-plan on the SAME project and run Race Mode again
      await c.workflow.selectBranch(proj.id, 'branch-a');
      await collect(
        c.workflow.start(
          proj.id,
          '重新规划为线下咖啡烘焙品鉴沙龙活动报名站',
          { model: 'mock-fast', styleTheme: amberCustomTheme }
        )
      );
      const raceEvents2 = await collect(
        c.workflow.confirmPlan(proj.id, { mode: 'race', model: 'mock-fast' })
      );
      const afterRace2 = await c.repo.getById(proj.id);
      expect(afterRace2?.raceBranches).toHaveLength(2);

      for (const b of afterRace2?.raceBranches ?? []) {
        const thought = raceEvents2.find(
          (ev) => ev.type === 'thought' && ev.branchId === b.branchId
        );
        const msg = String(
          (thought?.payload as { message?: string } | undefined)?.message ?? ''
        );
        expect(msg).toContain(b.label);
        expect(msg).not.toContain('极简亮色 SaaS 风');
        expect(msg).not.toContain('暗夜高转化风');
      }

      // Neutral summary fallback when theme cannot be determined from prompt or plan
      const standaloneMock = new MockLLMProvider();
      const neutralOut = await standaloneMock.generateObject({
        system: 'You are Alex, generating a React web app.',
        prompt: 'Build app without ProductPlan designSystem or Visual Style Direction.',
        schema: alexFilesOutputSchema,
        model: 'mock-fast',
      });
      expect(neutralOut.summary).toContain('全栈前端应用并接入 @atoms/cloud');
      expect(neutralOut.summary).not.toContain('极简亮色 SaaS 风');
      expect(neutralOut.summary).not.toContain('暗夜高转化风');
    } finally {
      await c.close();
    }
  }, 20000);

  it('guards prompts and mock generated apps against exposing internal SDK/platform jargon in UI copy', async () => {
    const samplePlan = {
      appName: '星辰沙龙',
      summary: '线下沙龙活动报名与签到站',
      targetUsers: '活动主办方与参会者',
      capabilities: ['db', 'auth', 'billing'] as Array<'db' | 'auth' | 'billing' | 'ai'>,
      pages: [{ name: 'Home', purpose: '活动介绍与报名' }],
      collections: [
        {
          name: 'items',
          fields: ['title', 'status'],
          description: '报名记录',
        },
      ],
    };

    const genPrompt = buildAlexGeneratePrompt({ plan: samplePlan });
    const iterPrompt = buildAlexIteratePrompt({
      plan: samplePlan,
      files: { 'src/App.tsx': 'export default function App() { return <div />; }' },
      instruction: '主色调改成深蓝色',
    });

    expect(genPrompt.system).toContain('@atoms/cloud');
    expect(genPrompt.system).toContain('数据自主可控');
    expect(iterPrompt.system).toContain('@atoms/cloud');
    expect(iterPrompt.system).toContain('数据自主可控');

    const mockLlm = new MockLLMProvider();
    const out = await mockLlm.generateObject({
      system: 'You are Alex, generating a React web app.',
      prompt: JSON.stringify(samplePlan),
      schema: alexFilesOutputSchema,
      model: 'mock-fast',
    });
    const appFile = out.files.find((f) => f.path === 'src/App.tsx')?.content ?? '';
    expect(appFile).toBeTruthy();
    expect(appFile).not.toContain('Powered by @atoms/cloud');
    expect(appFile).not.toContain('数据自主可控');
  });

  it('guards DB-only generated apps against unauthenticated { mine: true } / update calls and enforces graceful guest fallback', () => {
    expect(ATOMS_CLOUD_SDK_SOURCE).toContain('if (filter?.mine && !readToken())');

    const dbOnlyDocs = getCloudSdkPromptDocs(['db']);
    expect(dbOnlyDocs).toContain('DO NOT pass { mine: true }');
    expect(dbOnlyDocs).toContain('require a logged-in auth token');

    const fullDocs = getCloudSdkPromptDocs(['db', 'auth']);
    expect(fullDocs).toContain('{ mine: true } requires a logged-in user');
    expect(fullDocs).toContain('public views such as leaderboards');

    const dbOnlyPlan = {
      appName: '跳跳像素',
      summary: '复古像素横版跳跃小游戏',
      targetUsers: '休闲玩家',
      capabilities: ['db'] as Array<'db' | 'auth' | 'billing' | 'ai'>,
      pages: [{ name: 'Game', purpose: '试玩与排行榜' }],
      collections: [
        { name: 'scores', fields: ['score'], description: '玩家得分记录' },
      ],
    };

    const gen = buildAlexGeneratePrompt({ plan: dbOnlyPlan });
    const iter = buildAlexIteratePrompt({
      plan: dbOnlyPlan,
      files: { 'src/App.tsx': 'export default function App() { return <div />; }' },
      instruction: '优化界面',
    });

    expect(gen.system).toContain('degrade gracefully');
    expect(iter.system).toContain('degrade gracefully');
  });

  it('uses the LLM intent router to dispatch open product/research prompts to Emma/Iris without touching code and sends actionable edits to Alex', async () => {
    const repo = new MemoryProjectRepository();
    const baseMock = new MockLLMProvider();
    const llmCalls: string[] = [];

    const spyLlm: LLMProvider = {
      listModels: () => baseMock.listModels(),
      generateObject: async (input) => {
        const tag = input.system.startsWith('You are the Intent Router')
          ? 'router'
          : input.system.startsWith('You are Emma, discussing')
            ? 'emma_discuss'
            : input.system.startsWith('You are Iris, answering')
              ? 'iris_discuss'
              : input.system.startsWith('You are Alex')
                ? 'alex'
                : 'other';
        llmCalls.push(tag);
        return baseMock.generateObject(input);
      },
      streamText: (input) => baseMock.streamText(input),
    };

    const workflow = new AtomsWorkflowEngine({
      repo,
      llm: spyLlm,
      builder: new EsbuildStaticBuilder(),
      publisher: new SameOriginSitePublisher(repo, 'http://localhost:3000'),
      apiBaseUrl: 'http://localhost:3000',
    });

    const project = await repo.create({
      title: '跳跳像素',
      slug: 'mario-intent-test',
    });
    await collect(
      workflow.start(project.id, '帮我做一个马里奥的跳跃小游戏', {
        model: 'mock-fast',
      })
    );
    await collect(
      workflow.confirmPlan(project.id, { mode: 'linear', model: 'mock-fast' })
    );

    const beforeDiscuss = await repo.getById(project.id);
    const initialAppTsx = beforeDiscuss?.draftFiles['src/App.tsx'];
    expect(initialAppTsx).toBeTruthy();

    // 1. Open-ended color/style discussion -> LLM router routes to Emma, files untouched
    llmCalls.length = 0;
    const emmaEvents = await collect(
      workflow.iterate(project.id, '我想改配色', { model: 'mock-fast' })
    );
    expect(llmCalls).toEqual(['router', 'emma_discuss']);
    const emmaRouteEv = emmaEvents.find((ev) => ev.type === 'intent_routed');
    expect((emmaRouteEv?.payload as { targetRole?: string }).targetRole).toBe(
      'emma'
    );
    const emmaMsgEv = emmaEvents.find((ev) => ev.type === 'agent_message');
    expect(emmaMsgEv?.role).toBe('emma');
    const emmaOptions = (
      emmaMsgEv?.payload as { options?: Array<{ executeInstruction: string }> }
    ).options;
    expect(Array.isArray(emmaOptions) && emmaOptions.length >= 2).toBe(true);

    const afterEmma = await repo.getById(project.id);
    expect(afterEmma?.status).toBe('ready');
    expect(afterEmma?.draftFiles['src/App.tsx']).toBe(initialAppTsx);

    // 2. Research question -> LLM router routes to Iris, files untouched
    llmCalls.length = 0;
    const irisEvents = await collect(
      workflow.iterate(project.id, '帮我调研一下同类产品的留存机制', {
        model: 'mock-fast',
      })
    );
    expect(llmCalls).toEqual(['router', 'iris_discuss']);
    const irisRouteEv = irisEvents.find((ev) => ev.type === 'intent_routed');
    expect((irisRouteEv?.payload as { targetRole?: string }).targetRole).toBe(
      'iris'
    );
    expect(
      irisEvents.some((ev) => ev.type === 'agent_message' && ev.role === 'iris')
    ).toBe(true);
    expect((await repo.getById(project.id))?.draftFiles['src/App.tsx']).toBe(
      initialAppTsx
    );

    // 3. Explicit leading or mid-sentence @Emma bypasses router and directly asks Emma,
    //    while email addresses like support@alex.com are NOT misparsed as @mentions.
    llmCalls.length = 0;
    const explicitEvents = await collect(
      workflow.iterate(project.id, '@Emma 按钮和背景该怎么搭配更和谐？', {
        model: 'mock-fast',
      })
    );
    expect(llmCalls).toEqual(['emma_discuss']);
    expect(
      (
        explicitEvents.find((ev) => ev.type === 'intent_routed')?.payload as {
          explicit?: boolean;
          targetRole?: string;
        }
      )?.explicit
    ).toBe(true);

    llmCalls.length = 0;
    const midSentenceEvents = await collect(
      workflow.iterate(project.id, '我想看看 @Emma 对配色有什么建议', {
        model: 'mock-fast',
      })
    );
    expect(llmCalls).toEqual(['emma_discuss']);
    expect(
      (
        midSentenceEvents.find((ev) => ev.type === 'intent_routed')
          ?.payload as { targetRole?: string; explicit?: boolean }
      )?.targetRole
    ).toBe('emma');

    llmCalls.length = 0;
    const emailEvents = await collect(
      workflow.iterate(project.id, '把联系邮箱改成 support@alex.com', {
        model: 'mock-fast',
      })
    );
    expect(llmCalls[0]).toBe('router');
    expect(
      (
        emailEvents.find((ev) => ev.type === 'intent_routed')?.payload as {
          explicit?: boolean;
          targetRole?: string;
        }
      )?.explicit
    ).toBe(false);

    // 3b. Structured mentions array (e.g. from MentionComposerInput chip) -> bypasses router even adjacent to CJK
    llmCalls.length = 0;
    const chipPrompt = '请帮我问问@Emma 对配色的建议';
    const chipStart = chipPrompt.indexOf('@Emma');
    const chipEvents = await collect(
      workflow.iterate(project.id, chipPrompt, {
        model: 'mock-fast',
        mentions: [
          {
            role: 'emma',
            label: '@Emma',
            start: chipStart,
            end: chipStart + '@Emma'.length,
          },
        ],
      })
    );
    expect(llmCalls).toEqual(['emma_discuss']);
    const chipRoleStartEv = chipEvents.find((ev) => ev.type === 'role_start');
    const chipRoleStart = chipRoleStartEv?.payload as {
      targetRole?: string;
      mentions?: Array<{ role: string; label: string; start: number; end: number }>;
    };
    expect(chipRoleStartEv?.role).toBe('emma');
    expect(chipRoleStart?.targetRole).toBe('emma');
    expect(chipRoleStart?.mentions).toEqual([
      {
        role: 'emma',
        label: '@Emma',
        start: chipStart,
        end: chipStart + '@Emma'.length,
      },
    ]);

    // 3c. Explicit empty mentions array (UI literal '@' without selecting an agent chip) -> MUST still go through LLM router
    llmCalls.length = 0;
    const plainAtEvents = await collect(
      workflow.iterate(project.id, '@Emma 把主色调改成深蓝色', {
        model: 'mock-fast',
        mentions: [],
      })
    );
    expect(llmCalls[0]).toBe('router');
    expect(
      (
        plainAtEvents.find((ev) => ev.type === 'intent_routed')?.payload as {
          explicit?: boolean;
          targetRole?: string;
        }
      )?.explicit
    ).toBe(false);
    expect(
      (
        plainAtEvents.find((ev) => ev.type === 'intent_routed')?.payload as {
          targetRole?: string;
        }
      )?.targetRole
    ).toBe('alex');

    // 4. Concrete modification instruction -> LLM router routes to Alex & updates code
    llmCalls.length = 0;
    const alexEvents = await collect(
      workflow.iterate(project.id, '把主色调改成深蓝色', {
        model: 'mock-fast',
      })
    );
    expect(llmCalls[0]).toBe('router');
    expect(llmCalls).toContain('alex');
    const alexRouteEv = alexEvents.find((ev) => ev.type === 'intent_routed');
    expect((alexRouteEv?.payload as { targetRole?: string }).targetRole).toBe(
      'alex'
    );
    expect(
      (await repo.getById(project.id))?.draftFiles['src/App.tsx']
    ).toContain('bg-blue-800');
  });

  it('orchestrates multi-@mention teams with 2A parallel/serial handoff, 1A confirmation gate, and partial-success safety', async () => {
    const repo = new MemoryProjectRepository();
    const baseMock = new MockLLMProvider();

    let trackParallel = false;
    let throwOnAlex = false;
    const inFlight: string[] = [];
    const maxConcurrentPair: string[] = [];
    const callOrder: string[] = [];
    const capturedPrompts: Array<{ tag: string; prompt: string }> = [];

    const spyLlm: LLMProvider = {
      listModels: () => baseMock.listModels(),
      generateObject: async (input) => {
        const tag = input.system.startsWith('You are the Multi-Agent Orchestrator')
          ? 'orchestrator'
          : input.system.startsWith('You are Emma, discussing')
            ? 'emma_discuss'
            : input.system.startsWith('You are Iris, answering')
              ? 'iris_discuss'
              : input.system.startsWith('You are Alex')
                ? 'alex'
                : 'other';

        callOrder.push(tag);
        capturedPrompts.push({ tag, prompt: input.prompt });

        if (trackParallel && (tag === 'iris_discuss' || tag === 'emma_discuss')) {
          inFlight.push(tag);
          if (inFlight.length >= maxConcurrentPair.length) {
            maxConcurrentPair.splice(0, maxConcurrentPair.length, ...inFlight);
          }
          await new Promise((r) => setTimeout(r, tag === 'iris_discuss' ? 35 : 10));
          const idx = inFlight.indexOf(tag);
          if (idx >= 0) inFlight.splice(idx, 1);
        }

        if (throwOnAlex && tag === 'alex') {
          throw new Error('Simulated Alex generation outage');
        }

        return baseMock.generateObject(input);
      },
      streamText: (input) => baseMock.streamText(input),
    };

    const workflow = new AtomsWorkflowEngine({
      repo,
      llm: spyLlm,
      builder: new EsbuildStaticBuilder(),
      publisher: new SameOriginSitePublisher(repo, 'http://localhost:3000'),
      apiBaseUrl: 'http://localhost:3000',
    });

    const project = await repo.create({
      title: '沙龙协作站',
      slug: 'multi-mention-test',
    });
    await collect(
      workflow.start(project.id, '做一个活动报名与签到站', { model: 'mock-fast' })
    );
    await collect(
      workflow.confirmPlan(project.id, { mode: 'linear', model: 'mock-fast' })
    );

    const baselineApp = (await repo.getById(project.id))?.draftFiles['src/App.tsx'];
    expect(baselineApp).toBeTruthy();

    // 1. 2A Parallel @Iris + @Emma (independent angles -> dependsOn: [])
    trackParallel = true;
    callOrder.length = 0;
    inFlight.length = 0;
    maxConcurrentPair.length = 0;
    const p1Text = '@Iris 分析同类活动站留存要点；@Emma 从界面体验角度给配色建议';
    const p1Events = await collect(
      workflow.iterate(project.id, p1Text, {
        model: 'mock-fast',
        mentions: [
          { role: 'iris', label: '@Iris', start: 0, end: 5 },
          {
            role: 'emma',
            label: '@Emma',
            start: p1Text.indexOf('@Emma'),
            end: p1Text.indexOf('@Emma') + 5,
          },
        ],
      })
    );
    trackParallel = false;

    expect(callOrder[0]).toBe('orchestrator');
    expect(maxConcurrentPair).toContain('iris_discuss');
    expect(maxConcurrentPair).toContain('emma_discuss');

    const parallelPlan = p1Events.find((ev) => ev.type === 'collaboration_plan')
      ?.payload as {
      steps: Array<{ role: string; parallelGroup?: number; dependsOn: string[] }>;
    };
    expect(parallelPlan.steps.every((s) => s.parallelGroup === 1)).toBe(true);
    expect(
      p1Events.filter(
        (ev) =>
          ev.type === 'role_start' &&
          (ev.payload as { continuation?: boolean }).continuation === true
      )
    ).toHaveLength(2);
    expect(p1Events.filter((ev) => ev.type === 'agent_message')).toHaveLength(2);
    expect(
      p1Events.filter(
        (ev) =>
          ev.type === 'collaboration_step' &&
          (ev.payload as { status?: string }).status === 'completed'
      )
    ).toHaveLength(2);
    expect((await repo.getById(project.id))?.draftFiles['src/App.tsx']).toBe(
      baselineApp
    );

    // 2. 2A Serial Handoff @Iris -> @Emma (dependent -> Emma receives Iris reply context)
    callOrder.length = 0;
    capturedPrompts.length = 0;
    const p2Text =
      '@Iris 调研留存策略，再由 @Emma 结合调研结论梳理界面改进方案';
    const p2Events = await collect(
      workflow.iterate(project.id, p2Text, {
        model: 'mock-fast',
        mentions: [
          { role: 'iris', label: '@Iris', start: 0, end: 5 },
          {
            role: 'emma',
            label: '@Emma',
            start: p2Text.indexOf('@Emma'),
            end: p2Text.indexOf('@Emma') + 5,
          },
        ],
      })
    );
    expect(callOrder).toEqual(['orchestrator', 'iris_discuss', 'emma_discuss']);
    const emmaSerialPrompt =
      capturedPrompts.find((c) => c.tag === 'emma_discuss')?.prompt ?? '';
    expect(emmaSerialPrompt).toContain('Iris:');
    expect(emmaSerialPrompt).toContain('首屏即用免注册体验');
    expect(
      (
        p2Events.find((ev) => ev.type === 'collaboration_plan')?.payload as {
          steps: Array<{ role: string; dependsOn: string[] }>;
        }
      ).steps.find((s) => s.role === 'emma')?.dependsOn
    ).toEqual(['iris']);

    // 3. 1A Exploratory Gate @Emma + @Alex (pauses before Alex writes code)
    callOrder.length = 0;
    const p3Text =
      '先请 @Emma 讨论几套深蓝清爽配色方案，合适再让 @Alex 改代码';
    const p3Events = await collect(
      workflow.iterate(project.id, p3Text, {
        model: 'mock-fast',
        mentions: [
          {
            role: 'emma',
            label: '@Emma',
            start: p3Text.indexOf('@Emma'),
            end: p3Text.indexOf('@Emma') + 5,
          },
          {
            role: 'alex',
            label: '@Alex',
            start: p3Text.indexOf('@Alex'),
            end: p3Text.indexOf('@Alex') + 5,
          },
        ],
      })
    );
    expect(callOrder).toEqual(['orchestrator', 'emma_discuss']);
    const p3Plan = p3Events.find((ev) => ev.type === 'collaboration_plan')
      ?.payload as { turnId: string };
    const alexGateEv = p3Events.find(
      (ev) =>
        ev.type === 'collaboration_step' &&
        (ev.payload as { role?: string; status?: string }).role === 'alex' &&
        (ev.payload as { status?: string }).status === 'awaiting_confirmation'
    )?.payload as {
      turnId?: string;
      stepId?: string;
      status?: string;
      handoffInstruction?: string;
    };
    expect(alexGateEv?.status).toBe('awaiting_confirmation');
    expect(alexGateEv?.handoffInstruction).toBeTruthy();
    expect((await repo.getById(project.id))?.draftFiles['src/App.tsx']).toBe(
      baselineApp
    );

    // 3b. Confirm gated Alex collaboration step -> updates step running -> completed without duplicate prompt
    callOrder.length = 0;
    const confirmEvents = await collect(
      workflow.iterate(project.id, alexGateEv.handoffInstruction!, {
        model: 'mock-fast',
        targetRole: 'alex',
        collabStep: {
          turnId: p3Plan.turnId,
          stepId: alexGateEv.stepId ?? 'step-alex',
        },
      })
    );
    expect(callOrder).toEqual(['alex']);
    expect(
      confirmEvents.some(
        (ev) =>
          ev.type === 'collaboration_step' &&
          (ev.payload as { turnId?: string; stepId?: string; status?: string })
            .turnId === p3Plan.turnId &&
          (ev.payload as { stepId?: string }).stepId === 'step-alex' &&
          (ev.payload as { status?: string }).status === 'running'
      )
    ).toBe(true);
    expect(
      confirmEvents.some(
        (ev) =>
          ev.type === 'collaboration_step' &&
          (ev.payload as { turnId?: string; stepId?: string; status?: string })
            .turnId === p3Plan.turnId &&
          (ev.payload as { stepId?: string }).stepId === 'step-alex' &&
          (ev.payload as { status?: string }).status === 'completed'
      )
    ).toBe(true);
    expect(
      (
        confirmEvents.find((ev) => ev.type === 'role_start')?.payload as {
          continuation?: boolean;
        }
      )?.continuation
    ).toBe(true);
    expect((await repo.getById(project.id))?.draftFiles['src/App.tsx']).toContain(
      'bg-blue-800'
    );

    // 3c. Relaxed agentReplySchema accepts >400-char executeInstruction & nullable followUpQuestion
    const parsedLongReply = agentReplySchema.parse({
      reply: '推荐使用深海蓝高对比方案。',
      options: [
        {
          title: '深海蓝高对比方案',
          description: '对比度更高且按钮主次更鲜明。',
          executeInstruction: '将全局配色精确改为：'.padEnd(650, 'X'),
        },
      ],
      followUpQuestion: null,
    });
    expect(parsedLongReply.options?.[0]?.executeInstruction.length).toBe(650);
    expect(parsedLongReply.followUpQuestion).toBeNull();

    // 4. 1A Straight-Through @Emma + @Alex (decisive -> Emma hands off directly to Alex & compiles)
    callOrder.length = 0;
    capturedPrompts.length = 0;
    const p4Text =
      '@Emma 推荐一个深蓝配色方案并让 @Alex 直接按方案修改页面';
    const p4Events = await collect(
      workflow.iterate(project.id, p4Text, {
        model: 'mock-fast',
        mentions: [
          { role: 'emma', label: '@Emma', start: 0, end: 5 },
          {
            role: 'alex',
            label: '@Alex',
            start: p4Text.indexOf('@Alex'),
            end: p4Text.indexOf('@Alex') + 5,
          },
        ],
      })
    );
    expect(callOrder).toEqual(['orchestrator', 'emma_discuss', 'alex']);
    const alexPrompt =
      capturedPrompts.find((c) => c.tag === 'alex')?.prompt ?? '';
    expect(alexPrompt).toContain('Emma 结论');
    expect(
      p4Events.filter(
        (ev) =>
          ev.type === 'collaboration_step' &&
          (ev.payload as { status?: string }).status === 'completed'
      )
    ).toHaveLength(2);
    const updatedApp = (await repo.getById(project.id))?.draftFiles['src/App.tsx'];
    expect(updatedApp).toContain('bg-blue-800');

    // 5. Partial-Success Safety (Alex fails after Emma succeeds -> Emma persisted, draftFiles rolled back)
    const eventCountBeforeFail = (await repo.listEvents(project.id)).length;
    throwOnAlex = true;
    const p5Events = await collect(
      workflow.iterate(project.id, p4Text, {
        model: 'mock-fast',
        mentions: [
          { role: 'emma', label: '@Emma', start: 0, end: 5 },
          {
            role: 'alex',
            label: '@Alex',
            start: p4Text.indexOf('@Alex'),
            end: p4Text.indexOf('@Alex') + 5,
          },
        ],
      })
    );
    throwOnAlex = false;
    const alexFailStep = p5Events.find(
      (ev) =>
        ev.type === 'collaboration_step' &&
        (ev.payload as { role?: string; status?: string }).role === 'alex' &&
        (ev.payload as { status?: string }).status === 'failed'
    )?.payload as { error?: string; handoffInstruction?: string };
    expect(alexFailStep?.error).toContain('Simulated Alex generation outage');
    expect(alexFailStep?.handoffInstruction).toBeTruthy();

    const persistedAfterFail = (await repo.listEvents(project.id)).slice(
      eventCountBeforeFail
    );
    expect(
      persistedAfterFail.some(
        (ev) => ev.type === 'agent_message' && ev.role === 'emma'
      )
    ).toBe(true);
    const projectAfterFail = await repo.getById(project.id);
    expect(projectAfterFail?.draftFiles['src/App.tsx']).toBe(updatedApp);
    expect(projectAfterFail?.status).toBe('ready');

    // 6. Duplicate Single-Role Mention (@Emma ... @Emma) -> NO orchestrator or collaboration_plan
    callOrder.length = 0;
    const dupText = '请 @Emma 看下布局，顺便 @Emma 也看看字体大小';
    const firstEmmaStart = dupText.indexOf('@Emma');
    const secondEmmaStart = dupText.lastIndexOf('@Emma');
    const p6Events = await collect(
      workflow.iterate(project.id, dupText, {
        model: 'mock-fast',
        mentions: [
          { role: 'emma', label: '@Emma', start: firstEmmaStart, end: firstEmmaStart + 5 },
          { role: 'emma', label: '@Emma', start: secondEmmaStart, end: secondEmmaStart + 5 },
        ],
      })
    );
    expect(callOrder).toEqual(['emma_discuss']);
    expect(p6Events.some((ev) => ev.type === 'collaboration_plan')).toBe(false);
    const dupRoleStart = p6Events.find((ev) => ev.type === 'role_start')
      ?.payload as { mentions?: Array<{ role: string; start: number }> };
    expect(dupRoleStart?.mentions).toHaveLength(2);
  });
});
