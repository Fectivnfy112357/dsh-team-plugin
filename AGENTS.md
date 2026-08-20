# AGENTS.md

DSH Team 插件的仓库——同时承载需求/设计文档（已落地）和实现侧代码（已落地）。
**本仓根（`./`）即双格式插件包的根**：仓根 = DSH 静态插件包根 = Agent Plugins 1.0 插件根。代码形态按 `architecture.md §1.3` 组织。

## 工具

- [`/dsh-dual-plugin-guide` skill](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) — DSH Cordis 插件开发指导（双格式打包 / Service / Slot / 事件 / 动态 Tool）
- `D:\programming\projects\study\dsh` — DSH 源码（实现侧一切从这出发）
- `architecture.md` — 本仓的**实现侧架构**（Service 接口骨架 / 状态机 / 三个 Flow / Slot / 包结构 / 风险与开放项）

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

代码区（已落地，按 `architecture.md §1.3` 实现）：

| 路径 | 状态 | 用途 |
|---|---|---|
| `package.json` | ✅ | 双格式包清单（`name` / `type:module` / `dsh.bundle.patch` / `files`）|
| `cordis.patch.yml` | ✅ | `- insert: - id: dsh-team-plugin-skill` + 3 个 `@deepseek-ai/dsh-subagent-acp` 实例（hermes / mcode / claude-code）|
| `plugin.json` | ✅ | Agent Plugins 1.0 清单 |
| `lib/index.js` | ✅ | `apply(ctx)` 入口：注册 Service + Skill + Tool + Slot；`inject = ['skills', 'tools']`（**不含** slots）|
| `lib/tools/team-tools.js` | ✅ | 20 个 `team.*` Cordis tool（team.start / team.list / team.abort / team.open_decision_point / team.respond_decision_point / team.list_decision_points / team.complete_step / team.fail_step / team.complete_branch / team.fail_branch / team.add_plan / team.list_plans / team.register_artifact / team.list_artifacts / team.delete_artifact / team.rerun / team.resume / team.list_runs / team.check_cost_cap / team.list_adapters）|
| `services/` | ✅ | 13 个模块：team-service / member-service / dispatch-service / message-service / decision-point-service / plan-service / artifact-registry / log-writer / paths / flow-engine / round-table-flow / pipeline-flow / fan-out-flow + adapters / team-template-service / role-service |
| `ui/` | ✅ | 6 个 React 组件：team-panel / team-plan / team-member-chip / team-decision-badge / team-handoff-card / team-handoff-redo + `_react.js` helper |
| `skills/start-team/SKILL.md` | ✅ | `/start-team` skill 入口（双格式内容唯一源）|
| `scripts/verify.mjs` | ✅ | 5 层自检：critical paths / identity+frontmatter / node --check / lib load + tool schema / smoke 221 check |
| `scripts/check-output-schema.mjs` | ✅ | 静态扫所有 `defineTool` 的 output schema：嵌套结构 + required 键必须出现在 properties |
| `scripts/test-install.mjs` | ✅ | 实启 `dsh --profile web --port 0`，13 项 host 启动门（prerequisites / manifest / boot / teardown）|
| `scripts/smoke-test.mjs` | ✅ | service 层端到端 221 check（被 verify.mjs 第 5 层调用）|

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

仓根路径有空格（`D:\programming\projects\my project\...`）会被 pnpm 切，必须 junction 到无空格路径再装。

### 0. Prerequisites

`cordis.patch.yml` 引用的 `@deepseek-ai/dsh-subagent-acp` 必须在同一个 DSH profile 里能 resolve 到；否则 host 启动报 `Cannot find package '@deepseek-ai/dsh-subagent-acp'`，整树加载失败。

```powershell
dsh plugin --profile web add @deepseek-ai/dsh-subagent-acp
```

另外三个 subagent 适配器（hermes / mcode / claude-agent-acp）必须能在 PATH 上找到 `startContinuable` 用的可执行文件。hermes / mcode 已在 PATH；`claude-agent-acp` 不在是预期——成员加入时只在该 member 上 joinRun 失败，不影响插件加载或 host 启动。

### 1. Install

```powershell
# 1. 建 junction（只建一次）
New-Item -ItemType Junction -Path D:\dsh-plugins\dsh-agent-team -Target "D:\programming\projects\my project\dsh-agent-team"

# 2. 装到 web profile（用户当前活跃 profile）
dsh plugin --profile web add D:\dsh-plugins\dsh-agent-team

# 3. 验 manifest
dsh --profile web --dump-config | Select-String dsh-team-plugin
#   应看到 `# == dsh-team-plugin` + `- id: dsh-team-plugin-skill` + 3 个 subagent-acp instance

# 4. 实启
dsh --profile web --port 0
#   期望 stdout: `dsh web: http://127.0.0.1:<port>`，stderr 空
```

### 2. Host 启动时校验真错（dsh-team-plugin 已踩过，必读）

按"出现概率 × 排查难度"排序的 5 个 host-side footgun。**任何修改 `lib/index.js` 或 `lib/tools/*.js` 后再装都可能踩**：

1. **`inject: [...]` 含 `'slots'`** — web profile 起的是 host 进程，没有 `ctx.slots`；slot 是 client UI 进程的 Cordis 服务。错误：`pending (waiting for service: slots)` → 整树加载失败。修法：去掉 `'slots'`；slot 注册用 try/catch 降级（host 上调不了就 warn，不阻塞启动）。
2. **`defineTool` 的 `output` 缺 `render`** — `@deepseek-ai/dsh-tools` 的 AJV 校验要求 `output.render` 是函数（`presentationMeta` 才可选）。错误：`tool "<name>" must declare output { schema, render, presentationMeta? }`。
3. **`output.properties` 跟 `output.schema` 同级** — JS 不会报错，但 AJV strict 找不到 `properties`，连同 `required: [...]` 一起报。错误：`unsupported JSON schema: schema.required names "X" which is not in properties`。修法：把 `properties` 嵌套进 `schema`：
   ```js
   // ✗ 错位
   output: { schema: { type: 'object', required: ['a'] }, properties: { a: { type: 'string' } } }
   // ✓ 嵌套
   output: { schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } }
   ```
4. **`output.schema.required` 含不在 `properties` 里的名字** — 同上 AJV 错。修法：保证每个 required 名字都能在 `properties` 里找到。
5. **`cordis.patch.yml` 引用未装的 `@deepseek-ai/*` 包** — 错误：`Cannot find package '@deepseek-ai/dsh-subagent-acp'`。修法：装包（见上面 §0）。

### 3. 回归门（每次改完必跑）

```bash
# 静态扫：5 层 + tool schema + smoke 221 check；独立于 DSH 跑
node scripts/verify.mjs

# 实启：spawn dsh web + HTTP 探针 + 干净退出；12s，依赖 DSH
node scripts/test-install.mjs
```

两条都过才算 host 端没破坏。**`verify.mjs` 跑过 ≠ host 能起** — 上面 #3 / #4 静态扫能挡住 #2/#3/#4，但 #1 / #5 只有 `test-install.mjs` 实启才能验证。

`npm` 等价：
```bash
npm run check          # = node scripts/verify.mjs
npm run test-install   # = node scripts/test-install.mjs
```

### 4. 已发现的安装命令兼容性

- 仓根路径含空格 → pnpm 会切。解决：junction 到无空格路径（见 §1 #1）。
- `where.exe dsh` 在 PowerShell shim 上返回**无扩展名**路径，裸 `spawn` 会 ENOENT。`test-install.mjs` 内部已处理；自己写脚本时记得 probe `.ps1` / `.cmd` / `.bat` / `.exe` 哪个真存在。
- 仓根路径含空格会让 `dsh plugin ... add <path>` 把它切成两个依赖。永远走 junction 后路径，不要传原始路径。

## 写作边界

边界按文件分层，不按"仓内/仓外"分层：

- **`requirements.md`** — 只写产品形态 + 机制层（继承 `requirements.md §16`）：Team Run 状态枚举、状态转换图、artifact 字段、dispatch / 消息 log 结构、目录的逻辑划分
  - ❌ 不写：用什么语言 / 库 / ORM / 数据库 / async 模型 / 文件路径 / 进程模型
- **`architecture.md`** — 实现架构层：Service 接口骨架、Slot 注册点、事件名清单、包结构、数据流、状态机、并发与对账
  - ❌ 不写：业务实现代码体（函数体）、UI 像素级设计、视觉细节（配色 / 字体 / 间距）
- **`lib/` `services/` `ui/` `skills/`** — 实现代码层：按 `architecture.md` 的接口骨架落地函数体、UI 组件、skill 文档
  - ✅ 这里写 TypeScript / Python 代码、API 调用、ORM、UI 像素级实现
