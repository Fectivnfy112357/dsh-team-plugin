# AGENTS.md

DSH Team 插件的仓库——同时承载需求/设计文档（已落地）和实现侧代码（待落地）。
**本仓根（`./`）即双格式插件包的根**：仓根 = DSH 静态插件包根 = Agent Plugins 1.0 插件根。代码形态按 `architecture.md §1.3` 组织，文件尚未生成（包结构以目录树占位）。

## 工具

- [`/dsh-dual-plugin-guide` skill](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) — DSH Cordis 插件开发指导（双格式打包 / Service / Slot / 事件 / 动态 Tool）
- `D:\programming\projects\study\dsh` — DSH 源码（实现侧一切从这出发）
- `architecture.md` — 本仓的**实现侧架构**（Service 接口骨架 / 状态机 / 三个 Flow / Slot / 包结构占位 / 风险与开放项）

## 仓库结构

文档区（已落地）：

| 路径 | 状态 | 用途 |
|---|---|---|
| `README.md` | ✅ | 文档总索引 + 一句话定义 |
| `docs/requirements.md` | ✅ v1 闭环 + 第五轮机制层扩展 + 第六/七轮审阅收口 | 需求规格（产品形态 + 机制层定稿）|
| `docs/discussion-log.md` | ✅ 七轮 | 讨论过程 / 关键决策 / 被否决方案（按轮次）|
| `docs/architecture.md` | ✅ v1 骨架（模块 / 状态机 / 三个 Flow / UI Slot / 打包）| 实现侧架构（Service 接口骨架 / 状态机 / 三个 Flow / Slot / 打包形态）|
| `PROGRESS.md` | ✅ v1.0 收口 + 2.0 路线 | 进度快照（已完成 / 未完成 / 待拍板 / 留口）|
| `mockups/` | ✅ | UI 草图 HTML（`panel-linear.html` 为当前骨架）|
| `AGENTS.md` | — | 本文件——给 Agent 看的项目约定 |

代码区（待落地，按 `architecture.md §1.3` 占位）：

| 路径 | 状态 | 用途 |
|---|---|---|
| `package.json` | 🟡 待实施 | 双格式包清单（`name` / `type:module` / `dsh.bundle.patch` / `files`）|
| `cordis.patch.yml` | 🟡 待实施 | `- insert: - id: <id>-skill, name: '<pkg-name>'` |
| `plugin.json` | 🟡 待实施 | Agent Plugins 1.0 清单 |
| `lib/index.js` | 🟡 待实施 | `apply(ctx)` 入口（注册 Service + Skill + Tool + Slot）|
| `services/` | 🟡 待实施 | Team / Member / Dispatch / Message / Decision / Plan / Artifact / LogWriter 八个模块 |
| `ui/` | 🟡 待实施 | 常驻面板 React 组件（`team-panel` / `team-member-chip` / `team-decision-badge` / `team-handoff-card` / `team-handoff-redo`）|
| `skills/start-team/SKILL.md` | 🟡 待实施 | `/start-team` skill 入口（双格式内容唯一源）|

## 实现从哪开始

1. **必读**：`requirements.md` §2（核心概念）/ §5（数据存储）/ §9（核心机制）三节
2. **开发路线**：`architecture.md` §12 实现阶段 P0-P8（按 Story 1 → Story 2 → Story 3 顺序）
3. **落地形态**：按 [`/dsh-dual-plugin-guide` skill](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) 的**双格式**打包（单目录同时是 DSH 静态插件包 + Agent Plugins 1.0 插件），不走 DSH 仓 monorepo 一等公民路线
4. **第一批打开的文件**（P0 骨架）:
   - `package.json`（`name` / `type:module` / `dsh.bundle.patch` / `files`）
   - `cordis.patch.yml`（`- insert: - id: <id>-skill, name: '<pkg-name>'`）
   - `plugin.json`（Agent Plugins 1.0 清单）
   - `lib/index.js`（`apply(ctx)` 注册 Service + Skill + Tool + Slot）
   - `skills/start-team/SKILL.md`（内容唯一源）

## 装到本地 DSH

仓根路径有空格（`D:\programming\projects\my project\...`）会被 pnpm 切，必须 junction 到无空格路径再装：

```powershell
# 1. 建 junction（只建一次）
New-Item -ItemType Junction -Path D:\dsh-plugins\dsh-agent-team -Target "D:\programming\projects\my project\dsh-agent-team"

# 2. 装到 web profile（用户当前活跃 profile）
dsh plugin --profile web add D:\dsh-plugins\dsh-agent-team

# 3. 验
dsh --profile web --dump-config | Select-String dsh-team-plugin
#   应看到 `# == dsh-team-plugin` + `- id: dsh-team-plugin-skill`

# 4. 实启
dsh --profile web --port 0
#   期望 stdout: `dsh web: http://127.0.0.1:<port>`，stderr 空
```

装上后两处 host 侧真错必修（dsh-team-plugin 已踩过）：

- `inject: ['skills', 'tools', 'slots']` → 去掉 `slots`（client 才有）
- 每个 `defineTool` 的 `output` 都加 `render: (...) => ContentBlock[]`

验证：`node scripts/verify.mjs`（5 层 + 84 烟雾）独立于 DSH 跑，不依赖装到 DSH。


## 写作边界

边界按文件分层，不按"仓内/仓外"分层：

- **`requirements.md`** — 只写产品形态 + 机制层（继承 `requirements.md §16`）：Team Run 状态枚举、状态转换图、artifact 字段、dispatch / 消息 log 结构、目录的逻辑划分
  - ❌ 不写：用什么语言 / 库 / ORM / 数据库 / async 模型 / 文件路径 / 进程模型
- **`architecture.md`** — 实现架构层：Service 接口骨架、Slot 注册点、事件名清单、包结构、数据流、状态机、并发与对账
  - ❌ 不写：业务实现代码体（函数体）、UI 像素级设计、视觉细节（配色 / 字体 / 间距）
- **`lib/` `services/` `ui/` `skills/`** — 实现代码层：按 `architecture.md` 的接口骨架落地函数体、UI 组件、skill 文档
  - ✅ 这里写 TypeScript / Python 代码、API 调用、ORM、UI 像素级实现


