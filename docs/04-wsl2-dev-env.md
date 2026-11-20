# 04 - 本机 WSL2 开发环境连通性与配置说明

> 实测探测时间：2026-11-20

---

## 1. 环境实测结果

在 Windows 宿主机下通过 `wsl.exe` 连通本机 WSL2 实测结果如下：

| 检查项 | 实测状态 | 说明 |
| :--- | :--- | :--- |
| **WSL2 发行版** | **已连通** | 默认发行版 `Ubuntu`（`Running`，WSL Version `2`）；`docker-desktop` 与 `docker-desktop-data` 当前处于 `Stopped` 状态 |
| **WSL2 用户与家目录** | `<your-wsl-user>` | 家目录 `~`（`/home/<your-wsl-user>`） |
| **Node.js (Linux)** | **已安装（via `nvm`）** | `~/.nvm/versions/node/` 下可安装并切换 `v24.x` / `v22.x` |
| **Git (Linux)** | **已安装** | `/usr/bin/git` |
| **pnpm / psql** | 按需安装 | 当前仅依赖 `npm` 即可跑通完整开发与构建 |
| **目录跨端读写** | **已验证打通** | Windows 仓库目录可映射至 WSL2 `/mnt/c/<your-workspace>/atoms-demo` |
| **Windows 宿主工具** | 已安装 | Windows 侧 `node v24.18.1`、`npm`、`git` 均可用 |

---

## 2. 必须注意的 `PATH` 坑点（重要）

在 WSL2 的**非交互式命令**（如 `wsl.exe -d Ubuntu -- bash -lc "..."`）中，`~/.bashrc` 通常不会自动初始化 `nvm`。实测发现如果直接执行 `node` 或 `npm`，WSL2 会报 `node: command not found` 并回落去调用 Windows 宿主侧的 `/mnt/c/Program Files/nodejs/npm`。

**正确做法**：
- 在交互式 Ubuntu 终端里先确认 `nvm use 24.18.1`；
- 在非交互脚本或从 Windows 通过 `wsl.exe` 调用时，优先显式加载 `nvm`（避免在 PowerShell 传参时嵌套双引号导致参数解析异常）：

```bash
source ~/.nvm/nvm.sh
which node   # ~/.nvm/versions/node/v24.18.1/bin/node
which npm    # ~/.nvm/versions/node/v24.18.1/bin/npm
node -v      # v24.18.1
npm -v
```

---

## 3. 目录位置选择：`/mnt/c/...` vs WSL2 原生 ext4

当前项目创建在 Windows 路径 `<workspace>\atoms-demo`（WSL2 访问路径为 `/mnt/c/<workspace>/atoms-demo`）：

- **放在 `/mnt/c/...` 的优点**：
  - Windows 宿主 IDE / Antigravity 与 WSL2 Ubuntu 实时共享同一份文件，零同步成本，打开工作区即可协作。
- **潜在注意点（I/O 性能）**：
  - WSL2 访问 `/mnt/c`（9P 文件系统桥接）在读取海量小文件（例如大型 `node_modules` 做 Next.js 全量构建或 Playwright 扫描）时，速度会明显慢于 WSL2 原生 ext4 分区（如 `~/projects/atoms-demo`）。
- **建议策略**：
  - **文档与代码日常协作**先放在当前目录（可直接设为你当前的活跃工作区）；
  - 如果进入阶段 1～2 后发现 WSL2 内 `npm install` 或 `next dev` 明显偏慢，可随时通过以下两条路线无痛提速：
    1. 直接在 WSL2 原生目录（`~/projects/atoms-demo`）做构建运行，通过 Git 与 `/mnt/c/...` 同步；
    2. 或利用已实测安装的 Windows `Node v24.18.1` 在宿主机跑编译，只在需要 Linux 环境部署/测试时切入 WSL2。

---

## 4. 阶段 1 前置可选工具

当后续进入阶段 2 需要连接本地 PostgreSQL 时（若不用外部 Neon/Supabase 测试），可在 WSL2 内启动或安装以下任一方式：
- 拉起本机已有的 `Docker Desktop`（当前为 `Stopped`）运行 Postgres 容器；
- 或在 Ubuntu 内直接 `sudo apt install postgresql postgresql-client` 启动本地服务。
