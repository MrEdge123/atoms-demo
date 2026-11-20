# 03 - 路线 A+ 完整架构设计与三层测试闭环

---

## 1. 系统全景架构（Hexagonal / Ports & Adapters）

```text
                    ┌─────────────────────────────┐         ┌──────────────────────────────┐
                    │      工作台 UI (Workbench)    │         │   公网访问者 (手机 / 微信 / PC)  │
                    │  左: 多Agent流 | 右: 预览/代码 │         │     GET /s/[slug] (原生网页)   │
                    └──────────────┬──────────────┘         └──────────────┬───────────────┘
                                   │ SSE / REST                            │ 100% 独立 HTML + JS
                                   ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                 薄接入层 (Next.js App Router)                              │
│  /api/projects/* (创建/流式运行/确认/迭代/发布/导出)    /s/[slug] (直出成品)   /api/cloud/[pid]/*  │
└──────────────────┬───────────────────────────────────────────────────────┬───────────────┘
                   │                                                       │
                   ▼                                                       │
┌────────────────────────────────────────────────────────┐                 │
│             核心编排内核 (Core Orchestrator)             │                 │
│  只依赖 domain/ 与 ports/，零外部 SDK 依赖               │                 │
│  状态机: Iris → Emma(暂停确认) → Alex ↔ AutoFix(≤2轮)   │                 │
└───┬──────────┬──────────┬──────────┬───────────────────┘                 │
    │          │          │          │                                     │
    ▼          ▼          ▼          ▼                                     ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌───────────┐                    ┌─────────────────┐
│Port 1  │ │Port 2  │ │Port 3  │ │Port 4 & 5 │                    │  Port 3 运行时   │
│LLM     │ │Builder │ │Cloud   │ │Repo +     │                    │  AppCloudRuntime│
│Provider│ │esbuild │ │Config  │ │Publisher  │                    │  DB/Auth/Bill/AI│
└───┬────┘ └───┬────┘ └───┬────┘ └─────┬─────┘                    └────────┬────────┘
    │          │          │            │                                   │
════╪══════════╪══════════╪════════════╪═══════════════════════════════════╪═════════════
    ▼          ▼          ▼            ▼ (通过 container.ts 按环境变量动态装配) ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌───────────┐                    ┌─────────────────┐
│Mock /  │ │Mock /  │ │Memory /│ │Memory /   │                    │Memory /         │
│VercelAI│ │Esbuild │ │Postgres│ │Postgres + │                    │Shared Postgres  │
│(多模型) │ │Static  │ │+Proxy  │ │SameOrigin │                    │(未来: Neon API) │
└────────┘ └────────┘ └────────┘ └───────────┘                    └─────────────────┘
```

---

## 2. 核心领域契约（`src/domain/`）

模块间严格通过纯数据结构通信，已落盘为零依赖 TypeScript 类型定义：

1. **`VirtualFS`**（`Record<string, string>`）：AI 工程师产出与编译器消费的唯一代码表达，例如 `{ "src/App.tsx": "...", "src/components/Form.tsx": "..." }`。
2. **`CloudCapability`**（`'db' | 'auth' | 'billing' | 'ai'`）：声明项目需要注入哪些平台能力，避免无关代码污染简单应用。
3. **`ProductPlan`**：Iris/Emma 阶段产出的蓝图（`appName`、`summary`、`targetUsers`、`capabilities`、`pages[]`、`collections[]`），经用户确认后输入给 Alex。
4. **`BuildArtifact`**：统一编译输出。成功携带完整自包含 `html` 与包体积信息；失败返回结构化 `CompileError[]`（`phase: 'compile' | 'runtime'`、`file`、`line`、`message`），直接驱动自动修复循环。
5. **`AgentEvent`**：前后端解耦的流式协议，**提前预留 `branchId?: string`**，单路留空即可运行，后续扩展 Race Mode 时事件协议无需破坏性变更。

---

## 3. 五大抽象接口与动态可插拔矩阵（`src/ports/`）

| 抽象层（Port） | 核心方法 | 离线/测试 Adapter（L1 闭环） | 2 天 MVP 真实 Adapter | 未来演进 Adapter |
| :--- | :--- | :--- | :--- | :--- |
| **1. `LLMProvider`** | `listModels`<br>`generateObject`<br>`streamText` | `MockLLMProvider`（可编排“首次写错、次轮修好”剧本） | `VercelAISDKProvider`（动态切 Claude/GPT/DeepSeek/Qwen） | 多模型路由、Fallback 与用量统计包装器 |
| **2. `AppBuilder`** | `compile`（含 `seo?` 注入）<br>`verifyRuntime?` | `MockBuilder`（用于纯状态机单测） | `EsbuildStaticBuilder`（100ms 内存打包 + SEO/OG 注入 + 运行时异常上报） | `ContainerBuilder`（扩展支持独立后端容器） |
| **3. `AppCloudRuntime`** | `db`（含 `listCollections`）/ `auth`（含 `listUsers`）/ `billing`（Checkout + Webhook）/ `ai?` | `InMemoryAppCloud`（按 `projectId` 隔离的 Map） | 统一 Postgres SQL 层（本地 `PGlite` 落盘 / 线上标准 `pg`）+ `MockBilling` / `CreemBilling` | `NeonDedicatedAppCloud`（每项目动态建独立 Neon 实例） |
| **4. `ProjectRepository`** | `create` / `listAll` / `getById` / `getBySlug` / `updatePlan` / `saveDraft` / `saveRaceBranches` / `savePublished` / `appendEvent` / `listEvents` | `MemoryProjectRepo` | 统一 Postgres SQL 层（本地 `PGlite` 落盘 / 线上标准 `pg`） | 对象存储拆分大体积 HTML 快照 + 审计历史 |
| **5. `SitePublisher`** | `publish` | `LocalMockPublisher` | `SameOriginPublisher`（同域 `/s/[slug]` 直出原生网页） | `VercelApiPublisher` / `CloudflarePagesPublisher`（独立子域名 + CDN） |
| **编排接口 `WorkflowEngine`** | `start` / `confirmPlan` / `selectBranch` / `iterate` / `publish` | 直接驱动状态机 | `LinearSOPWorkflow` + `RaceMode`（支持单路与双路并发择优） | 动态图编排与多专家扩展 |

---

## 4. 路线 A+ 的 4 个关键工程机制

### 4.1 虚拟模块 `@atoms/cloud` 与依赖白名单
- Alex 在生成代码时统一导入平台约定 SDK：
  ```ts
  import { db, auth, billing, ai } from '@atoms/cloud';
  ```
- `EsbuildStaticBuilder` 编写自定义内存解析插件：
  1. 相对路径（`./`、`../`、`@/`）直接从内存 `VirtualFS` 解析，零磁盘临时文件；
  2. `@atoms/cloud` 自动重定向到内置客户端 SDK 代码，注入当前 `projectId`、接口基地址与 `Authorization: Bearer` 逻辑；
  3. 第三方包走**严格白名单**：`react`、`react-dom`、`lucide-react`、`clsx`、`tailwind-merge`。从平台本地 `node_modules` 直接 Tree-Shaking 打入产物；若 AI 幻觉引入未允许依赖，立即抛出清晰 `CompileError` 触发 Auto-Fix；
  4. **真 SEO / OG 注入**：优先读取 `CompileInput.seo`（回退至 `ProductPlan.appName` 与 `summary`），在生成的 `<head>` 中注入规范 `<title>`、`<meta name="description">` 与 `og:title` / `og:description` / `og:type` 标签。
- **零境外 CDN**：Tailwind CSS 走构建期按需编译并内联 `<style>`，确保国内网络环境首屏秒开。

### 4.2 编译期 + 运行期双闭环自愈
- **编译期自愈**：`Alex` 写完文件 → `EsbuildStaticBuilder.compile()` → 若 `ok === false`，编排器自动将错误堆栈与对应文件内容回传给 `Alex` 修复（默认上限 2 轮）。
- **运行期兜底**：打包 HTML 时在根组件外自动包裹 `RuntimeErrorBoundary` 并监听 `window.onerror` / `unhandledrejection`：
  - **预览态（`mode: 'preview'`）**：通过 `window.parent.postMessage` 将运行期异常上报给工作台，支持一键或自动回传修复；
  - **线上态（`mode: 'production'`）**：展示友好降级界面，不白屏，也不暴露工作台调试通道。

### 4.3 最小 4 张表实现“真持久化 + 草稿/线上隔离”

```sql
-- 1. 平台项目表（草稿态、Race Mode 候选分支与线上发布态严格隔离）
projects (
  id, slug UNIQUE, title, status,
  capabilities_json, plan_json,
  draft_files_json, race_branches_json,
  published_files_json, published_html, published_version,
  created_at, updated_at
)

-- 2. 协作事件流表（刷新工作台不丢失多 Agent 过程）
project_events (
  id, project_id, seq, role, branch_id, type, payload_json, created_at
)

-- 3. 生成应用的用户表（多站点账号完全隔离）
app_users (
  id, project_id, email, password_hash, name, role, plan, created_at,
  UNIQUE(project_id, email)
)

-- 4. 生成应用的通用业务集合表
app_records (
  id, project_id, collection, owner_user_id, data_json JSONB, created_at, updated_at
  -- 索引: (project_id, collection, created_at DESC)
)
```

**安全边界**：
- 工作台登录态与 `/s/[slug]` 站点访问者登录态完全分离；
- `/api/cloud/[projectId]/*` 仅认作用域锁定在 `projectId` 的 Bearer Token，防止跨站点越权读写；
- 对单条 `app_records.data_json` 做大小限制（如 ≤ 50KB），防止恶意写入撑爆数据库。

### 4.4 统一 SQL 层（`PGlite` + `pg`）、异步收款闭环与集中装配

1. **统一 Postgres SQL 执行抽象**：
   - `PostgresProjectRepo` 与 `PostgresAppCloudRuntime` 只依赖一个极简 `SqlClient`（`query` / `exec`）；
   - 本地开发默认用 `@electric-sql/pglite`（数据落盘到 `.data/pglite`），零 Docker/外部库即可运行完整 Postgres SQL；线上只需配置 `STORAGE_ADAPTER=postgres` 与 `DATABASE_URL`，即刻无缝切换标准 `pg` 连接云端 Neon / Supabase / 自建 PostgreSQL。
2. **`AppBillingPort` 异步结账 + Webhook 验签闭环**：
   - 统一 `createCheckoutSession` → 跳转收银台 → `handleWebhook(rawBody, signature)` 验签并防重放幂等更新 `app_users.plan` → 返回目标 `/s/[slug]` 解锁 Pro 功能；
   - `BILLING_ADAPTER=mock` 走平台内置模拟收银台；`BILLING_ADAPTER=creem` 直连 **Creem Test Mode**（填好 `CREEM_API_KEY`、`CREEM_WEBHOOK_SECRET`、`CREEM_PRODUCT_ID` 即可真实跳转外部收银台与接收真实签名回调）。
3. **集中装配入口（`src/container.ts`）**：

```env
LLM_ADAPTER=mock | vercel-ai
BUILDER_ADAPTER=mock | esbuild
STORAGE_ADAPTER=memory | pglite | postgres
PUBLISHER_ADAPTER=memory | same-origin
BILLING_ADAPTER=mock | creem
```

工作台配套细节：工作台右侧面板提供 **`实时预览` / `源码` / `Cloud 数据`（调用 `listCollections`、`list`、`listUsers`）** 三个 Tab，顶部提供基于 `LLMProvider.listModels()` 的 **模型切换下拉框**。

---

## 5. 目标完整目录结构

```text
atoms-demo/
├── docs/                  # 调研、取舍、架构与 WSL2 环境文档
├── src/
│   ├── domain/            # 已创建：领域模型与事件协议（零依赖）
│   ├── ports/             # 已创建：5 大核心端口 + WorkflowEngine 接口
│   ├── core/              # 待建：编排状态机、3 角色 Prompt、@atoms/cloud 客户端 SDK
│   ├── adapters/          # 待建：mock / memory / esbuild / postgres / vercel-ai / same-origin
│   ├── container.ts       # 待建：环境变量驱动装配容器
│   ├── app/               # 待建：Next.js 工作台 UI + /s/[slug] + /api/projects + /api/cloud
│   └── tests/             # 待建：L1 / L2 / L3 三层闭环测试
└── README.md
```

---

## 6. 三层闭环自动化测试策略

| 层级 | 装配组合 | 运行耗时 & 成本 | 核心验收闭环 |
| :--- | :--- | :--- | :--- |
| **L1 契约与编排闭环** | `MockLLM` + **真实 `EsbuildStaticBuilder`** + `InMemoryAppCloud` + `MemoryProjectRepo` | **单次闭环 < 1 秒**（实测冷启 ~471ms / 热态 ~388ms）；全量 8 用例 L1 套件（含多次 `esbuild` + Tailwind v4 构建、Race Mode 与跨项目迭代）约 **7~8 秒** / 0 Token | 1. 未确认方案前绝不触发 Alex 编码；<br>2. Race Mode 候选分支未显式采用前拦截发布与普通迭代，保留既有线上版本；<br>3. MockLLM 首轮故意生成坏 TSX → esbuild 真实报错 → 次轮 Auto-Fix 修好并产出 HTML；<br>4. 跨项目交错迭代不串用模板并保留增量功能；<br>5. 草稿改坏不影响已发布 HTML，项目 A/B 数据与 Token 严格隔离。 |
| **L2 真发布与持久化闭环** | 预置/生成 TSX + `EsbuildStaticBuilder` + **真实 PGlite / Postgres** + `SameOriginPublisher` | **~5~14 秒** / 0 Token | 真实 `PGlite` 重启跨进程恢复项目、事件流、Pro 订阅与业务数据；跨项目交错多轮迭代后重新发布，老数据完好且各站点数据严格隔离；路由集成全链路校验 409/404/401/200。 |
| **L3 真大模型回归闭环** | **真实 `VercelAISDKProvider`** + 全套真实 Adapter | 按需运行 | 固定 3 个 Golden Prompts（活动报名签到 / 轻量 CRM / 带登录与 Pro 开关的笔记站），统计编译一次通过率、Auto-Fix 挽回率与端到端耗时。 |
