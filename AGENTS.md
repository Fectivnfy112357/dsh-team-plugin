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
| `PROGRESS.md` | ✅ v1.0 收口 + 2.0 §2 全 17 项闭环 | 进度快照（已完成 / 未完成 / 待拍板 / 留口）|
| `mockups/` | ✅ | UI 草图 HTML（`panel-linear.html` 为当前骨架）|
| `AGENTS.md` | — | 本文件——给 Agent 看的项目约定 |

代码区（已落地，按 `architecture.md §1.3` 实现）：

| 路径 | 状态 | 用途 |
|---|---|---|
| `package.json` | ✅ | 双格式包清单（`name` / `type:module` / `dsh.bundle.patch` / `files`）|
| `cordis.patch.yml` | ✅ | `- insert: - id: dsh-team-plugin-skill` + 3 个 `@deepseek-ai/dsh-subagent-acp` 实例（hermes / mcode / claude-code）|
| `plugin.json` | ✅ | Agent Plugins 1.0 清单 |
| `lib/index.js` | ✅ | `apply(ctx)` 入口：注册 Service + Skill + Tool + Slot；`inject = ['skills', 'tools']`（**不含** slots）；额外注册 6 个 `client-ui-*` slot registrar（layout / sidebar / user-questions / conversation / tool / plan）+ `team-config` / `team-panel` / `team-plan` / `settings.section` slot |
| `lib/tools/team-tools.js` | ✅ | **29** 个 `team.*` Cordis tool — 基础生命周期 (start / list / abort / list_runs / rerun / resume / check_cost_cap / list_adapters) + 决策点 (open / respond / list) + 步骤信号 (complete_step / fail_step / complete_branch / fail_branch) + plan (add_plan / list_plans) + artifact (register_artifact / list_artifacts / delete_artifact) + **9 个 CRUD (create_role / update_role / delete_role / create_member / update_member / delete_member / create_template / update_template / delete_template)** |
| `services/` | ✅ | 16 个模块 — 核心: team-service / member-service / dispatch-service / message-service / decision-point-service / plan-service / artifact-registry / log-writer / paths / flow-engine / round-table-flow / pipeline-flow / fan-out-flow + **配置中心 CRUD: role-service / team-template-service (含 create/update/remove + ref-count 校验)** + adapters |
| `ui/` | ✅ | **13** 个 React 组件 + helper — 核心 v1: team-panel / team-plan / team-member-chip / team-decision-badge / team-handoff-card / team-handoff-redo + **chrome 2.0: layout (TeamTopBar+TeamFooter) / sidebar (TeamSidebar) / team-config (TeamConfigPanel 3 tab) / user-questions (UserQuestionCard) / conversation (ConversationTimeline) / tool (TeamToolCall) / plan (PlanSurface)** + `_react.js` helper（含视觉 token 系统 + functional component 自动渲染）|
| `skills/start-team/SKILL.md` | ✅ | `/start-team` skill 入口（双格式内容唯一源）|
| `scripts/verify.mjs` | ✅ | 5 层自检：critical paths / identity+frontmatter / node --check / lib load + tool schema / smoke 298 check |
| `scripts/check-output-schema.mjs` | ✅ | 静态扫所有 `defineTool` 的 output schema：嵌套结构 + required 键必须出现在 properties（**29 块 tool schema**） |
| `scripts/test-install.mjs` | ✅ | 实启 `dsh --profile web --port 0`，13 项 host 启动门（prerequisites / manifest / boot / teardown）|
| `scripts/smoke-test.mjs` | ✅ | service 层端到端 **298** check（被 verify.mjs 第 5 层调用）|

## 视觉 token 系统 (B1)

`ui/_react.js` 是**全部 UI 视觉细节**的单一来源：

- **`DEFAULT_TOKENS`** — frozen (深 freeze) 的默认主题 ("Linear" 风格：clean + dense + 黑白+蓝色 accent)。结构: `color` (含 `state` / `intent` / `accent` / `danger` / `warning` / `success` 等) + `space` (xs/sm/md/lg/xl/xxl) + `radius` (sm/md/lg/pill) + `font` (family + size + weight) + `motion` (fast/base/slow)。
- **`getTokens()`** — 读 `globalThis.__dshTeamPluginTheme` 合并 override 后返回（运行时换主题；测试可塞临时主题）。
- **`tokens`** — Proxy 包装，每个 read 调用 `getTokens()`，因此**主题改动后所有 UI 组件下次 render 即可看到新色**。所有 `ui/*.js` 组件**只通过 `tokens.color.x` / `tokens.space.x` 引用样式**，禁止内联 hex。
- **`_resetThemeForTests()`** — 删 `globalThis.__dshTeamPluginTheme`，回到默认。

`_react.js#createElement` 还有一项关键升级: **functional component 立即渲染**。`h(MyComponent, props)` 会在 shim 中**立即调用** `MyComponent(props)` 并返回其结果。这让 snapshot / tree-walk 测试可以直接遍历 `TeamPanel` 等大组件的渲染输出，而不需要在测试里手动调用每个子组件。

## UI 槽位表（v2.0 §2 全 17 项闭环后）

| Slot 名 | 组件 | kind | 注册位置 |
|---|---|---|---|
| `team-panel` | `TeamPanel` (run-state) | list | `ui/team-panel.js#registerTeamSlots` |
| `team-config` | `TeamConfigPanel` (3 tab form) | keyed | 同上 (2.0 §2 A5 重接) |
| `team-plan` | `TeamPlan` (PlanService 渲染) | keyed | 同上 |
| `settings.section` | `TeamConfigPanel` | list | 同上 (2.0 §2 A5 重接, 错配修正) |
| `tool.call.toolview` | `TeamHandoffCard` / `TeamHandoffRedo` / `TeamMemberChip` / `TeamDecisionBadge` | keyed (entryKey 区分) | 同上 |
| `client-ui-layout` | `TeamTopBar` + `TeamFooter` | list (双 entry) | `ui/layout.js#registerLayoutSlot` |
| `client-ui-sidebar` | `TeamSidebar` | list | `ui/sidebar.js#registerSidebarSlot` |
| `client-ui-conversation` | `ConversationTimeline` | list | `ui/conversation.js#registerConversationSlot` |
| `client-ui-user-questions` | `UserQuestionCard` | keyed | `ui/user-questions.js#registerUserQuestionsSlot` |
| `client-ui-tool` | `TeamToolCall` | keyed | `ui/tool.js#registerToolSlot` |
| `client-ui-plan` | `PlanSurface` (fallback) | keyed | `ui/plan.js#registerPlanSlot` |

每个 `register*Slot` 在 `lib/index.js#apply` step 3e 注册；step 3e 走 `try/catch` 降级,任一 registrar 挂了只 warn 不阻塞 host 启动。

## 配置中心 (A4/A5)

`ui/team-config.js#TeamConfigPanel` 是 Role / Member / TeamTemplate 3 tab 的配置中心。**正确的 slot 绑定是 `team-config` 和 `settings.section`（不是 `team-panel`）**——后者是 run-state 组件,2.0 §2 A5 已修正这处历史错配。Form 字段直接引用 `architecture.md §5.2` schema;实际提交通过 `team.create_role` / `team.create_member` / `team.create_template` 三个工具（A6/A7/A8），由 host 在 `onSubmit*` 回调里 dispatch。

## 实现从哪开始

1. **必读**：`requirements.md` §2（核心概念）/ §5（数据存储）/ §9（核心机制）三节
2. **开发路线**：`architecture.md` §12 实现阶段 P0-P8（按 Story 1 → Story 2 → Story 3 顺序）+ 2.0 §2 全 17 项 (A1-A8 + B1-B11) 已闭环,见 `PROGRESS.md` 表
3. **落地形态**：按 [`/dsh-dual-plugin-guide` skill](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) 的**双格式**打包（单目录同时是 DSH 静态插件包 + Agent Plugins 1.0 插件），不走 DSH 仓 monorepo 一等公民路线
4. **第一批打开的文件**（P0 骨架）:
   - `package.json`（`name` / `type:module` / `dsh.bundle.patch` / `files`）
   - `cordis.patch.yml`（`- insert: - id: <id>-skill, name: '<pkg-name>'`）
   - `plugin.json`（Agent Plugins 1.0 清单）
   - `lib/index.js`（`apply(ctx)` 注册 Service + Skill + Tool + Slot + 6 个 client-ui-* slot registrar）
   - `skills/start-team/SKILL.md`（内容唯一源）
5. **新增 UI / chrome 时**（B 类实现范式）:
   - 颜色 / 间距 / 圆角 一律走 `tokens.color.x` / `tokens.space.x` / `tokens.radius.x`，**禁止**硬编码 hex
   - 必加 `data-*` sentinel 属性（`data-component` / `data-section` / `data-state-pill` / `data-action` 等），方便 host + 测试做 tree-walk 断言
   - 必在 `lib/index.js#apply` step 3e 注册（`try/catch` 降级）
   - 必加 smoke-test 覆盖（模块 export 校验 + 关键属性 presence 校验）

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

按"出现概率 × 排查难度"排序的 6 个 host-side footgun。**任何修改 `lib/index.js` 或 `lib/tools/*.js` 后再装都可能踩**：

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
6. **`team-config` slot 把 `TeamPanel` 当 form 用了**（v1 历史错配）— 修法：用 `TeamConfigPanel`（见 §"配置中心"），`TeamPanel` 仍绑 `team-panel` slot。

### 3. 回归门（每次改完必跑）

```bash
# 静态扫：5 层 + tool schema + smoke 298 check；独立于 DSH 跑
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
  - ❌ 不写：业务实现代码体（函数体）、UI 像素级设计、视觉细节（配色 / 字体 / 间距）—— 这些归本仓 `ui/_react.js#tokens` + `ui/*.js`
- **`lib/` `services/` `ui/` `skills/`** — 实现代码层：按 `architecture.md` 的接口骨架落地函数体、UI 组件、skill 文档
  - ✅ 这里写 TypeScript / Python 代码、API 调用、ORM、UI 像素级实现
  - ✅ 视觉细节 (色板 / 字号 / 圆角 / 间距 / 动效) 集中在 `ui/_react.js#DEFAULT_TOKENS` + `getTokens()`，其它 `ui/*.js` 通过 `tokens` Proxy 引用
