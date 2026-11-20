# Mini Atoms Demo（路线 A+）

面向极速交付与全栈商业化闭环的 **Mini Atoms** 工作台与运行时实现：

> **一句话产品想法 → Iris 深度调研 → Emma 产品规划（硬确认门禁 + Race Mode 双路择优）→ Alex 全栈生成 + 内存 Esbuild 编译自愈（≤2 轮）→ `@atoms/cloud` 真实持久化（db / auth / billing / ai）→ 源码在线编辑重编译 → 一键发布独立 `/s/[slug]` 生产站点（真 SEO/OG + 二维码 + ZIP 导出）。**

---

## 核心特性概览

1. **Atoms 暖纸白双态工作台（免登录直接用）**
   - **启动大厅**：`270px` 可折叠侧栏 + 居中团队头像与凹槽提示词台 + 推荐场景卡片 + 项目列表（支持卡片内二次确认删除）。
   - **沉浸双栏工作台**：`44px` 统一顶栏 + 可切换模型下拉 + 左侧聚合协作流（Iris 调研卡 / Emma 方案确认卡 / Alex 折叠步骤与虚线时间轴 / `持续构建 4 步进度卡` / 统一底部 Composer）+ 右侧四视图舞台（`实时预览 | 源码 | Cloud 数据 | 概览`）。
   - **严格状态隔离与门禁保护**：待确认方案（`researching` / `planning` / `awaiting_confirmation`）及 Race Mode 未选定分支期间，工作台与服务端一致拦截 `409` 迭代/编辑/发布，已有草稿与已发布 `/s/[slug]` 站点数据保持 100% 隔离不受影响。

2. **源码在线编辑 + 编译自愈闭环**
   - 支持在工作台「源码」Tab 直接修改代码并触发内存 `esbuild` + Tailwind CSS v4 重新编译，即时更新右侧草稿预览，同时保持线上发布版稳定。
   - AI 编码阶段内建 ≤2 轮自动编译修复，预览态注入 `RuntimeErrorBoundary` 与 `window.postMessage` 异常一键修复机制。

3. **统一 `@atoms/cloud` BaaS 与商业闭环**
   - 默认内置 **`PGlite`**（`.data/pglite`）实现开箱即用的 PostgreSQL 持久化，线上配置 `STORAGE_ADAPTER=postgres` + `DATABASE_URL` 无缝切换云 Postgres（Neon / Supabase / 自建 pg）。
   - 内置每项目严格隔离的终端用户注册/登录/Bearer Token 鉴权、JSONB 集合增删查、**Mock + Creem Test Mode** HMAC Webhook 验签幂等升级、以及 AI 代理口。

4. **独立生产站点直出与部署就绪**
   - `/s/[slug]` 无编辑器外壳直出生产 HTML，自动注入真实 `<title>`、`description` 与 Open Graph 元信息。
   - `resolvePublicBaseUrl` 支持从反向代理请求头 / `VERCEL_URL` 自动推导公网地址（显式设置 `APP_BASE_URL` 时优先使用）。

---

## 快速启动与验证

### 环境变量配置（`.env.local`）
参考 [.env.example](./.env.example)：
- 离线默认模式无需配置任何外部密钥即可完整跑通（`LLM_ADAPTER=mock`、`STORAGE_ADAPTER=pglite`、`BILLING_ADAPTER=mock`）。
- 接入真实大模型时设 `LLM_ADAPTER=vercel-ai` 并填入对应厂商密钥（支持 `DEEPSEEK_API_KEY`、`KIMI_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`）。在已验收的 DeepSeek + Kimi 生产配置下（仅配置 `DEEPSEEK_API_KEY` 与 `KIMI_API_KEY`），工作台提供 7 个可选模型（`deepseek:deepseek-flash` 为默认首选项，另含 `deepseek:deepseek-v4-pro`、3 个 Kimi 模型及 2 个 Mock 模型）；如仅配 `DEEPSEEK_API_KEY` 则为 4 个选项，若同时配置 OpenAI / Anthropic 密钥，首选项会按 `/api/models` 返回顺序排在前面。
- 部署云端 Postgres 时设 `STORAGE_ADAPTER=postgres`、`DATABASE_URL` 与强随机 `APP_AUTH_SECRET`。

### 线上部署架构（第二阶段已完成）
- **在线工作台**：<https://xcodea.online>（`www.xcodea.online` 301 重定向至 apex 域名）
- **在线独立发布示例**：<https://xcodea.online/s/app-otqlo>（`山丘手冲烘焙工坊`，含真实 PostgreSQL 持久化、端用户登录、Pro 订阅解锁与 OG 元信息）
- **GitHub Public 仓库**：<https://github.com/MrEdge123/atoms-demo>
- **生产部署拓扑**（腾讯云轻量 `Docker Compose`，配置文件见 [`docker-compose.yml`](./docker-compose.yml) 与 [`Caddyfile`](./Caddyfile)）：
  - `caddy:2-alpine`：自动签发/续期 Let's Encrypt HTTPS 证书，启用非 SSE 路由 `zstd`/`gzip` 压缩，SSE 流透传 `flush_interval -1`。
  - `app`：Next.js 15 `output: 'standalone'` 容器，运行 `STORAGE_ADAPTER=postgres`、`LLM_ADAPTER=vercel-ai`、`BILLING_ADAPTER=mock`。
  - `postgres:16-alpine`：挂载命名持久卷 `postgres_data`，容器重建/重启后项目与 `@atoms/cloud` 数据完整保留。
- **公网 HTTPS 前置条件**：将 apex 域名与 `www` 子域的 DNS `A` 记录解析至服务器公网 IP，并在云主机防火墙放行入站 `TCP 80 / 443`（可选放行 `UDP 443` 以支持 HTTP/3），完整步骤参见 [07 - 国内环境外部依赖调研与组件选型指南](./docs/07-china-external-dependencies-research.md)。

```bash
# 生产环境变量模板（Compose 读取同目录 .env；POSTGRES_PASSWORD 会直接拼接进 DATABASE_URL，请使用十六进制或纯字母数字等 URI 安全随机密码，避免 # / ? 等特殊字符；同时填入 APP_AUTH_SECRET / SITE_DOMAIN / APP_BASE_URL 与模型密钥）
cp .env.production.example .env

# 启动 Docker Compose 全栈（Postgres 16 + Next.js Standalone + Caddy HTTPS）
docker compose up -d --build
```

### 常用命令（Windows `Node v24.18.1`）

```powershell
# 类型检查
npm run typecheck

# 运行全量 L1 契约与 L2 PGlite 持久化/路由集成测试
npm test

# 构建生产包
npm run build

# 运行真实大模型 5 模型连通性探测（需提前在 .env.local 配置真实 Key）
node scripts/verify-live-llm.mjs

# 运行端到端 HTTP 冒烟脚本（本地可不带参数；线上可直接传入公网地址）
node scripts/e2e-http-smoke.mjs https://xcodea.online

# 启动本地生产服务（默认 http://localhost:3000）
npm run start
```

---

## 目录与文档索引

- **调研、设计与交付文档（`docs/`）**：
  - [01 - Atoms 产品调研与竞品分析](./docs/01-atoms-research.md)
  - [02 - Demo 范围界定与关键技术取舍](./docs/02-demo-scope-and-tradeoffs.md)
  - [03 - 路线 A+ 完整架构设计与三层测试闭环](./docs/03-architecture-design.md)
  - [04 - 本机 WSL2 开发环境连通性与配置说明](./docs/04-wsl2-dev-env.md)
  - [05 - Atoms 实测使用体验报告与视觉排版规范](./docs/05-atoms-ux-visual-audit.md)
  - [06 - 最终成品交付清单与两阶段实施规划](./docs/06-delivery-checklist.md)
  - [07 - 国内环境外部依赖调研与组件选型指南](./docs/07-china-external-dependencies-research.md)
- **核心架构目录（Ports & Adapters）**：
  - `src/domain/`：领域契约（零外部依赖 TypeScript）
  - `src/ports/`：五大核心端口抽象
  - `src/core/`：SOP 状态机、共享门禁守卫、`@atoms/cloud` 客户端 SDK
  - `src/adapters/`：Mock / Vercel AI LLM、Esbuild 内存构建、InMemory / PGlite / Pg 存储、Mock / Creem 支付、同域发布器
  - `src/container.ts`：环境变量驱动的容器装配
  - `src/app/` & `src/components/`：Next.js 15 App Router API 与 Atoms 风格工作台前端
