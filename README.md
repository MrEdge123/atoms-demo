# Mini Atoms

- **在线工作台**：<https://xcodea.online>
- **示例站点**：<https://xcodea.online/s/app-otqlo>
- **GitHub**：<https://github.com/MrEdge123/atoms-demo>

用一句白话需求就能让 AI 产品团队帮你做出真正能用、能存数据、还能一键上线分享的网页应用。
打开工作台不需要注册账号，输入想法后先看方案再动手写代码，改满意后直接点发布，手机和朋友的电脑打开 `/s/[slug]` 就能访问，刷新页面数据也不会丢。

![Mini Atoms 工作台双栏预览](./docs/images/workbench.png)

![已发布示例站点：山丘手冲烘焙工坊](./docs/images/published-site.png)

---

## 工作流程与核心能力

1. **三角色协作、意图路由与门禁保护**
   - **Iris**（负责市场与竞品调研）先分析目标人群与产品定位；接着由 **Emma**（负责拆解产品方案与数据表，生成后等待你确认）列出能力、页面与数据集合；你确认后才交给 **Alex**（负责编写前后端代码并在编译出错时自动修复）动手实现。
   - 对话迭代内置 **LLM 模型意图路由**（非硬编码关键词规则），可自动识别“想先调研 / 想先聊产品方案 / 明确改代码”；同时支持在消息任意位置使用独立 **`@mention` 徽章组件**（与普通 `@` 字符隔离）指名 **@Iris / @Emma / @Alex**，当单条消息提及多个智能体时自动按依赖串行或并行协作编排，并展示**分工进度卡与确认门禁**。
   - 当你点击生成时，还可以启用 **Race Mode**（同时并发生成两套不同视觉风格的完整应用，方便对比后再决定采用哪一版）。
   - 在 Emma 方案待确认期间、或 Race Mode 未选定分支前，服务端和前端一致拦截未授权的发布/迭代（`409`），保障既有草稿和线上 `/s/[slug]` 版本不被误覆盖。

2. **在线编译自愈、代码级迭代校验与源码微调**
   - Alex 生成的代码在内存通过 `esbuild` + Tailwind CSS v4 编译；如遇编译错误会自动触发最多 2 轮修复；整轮构建完成后通过 SSE 将构建进度事件推给工作台（构建内日志在每轮结束时统一下发，而非逐文件流式推送）。
   - 迭代改版时自动向 Emma/Alex 注入当前源码真实配色与文件摘要，内置**禁止仅改 `DESIGN.md` 文档而未实际修改组件代码**的自动返工校验与「代码变更优先」文件排序；项目详情舞台与列表配备**慢网加载骨架屏**，避免弱网加载瞬间误判为空项目。
   - 预览页面注入运行期异常捕获并回传工作台，支持手动“一键修复”；右侧「源码」Tab 可直接修改代码并保存重编译预览。

3. **内置 `@atoms/cloud` 持久化与模拟收银台**
   - 生成应用默认接入同构 BaaS（本地用嵌入式 `PGlite` 落盘，线上切标准 `pg`），按项目隔离终端用户注册/登录（JWT）、JSONB 业务集合与内置 **Mock** 模拟收银台（仅用于本地与在线演示，无真实扣款；同时预留了 Creem 适配器接口）。
   - 独立发布的 `/s/[slug]` 自动剥离工作台外壳并写入真实 `<title>`、`description` 与 Open Graph 分享元信息，搭配二维码分享与一键 ZIP 导出。

---

## 实现思路与关键取舍

本项目采用 **「前端交互 + 平台托管 BaaS」** 的轻全栈架构：AI 专注于前端 React + Tailwind 交互与视觉体验，后端数据、鉴权、订阅与 AI 能力统一收敛到内置 SDK，并通过内存 `esbuild` 打包为自包含 HTML；相比为每个生成应用动态拉起独立容器和数据库的“重全栈路线”，这套方案在轻量云主机上实现了毫秒级编译反馈、极低运维成本以及改版重发布零丢数据，同时通过 Ports & Adapters（六边形架构）将 LLM、构建器、存储、发布与支付全部抽成可替换接口。详参 [02 - 范围界定与关键技术取舍](./docs/02-demo-scope-and-tradeoffs.md) 与 [03 - 轻全栈架构设计与三层测试闭环](./docs/03-architecture-design.md)。

---

## 完成程度（已完成 / 未完成）

- **已完成**：Iris → Emma（确认门禁）→ Alex（编译自愈 + 在线源码重编译）核心工作流、LLM 意图路由与独立 `@mention` 多智能体分工编排、代码级迭代防空转校验、慢网加载骨架屏、Race Mode 双风格并行对比择优、PGlite/PostgreSQL 真持久化、`@atoms/cloud`（`db` / `auth` / `ai` 与 **Mock 收银台** 模拟闭环）、匿名会话隔离与接口安全加固、独立 `/s/[slug]`（SEO/OG + 二维码 + ZIP 导出），以及腾讯云 Docker Compose + Caddy 自动 HTTPS 公网部署。
- **未完成**：
  - 真实支付网关（当前为基于 HMAC Webhook 模拟回调的 **Mock 收银台**，仅预留 Creem 适配器尚未接入真实商户收单）；
  - 平台账号与多租户（当前工作台通过签名匿名 Cookie 做会话隔离，无账号体系与团队权限管理）；
  - 发布站点独立子域名（当前为同域 `/s/[slug]`，尚未拆出独立通配符子域名隔离 Origin）；
  - 版本历史与回滚；消息排队与中途停止；PC/移动端预览切换（当前仅提供基础 `390px` 预览宽度切换，缺少完整多设备断点调试）；发布前安全扫描；自定义域名。

---

## 后续扩展与优先级（P0 / P1 / P2 及原因）

- **P0：接入真实支付网关（如 Creem Live / 支付宝沙箱）与发布态能力落库**——让订阅付费具备真实资金流闭环，并消弭从 HTML 提取能力声明的边界隐患。
- **P1：独立通配符子域名发布与 PostgreSQL RLS 行级隔离 + 平台账号体系**——从浏览器同源和数据库内核两层彻底隔离开不同生成站点的脚本与数据，并支撑跨设备找回历史项目。
- **P2：版本历史与一键回滚、消息排队与中途停止按钮、PC/移动端完整响应式调试、发布前静态安全扫描与自定义域名绑定**——持续提升复杂项目构建稳定性、多端体验和上线安全性。完整路线图见 [06 - 最终成品交付清单与阶段规划](./docs/06-delivery-checklist.md) 与 [07 - 国内环境外部依赖调研与组件选型指南](./docs/07-china-external-dependencies-research.md)。

---

## Atoms 能力对照表

对照 Atoms 核心主流程（**描述、检查、修改、测试、发布、验证、更新**）及工作台高价值延展能力，当前实现状态如下：

| 流程 / 能力（标注层级） | 已实现 | 实现方式不同 | 未实现及原因 |
| :--- | :--- | :--- | :--- |
| **`[主流程]` 描述**（需求输入与澄清） | 启动台自由输入想法，支持独立 `@mention` 徽章组件与多智能体协作分工编排，驱动 **Iris** 调研与 **Emma** 拆解页面/集合方案 | — | 缺少多模态附件/图片参考输入与消息排队机制（聚焦核心文本 SOP，优先保障端到端交付） |
| **`[主流程]` 检查**（方案审核与结果审视） | **Emma** 方案确认卡与硬门禁（`409` 拦截未确认操作）、右侧实时预览舞台、结构化概览与 `DESIGN.md` | — | 缺少细粒度多版本快照对比与可视化元素点选（由「源码」Tab 与整页预览替代） |
| **`[主流程]` 修改**（迭代与局部微调） | 多轮对话增量迭代（LLM 模型意图路由 + 分工进度卡）、代码级迭代防空转门禁（防仅改 `DESIGN.md`）、慢网加载骨架屏与编译错误 ≤2 轮自动自愈 | 运行期仅通过预览 `postMessage` 提供工作台**一键修复**；Alex 文件与进度在每轮构建完成后按轮次从缓冲统一下发 | 暂不支持前端点击任意 DOM 节点做可视化拖拽微调与构建中途停止按钮（为控制状态机复杂度优先保证源码直编 + 整轮回滚稳态） |
| **`[主流程]` 测试**（自动化与真实验证） | 28 条 L1/L2 自动化测试（含 PGlite 重启/事务与 HTTP 路由守卫）及 18 步 HTTP 冒烟脚本 | 以工作台内建 L1/L2 自动化套件 + HTTP 冒烟脚本验证生成链路，未内置面向每个生成应用自动跑 Playwright 的托管沙箱 | 缺少生成后对每个用户产物自动触发的发布前安全扫描与独立子应用压测沙箱 |
| **`[主流程]` 发布**（生产上线与导出） | 一键发布生成独立 `/s/[slug]` 生产页面，注入真实 `<title>` / OG 卡片、内联 Tailwind v4 与 CSP | 采用同域路由 `/s/[slug]` 直出静态 HTML，而非为每个项目分配独立动态容器或 `*.domain` 子域名（规避动态容器运维与证书签发开销） | 发布站点独立子域名与自定义域名绑定（留待第三阶段结合通配符 DNS/Caddy 拆出） |
| **`[主流程]` 验证**（真数据与跨端验真） | 发布站独立验证、Cloud 数据面板可观测真实入库记录、公网设备打开即持久化不丢 | 订阅闭环默认采用**内置 Mock 收银台**发签名 Webhook 模拟 Pro 解锁（无需审核和银行卡），可凭环境配置切至 Creem Test Mode | 真实商用支付网关扣款（需企业/个人商户签约与合规结算资质） |
| **`[主流程]` 更新**（持续发布与无损演进） | 草稿态 / 已发布线上版本严格隔离；重新发布版本号递增，`app_users` 与 `app_records` 历史数据完整保留 | — | 版本历史列表与一键历史回滚（当前仅保留当前草稿与最新已发布版本两份快照） |
| **`[延展能力]` Race Mode** | 支持并发生成 2 套差异化设计方向并对比预览、选定后写入草稿主分支 | — | 暂未开放 >2 路及自定义分支数量并发（兼顾 Token 成本与生成时延） |
| **`[延展能力]` 源码编辑** | 「源码」Tab 直接查看/修改虚拟文件系统代码并即时触发 `esbuild` 重编译预览 | — | 未接入完整云端 LSP 智能补全与 GitHub OAuth 双向仓库同步 |
| **`[延展能力]` Cloud 面板** | 工作台内置「Cloud 数据」Tab 实时查看项目集合记录、注册用户与会员状态并支持清理 | — | 未开放直接在线建表 DDL 或可视化 SQL 查询器（通用 JSONB 集合已覆盖常规应用 CRUD） |
| **`[延展能力]` SEO / OG** | 依据 `ProductPlan` 自动生成并注入 HTML 标题、Meta 描述与 Open Graph 分享标签 | 在服务端 `EsbuildStaticBuilder` 编译阶段直接写入静态 HTML `<head>`，未设立独立 SEO Agent | 缺少 Sitemap 自动托管与搜索引擎提交 |
| **`[延展能力]` 二维码与 ZIP 导出** | 支持一键生成访问二维码及全套源码/静态项目 ZIP 下载，含本地预览说明与环境变量占位 | — | 缺少一键导入第三方托管平台（如 Vercel Deploy Button）流水线 |

---

## 安全设计

围绕免登录工作台与同域发布共存的典型风险，本项目在 A–D 四个方向落地了完整防线：

- **A. 匿名工作台会话与项目归属隔离**：首次访问工作台签发由 `APP_AUTH_SECRET` HMAC-SHA256 签名的 30 天 `HttpOnly / SameSite=Lax`（HTTPS 生产启用 `Secure`）`atoms_sid` Cookie；`projects` 表自动迁移 `owner_sid` 列，列表仅返回当前会话名下项目，跨会话操作或对无 `owner_sid` 的历史只读项目（如示例站点）发起写入/查看后台均返回 `403`。
- **B. 防发布站点冒用与沙盒边界**：所有工作台写接口强制校验 `Origin === APP_BASE_URL`、自定义头 `X-Atoms-Workbench: 1` 且拦截来自 `/s/` 的 `Referer`；`/s/[slug]` HTTP 响应头及预览 `iframe` 同步下发 CSP（限制 `connect-src` 为 `<origin>/api/cloud/`、`frame-ancestors 'self'` 并在响应头禁止 `object-src`）；生成应用的终端用户 Token 以 `atoms_cloud_token_<projectId>` 分键存储，杜绝多站点互相覆盖。
- **C. AI 代理鉴权防刷与预算保护**：`/api/cloud/[projectId]/ai` 仅放行携带合法终端用户 Token 的请求或来自该项目已发布站点同源的 `/s/<slug>` 请求；内置按 IP/分钟与项目/日双维度滑动/日历限流（超出返回 `429` + `Retry-After`）、输入字符数与 `maxTokens` 上限保护，并输出 `[CloudAI]` 结构化审计日志。
- **D. 数据权限、交易原子性与稳定性**：Cloud DB `PATCH`/`DELETE` 强制校验终端用户 Token 及 `owner_user_id`（支持 via `CLOUD_PUBLIC_COLLECTIONS` 放行公开留言板中的无归属记录），列表强制 `?limit` 分页上限（默认 50，最高由 `CLOUD_DB_MAX_LIMIT` 控制，默认 100）；Mock 收银台 `/api/cloud/mock-checkout/complete` 校验当前 Token 对应用户与 `userId` 一致性（不匹配返回 `403`）；支付 Webhook 记录订单+升级方案以及 Race Mode `selectBranch` 选枝+写入审计事件均收敛于同一 SQL 事务；SSE 客户端断开通过 `AbortController` 取消进行中的 LLM 调用并按原有状态机回滚；LLM 异常脱敏（`sanitizeErrorMessage`）先截断前 `1000` 字符再做正则脱敏防止长串触发 ReDoS。
- **第三阶段演进计划**：将已发布站点迁至独立通配符子域名（从根本上隔离工作台与生成站点的 Cookie/Storage Origin），并在数据库层引入 PostgreSQL 行级安全策略（RLS）。

---

## AI 编程工具的使用方式

- **工具矩阵与「主开发 + 外部视角定时监工/浏览器验真」双 Agent 闭环**：
  - 全流程以 **Antigravity IDE** 主导架构设计、核心编排与全栈实现，配合 `/goal` 驱动夜间与长程无人值守里程碑；
  - 在 **Codex Desktop** 中配置了**每 15 分钟轮询一次的定时自动化任务**，持续监测 Antigravity 的执行状态：若发现长时间无动静或疑似卡死便主动介入排查解卡；一旦检测到阶段任务完成，则**自动驱动浏览器模拟真实用户操作跑独立端到端验收与宽屏回归**——相比主开发 Agent“自己测自己”容易陷入实现惯性，这种**更符合外部视角的黑盒反馈**能持续暴露作者视角漏掉的交互边界，并将可复现步骤直接回抛给 Antigravity 修复；
  - 每次重要功能或安全里程碑提交后，同步使用 OpenAI Codex CLI（`codex review --commit`）对最新 Diff 发起独立安全与质量审查，并保持**审查与自动化测试并行执行**。业务生成链路基于 Vercel AI SDK 接入 `DeepSeek`（`deepseek-flash`、`deepseek-v4-pro`）与 `Kimi` 序列模型，结合 [高级网页 UI 设计参考手册](./docs/08-ui-design-guide.md) 约束生成审美。
- **人机分工与提示词习惯**：
  - **先定抽象与取舍，后落代码**：每个关键选型都先要求 AI 讲清「得到什么、失去什么」，确定 `Ports & Adapters` 抽象边界与 2 天交付范围后再进入编码；
  - **关键决策前置 + 频繁本地 `commit`**：集中拍板架构、云资源与安全约束后交给 `/goal` 与定时监工后台推进，同时要求每个阶段性变更及时本地 `commit`，便于故障定位与 Diff Review；
  - **公网真实试用倒逼修复，严防 AI“偷懒/写死”**：亲自在公网跑真实 Prompt 并贴截图复现，主动拦停硬编码捷径（如明确要求意图路由调用模型判断而非写死关键词规则、拆分【全部项目】/【场景模板】独立页面、用独立 `@mention` 组件区分正常 `@` 字符）。
- **有效人工投入（约 6 小时，自然跨度约 1.5 天）与取舍心得**：
  - **架构定型与范围决策（~1.5h）**：选「前端交互 + 平台托管 BaaS」轻全栈路线换毫秒级编译反馈与极低运维成本，将真实商户收单后置、先用 **Mock 收银台** 跑通商业闭环；
  - **外部依赖准备与产品体验（~1.0h）**：准备模型 API Key、腾讯云香港主机与域名解析、打通 GitHub 推送，并登录实测 Atoms 官网沉淀视觉与交互对标基线；
  - **公网排障、审美规范与安全把关（~1.5h）**：把关真实模型调优、4 层安全防线与示例重构；在仅剩 1 天的开发成本约束下克制选型，用“轻量主题预设 + `DESIGN.md`”替代重型可视化样式编辑器；
  - **公网深度试用与体验打磨（~2.0h）**：从真实用户视角连续测试复杂 Prompt 与弱网场景，推动落地多智能体分工编排、慢网加载骨架屏与代码级迭代可靠性保护。
- **高价值真实线上踩坑与人工介入案例**：
  1. **真实大模型慢推理“假死”**：上线后 DeepSeek/Kimi 在结构化 JSON 生成时默认走慢推理导致超时且缺少执行日志；人工果断切默认 `deepseek-flash` 并引入 Codex 排查流生命周期，最终通过禁用慢思考、`streamObject` 流式解析与 `AbortController` 断开回滚稳住链路。
  2. **生成物审美平庸 → 设计规范体系化注入**：实测初版应用视觉粗糙后，人工引入外部设计指南沉淀进 `DESIGN.md` 与主题预设，并按新流程重做旗舰示例站「山丘手冲烘焙工坊」与展示截图。
  3. **公网真机实测连环暴露单测盲区（含对标 Atoms 补齐慢网骨架屏）**：实测「马里奥跳跃小游戏」踩出匿名访问 `db.list` 崩溃；「想聊配色却被直接交给工程师改代码」倒逼落地模型驱动意图路由与独立 `@mention` 多智能体编排；人工截图标红揪出「工程师只改了 `DESIGN.md` 没改组件代码」倒逼后端补齐实时源码色板注入与禁止仅改文档的自动返工门禁；弱网打开项目时先闪现空白页，对照 Atoms 原生具备的加载态体验补齐了项目与列表骨架屏，消除“误以为项目被删除或打开空项目”的体验落差。
  4. **外部视角浏览器模拟回归 + Diff Review 双保险拦住高危边界**：Codex 15 分钟定时任务在阶段完成后自动驱动浏览器从外部用户视角实操，先后拦住 Race Mode 未选分支可发布、重规划待确认态可偷跑迭代、Race 主题文案漂移；叠加 `codex review --commit` 揪出错误脱敏正则 ReDoS 与同域防冒用边界，并配合 `npm run typecheck`、`npm test`（28 用例 L1/L2 自动化闭环，含 PGlite 重启、SQL 事务回滚、权限/限流与中断取消验证）、`npm run build` 及 18 步 `scripts/e2e-http-smoke.mjs` HTTP 冒烟脚本（本地与公网双重运行）形成完整验真闭环。

---

## 快速启动与验证

### 环境变量配置（`.env.local`）
参考 [.env.example](./.env.example)：
- 离线默认模式无需外部密钥即可跑通（`LLM_ADAPTER=mock`、`STORAGE_ADAPTER=pglite`、`BILLING_ADAPTER=mock`）。
- 接入真实大模型时设 `LLM_ADAPTER=vercel-ai` 并填入对应密钥（同时配 `DEEPSEEK_API_KEY` 与 `KIMI_API_KEY` 时配合默认列表提供 7 个可选模型，完整安全限流与分页变量说明见 [.env.example](./.env.example) / [.env.production.example](./.env.production.example)）。

### 生产 Docker 部署
```bash
cp .env.production.example .env
# 填入强随机 POSTGRES_PASSWORD、APP_AUTH_SECRET、SITE_DOMAIN、APP_BASE_URL 与模型密钥
docker compose up -d --build
```

### 常用命令（Windows `Node v24.18.1`，macOS / Linux 环境同样适用）

```powershell
# 类型检查
npm run typecheck

# 运行全量 28 用例 L1/L2 自动化测试（零外部依赖）
npm test

# 构建生产包
npm run build

# 运行 18 步端到端 HTTP 冒烟脚本（本地直接执行；公网可传入 URL）
node scripts/e2e-http-smoke.mjs
node scripts/e2e-http-smoke.mjs https://xcodea.online

# 启动本地生产服务（默认 http://localhost:3000）
npm run start
```

---

## 文档索引与核心目录

- **调研、设计与运维文档（`docs/`）**：
  - [01 - Atoms 产品调研与竞品分析](./docs/01-atoms-research.md)
  - [02 - 范围界定与关键技术取舍](./docs/02-demo-scope-and-tradeoffs.md)
  - [03 - 轻全栈架构设计与三层测试闭环](./docs/03-architecture-design.md)
  - [04 - WSL2 开发环境连通性与配置说明](./docs/04-wsl2-dev-env.md)
  - [05 - Atoms 实测使用体验报告与视觉排版规范](./docs/05-atoms-ux-visual-audit.md)
  - [06 - 最终成品交付清单与阶段规划](./docs/06-delivery-checklist.md)
  - [07 - 国内环境外部依赖调研与组件选型指南](./docs/07-china-external-dependencies-research.md)
  - [08 - 高级网页 UI 设计参考手册（Agent 版）](./docs/08-ui-design-guide.md)
- **核心架构目录（Ports & Adapters）**：
  - `src/domain/`、`src/ports/`、`src/core/`、`src/adapters/`、`src/container.ts`、`src/middleware.ts`、`src/lib/`、`src/app/`、`src/components/`、`src/tests/`
