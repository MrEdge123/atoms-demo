# 06 - 最终成品交付清单与阶段规划

> 本文档梳理 Mini Atoms 工作台与运行时的自主工程交付目标、**第一阶段（零外部依赖闭环）** 补全范围、**第二阶段（云端部署与安全加固）** 已落地成果，以及第三阶段演进规划。

---

## 一、自主工程目标与设计原则

### 1.1 功能与工程闭环要求
- **多角色协同生成 + 实时预览**：围绕真实用户想法串联「市场调研 → 产品方案确认 → 全栈编码与编译修复 → 发布」链路，在工作台右侧即时渲染可交互成品。
- **真实数据与隔离持久化**：不仅能生成好看页面，还要真正跑通表单写入、终端用户注册登录与刷新不丢失，并严格做到多站点数据分离与跨项目隔离。
- **主流程 + 高价值延展能力**：完整覆盖需求输入、方案确认、构建自愈、源码直接修改、多轮迭代与独立发布，同时提供 **Race Mode 双路择优**、**Cloud 数据面板**、**Mock/Creem 订阅闭环**、**真 SEO/OG** 等工程能力。
- **工作台免登录直用 + 匿名会话隔离**：无需注册平台账号即可上手体验，底层由签名匿名 Cookie（`atoms_sid`）保障各自创建的项目互不越权干扰。
- **最终交付产物**：
  1. 公网可访问的在线工作台与示例站点链接
  2. 公开源码仓库与可本地一键复现脚本
  3. 架构说明、取舍记录、安全设计与验证报告

### 1.2 工程侧重点落地
| 工程关注点 | 本项目实现做法 |
| :--- | :--- |
| **全链路可用性** | 端到端链路跑通、PostgreSQL 真持久化、项目重命名/级联删除、源码在线编辑重编译，配合 22 用例 L1/L2 自动化测试与 18 步 HTTP 冒烟脚本 |
| **架构与取舍** | 采用「路线 A+」（内存 Esbuild + 托管 `@atoms/cloud` BaaS）避免动态容器冷启动慢与端口编排风险；Ports & Adapters 分层隔离内核与适配器 |
| **交互体验** | 参考 Atoms 双态工作台布局，提供折叠步骤时间轴、强确认门禁与 Race 分支草稿/线上三态隔离 |
| **编译自愈与安全边界** | 服务端 `esbuild` 编译错误自动触发最多 2 轮修复；预览态支持运行期报错一键回传修复；接口层面补齐签名 Cookie、防伪头校验、CSP、AI 限流与事务控制 |
| **可部署与可复现** | 环境变量驱动装配（`container.ts`）、支持本地零配置 `PGlite` 与线上标准 `pg`、提供 Docker Compose + Caddy 自动 HTTPS 与一键冒烟脚本 |

---

## 二、第一阶段：零外部依赖闭环（本轮已补齐）

> 不依赖任何付费 API Key、外置数据库或公网平台即可在本地 100% 实跑、自动化测试与浏览器验收：

1. **既有底座（已完备）**
   - `Iris → Emma（硬确认门禁，支持 409 拦截与旧草稿/旧线上站保护）→ Alex（内存 Esbuild + Tailwind v4 编译 + ≤2 轮 Auto-Fix）`
   - Race Mode 双风格并行生成与三态隔离
   - 统一 Postgres SQL 层（本地 PGlite 落盘 / 线上 `pg`）、`@atoms/cloud`（`db` / `auth` / `billing` / `ai`）、独立 `/s/[slug]`（真 SEO/OG）
   - Mock + Creem HMAC Webhook 验签幂等收银台、二维码分享、ZIP 导出
   - Atoms 官网风暖纸白 UI（启动大厅 + 双栏工作台 + Cloud 数据面板 + 浅色模拟收银台与 404 页）

2. **第一阶段新增补全项**
   - **项目生命周期管理（重命名 & 级联删除）**：
     - `PATCH /api/projects/[id]`：支持工作台顶栏下拉内联重命名并校验标题合法性；
     - `DELETE /api/projects/[id]`：支持在工作台下拉及启动大厅项目卡片上二次确认删除项目，并级联清理 `project_events`、`app_records`、`app_users` 与 `billing_orders`（构建/规划中返回 `409` 保护）。
   - **源码在线编辑 + 保存重新编译预览**：
     - `PUT /api/projects/[id]/files`：右侧「源码」Tab 支持直接编辑任意文件并一键「保存并重新编译」实时更新预览（严格遵守确认门禁与 Race 选枝 `409` 拦截，且编译失败或未重新发布前绝不污染线上 `/s/[slug]`）。
   - **零外部依赖云部署工程适配**：
     - `resolvePublicBaseUrl(req, fallback)` + `VERCEL_URL` 回退：未手动固定 `APP_BASE_URL` 时自动从代理请求头或运行环境推导公网访问地址，避免线上分享链接/二维码/支付回跳指向 `localhost`；
     - `/start`、`/confirm`、`/iterate` SSE 路由统一声明 `export const maxDuration = 180` 防长耗时推理超时；客户端断开时通过 `AbortController` 取消进行中的 LLM 调用并回滚项目状态。
   - **细节抛光**：修复 `/checkout/mock` 卡片顶部 `HMAC 签名闭环` 徽章在窄卡内的换行问题。

---

## 三、第二阶段：外部依赖接入与腾讯云公网交付（已完成并验收）

> 详细组件对比见 [07 - 国内环境外部依赖调研与组件选型指南](./07-china-external-dependencies-research.md) 第八节。当前已完成 **腾讯云轻量应用服务器（中国香港）+ 自有域名 `xcodea.online` + Docker Compose (Next.js 15 Standalone + Postgres 16 + Caddy 2 HTTPS) + 真实 DeepSeek/Kimi 大模型** 全链路公网交付与闭环验收：

### 3.1 公网必交物清单
1. **在线工作台**：<https://xcodea.online>（`https://www.xcodea.online` 经 Caddy `301` 跳转至 apex）
2. **线上独立发布示例站**：<https://xcodea.online/s/app-otqlo>（项目 `proj_805be62d` / `山丘手冲烘焙工坊`）
3. **Public GitHub 仓库**：<https://github.com/MrEdge123/atoms-demo>
4. **生产编排产物**：`Dockerfile`、`docker-compose.yml`、`Caddyfile`、`next.config.ts`（`output: 'standalone'`）、`.env.production.example`、`scripts/verify-live-llm.mjs`、`scripts/e2e-http-smoke.mjs`

### 3.2 已完成生产改造与加固要点
| 实施项 | 落地结果 |
| --- | --- |
| **1. 多模型 LLM 接入与流式防卡死** | 在当前 DeepSeek + Kimi 生产配置下首选项为 `deepseek:deepseek-flash`，开放 DeepSeek（`flash` / `v4-pro`）、Kimi（`k3.1-pro-highspeed` / `k2.6` / `k2.7-code-highspeed`）及 Mock 共 7 个可选模型；修复 `streamObject`/`streamText` `fullStream` 消费与 `AbortController` 回收、增加结构化日志 `[Workflow]`/`[LLM]`、单项目 `activeRuns` 互斥锁及失败态兜底恢复 |
| **2. 云主机、域名与 HTTPS** | 腾讯云轻量应用服务器（中国香港）绑定域名 `xcodea.online`，由 **Caddy 2** 自动签发 Let's Encrypt TLS 证书，对非 SSE 接口开启 `zstd`/`gzip` 压缩，对 `/start`、`/confirm`、`/iterate` SSE 流禁用缓冲（`flush_interval -1`） |
| **3. 云端持久化 Postgres 16** | `postgres:16-alpine` 绑定命名持久卷 `postgres_data`；加固 `pg` 空闲连接 `pool.on('error')`、`APP_AUTH_SECRET` 生产强校验、PG `23505` slug 冲突重试与轻量 `/api/health` 探测 |
| **4. 性能优化与安全加固** | 预览产物开启 esbuild 压缩与生产树摇；接口落地签名匿名 Cookie `atoms_sid` 与 `owner_sid` 归属隔离（历史只读）、`Origin`/`X-Atoms-Workbench`/`/s/` Referer 防伪校验、发布/预览态 CSP、AI 代理鉴权与限流（429）、Cloud DB 本人鉴权与分页上限、Mock 收银台用户绑定、Webhook/选枝 SQL 事务及 `sanitizeErrorMessage` 截断前 1000 字符脱敏防 ReDoS |

### 3.3 第二阶段验收实测记录
- **多模型真实探测（`scripts/verify-live-llm.mjs`）**：`deepseek:deepseek-flash`、`deepseek:deepseek-v4-pro`、`kimi:kimi-k3.1-pro-highspeed`、`kimi:kimi-k2.6`、`kimi:kimi-k2.7-code-highspeed` 共 5 个真实模型结构化生成全部通过；生产环境实测 Kimi `/start` + 线性 `/confirm` 编译成功。
- **公网 HTTP 17 步闭环冒烟（`node scripts/e2e-http-smoke.mjs https://xcodea.online`）**：17 步全部通过（脚本以 `mock-default` 断言健康接口 `ok: true`、模型数 `>= 2`、SSE 启动、Race Mode `409` 门禁、选枝发布、`/s/[slug]` SEO/OG、跨项目 JWT 隔离、`@atoms/cloud` 读写、HMAC Webhook 升级 Pro、Cloud 面板与 ZIP 导出、多轮增量迭代、源码重编译、重命名与级联删除；同次实测返回观测到线上运行配置为 `storage: 'postgres'`、`llm: 'vercel-ai'` 及 7 个可选模型，真实大模型生成链路已由上述 5 模型探测与下方浏览器实测独立验证）。
- **公网真实浏览器端到端验收（`https://xcodea.online`）**：在 `deepseek:deepseek-flash` 下完成自由需求输入、未确认门禁验证、Race Mode 双枝构建（`291 KB` / `279 KB`）与采纳 B 枝、`Coffee Tester`（`coffee.tester@example.com`）注册与 `reservations` 写入（`PERSIST-2026-CHECK`）、源码在线编辑重编译（`Roast Lab Tasting Bar · 精品烘焙`）、增量迭代（`限时冬季豆单`徽章，`287 KB`）、项目重命名/删除、公网 `/s/app-otqlo` 与 QR/OG 校验，以及 Mock 收银台 → HMAC Webhook → `Pro 已激活` 解锁，**全程 0 控制台报错、0 5xx 响应**。
- **容器重启持久化复核**：执行 `docker compose restart app` 后，服务自动恢复 `Healthy`；API 与浏览器硬刷新均验证用户登录态、`Pro 已激活` 权益、`限时冬季豆单` 及预约记录 `PERSIST-2026-CHECK` 完整留存（0 控制台报错、0 5xx）。
- **Codex CLI 代码与 Diff 审查**：多轮差异审查及全仓排查中识别的 `P0`/`P1` 风险已全部修复合入，最终增量 `799d295` 零 `P0`/`P1` 问题。

---

## 四、第三阶段演进与后续优先级规划

1. **真实外部支付网关（P0）**：
   - 第二阶段保留内置 Mock Checkout（HMAC-SHA256 异步 Webhook 与订单幂等），确保评审零门槛体验完整商业闭环；
   - 第三阶段可按需切换 **Creem Test/Live Mode** 或接入 **支付宝开放平台** 沙箱/正式商户接口。
2. **多租户隔离与平台登录（P1）**：
   - 为工作台增加平台账号登录与项目归属鉴权；
   - 将独立部署站从同域 `/s/[slug]` 升级为通配符子域 `*.xcodea.online` 隔离不同生成的终端站点 Origin，并引入 PostgreSQL 行级安全（RLS）。
3. **代码质量与稳定性细节抛光（P2/P3，来自 Codex 审查尾项）**：
   - **发布态能力服务端落库（P2）**：在 `releases` 表持久化 `capabilities` 元数据，替代对已发布 HTML 内 `window.__ATOMS_CONFIG__` 的正则回退检查（消除极端自定义 CSS 文本遮蔽风险）；
   - **工作台列表重试序号保护（P2）**：在 `Workbench.tsx` 项目列表重试路径补充请求递增序号校验，杜绝旧重试响应覆盖更新后的项目状态；
   - **跨项目切换保留发布错误提示（P3）**：将发布失败状态按 `projectId` 维度保留或展示带项目标识的提示，避免切换项目时静默吞掉上一项目的发布失败反馈。
