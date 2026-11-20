# 06 - 最终成品交付清单与两阶段实施规划

> 本文档对齐 ROOT 全栈笔试交付标准，梳理当前全部已完成能力、**第一阶段（零外部依赖闭环）** 补全范围，以及 **第二阶段（外部依赖与公网交付）** 待拍板决策项。

---

## 一、核心交付目标与评估维度对齐

### 1.1 功能与交付硬指标
- **智能体驱动生成 + 可视化呈现**：通过多智能体协作（调研 → 产品规划与确认 → 全栈编码 + 自动修复）生成真实可运行的 Web 应用，并在工作台右侧实时渲染。
- **真实交互 + 真数据持久化**：拒绝静态页面或“点两下即白屏”的概念验证（PoC），应用需具备完整表单交互、终端用户会话与数据持久化，刷新/跨端/迭代重发布不丢失数据。
- **主流程 + 高价值延展能力**：覆盖从需求输入、方案确认、构建自愈、增量迭代、源码查看/编辑到独立发布的完整主流程，并提供 **Race Mode 双方案择优**、**Cloud 数据面板**、**Mock/Creem 订阅闭环**、**真 SEO/OG** 等延展特性。
- **无需平台工作台登录/注册**：直接可用，零门槛体验完整构建链路（同时生成站点内部可按需启用 `@atoms/cloud` 终端访客认证）。
- **最终必交物清单**：
  1. 可公开访问的在线测试链接（已部署运行环境）
  2. Public 可访问的 GitHub 源代码仓库
  3. 工程说明与交付文档（含实现思路与关键取舍、当前完成程度、后续演进与优先级判断）

### 1.2 评估维度对照
| 评估维度 | 本项目工程落点 |
| --- | --- |
| **完成度** | 端到端全链路可用 + 跨设备真实落库 + 项目重命名/删除 + 源码在线编辑重编译 + 12+ 条 L1/L2 自动化测试 + 17 步生产 HTTP 冒烟 |
| **工程思维** | 选定「路线 A+」（内存 Esbuild + 托管 `@atoms/cloud` BaaS）规避容器冷启动失控；Ports & Adapters 六边形架构清晰隔离领域契约与外部 Adapter |
| **用户体验** | 对齐 `atoms.dev` 暖纸白双态工作台（启动大厅 ↔ 沉浸双栏）、折叠时间轴降噪、`持续构建 4 步进度卡`、强确认门禁保护已有草稿与线上站 |
| **创新性** | Race Mode 候选/草稿/线上三态严格隔离；真编译期 Auto-Fix + 运行期 `ErrorBoundary/postMessage` 自愈闭环 |
| **可交付性** | 零本地强依赖的环境变量装配（`container.ts`）、动态公网 Origin 解析、标准 Postgres Schema 兼容、详尽文档与一键复现脚本 |

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
     - `/start`、`/confirm`、`/iterate` SSE 路由统一声明 `export const maxDuration = 60` 防无服务器超时。
   - **细节抛光**：修复 `/checkout/mock` 卡片顶部 `HMAC 签名闭环` 徽章在窄卡内的换行问题。

---

## 三、第二阶段：外部依赖接入与腾讯云上线闭环（已拍板路线）

> 详细组件对比见 [07 - 国内环境外部依赖调研与组件选型指南](./07-china-external-dependencies-research.md) 第八节，第二阶段已明确走 **腾讯云香港轻量 + 自有域名 + Docker (Next.js + Postgres 16 + Caddy HTTPS) + 真实大模型 API**：

| 实施项 | 选定方案与配置方式 |
| --- | --- |
| **1. 真实大模型 API** | 用户提供外部配置文件（`key = 厂商, value = API key`）后写入被 `.gitignore` 保护的 `.env.local`（`LLM_ADAPTER=vercel-ai`），并针对多厂商/国产接口加固 `generateObject` 结构化输出容错后进行本地真模型端到端验跑 |
| **2. 云主机** | **腾讯云轻量应用服务器（中国香港）**（免工信部 ICP 备案，优选 `2核4G` 按月，放行 TCP `22 / 80 / 443`） |
| **3. 域名、解析与 HTTPS** | 腾讯云注册域名并完成个人实名认证 → **DNSPod** 添加 `A` 记录指向香港公网 IP → Docker 内置 **Caddy** 自动申请并续期 Let's Encrypt HTTPS 证书 |
| **4. 云端持久化 Postgres** | 同机 Docker Compose 拉起 **`postgres:16-alpine` + 命名持久卷**（`STORAGE_ADAPTER=postgres` + 内网 `DATABASE_URL`），零额外云库费用、重启不丢数据 |
| **5. 交付上线产物** | 补齐 `output: 'standalone'`、`Dockerfile`、`docker-compose.yml`、`Caddyfile`、`.env.production.example`，完成公网 HTTPS 多端实测并整理 GitHub Public 仓库与最终笔试文档 |

---

## 四、第三阶段：外部真实支付接入（后续独立推进）

- **第二阶段保持**：内置 Mock Checkout（HMAC-SHA256 异步 Webhook 回调与订单幂等闭环），确保评审免测试卡即可零门槛体验 Pro 解锁全流程；
- **第三阶段升级**：在站点上线闭环后再按需切换 **Creem Test / Live Mode** 或接入 **支付宝开放平台沙箱 / 正式商户接口**。
