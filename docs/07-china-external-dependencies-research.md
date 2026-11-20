# 07 - 国内环境外部依赖调研与组件选型指南

> 本文档面向 **第二阶段（接入真实外部依赖并公网交付）**，结合中国大陆网络访问环境、免 ICP 备案窗口期、人民币付费便利度、以及 `atoms-demo` 的技术架构（Next.js 15 + 内存 Esbuild + Vercel AI SDK `generateObject` + PostgreSQL），汇总全部可选组件对比与落地避坑。
>
> *注：各云服务免费额度与实时定价随官方政策动态调整，正式开通前请以各平台官网说明为准。*

---

## 一、外部依赖全景分层（必选 vs 可选）

在进入公网交付前，先把外部依赖按**必要性**分为两层：

| 分层 | 组件类型 | 作用与必要性说明 | 对应 `atoms-demo` 接入点 |
| --- | --- | --- | --- |
| **必选 1** | **真实大模型 API** | 支撑任意自由 Prompt 生成，彻底脱离 Mock 模板，回应“真实可用而非 PoC”核心要求 | [src/adapters/llm/vercel-ai.ts](../src/adapters/llm/vercel-ai.ts)（`LLM_ADAPTER=vercel-ai`） |
| **必选 2** | **公网 Web 托管 + 国内可直达域名** | 确保国内评审电脑、手机 4G/5G、微信都能秒开工作台与 `/s/[slug]`，避免默认域名被阻断 | `APP_BASE_URL` / `resolvePublicBaseUrl` |
| **必选 3** | **云端持久化 PostgreSQL** | 保证多设备写入、页面刷新、服务重启或迭代重发布后数据不丢失 | [src/adapters/storage/sql-client.ts](../src/adapters/storage/sql-client.ts)（`STORAGE_ADAPTER=postgres` + `DATABASE_URL`） |
| **必交项** | **GitHub Public 仓库** | 公开源码交付、CI/CD 或 PaaS 一键拉取部署 | 清理 `.env*` 与 `.data/` 后推送 Public 仓库 |
| **可选 1** | **第三方支付网关** | 已有内置 Mock Checkout（HMAC 异步回调闭环），可按需决定是否挂 Creem / 支付宝沙箱 | [src/adapters/app-cloud/billing.ts](../src/adapters/app-cloud/billing.ts) |
| **可选 2** | **对象存储 / 独立域名 / HTTPS** | 若后续扩展用户图片上传或绑好看自定义域名，可选 R2 / COS / OSS / Caddy | 未来扩展存储端口与域名解析 |

---

## 二、真实大模型 API 国内选型

### 2.1 技术前提：结构化输出与代码生成兼容要点
`atoms-demo` 核心编排链路（Iris 调研 → Emma 产品方案 → Alex 多文件生成与 Auto-Fix）通过 Vercel AI SDK 的 `generateObject(schema)` 驱动。对照实测与社区实践，接入国产/开源模型 API 需注意 3 点：
1. **协议与 Schema 支持差异**：国内模型大多通过 OpenAI 兼容接口 + **JSON Mode（`response_format: { type: 'json_object' }`）或 Tool Calling** 模拟结构化输出，而非 OpenAI 原生强约束 `json_schema (strict: true)`；
2. **模型温度与格式容错**：代码生成场景使用国产或聚合接口时，建议固定较低 `temperature`（`0`～`0.2`），并在 `generateObject` 失败或偶发包裹 ```json markdown 代码块时补一层清洗解析与重试；
3. **保留 Mock 离线选项**：配置好真实 Key 后，依然通过 `CompositeLLMProvider` / 下拉框保留 Mock 模型作为离线兜底选项。

### 2.2 主流国内直连平台横向对比

| 平台 | 代表模型 | 国内开通与支付 | OpenAI 兼容性 | JSON / 代码生成推荐度 | 核心优劣与适用场景 |
| --- | --- | --- | --- | --- | --- |
| **DeepSeek 官方** | `deepseek-chat`（V3 系列） | 国内直连，微信/支付宝充值，成本极低 | 极高（项目已内置 `DEEPSEEK_API_KEY` 支持） | ⭐⭐⭐⭐⭐ 代码与逻辑推理第一梯队，支持 JSON 输出 | 性价比极高、代码稳；偶有全网高峰限流 |
| **阿里云百炼（DashScope）** | `qwen-coder` / `qwen-plus` / `qwen-max` | 支付宝/个人实名开通，新人常带免费额度 | 良好（提供兼容 OpenAI 模式接口） | ⭐⭐⭐⭐⭐ Qwen 对 JSON Schema 与 Tool Calling 约束极稳 | 大厂 SLA 极稳、国内延迟极低，几乎不受高峰限流困扰 |
| **硅基流动（SiliconFlow）** | 一键聚合 `DeepSeek-V3`、`Qwen`、`GLM` 等开源模型 | 微信/支付宝直充，常带新人免费额 | 完全兼容（`https://api.siliconflow.cn/v1`） | ⭐⭐⭐⭐ 视具体模型而定（主流模型均支持 `json_object`） | **最适合演示工作台「多模型切换下拉」**——单个 Key 可同时挂载 2～3 个真实模型 |
| **字节火山方舟（Volcengine Ark）** | 豆包系列 / 火山托管版 `DeepSeek-V3` | 个人/企业实名开通，按量后付费或预充值 | 良好 | ⭐⭐⭐⭐ 高并发与首字延迟极快 | 用大厂高速通道调用 DeepSeek，可有效规避官方高峰拥堵 |
| **智谱 BigModel** | `glm-4` / `glm-4.5` 等系列 | 微信/支付宝直充 | 良好 | ⭐⭐⭐⭐ 中文理解、长文本与 Agent 工具调用强 | 中文业务方案拆解自然，接口稳定 |
| **海外直连 / 中转（Claude / OpenAI）** | `Claude Sonnet` / `GPT-4o` | 需外币卡或自有合规渠道 | 原生最高 | ⭐⭐⭐⭐⭐ 前端 UI 审美与一次性编译通过率最高 | 若手头已有现成 Key 可无缝挂入，目前已在 [vercel-ai.ts](../src/adapters/llm/vercel-ai.ts) 内置适配 |

---

## 三、公网 Web 托管与国内直连避坑

### 3.1 国内访问的两大核心避坑
1. **避免直接交付裸 `*.vercel.app` 域名**：大陆网络对免费默认 `vercel.app` 域名存在普遍断连/阻断，评审在未开代理的手机 4G/5G 或公司网络下可能直接白屏。若坚持用 Vercel，必须额外绑定自有域名（境外 DNS 解析），且需注意 Serverless Hobby 档较短的函数执行超时限制对双路 Race Mode 长连接的影响。
2. **短周期内避免强绑“大陆境内主机 + 新域名”**：大陆境内云主机绑公网域名必须经过工信部 ICP 备案（通常需要 5～15 个工作日），不适合 48 小时级交付窗口；**选用中国香港或亚太（新加坡/日本）节点可天然免备案，且内地直连延迟通常在 40～80ms 区间**。

### 3.2 四大公网部署路线对比

| 部署平台 | 节点与免备案 | 部署模式 | 与 Next.js + SSE / Race Mode 契合度 | Postgres 搭配方式 | 特点总结 |
| --- | --- | --- | --- | --- | --- |
| **Zeabur（推荐）** | 支持香港 / 亚太节点，免备案；自带 `*.zeabur.app` HTTPS，可绑自有域名 | GitHub 一键部署 Next.js（常驻容器） | ⭐⭐⭐⭐⭐ **无 Serverless 10s 超时限制**，SSE 流式与双路并发极稳 | 同项目一键添加 **PostgreSQL**，走内网地址零外网流量费 | 体验最接近 Vercel，支持微信/支付宝，最省心 |
| **Sealos（推荐）** | 国内/亚太云原生节点，免备案友好 | App Launchpad 通过 Dockerfile / Node 镜像部署 | ⭐⭐⭐⭐⭐ 常驻容器，国内访问稳定，按小时计费成本极低 | 应用商店一键拉起高可用 **PostgreSQL 集群**（同内网） | 国内开发者社区极流行，应用 + 数据库一个面板管完 |
| **阿里云 / 腾讯云香港轻量服务器** | **香港节点免备案**，内地三网优化直连 | Docker Compose（Next.js `standalone` + Postgres 16 + Caddy） | ⭐⭐⭐⭐⭐ 完全可控、内存充裕、零超时限制 | 同机 Docker Compose 挂持久卷跑官方 Postgres 16 | 稳定性天花板；需备一个低价境外解析域名给 Caddy 自动签 HTTPS |
| **Vercel（需绑自有域名）** | 仅绑自有非大陆 DNS 域名时可稳定访问 | Serverless Functions | ⭐⭐⭐ 需留意免费档函数超时与 SSE 长耗时上限 | 须外挂云端 Postgres（如 MemFire / Neon / Supabase） | 仅适合你手头已有闲置海外域名且偏好零运维的情况 |

---

## 四、云端 PostgreSQL 数据库选型

`atoms-demo` 使用标准 SQL 协议（`pg.Pool` + [SCHEMA_SQL](../src/adapters/storage/sql-client.ts#L18-L82) 自动建表），因此以下任意标准 PostgreSQL 服务均只需填入 `DATABASE_URL` 并设 `STORAGE_ADAPTER=postgres` 即可零改动接通：

| 数据库组件 | 所属生态 / 节点 | 国内直连速度 | 免费额度 / 成本参考 | 适配要点 |
| --- | --- | --- | --- | --- |
| **Zeabur / Sealos 内置 Postgres** | 与 Web 服务同项目同区部署 | ⭐⭐⭐⭐⭐（应用走内网直连，不经公网） | 按容器用量极低成本 | 部署最顺手，避免跨云网络抖动与连接延迟 |
| **MemFire Cloud** | 国内版 Supabase 兼容服务（国内节点） | ⭐⭐⭐⭐⭐（国内直连毫秒级） | 提供基础免费入门套餐（含 Postgres 存储额度） | 非常适合后端挂在海外/Vercel 时避免数据库被墙；提供标准 PG 连接串 |
| **阿里云 / 腾讯云按量 Postgres RDS** | 香港/国内自选 | ⭐⭐⭐⭐⭐ | 按量付费（短期演示仅几元） | 企业级稳定性 |
| **香港轻量同机 Docker Postgres 16** | 自建同机容器 + 命名卷持久化 | ⭐⭐⭐⭐⭐（本机回环通讯） | 包含在轻量机月费内 | 无跨网延迟、零连接数额度烦恼 |
| **Neon Serverless Postgres** | 海外（美东/新加坡可选） | ⭐⭐⭐（建议由香港/海外后端内网连接） | 有免费入门档 | 原生带 PgBouncer 连接池，配合 Vercel 无服务器很常见；注意国内直连控制台偏慢 |
| **Supabase（新加坡/东京）** | 亚太节点 | ⭐⭐⭐（建议选新加坡/东京） | 免费 2 个项目（注意长期无请求会暂停） | 若使用 Session/Transaction Pooler 需注意兼容配置 |

---

## 五、支付收款选型（个人开发者无营业执照视角）

| 收款方案 | 个人资质门槛 | 国内访问与演示体感 | 已完成情况 / 改造成本 | 建议定位 |
| --- | --- | --- | --- | --- |
| **内置 Mock Checkout（推荐默认）** | **零资质** | ⭐⭐⭐⭐⭐ 国内秒开、1 次点击即验证完 HMAC 签名 Webhook 回调 + 订单幂等 + 升级 Pro | **已完成**（开箱即用） | **最适合笔试公网交付默认**，评审无需注册测试账号即可验证真实闭环 |
| **支付宝开放平台「沙箱环境」** | **免营业执照**（个人支付宝实名免费开通） | ⭐⭐⭐⭐ 国内官方网关，真实 RSA2 异步回调 | 需新增一个 `AlipaySandboxBillingAdapter` 并填沙箱密钥；需注意通知回调地址须公网可达 | “官方感”更强；但评审体验付款需页面展示沙箱买家测试账号，易因验证码/风控略增操作摩擦 |
| **Creem Test Mode** | 个人邮箱开通 | ⭐⭐⭐ 海外支付网关，国内偶发略慢 | **已完成**（填 Creem Test Key 即启用） | 面向出海 SaaS 演示很加分 |
| **个人聚合收款（蓝兔 / 虎皮椒）** | 个人签约需交开户费 + 审核，走真实扣款 | — | 不适合 | 仅用于真上线商用，不建议用于 48h 演示测试 |

---

## 六、可选扩展外部组件（对象存储 / 域名 / HTTPS）

虽然当前 `atoms-demo` 第一阶段已经完整闭环、**不依赖对象存储也能交卷**，但如果第二阶段决定顺带补图片上传或绑定独立域名，国内独立开发者常见组件对比如下：

| 组件 | 免费额度 | 出口流量与计费坑 | 免备案自定义域名 | HTTPS 与工具搭配 |
| --- | --- | --- | --- | --- |
| **Cloudflare R2（首选）** | 10GB 存储/月 + 100万次读 + 1000万次写 | **零出口流量费（无流量账单刺客）** | **免备案**（域名托管在 CF 即可绑） | 自带全网免费自动 HTTPS；国内部分运营商晚高峰或有轻微波动 |
| **七牛云（Qiniu）** | 实名认证后含 10GB 存储 + 10GB/月国内流量 | 超额即扣外网流量费 | **必须国内 ICP 备案**才可绑自定义域名 | 国内 CDN 极快；测试域名有 30 天回收限制 |
| **腾讯云 COS / 阿里云 OSS** | 仅新人短期体验包，长期需付费 | 存储极便宜但**外网流出 / CDN 流量费较贵** | **必须国内 ICP 备案** | 生态完善、国内极快；注意设流量封顶防刷 |
| **独立轻量主机 + Caddy** | 自备低价境外注册域名（DNS 放 Cloudflare） | 无额外反代授权费 | 香港/海外机器**免备案** | 用极简 `Caddyfile` 自动申请并续期 Let's Encrypt HTTPS 证书 |

---

## 七、3 套国内落地组合套餐与决策勾选表

### 推荐组合参考
- **套餐 A（最快省心 · 强烈推荐）：阿里云百炼或硅基流动 + Zeabur / Sealos（香港/亚太） + 内置 PostgreSQL + Mock 收银台**
  - 一套人民币账号搞定多真实模型，一站式 PaaS 同时管 Next.js 常驻容器（SSE 零超时）和内网 Postgres，无需买域备案就能给评审发国内直连 HTTPS 链接。
- **套餐 B（最稳可控 · 工程度高）：DeepSeek 官方 / 百炼 + 阿里云或腾讯云香港轻量服务器 + Docker Compose（Next.js + Postgres 16 + Caddy） + Mock 收银台**
  - 三网直连延迟最低，全容器编排由我直接为你写好 `Dockerfile`、`docker-compose.yml` 与 `Caddyfile`，只需一台香港机器 + 一个域名解析。
- **套餐 C（已有海外资源复用）：现有 OpenAI/Claude Key + Vercel（绑已有海外域名） + MemFire Cloud / Neon + Mock 或 Creem Test**
  - 适合手头刚好已有闲置域名与外币卡/Key 的情况（需配合 SSE 超时调优）。

### 决策勾选清单（待拍板后立即进入第二阶段实施）
1. **大模型平台选型**：`DeepSeek 官方` / `阿里云百炼` / `硅基流动` / `火山方舟` / `智谱` / `已有 OpenAI 或 Claude`（准备挂哪几款模型到下拉框？）
2. **托管与数据库组合**：`Zeabur` / `Sealos` / `香港轻量服务器 Docker` / `Vercel + MemFire 或 Neon`
3. **收银台策略**：保持 `Mock Checkout（零门槛默认）` / 补充 `Creem Test` / 新增 `支付宝沙箱`
4. **交付节奏**：是否同时补齐 `Dockerfile`（如需容器/Sealos/Zeabur 部署）、真实模型 JSON 模式兼容加固、真实 Prompt 跑通验收、GitHub Public 仓库推送整理与最终笔试文档？

---

## 八、最终拍板选型：腾讯云一站式闭环方案（第二阶段）与支付规划（第三阶段）

### 8.1 第二阶段：云主机 + 域名解析 + HTTPS + 数据库 + 真实大模型 API

1. **云主机（腾讯云轻量应用服务器 · 中国香港）**
   - 地域选择 **中国香港**（免工信部 ICP 备案，买完即部署上线，内地三网直连低延迟）；
   - 镜像选用 Ubuntu 24.04 或 Docker 预装镜像，防火墙放行 TCP `22` / `80` / `443`（可选放行 UDP `443` 以支持 HTTP/3）；
   - 规格优先选 **`2核4G`（按月）**，可从容机上执行 `docker build` 并并发运行 PostgreSQL + Next.js + 内存 `esbuild`；若选用 `2核2G` 需提前加配 2GB Swap 并优先本地/CI 构建镜像。

2. **数据库（同机 Docker PostgreSQL 16 + 持久卷）**
   - 通过 `docker-compose.yml` 同机拉起 `postgres:16-alpine` 并挂载命名持久卷，生产环境设 `STORAGE_ADAPTER=postgres`；
   - 应用与数据库走 Docker 内网直连，无外网延迟与额外 RDS 费用，且重启不丢数据。

3. **域名注册与解析（腾讯云域名 + DNSPod）**
   - 在腾讯云注册后缀域名的同时**立即提交个人实名认证模板**（实名通过前处于 `serverHold` 不可解析；个人自动审核通常几分钟～几小时生效）；
   - 实名通过后在 DNSPod 为主域名（`@`）与 `www` 子域分别添加 `A` 记录指向香港轻量公网 IP，以配合 `Caddyfile` 自动为 apex 与 `www` 签发证书并启用 `www` 301 重定向（全新解析记录通常几秒～几分钟生效）。

4. **SSL / HTTPS（Caddy 全自动签发与续期）**
   - 首选在 `docker-compose.yml` 中内置 **Caddy** 反向代理 Next.js：只要放行 `80 / 443` 端口，自动向 Let's Encrypt 签发 HTTPS 证书并后台自动续期（规避腾讯云免费 90 天证书每季度人工替换），同时对 SSE 流式输出天然友好；
   - 备选方案为在腾讯云 SSL 控制台申请免费 90 天证书并配置 Nginx 反代。

5. **真实大模型 API 接入（本地凭据读取 + JSON 兼容加固）**
   - 待用户提供独立本地凭据配置文件（`key = 厂商, value = API key`）路径后，通过代码/脚本将对应环境变量安全写入已加入 `.gitignore` 的 `.env.local`（及部署用 `.env`，确保不进 Git 仓库）；
   - 对 [src/adapters/llm/vercel-ai.ts](../src/adapters/llm/vercel-ai.ts) 进行国产及多厂商 OpenAI 兼容端点适配、结构化输出容错解析与重试加固，保留下拉切换真模型 + Mock 兜底，并用真实自由 Prompt 跑通本地端到端验收。

6. **容器化交付与公网收口**
   - 补齐 `next.config.ts`（`output: 'standalone'`）、`Dockerfile`、`docker-compose.yml`、`Caddyfile` 与 `.env.production.example`；
   - 上云启动验证公网 `https://域名`（桌面 + 手机 4G 实测 + `/s/[slug]` 持久化验证），整理 Public GitHub 仓库与最终笔试说明文档。

### 8.2 第三阶段：外部真实支付接入（延后独立推进）
- **第二阶段默认策略**：保持内置 **Mock Checkout**（已完整打通跳转收银台 → HMAC-SHA256 签名 Webhook 回调 → 订单幂等 → `Pro` 会员升级闭环），保证外部评审无需测试银行卡或测试 App 即可秒级完整体验；
- **第三阶段升级项**：在主体站点与公网域名上线后再行决定并接入 **Creem Test/Live Mode** 或 **支付宝开放平台沙箱 / 正式商户通道**。
