# DSH Team 插件 — 实现架构

> 状态：v1 重写版 · 2026-08-19 · 形态选型 = 静态双格式 Cordis 插件（按 [`dsh-dual-plugin-guide`](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md)）
>
> 配套：`requirements.md`（第七轮收口）/ `discussion-log.md`（七轮决策）/ `mockups/panel-linear.html`（UI 骨架）

## 0. 文档定位

本文件是 DSH Team 插件的**实现架构**——把 `requirements.md` 定下的产品形态与机制层映射到 DSH（Cordis）侧的组件、Service、事件与存储。

| 文档 | 角色 |
|---|---|
| [`requirements.md`](requirements.md) | 产品形态 + 机制层定稿（做什么、规则是什么） |
| [`discussion-log.md`](discussion-log.md) | 七轮讨论过程、关键决策、被否决方案（为什么这么做） |
| [`architecture.md`](./architecture.md) | **本文件** — DSH 侧实现架构（怎么在 DSH 里实现） |
| [`mockups/panel-linear.html`](../mockups/panel-linear.html) | 常驻面板 UI 骨架（Linear 风 app shell） |

**范围**：实现侧架构、组件划分、Service 接口骨架、关键事件、数据存储布局、生命周期与并发约束、与 DSH 已有能力的复用关系、实现阶段、仓根包结构。

**非范围**：

- 重新讨论产品形态 / 机制层（`requirements.md` 第八轮之前任何点都视作定稿）
- 业务实现代码体（`lib/` `services/` `ui/` `skills/` 的函数体 / 组件实现 / 业务逻辑）——接口级骨架落到本文件，函数体留给仓内代码文件
- 视觉细节（配色 / 字体 / 间距 / 圆角 / 动效）— §11.3 + `requirements.md §10.3` 留给后续
- 跨 Run artifact 引用 id 内 run 归属段的具体编码格式（`requirements.md §11.4` Open Question，DSH 实现层定）

**写作约定**：所有 "§x.y" 引用都指向 `requirements.md`；所有"@dsh/xxx" 引用都指向 `D:\programming\projects\study\dsh\packages\xxx`。

---

## 1. 形态选型

### 1.1 插件形态：静态双格式 Cordis 插件

按 [`dsh-dual-plugin-guide`](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) 走**双格式**：

| 维度 | 选择 | 理由 |
|---|---|---|
| 形态 | 静态双格式插件包 | 持久安装、可分发、跨生态（DSH + Agent Plugins 1.0）|
| 内核 | Cordis 插件 | DSH 原生架构（everything is a plugin，`D:\programming\projects\study\dsh\AGENTS.md`）|
| 入口 | `apply(ctx)` 函数形 | 与现有 DSH 插件保持一致；不引入 class/plugin 形 |
| 注册 | `ctx.skills` + `ctx.tools` + 自定义 `ctx.team` Service | 三处注册：skill 给 agent 调用，tool 给 DSH 调度者调用，Service 给插件内各组件互相调用 |
| 包位置 | **本仓根**（`./` 即双格式包根；不是 DSH monorepo `packages/team/`）| 文档与代码同仓；走 `dsh plugin --profile add` 安装，可发布可分发 |
| 数据根 | `<DSH 数据根>/team-runs/<run-id>/`（项目级）+ `<DSH 数据根>/{roles,members,team-templates}/`（全局）| 与 `§5.1` 目录一致 |

**为什么不放 DSH 仓内 monorepo `packages/team/`**：

- 跨生态分发有真实需求（`discussion-log.md §6.4` 调研 + §6.6 借鉴但未采纳）：`requirements.md §6` Adapter 集合是封闭的，但插件本身要走 Agent Plugins 1.0 兼容，方便在 DSH 之外（Codex / Cursor / VS Code 等）装载
- DSH Team 五个协调日志（`§2.4`）的"单写入者=DSH"承诺要求 DSH 进程持有 Service 写入器——这在本仓插件里也成立（DSH 进程跑这个插件，DSH 死 = 整队销毁）
- 双格式是 [`dsh-dual-plugin-guide`](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) 默认形态，工具链（scaffold / verify / install）齐备
- 文档与代码同仓便于审阅：架构 / 接口骨架 / 落地代码 / 决策记录可一并 review；P0-P8 推进时无需跨仓同步

**为什么不是动态 Cordis 插件**：

- 启动对账（`§9.6`）需要在 DSH 启动 hook 上注册一次——动态插件每次重启都丢，状态丢失不可接受
- 跨 Run 的"持续子代" subagent 需要稳定 Service 持有句柄，动态插件不持久
- Story 1/2/3 都是 1.0 支柱（`§19.4`），不能"先动态后期静态"留技术债

### 1.2 启动入口：skill 薄包装 + 插件核心工具

按 `§4.1`：

- **skill**：`/start-team <task>` 斜杠 + "帮我组建团队做 X" 自然语言双触发
- **插件工具**：`team.start` / `team.abort` / `team.continue` / `team.complete` / `team.list` 等 DSH 通过 Cordis 注入的工具；skill 不实现核心逻辑，仅薄包装
- **架构归属**：核心逻辑 = Cordis 插件；skill = thin wrapper；UI = 配置中心 + 常驻面板（**不**作 Team 启动入口）

### 1.3 双格式包结构（本仓根布局）

按 `dsh-dual-plugin-guide` 双格式布局，**`./` 既是仓根也是双格式包根**——文档与代码同仓：

```
./
├── README.md                   # 文档总索引 + 一句话定义
├── requirements.md             # 需求规格（产品形态 + 机制层定稿）
├── discussion-log.md           # 讨论过程 / 关键决策 / 被否决方案
├── architecture.md             # 本文件
├── AGENTS.md                   # 给 Agent 看的项目约定
├── mockups/                    # UI 草图 HTML
├── package.json                # name/type:module/main:lib/index.js + dsh.bundle.patch + files
├── plugin.json                 # Agent Plugins 1.0 清单
├── cordis.patch.yml            # - insert: - id: dsh-team-plugin-skill, name: '<pkg-name>'
├── lib/
│   └── index.js                # apply(ctx): 注册 Service + Skill + Tool + Slot
├── skills/
│   └── start-team/
│       └── SKILL.md            # /start-team <task> 入口（双格式内容唯一源）
├── services/                   # 内部模块（不在 lib/ 暴露，由 apply() 装配）
│   ├── team-service.ts
│   ├── member-service.ts
│   ├── dispatch-service.ts
│   ├── message-service.ts
│   ├── decision-point-service.ts
│   ├── plan-service.ts
│   ├── artifact-registry.ts
│   └── log-writer.ts
├── ui/                         # Client Slot（React.createElement）
│   ├── team-panel.tsx
│   ├── team-member-chip.tsx
│   ├── team-decision-badge.tsx
│   ├── team-handoff-card.tsx
│   └── team-handoff-redo.tsx
└── references/                 # （可选）事实库引用
```

> 仓根即包根——`dsh plugin --profile add <this-repo>` 直接以本仓为插件源；`package.json` / `cordis.patch.yml` / `plugin.json` 与 `lib/index.js` 同在仓根，文件尚未生成（🟡 待实施）。
> 命名 / 路径 / 内部模块划分细节待实施时按 dsh-dual-plugin-guide 落地。

---

## 2. DSH 已有能力复用矩阵

DSH 已有相当完整的底层（`D:\programming\projects\study\dsh`）。DSH Team 不重写这些能力，而是**在 Cordis 插件里组合它们**。

| DSH 现有能力 | 包 | DSH Team 怎么用 | 限制 / 待解决 |
|---|---|---|---|
| Cordis 插件 / Service / Slot / Event | `@deepseek-ai/cordis` | 全部基于此 | 81 事件 + 55 Host + 7 Client + 42 Client Slot（见 `dsh-dual-plugin-guide` references/）|
| Subagent capability | `@deepseek-ai/dsh-subagent` | **Member = continuable subagent**（跨 dispatch 持续）| 一个 Member 一个 ACP 进程；单写入者承诺在 subagent 框架之上自建协调日志 |
| Subagent over ACP | `@deepseek-ai/dsh-subagent-acp` | Member 跟 Adapter 通信的物理通道 | 每 run 一个进程；dispose 6s+3s 优雅退出 |
| Subagent fork in process | `@deepseek-ai/dsh-subagent-fork-in-process` | 可选：DSH 调度者内部的"预览 / dry-run"子代 | DSH Team 默认不依赖 |
| Workflow engine | `@deepseek-ai/dsh-workflow` + `workflow-worker-thread` | 1.0 默认**不**依赖——DSH 进程自己 hold Run | workflow 是 holder-owned 且一次性，与"DSH 死=整队销毁 + 重连"语义一致，2.0 可包装 |
| Skill system | `@deepseek-ai/dsh-skill` | skill 入口（`/start-team` 等）| 已有 `ctx.skills`，DSH Team 只注册，不实现技能系统 |
| Plan mode | `@deepseek-ai/dsh-plan-mode` | **不直接复用**——plan 由 DSH Team 自己生成（`§9.9.2`）| plan-mode 是 DSH 通用 plan 工具，不感知 Team Run 收敛锚点 |
| User questions | `@deepseek-ai/dsh-user-questions` + `tool-ask-user` | 决策点（`§9.10`）的工具实现 | 已有 dsh-user-questions 工具；DSH Team 在此之上加决策点持久化 + 等待超时 |
| ACP server (Member 侧) | `@deepseek-ai/dsh-acp` | Adapter 物理实现 | 自动化只、baseline prompts、每连接多 session |
| Session persistence | `@deepseek-ai/dsh-session-persistence-{jsonl,sqlite}` | Member 自己的 session 持久化（subagent 内置）| Member session 跨 Run 不累积（`§13.2 Q-M1`）需要 subagent 层"每次新 run = 全新 session"——已天然支持 |
| Job runner | `@deepseek-ai/dsh-jobs-local` | 可选：离线 / 后台 dispatch | 1.0 不强制 |
| Goal | `@deepseek-ai/dsh-goal` + `tool-goal` | **不混用**——DSH Team 自己有状态机（`§2.3`）| 跟 goal 子系统正交 |
| LLM | `@deepseek-ai/dsh-llm-{deepseek,pi-ai,retry}` | DSH 调度者自己的 LLM | Member 走 ACP 走各自 LLM |
| Client UI primitives | `@deepseek-ai/dsh-client-ui-*` | 常驻面板 UI | 复用 `ui-conversation` / `ui-layout` / `ui-tool` 等已有 Slot；新增 `client-ui-team-*` Slot 见 §7 |
| `host/boot` 事件 | DSH host | 监听 | 触发 `TeamService.reconcileOnBoot` |
| `host/shutdown` 事件 | DSH host | 监听 | 标记活跃 Run 为 `interrupted` 候选（由下次启动对账）|

> 关键判断：**Member = subagent 持续子代** 是本架构的最大复用点，DSH Team 核心就变成"subagent 之上的 Team 协调层 + UI 层"。

---

## 3. 概念映射：requirements → 实现组件

| requirements 概念 | § | 实现组件 | 关键 Service / 文件 |
|---|---|---|---|
| Role 模板 | §2.1 | `roles/<role-id>.json`（全局）| `RoleService`（CRUD + 引用检查）|
| Member 实体 | §2.2 | `members/<member-id>.json`（全局）| `MemberService`（实例化 Role + 元数据）|
| Team Run | §2.3 | `team-runs/<run-id>/`（项目级）| `TeamService.start / abort / list` |
| Dispatch | §2.4 | `team-runs/<run-id>/dispatch-log.jsonl` | `DispatchService.dispatch` |
| Handoff | §2.5 | `team-runs/<run-id>/handoff-log.jsonl` | `DispatchService.handoff` |
| A2A 消息 | §2.6 | `team-runs/<run-id>/a2a-message-log.jsonl` | `MessageService.send / wake` |
| Artifact | §2.7 | `team-runs/<run-id>/sessions/<member-id>/artifacts/` 或 `team-runs/<run-id>/plans/`（plan 例外）| `ArtifactRegistry` |
| Dispatcher（DSH 调度者）| §2.8 | DSH 自己 | 跟 DSH 客户端输入框共用 session |
| handoff-round-table | §3.1 | FlowEngine 内部 case | `RoundTableFlow` |
| pipeline-with-feedback | §3.2 | FlowEngine 内部 case | `PipelineFlow` |
| fan-out-collect | §3.3 | FlowEngine 内部 case | `FanOutFlow` |
| 用户启动入口 | §4.1 | skill `/start-team` + plugin tool `team.start` | `dsh-dual-plugin-guide` 注册 |
| DSH handoff 流程 | §4.2 / §9.6 | 复用 `handoff-hermes` skill | 不新建 skill |
| 用户介入 | §4.3 / §9.10 | `user-intervention-log.jsonl` | `DecisionPointService` |
| 五个协调日志 | §5.1 | jsonl append-only | `LogWriter`（单写入者=DSH Team Service）|
| session-state.json | §5.2 | `sessions/<member-id>/session-state.json` | 写入方 = Member 自己 |
| self-handoff 文档 | §9.3 | `sessions/<member-id>/handoff-<n>.md` | 写入方 = Member 自己 |
| Member inbox | §2.6 | `session-state.json` 的 `inbox` 字段 | `MessageService` 投递 + 唤醒 |
| plan | §9.9 | `team-runs/<run-id>/plans/<plan-id>.(md|json)` | `PlanService` |
| decision_point 等待 | §9.10.4 | `user-intervention-log.jsonl` | `DecisionPointService.waitForUser` |
| 启动对账 | §9.6 | DSH 启动时 plugin 的 `apply(ctx)` 入口 | `TeamService.reconcileOnBoot` |
| 4 worker 上限 | §9.12.9 | 引用宿主 `acp_adapter/server.py:231` | 不写自造数字，运行时查询 |

---

## 4. 核心子系统

### 4.1 TeamService（Team Run 生命周期 + 状态机）

**职责**：Team Run 状态机、生命周期持有、abort / 重跑、启动对账。

**接口骨架**（TypeScript 风格伪签名，下同）：

```ts
interface TeamService {
  // 启动
  start(req: {
    taskDescription: string;
    flow: 'handoff-round-table' | 'pipeline-with-feedback' | 'fan-out-collect';
    flowConfig: FlowConfig;
    members: MemberRef[];        // 拼好队的成员
    templateId?: string;         // 来自 team-template
  }): Promise<TeamRun>;

  // 中止
  abort(runId: string, reason: string): Promise<void>;

  // 重跑
  rerun(runId: string, opts: {
    injectArtifacts?: ArtifactRef[];
    modifiedTask?: string;
  }): Promise<TeamRun>;

  // 查询
  list(opts?: { state?: RunState; includeArchived?: boolean }): TeamRun[];
  get(runId: string): TeamRun | undefined;

  // 启动对账（DSH 启动时由 plugin apply() 调一次）
  reconcileOnBoot(): Promise<{ interrupted: string[] }>;
}
```

**状态机**（`§2.3 + §9.8`）：

```
                            ┌──────────────┐
                            │   pending    │
                            └──────┬───────┘
                                   │ 拼队开始
                                   ▼
                            ┌──────────────┐
                ┌───────────┤  assembling  ├────────────┐
                │           └──────┬───────┘            │
                │ 组装失败          │ 拼队完成            │ 任意时刻
                │ (assembling-     │ 至少一个 member     │ 用户主动
                │  >failed)        │ session 已建立      │ (含 assembling)
                │                  ▼                     ▼
                │           ┌──────────────┐      ┌──────────┐
                │           │   running    │      │ aborted  │
                │           │ + degraded?  │      └──────────┘
                │           └─┬──┬──┬──┬─┘
                │             │  │  │  │
                │ 收敛/兜底    │  │  │  │ 自然达成     全部成员
                │ 门 + 用户    │  │  │  │ (round-     不可恢复
                │ 确认         │  │  │  │  table 必)  (DSH 判定)
                │             │  │  │ ▼             ▼
                │             │  │  │ succeeded  ┌──────────┐
                │             │  │  │ (partial?) │  failed  │
                │             │  │  │            └──────────┘
                │             │  │  │ 持有进程死亡
                │             │  │  │ (启动对账发现)
                │             │  │  ▼
                │             │  │ ┌──────────────┐
                │             │  │ │ interrupted  │
                │             │  │ └──────┬───────┘
                │             │  │        │ 用户点重跑
                │             │  │        ▼
                │             │  │ (回到 assembling)
                │             │  │ 用户放弃
                │             │  ▼
                │             │ ┌──────────┐
                │             │ │ aborted  │
                │             │ └──────────┘
                │             │
                │             ▼
                │        (任意状态 → archived 软关闭)
                ▼
          (任意终态)
```

**关键实现点**：

- `degraded` **不是状态**，是 `running` 状态上的修饰 flag（`meta.json.degraded_flag` + `state-history.jsonl` 记录置位时刻）
- 状态转换触发器在 `team-runner.state-machine`（`onTransition(from, to, ctx)`）；转换前**先**写 `state-history`，再更新 `meta.json`——确保审计可重放
- `assembling → failed` 出口存在，但**禁止断点续跑**（`§2.3` 收口，留 2.0）；失败时复用素材 + plan 可重跑组装
- `interrupted` 仅由**启动对账**（`§9.6`）标记——DSH 启动时扫描所有 `state=running` 的 Run，持有进程不在 = 标记 interrupted，reason=`process-killed`；同步把 in-flight dispatch 标记 `terminal=interrupted` + 同步 `dispatch-interrupted` 到 `state-history`

**状态机表**（`§2.3`）：

| 状态 | 进入条件 | 关键行为 |
|---|---|---|
| `pending` | start() 成功 | 等拼队 |
| `assembling` | 拼队逻辑开始 | 按 strategy 选 Member；可失败 → `failed(reason=assembly)` |
| `running` | 至少 1 Member session 已建立 | 接受 dispatch / handoff / A2A；可置 degraded flag |
| `succeeded` | 用户决策点确认（round-table） / 调度者按 flow 判定（其余）| 销毁所有 Member session；产物保留 |
| `failed` | 重试上限 / 不可恢复 / 循环失败 / 组装失败 | 同上 |
| `interrupted` | 启动对账发现 running 但无持有进程 | reason=`process-killed` |
| `aborted` | 用户显式触发 | 任意非终态可入；产物保留 |
| `archived` | 用户主动 | 任意状态可入；只读 |

**DIP 依赖**：`MemberService` / `DispatchService` / `MessageService` / `PlanService` / `DecisionPointService` / `ArtifactRegistry` / `LogWriter`。

### 4.2 MemberService（Member + Session）

**职责**：Member 实体 CRUD、Member ↔ subagent 桥接、Member session 跨 dispatch 持续、self-handoff 触发。

**核心判断**：Member = `@deepseek-ai/dsh-subagent` 的实例（**持续子代** continuable 模式），每个 Member 一个独立 ACP 进程。

**为什么走 continuable subagent**：

- `§6` + `§9.2` 要求 Member session 跨 dispatch 持续 = continuable 的天然语义
- `§6` 要求"每个 Member 独立 ACP 进程" = `@deepseek-ai/dsh-subagent-acp` 的天然行为
- 跨 Run 不累积（`§13.2 Q-M1`）= "每个新 Team Run 起一个全新 continuable subagent"，天然隔离
- `§9.2` 状态机（idle ↔ working）+ 跨 dispatch 不重建 = subagent followup 行为

**接口骨架**：

```ts
interface MemberService {
  // Member 实体 CRUD（全局素材）
  createMember(input: NewMember): Member;
  updateMember(memberId: string, patch: Partial<Member>): Member;
  deleteMember(memberId: string): void; // 引用检查（team-templates / 历史 run）

  // 加入 Team Run
  joinRun(runId: string, memberId: string): Promise<SubagentHandle>;
  // 内部：
  //   1. 拍快照（§5.2 素材快照）写入 meta.json.members[].snapshot
  //   2. ctx.subagents.startContinuable({ provider: 'acp', persona, toolFilter, ... })
  //   3. 拿 childId → 写入 sessions/<member-id>/session-state.json

  // 唤醒（DSH 投递 A2A 消息后）
  wake(memberId: string, hint: { topic: string; intent: string }): void;
  // 实现：A2A 消息 → 写入 inbox + 发轻量 ACP prompt "你有一条新消息"
  // 去重：T 秒内同一目标不重复唤醒（防 ping-pong 风暴，§9.4）

  // 派遣（DSH 调度者发 dispatch）
  dispatch(memberId: string, payload: DispatchPayload): Promise<DispatchReceipt>;
  // 实现：subagent followup(memberId, content, { source: 'dsh' })

  // A2A 消息（成员发起）
  sendMessage(fromMemberId: string, msg: A2AMessage): void;
  // 实现：写 a2a-message-log + 投递到 toMemberId inbox + wake(to)

  // Self-handoff
  triggerSelfHandoff(memberId: string, reason: 'context-overflow'): Promise<void>;
  // 实现：subagent followup 携带 handoff-<n>.md 内容；更新 session-state.json
  //   不重建 session id——session_chain 追加

  // 销毁
  leaveRun(runId: string, memberId: string): Promise<void>;
  // 实现：subagent handle.dispose()（6s+3s 优雅退出）
}
```

**Member 状态机**（`§9.2 + §9.3`）：

```
idle ↔ working → failed (终端，dispatch 失败会上报 DSH 走 §9.8.2/§9.8.3)
        ↓
     (context > 200k token) → self-handoff（不重建 session，链式续接）
```

- session **不重建**直到 Run 终态（`§9.2 + §13.3 Run-2`）
- self-handoff 触发时：**成员自己**写 `handoff-<n>.md` → `session/close` → `session/new` → `session/prompt`（按 H4 拼接：① member 人格 ② handoff 文档 ③ 原 task 指令）→ `session_chain` 追加；**不**走协调日志（`§2.4 / §9.3` 锁定：成员直接落盘）
- 200k token 阈值检测 = 成员进程内部能力（acp session event 暴露 context length）；DSH 仅在 `session-state.json` 记录 handoff_count，不做拦截

**跟 subagent 框架的边界**：

- DSH Team **不**自己实现 ACP 协议——复用 `dsh-subagent-acp`
- DSH Team **不**自己实现 session 持久化——subagent 内置
- DSH Team **接管**的：snapshot 拍取、inbox 写入、A2A 唤醒去重、self-handoff 触发条件判定（>200k token 由 Member 自己检测，DSH 不在中间判定）

### 4.3 DispatchService / MessageService（三个原语）

`§2.4 / §2.5 / §2.6` 三个原语 + `§2.4` "单写入者原则"。

**单写入者承诺**（`§2.4` 第七轮收口）：

> 五个 append-only 协调日志——`dispatch-log` / `handoff-log` / `a2a-message-log` / `user-intervention-log` / `state-history`——的唯一写入者都是 DSH。**这不包括 artifact 与 self-handoff 文档**：artifact 与 `handoff-<n>.md` 由成员直接落盘。

**接口骨架**：

```ts
// 协调日志写入器（DSH Team Service 持有）
interface LogWriter {
  append(log: 'dispatch-log' | 'handoff-log' | 'a2a-message-log'
              | 'user-intervention-log' | 'state-history',
         runId: string, entry: object): void;
  // 实现：单进程内串行（async mutex）；多 DSH 进程并发=架构层不支持（1.0）
}

interface DispatchService {
  dispatch(req: { runId, from: 'scheduler', to: MemberId, task, contextRefs }): DispatchLogEntry;
  // 写 dispatch-log + 调 MemberService.dispatch

  handoff(req: { runId, from: MemberId, to: MemberId | 'DSH-routing',
                 task, artifacts, reason }): HandoffLogEntry;
  // 写 handoff-log + （to 是 MemberId 时）调 MemberService.dispatch / 唤醒 / 投递 inbox
  // 关键：成员发起的移交不污染 dispatch-log（§2.4 / §2.5 / §3.2 第七轮收口）
}

interface MessageService {
  send(req: { runId, from: MemberId, to: MemberId | 'broadcast',
              topic, intent, payload, inReplyTo? }): A2AMessageLogEntry;
  // 写 a2a-message-log + 投递 inbox + wake(to)
  // wake 去重：T 秒内同目标不重复唤醒（§9.4 第六轮收口）
}
```

**DSH 不读内容**（`§2.6 / §9.4`）：MessageService.send 只看 header（topic / intent / kind），不读 payload；DSH 不做内容理解。

**dispatch 状态机**（`§9.8.5`）：

```
pending → running → {completed | failed | interrupted}
                       ↑             ↑              ↑
                  自然完成     运行失败/结果失败   被 abort 打断
```

- 三态枚举直接落到 `dispatch-log.jsonl` 的 `terminal` 字段（顶层，非嵌套）——便于扫描
- `interrupted` 与 `failed` 必须区分（`§9.8.1 D1-6`）：前者是"被中止"，后者是"自然失败"
- 半成品 artifact 保留（不可变快照，`§9.11.4`），重跑注入可被 DSH 注入到新 dispatch

### 4.4 Dispatcher（DSH 调度者）

**实质**：DSH 调度者 = 用户在 DSH 客户端输入框直接对话的 agent（`§2.8`）。

**DSH Team Service 在 DSH 调度者里的接入点**：

- 通过 Cordis `ctx.tools` 注册 `team.start` / `team.abort` / `team.list` / `team.rerun` 等
- 通过 Cordis `ctx.tools` 注册 `team.continue` / `team.complete` / `team.abort`（决策点响应）
- DSH 自己决定何时调用（调度循环 = DSH LLM 自治）

**DSH handoff**（`§9.6`）：复用现有 `handoff-hermes` skill，**不**新建 `handoff-dsh`。handoff 文档结构（`§9.6 + Q-DSH-3`）：

1. Team Run ID + 绝对路径
2. `meta.json` / `dispatch-log.jsonl` / `a2a-message-log.jsonl` / 各 Member artifacts 目录路径
3. 当前 Team Run 状态
4. "下一步"建议（可选）
5. 最近 active plan: `<id> <path>`（仅引用未执行完的，`§9.9.7`）

**DSH 调度者 vs Member**（`§9.6 + §13.5`）：

| 维度 | Member | DSH 调度者 |
|---|---|---|
| 可见性 | 后台（ACP 进程）| 前台（DSH 客户端输入框）|
| session 谁控制 | Member 自己 / DSH 自动 | **用户**手动 |
| 换 session 触发 | 自动（200k token 阈值）| **用户观察后手动** |
| handoff 谁生成 | Member 自己（按 `/handoff-hermes`）| DSH 自己（同 skill）|

**切换期间 Team 行为**（`§9.7`）：

- `running` 状态保持不变（**无** `paused` 状态，`§9.7` 第六轮收口）
- DSH 不在 → 成员进程保活，无调度者推进新 dispatch → 自然冻结（机制事实，不是状态变更）
- 新 DSH session 接管后继续

**全局视野实现**（`§9.6` 第六轮收口）：

- DSH **不常驻全量上下文**——维护轻量 **Runs 索引**（`{ run_id, state, members_count, last_event_at }`）到内存
- plan 生成（`§9.9.2` 需要全局视野）基于索引 + 按需读指定文件
- 索引启动时由 `startup-reconcile()` 顺便建立（扫描 + sort by `last_event_at`）

### 4.5 决策点（DecisionPointService）

**职责**：开决策点 → 等待用户响应 → 注入 feedback 到下一轮 dispatch。

**接口骨架**：

```ts
interface DecisionPointService {
  open(req: {
    runId: string;
    kind: 'convergence' | 'fallback' | 'ad-hoc';
    prompt: string;
    contextRefs?: ArtifactRef[];
    waitMinutes: number;          // 来自 flow_config.decision_points
  }): DecisionPoint;

  // 用户响应（来自 DSH 调 team.continue/complete/abort）
  respond(dpId: string, response: {
    action: 'continue' | 'complete' | 'abort';
    feedback?: string;
    isAdHoc?: boolean;
  }): void;
  // 写 user-intervention-log + 把 feedback 拼进下一轮 dispatch.task

  // 窗口内多次响应：以最后一条 action 为准（§9.10.4）
  // 反馈不合并（保留"改主意"）
  // 窗口外迟到消息无决策点归属，但 DSH 调度时可见
}
```

**开点（零 DSH 裁量，`§9.10.1` 第七轮拍板 1）**：

1. **收敛门**：`round-table-flow.checkConvergence()` 在轮次边界检收敛候选，检出即开
2. **兜底门**：`round-table-flow.atMaxRounds()` 必开
3. **用户门（ad-hoc）**：UI 顶栏按钮 → 拉临时决策点（`flow_config.ad_hoc_decision_points=true` 才显示）

**响应模型**（`§9.10.2`）：`{ action: continue|complete|abort, feedback?: string, is_ad_hoc?: boolean }`——所有门同构；ad-hoc 与 flow 触发同 schema，`is_ad_hoc` 区分。

**注入机制**（`§4.3 + §9.10.3`）：DSH 处理响应时把 `feedback` 文本写进下一轮 dispatch 的 `task` 字段。

**等待机制**（`§9.10.4`）：

- 两级 `wait_minutes`：全局默认 10 分钟（OQ-2 待拍是否写入产品默认）+ `flow_config.decision_points[i].wait_minutes` 单点 override
- 窗口内多次介入：DSH 取**最后一条 action** 为准；`feedback` 不合并（保留"改主意"）
- 窗口外迟到消息无决策点归属，但 DSH 调度时可见

**超时按 flow 分流**（`§9.10.4 / §9.13` 第七轮收口）：

| Flow | 超时动作 |
|---|---|
| `handoff-round-table` | abort |
| `pipeline-with-feedback` | continue |
| `fan-out-collect` | continue |

**用户失联 ≠ 自动 succeeded**（`§9.9.6 + §9.10.4`）：round-table 无用户确认停留等待态，不自动落 succeeded。

**决策点与 Plan**（`§9.9.5`）：

- `plan.derived_from` 必填：取自 `decision` artifact / 带 `conclusion` 的收敛消息 / `user-intervention-log` 中 `action=complete` 记录——三选一，**无**新造记录
- `convergence_note` 降级为兜底注释字段（非决策点路径用，且必须引用具体消息 id 区间）

### 4.6 PlanService

**职责**：DSH 唯一生成者（`§9.9.2`），plan 持久化，dispatch 软参考。

**接口骨架**：

```ts
interface PlanService {
  generate(req: {
    runId: string;
    derivedFrom: ArtifactRef[];     // 必填，§9.9.5
    body: string;                   // 自由正文（自然语言）
    steps: Array<{
      role: RoleRef;
      intent: 'produce' | 'review' | 'collect' | 'synthesize' | 'decide';  // 枚举值集 Open Question §11.4
      expectedArtifact: { type: ArtifactType; desc: string };  // required
    }>;
  }): PlanArtifact;
  // 写 team-runs/<run-id>/plans/<plan-id>.{md|json}
  // produced_by = 'scheduler'（§9.9.3 D4-7）
  // produced_in_session = null
  // 目录归属：Team Run 顶层（§9.9.3）

  // dispatch 软参考（§9.9.4）
  // 不强制，按需在 dispatch.context_refs 引用 plan step
}
```

**生成流程**（`§9.9.2`）：

1. **触发条件**：`flow_config.plan_output=true` **且** 收敛候选命中
2. **生成步骤**：
   - 读 `a2a-message-log.jsonl` 找收敛消息（`payload.conclusion`）
   - 读 `artifacts/` 找决策锚点
   - DSH 写 plan 正文（自由自然语言）→ 提炼 3-5 步索引（`role` + `intent` + `expected_artifact{type, desc}`）→ 落到 `team-runs/<run-id>/plans/plan-<n>.md` + `.meta.json`
3. **derived_from 必填**：从收敛锚点列表（decision / 收敛消息 / 用户决策点记录）选
4. **软参考 + 采纳留痕**：`dispatch.context_refs` 引用对应 plan step；DSH 偏离允许，但偏离也留痕（`dispatch.task` 文本里注明"偏离 plan step X,原因: ..."）

**与 DSH handoff 协同**（`§9.9.7`）：handoff 文档模板加"最近 active plan: `<id> <path>`"，仅引用未执行完的 plan。

**intent 枚举**（`§11.4 OQ-1`）：倾向 `produce | review | collect | synthesize | decide`——实现时预留枚举扩展点，用户拍板后填具体值。

### 4.7 三个 Flow 的核心循环

按 `team-runner` 内部 flow strategy 模式（新 flow 通过实现 strategy 接口加，`§11.2` 留口）。

#### 4.7.1 handoff-round-table（Story 1）

```
state = running
rounds = 0
while rounds < max_rounds:
  轮次边界:
    dsh 扫描 a2a-message-log + dispatch-log, 检收敛候选
    if 收敛候选命中 → 开收敛门（决策点）→ 走 §9.9.6 三态判定
    rounds++
  向当前全部成员逐一发送发言邀请（sequential prompt 队列）
  等待全员回包（超时按 flow 分流）
  把回包 / A2A 消息写入 a2a-message-log
  检 max_rounds → 兜底门
if 用户确认 complete → succeeded（user-intervention-log 锚）
if abort → aborted
```

**关键点**：

- **扫过制**（`§3.1`）：轮次边界是机制可判定（邀请-回包），不依赖 DSH 判断内容
- **决策点开点** = [收敛门 / 兜底门 / 用户 ad-hoc 门] 三合一，零 DSH 裁量
- 缺席成员 = 标记但不阻塞；"轮"=邀请-回包对数，不依赖"全员发言"
- 物理并发 ≤4（`§9.12.9`）：轮中"全员逐一"是顺序遍历，4 worker pool 不被 fan-out 占据
- `succeeded(round-table)` 唯一入口 = 用户在决策点确认（`§9.9.6`）；DSH 判定不直接落 succeeded

#### 4.7.2 pipeline-with-feedback（Story 2）

```
state = running
for step in steps:
  target = step.member
  dsh 派 dispatch(target, task=step.task, context_refs=inject(step))
  等待 target 终态（complete / fail）
  if complete:
    收集 produced_artifact_ids → 写 dispatch-log
    target 走 handoff（到下一棒 to=DSH-routing, §3.2/§2.5 P2-1）
    dsh 查 plan → 派下一个 step
  if fail:
    if retry < step.max_retries:
      retry++
      重派同 target + feedback（从 handoff 携带的"需修改清单"）
    else:
      # 默认 failed;dsh 可插队一次
      if dsh 没有插队决策（超时）→ failed
      if dsh 重派/换人 → state=running（继续循环）
      if dsh terminate → failed
```

**关键点**：

- **顺序强制在 DSH 侧**（`§3.2` 第六轮收口）：成员 handoff 写"完成 step N"不点名下一棒，`to=DSH-routing` 路由占位；DSH 查 plan 后派单
- 成员发起的移交**不污染 dispatch-log**（`§2.5 P2-1` 第七轮收口）：成员→DSH-routing 落 handoff-log，DSH→具体成员 落 dispatch-log
- feedback loop 用 `flow_config.feedback_loops: { "step_i → step_j": { max_retries } }` 配置
- pipeline 决策点**默认关**；若 `flow_config.decision_points[]` 显式开启 → 等待按 `§9.10.4` 分流超时（→ continue）

#### 4.7.3 fan-out-collect（Story 3）

```
state = running
  # 预飞行确认（§9.13 ①, §3.3 P0-1①）
  if len(parallel) >= 3:
    向用户确认"将并行启动 N 个成员 agent + 预估成本 / 本轮上限"
    用户 cancel → aborted; continue → 继续

  # 派发（逻辑并行，物理 ≤4）
  dispatch 队列 = [d for d in parallel]   # 物理并发 = 4 worker pool
  await Promise.allSettled(dispatch 队列)

  # 收尾：join by DSH（幂等派发，§3.3 第六轮收口）
  completed_members = [d for d in dispatch if d.terminal == completed]
  failed_members    = [d for d in dispatch if d.terminal == failed]
  if failed_members:
    meta.degraded_flag = true   # 部分失败置 flag，不全挂不进 failed
    state-history 记录置位
  # 派发 aggregator（若配置）
  if aggregator:
    dispatch aggregator(participants=completed_members, artifacts=their_artifacts)
    await aggregator terminal

  if subsequent_steps: 走 pipeline 风格继续
  if 全部完成 → succeeded（partial? 看 degraded_flag）
  if 全部失败 → failed
```

**关键点**：

- N 路并行是**逻辑并行**；物理并发 = ACP adapter 的 4 worker 上限（`§9.12.9` 引用 `acp_adapter/server.py` 行 231）；5+ 路时 4 并发 N-4 排队
- **join 由 DSH 判定一次性派发**（第六轮）：`handoff to=DSH-routing` 模式，成员各自 handoff 给 aggregator 的写法**不采用**——会重复触发汇总
- **完成定义** = 显式 complete + 产物/引用存在；显式空结果（"查无资料"）= complete；沉默死亡 = 视为 failed
- join 超时留足排队余量，防"资源排队"误判为"成员死亡"
- aggregator 派单带 `context_refs = completed_members.artifacts` 一次性注入

### 4.8 不收敛三态判定

`§9.9.6`：DSH 在**任一轮边界**检收敛候选，检出即按三态判定开收敛门（`§9.10.1`）；`max_rounds` 到达为兜底门判定：

1. **有共识** → 产 `plan`（按 `flow_config.plan_output` 开关）→ **开决策点 → 用户确认 → succeeded**
2. **无共识但有方向** → 产 `decision`（结论 = "方向未定/暂缓"）+ 呈现给用户 → **开决策点**
3. **卡死**（无进一步信息价值）→ DSH 介入：自动重派一次 或 终止

---

## 5. 数据存储

### 5.1 目录结构

跟 `§5.1` 一致；DSH 实现层负责具体存储引擎（YAML/JSON/SQLite）与绝对路径。

```
<DSH 数据根>/
├── roles/                          # 全局
│   └── <role-id>.json
├── members/                        # 全局
│   └── <member-id>.json
├── team-templates/                 # 全局或项目级
│   └── <team-template-id>.json
└── team-runs/                      # 项目级
    └── <run-id>/
        ├── meta.json
        ├── dispatch-log.jsonl
        ├── handoff-log.jsonl
        ├── a2a-message-log.jsonl
        ├── user-intervention-log.jsonl
        ├── state-history.jsonl
        ├── plans/                  # 1.0 新增（§9.9.3）
        │   └── <plan-id>.{md|json}
        └── sessions/
            └── <member-id>/
                ├── session-state.json
                ├── session-log.jsonl
                ├── handoff-<n>.md
                └── artifacts/
                    └── <artifact-id>.<ext>
```

**作用域**：

- `roles/ members/ team-templates/`：用户私有素材库（全局）
- `team-runs/`：项目级（`.dsh/team-runs/<run-id>/`，随项目归档/分享）

### 5.2 实体类型与删除规则

| Entity | 关键字段 | 持久化位置 | 删除规则 |
|---|---|---|---|
| `Role` | id, display_name, persona, adapter(enum), cli_options, tools_allowed, avatar | 全局素材库 | 无引用检查（成员快照挂原 role 引用）|
| `Member` | id, role_id, display_name, persona, cli_options_override, metadata | 全局素材库 | 引用检查：被 team-templates / 在跑 run 引用 = 拒绝 |
| `TeamTemplate` | id, name, flow, flow_config, members(members 引用 + instance_alias) | 全局或项目级 | 引用检查：被 team-template 嵌套引用 / in-flight run 引用 = 拒绝 |
| `TeamRun` | id, state, degraded_flag, flow, flow_config, members(含 member_snapshot), task_description, current_round, created/started/ended_at | 项目级（`.dsh/team-runs/<run-id>/`）| 终态后归档（archived 软关闭）；物理清理 = 引用检查 |

### 5.3 五个协调日志（单写入者=DSH）

| 文件 | 行 schema | 触发源 |
|---|---|---|
| `dispatch-log.jsonl` | `{id, from, to, task, context_refs, issued_at, completed_at, produced_artifact_ids, run_id, seq, terminal?: completed\|failed\|interrupted}` | `DispatchService.dispatch` 派单 + 终态标记 |
| `handoff-log.jsonl` | `{id, from, to(member\|DSH-routing), task, artifacts[], context, reason, run_id, seq, timestamp}` | `DispatchService.handoff`（DSH 代理 member→member 移交）|
| `a2a-message-log.jsonl` | `{id, from, to(member\|broadcast), topic, intent, payload, in_reply_to, timestamp, delivered_to_inbox_at, kind: message\|system-wake}` | `MessageService.send` 转发 + wake 事件 |
| `user-intervention-log.jsonl` | `{id, decision_point_id, user_message, action: continue\|complete\|abort, timestamp, is_ad_hoc}` | `DecisionPointService.respond` |
| `state-history.jsonl` | `{from_state, to_state, reason, timestamp}` | `TeamService` 状态机转换 |

**关键约束**：成员进程**不**持有这些文件的写句柄；写由 DSH 进程经 `TeamService` / `DispatchService` / `MessageService` / `DecisionPointService` 集中发出。多进程并发 append 同一 jsonl = 加文件锁 / 串行队列（实现细节）。

### 5.4 Member session 状态

`sessions/<member-id>/session-state.json`：

```json
{
  "current_session_id": "<acp-session-id>",
  "session_chain": ["<old>", "<new>"],
  "handoff_files": ["handoff-1.md"],
  "inbox": { "pending": ["<msg-id>"], "processed": ["<msg-id>"] },
  "state": "active|terminated",
  "self_handoff_count": 0
}
```

由 `MemberService` 维护（在 subagent 提供的 AgentHandle 之上），与 DSH session 模型解耦——DSH session 是用户前台，Member session 是 Team Run 内的子 agent session。

### 5.5 Artifact 存储

- **位置**：Team Run 实例下，`sessions/<member-id>/artifacts/<artifact-id>.<ext>`；`plan` 类型例外：在 Team Run 顶层（`team-runs/<run-id>/plans/`）
- **元数据**：`artifacts/<id>.meta.json`（与文件同目录，便于按目录扫描），记录 `produced_by` / `produced_in_dispatch` / `produced_in_session` / `derived_from` / `type` / `created_at`
- **不可变快照**：重跑 → 新 id；原文件保留；同源链 `derived_from`
- **跨 Run 引用**：id 带 run 归属段 `<run-id>/<artifact-id>`（具体编码格式 OQ-3，DSH 实现层定），**引用式不复制**
- **删除保护**：`derived_from` 计数 + 跨 Run 反向引用计数，被引用 = 拒绝（`§9.11.3`）

### 5.6 引用锁 / 快照

- **删除前引用检查**（`§5.2 + §9.11.3`）：被引用的 artifact 拒绝物理删除
- **Run 创建时拍快照**（`§5.2` 快照）：Run 创建瞬间，members / roles 元数据嵌入 `meta.json.members[].snapshot`——历史 Run 自足，素材库实体之后删除不破坏历史审计
- 两者都要：删除前引用检查挡"被引用时删除"；快照挡"删除之后"破审计

### 5.7 归档与清理

- **归档 = 软关闭**：artifact 原地保留（`§9.11.3`）
- **删除 = 检查引用**：被引用的拒绝（`§9.11.3`）
- **当前版本不做自动清理**（`§9.11.6`）——无 TTL、无冷区
- 归档时检查引用 + 记录 warning 进 `state-history.jsonl`（`§9.11.5`）

---

## 6. 生命周期与并发

### 6.1 Team Run 状态机

见 §4.1 状态机图 + 表。要点重申：

- `degraded` 是 `running` 的修饰 flag，**不**是独立状态；进入条件 = ≥1 非全部 Member 不可恢复
- `aborted` 独立终态，与 `failed` 不可合并（语义不同）
- `interrupted` 仅 reason=`process-killed`（DSH 崩溃/进程死亡）
- `assembling → failed` 新增合法（reason=assembly）
- abort 允许任意状态（含 pending / assembling）
- 已完成 dispatch 的 artifact / log 保留；pending 状态已派发但未执行的 dispatch 标记 `orphan`

### 6.2 启动对账（startup reconciliation）

`§9.6` 第六轮收口。DSH 启动时 `TeamService.reconcileOnBoot()`：

```
扫描所有 .dsh/team-runs/*/meta.json
  for run with state in {assembling, running}:
    if run 持有进程不在（本 DSH 进程 / 已知 PID 都不在）：
      run.state = interrupted
      state-history.append({ from: state, to: interrupted, reason: process-killed })
      同步把 run 内所有 completed_at=null 的 dispatch:
        dispatch.terminal = interrupted
        dispatch-log append({ ...existing..., terminal: interrupted, terminal_at: now })
```

> 这是墓碑写入者的唯一答案（`§9.6`）——死进程写不了墓碑，DSH 启动时补上。

实现层：

- 监听 `host/boot` 事件（DSH 启动 hook）
- 只跑一次（plugin 单例）

### 6.3 interrupted 出口

`§9.6 / §9.12.4`：

- `interrupted` → 用户点击重跑 → 重新组队 → `running`
- `interrupted` → 用户放弃 → `aborted`
- **不**自动恢复、不收养孤儿进程（DSH 死=成员进程一并销毁，ACP session 在 adapter 内存中，重连不可能；产物保留在 run 目录可回看）

### 6.4 4 worker 上限

`§9.12.9`：活跃 Run 数量无产品层队列 / 拒绝规则；**并发上限为实现层约束，直接引用宿主限制**——ACP adapter 的 agent 执行线程池硬上限 = 4 个并发 worker。

DSH Team Service 在以下位置尊重此约束：

- fan-out N 路并行：物理并发 ≤4（5 路实际 4 并发 1 排队）
- join 超时留足排队余量，防"资源排队"误判为"成员死亡"（`§3.3`）
- 不写自造数字；需要时通过 Cordis Service 查询宿主 `acp_adapter/server.py:231` 暴露的 worker 数

---

## 7. UI 架构

### 7.1 Slot 注入

按 `§10.1 / B3`，常驻面板采用 Linear 风 app shell；**视觉细节（配色/字体/圆角/间距）留 UI backlog**（`§11.3`），本架构只规定**结构组件**与**Slot 注册点**。

**新加 Slot**（DSH Team 自己的 1.0 最小集合）：

| Slot 名 | 类型 | 内容 | 优先级 |
|---|---|---|---|
| `team-panel` | list | 常驻面板根组件 | 1（主面板）|
| `team-config` | keyed | Team / Role / Member 配置中心 | 2 |

注册方式：`@dsh/team` 的 `apply(ctx)` 内 `ctx.effect(() => slots.register('team-panel', { component: ... }))`，卸载自动清理（按 dsh-dual-plugin-guide "副作用必须可清理"原则）。

**复用 Slot**：

| Slot | 包 | 用途 |
|---|---|---|
| `client-ui-layout` | `@deepseek-ai/dsh-client-ui-layout` | app shell（顶栏 + 侧栏 + 主区 + footer）|
| `client-ui-conversation` | `@deepseek-ai/dsh-client-ui-conversation` | 主区 timeline（消息流）|
| `client-ui-sidebar` | `@deepseek-ai/dsh-client-ui-sidebar` | 侧栏（活跃 + 历史 Team）|
| `client-ui-tool` | `@deepseek-ai/dsh-client-ui-tool` | 工具调用呈现（dispatch / handoff 卡片）|
| `client-ui-user-questions` | `@deepseek-ai/dsh-client-ui-user-questions` | 决策点事件卡片（输入框 + action 三选 + 消息一体，`§9.12.7`）|
| `client-ui-plan` | `@deepseek-ai/dsh-client-ui-plan` | Plan 呈现（若 DSH 端有通用 plan UI）|

### 7.2 面板布局（mockups/panel-linear.html）

按 `§10.1`：

| 区域 | 内容 | 实现 Slot |
|---|---|---|
| 顶栏 | brand + Team 运行状态 pill | `client-ui-layout` |
| 左 sidebar | 活跃 Team + 历史 Team + 素材库入口 | `client-ui-sidebar` + `client-ui-team-panel` |
| 主区头 | Team 名 + flow 类型 + 团队操作按钮 | `client-ui-team-panel` |
| 主区成员栏 | chip 形式横向，状态点区分忙/闲 | `client-ui-team-member-chip` |
| 主区 timeline | 消息气泡 + handoff 卡片 + A2A 消息气泡 | `client-ui-conversation` + `client-ui-team-handoff-card` |
| 全局 footer | ACP / artifact / dispatch / message 计数 + 命令面板 | `client-ui-layout` |

### 7.3 事件流呈现

按 `§10.2`：

| 元素 | 视觉 | 实现 |
|---|---|---|
| @mention | 聊天气泡 + 左侧 mention 边（黄色）| `client-ui-conversation` |
| dispatch / handoff | 主区独立卡片 | `client-ui-team-handoff-card` |
| handoff 退回 | 同一卡片，红色变体 | `client-ui-team-handoff-redo` |
| A2A-style 消息 | 聊天气泡（无 mention 边）| `client-ui-conversation`（按 kind 区分）|
| **用户介入（决策点响应）** | **决策点事件卡片** | `client-ui-user-questions` + `client-ui-team-decision-badge` |
| in_reply_to 关系 | 一级虚线引导 | `client-ui-conversation` 自定义 |
| 决策点等待信号 | 状态 pill 上小角标 | `client-ui-team-decision-badge` |

**按 flow 自适应密度**（`§9.12.6`）：round-table 中 A2A 消息为主事件，timeline 主体就是它；pipeline / fan-out 中 A2A 是穿插。

### 7.4 决策点 UI（`§9.10.3 + §9.12`）

- 状态 pill 上**小角标**（`§9.12.2 D7-2`）：不是新 pill，不是高亮——匹配"决策点不是新状态"的机制
- 介入面板 = timeline 自然延续（`§9.12.3 D7-3`）：最后一条消息后出现"等待你的反馈"输入卡
- 侧栏活跃 Run 项显示决策点等待状态（`§9.12.1 D7-1`）——多 Team 多个决策点时"可扫一眼识别"
- 用户主动 ad-hoc 门：timeline 顶栏有"插入决策点"按钮（只在 running 期间可见，`flow_config.ad_hoc_decision_points=true` 才显示）——这是 UI 暴露介入时机的唯一入口，**不是**过程性介入按钮

### 7.5 多 Team 视图（`§9.12`）

- **侧栏上下同框** + 历史区默认折叠 "历史 (N)"；**不用 tab**（D7-5）
- 活跃 Run 列表项 = Team 名 + 状态 pill + 成员数 + 决策点小角标
- 历史 Run 列表项 = Team 名 + 终态 + 终态时间；点击 = 进入只读视图
- 重跑（`§9.12.4 D7-4`）= 复用 `members` + `flow_config` + 预填 `task_description`（可改）+ 启动前可勾选注入原 Run artifacts 为初始 `context_refs`

### 7.6 Slot 依赖与可发现性

- Panel 组件从 `TeamService` 订阅 runs / events；不直接持有状态，只渲染（单源真相 = `TeamService.runStore`）
- 决策点等待信号来源：`TeamService.decisionPoint.waitingDecisions()`（Service 方法）
- 历史 Run 列表：`TeamService.runStore.list({ state: terminal })`
- Team 配置中心通过 `RoleService` / `MemberService` / `TeamTemplateService` CRUD；编辑实时预览（`§12.1 A4`）

---

## 8. 失败处理（`§9.8`）

### 8.1 失败二分（`§9.8.2`）

```
失败检测
  ├── 运行失败（进程挂 / 超时 / 无产物）
  │   → 轻量重试（DSH 不参与）
  │   → 耗尽 → 上报 DSH 走 §9.8.3
  │
  └── 结果失败（有产物但判定不达标）
      → 按 flow 语义:
         pipeline → 走 feedback loop
         fan-out → 置 degraded flag, join 照常
         round-table → "无结果失败", 失败标准 = 不收敛（§9.9.6）
      → 耗尽 → 上报 DSH
```

### 8.2 循环失败（`§9.8.3`）

- `pipeline-with-feedback`：feedback loop 连续 `max_retries` 次失败 → 默认 `failed`
- DSH 可**插队一次**：重派 / 换人 → `running`；终止 → `failed`
- DSH 不响应 → 自然落 `failed`（无 N 步计数约束）
- `degraded` flag **不适用 pipeline**（顺序 flow 无"其他存活成员"概念）

### 8.3 degraded 修饰 flag（`§9.8.4`）

- 判定时点：flow 中途即可
- 判定规则：`≥1 非全部 Member 不可恢复`（可机器判定：进程挂 / 超时 / 重试耗尽）
- flag 置位后行为：
  - 不再向已死成员派发任务
  - 终态判定门槛放宽 → `succeeded(partial)` 标注参与 / 失败成员清单
  - 其余流程照常（join 照常 / analyzer 照跑）
- **全部挂 = failed**（不是 degraded）
- DSH 判定仅在"边界模糊"（如 Member 自评"任务不可能完成"）时启用

### 8.4 abort（`§9.8.1`）

- 独立终态（D1-1），与 failed 不合并
- 进入条件：用户显式触发，任意非终态（含 `pending` / `assembling` / `running` / `interrupted`）
- 进入动作：DSH 立即停止派发新 dispatch + 中断当前在跑 dispatch（标记 `terminal=interrupted`）；已完成 dispatch 产物保留
- **进程层被杀** = DSH 进程死亡（桌面客户端退出 / 崩溃）→ 归 `interrupted`，**不**归 `aborted`（D1-5 第六轮收口）；语义不可混淆
- `state-history` 必含 `aborted` 转换的 reason（形式待定，`§11.4 OQ-4`）

---

## 9. 成本纪律（`§9.13`）

`team-runner.cost-guard` 是独立服务，三道防线：

### 9.1 预飞行（`§3.3 P0-1① + §9.13 ①`）

- 触发：`fan-out-collect` 且 `parallel.length >= 3`（阈值 tunable，默认 3）
- 动作：在派发前**中断** dispatch 队列 → 弹窗给用户确认"将并行启动 N 个成员 agent + 预估成本 / 本轮上限"
- 用户 cancel → aborted（**不**是 failed）；用户 continue → 继续
- 弹窗通过 DSH 现有的"ask user" 通道；**不是新机制**

### 9.2 上限门（`§9.13 ③`）

- 触发：单 Run 触顶 `flow_config.cost_cap`（按轮次 / agent 分钟计；具体计费策略由 DSH 实现，本架构只规定 hook 点）
- 动作：开一个"续 / 停"决策点（`action: continue(续 N 轮) | complete | abort`）；用户失联 → 默认 abort 系
- **触顶不评 failed**（预算 ≠ 产品缺陷）

### 9.3 分流超时（`§9.10.4 + §9.13 ②`）

- 决策点等待超时按 flow 分流（`§9.10.4` 第七轮拍板 2）：
  - `round-table` → abort
  - `pipeline-with-feedback` / `fan-out-collect` → continue
- 与 9.1 预飞行 + 9.2 上限门三道防线，覆盖"无人值守"的每条路径，无死角

> Story 1 成本已由 `max_rounds`（默认 5）× 队形大小天然封顶——本节主要起兜底声明作用（`§9.13`）。

---

## 10. ACP 集成（`§6`）

### 10.1 Adapter 枚举（封闭，`§12.1 A3`）

| Adapter | 实现方式 | Provider 名称 |
|---|---|---|
| `hermes` | `hermes acp` 原生 stdio | `acp-hermes` |
| `mcode` | `mcode acp` 原生 stdio | `acp-mcode` |
| `claude-code` | `claude-agent-acp` 桥接 | `acp-claude-code` |

通过 subagent 的 named provider registry 注册（`@dsh/subagent` 已有此 seam，参考 `packages/subagent/subagent-acp`）：

```text
SubagentProvider('acp-hermes',        { exec: 'hermes',             args: ['acp'], schema: AcpSchema })
SubagentProvider('acp-mcode',         { exec: 'mcode',              args: ['acp'], schema: AcpSchema })
SubagentProvider('acp-claude-code',   { exec: 'claude-agent-acp',                     schema: AcpSchema })
```

`Role.adapter` 字段决定实例化时选哪个 provider；**用户不能新增 adapter**（J 决策）——需扩就改插件源码 + build。

> 架构上预留扩展性（`§6` §631）：`hermes / claude-code / mcode` 以及未来加入的 Adapter（如 `opencode`）都是平级条目。`opencode` 是预留扩展位，**1.0 不实现**（与 `requirements.md §6` 一致；`§631` 明确"未来加入"）。

### 10.2 Member 进程生命周期

```
Team Run 进入 running
  → TeamService 遍历 members
    → 对每个 member 调 subagent.startContinuable({ provider: <adapter>, persona, system, cwd })
      → subagent-acp 起 stdio 进程 → session/new
      → 返回 AgentHandle（acp-session-id）
  → MemberService 包装 AgentHandle，初始化 session-state.json
  → inbox 监听就位

dispatch 派单
  → subagent.followup({ handle, prompt: <task + context_refs 内容解析> })
  → acp session/prompt
  → 等 prompt response 或 acp event

Run 终态
  → 遍历所有 member session
  → subagent.drainContinuableDescendants([handle, ...])（@dsh/acp 已提供此 seam）
  → session-state.json 标 state=terminated
```

### 10.3 Context 注入

- DSH 派 dispatch 时把 `context_refs` 解析为 artifact 文件路径（按 `derived_from` 链展开）
- 注入到 acp `session/prompt` 的 prompt 文本（模板：`"请参考以下产物: <path1>\n<path2>\n\nTask: <task>"`）
- 大块产物只传路径，Member 按需读（Anthropic 经验，`§9.5`）

### 10.4 Self-handoff（`§9.3`）

- 阈值检测：由 acp session event 暴露 context length（acp 协议未硬性规定，各 adapter 实现差异——`packages/subagent/subagent-acp` 需做 adapter-specific 适配）
- 触发：成员进程自己写 `handoff-<n>.md` → acp `session/close` → `session/new` → `session/prompt`（按 H4 拼接：① member 人格 ② handoff 文档 ③ 原 task 指令）
- DSH 侧：`session-state.json` 记录 `session_chain` / `handoff_files` / `self_handoff_count`
- **成员直接落盘，不走协调日志**（`§2.4 / §9.3` 锁定）

---

## 11. 风险与开放项

### 11.1 风险

| 风险 | 缓解 |
|---|---|
| DSH 进程 = Run 持有者；多 DSH 进程并发 append 同一 jsonl = 1.0 不支持 | 单 DSH 进程单实例；2.0 加 FSLock 或中心化队列 |
| 4 worker 上限的物理并发约束 | fan-out N 路逻辑并行，物理排队；join 超时留足余量（`§3.3`）|
| 5 个协调日志的单写入者承诺 vs 实际多线程 | DSH Team Service 持 async mutex（FSLock 不必要，单进程内串行）|
| Member session 跨 Run 不累积（`Q-M1`）vs subagent 持续语义 | 每个新 Team Run = 一个全新 continuable subagent（不跨 Run 复用）|
| 启动对账的竞态（多个 DSH 进程同时启动）| 1.0 单实例；2.0 加 leader election |
| 4 worker 上限查询接口 | 通过 Cordis Service 暴露 `acp_adapter.server.workerPool.size`；DSH Team 启动时查询 + 运行时引用 |
| 决策点等待时 DSH 调度者被换 session | `handoff-hermes` 文档结构（`§4.4`）含决策点等待状态；新 session 接管继续 |
| Plan 生成跨轮记忆——`plan.derived_from` 取值域可能跨多个 Run | 引用式实现；需保证跨 Run 引用不被删除（`§5.6 引用锁`）|
| acp 协议 context length 暴露不一致 | 各 adapter（hermes / mcode / claude-agent-acp）实现差异；200k 阈值检测在 subagent-acp 层需做 adapter-specific 适配 |
| DSH handoff 期间 Run 长时间无调度者 | 成员 session 保活但无推进；UI 可加"无推进"暗示（`§4.4` 留 UI backlog）|

### 11.2 开放问题（继承 `requirements.md §11.4`）

- **OQ-1**：plan step intent 枚举值集（倾向 `produce | review | collect | synthesize | decide`，待拍）
- **OQ-2**：决策点等待默认 10 分钟是否写入产品默认值（倾向是）
- **OQ-3**：跨 Run artifact id 内 run 归属段编码格式（机制层锁定，具体格式 DSH 实现定）
- **OQ-4**：state-history 必含字段的准确措辞（用户落文档时定）
- **OQ-5**：`requirements.md §4` 重写的终稿措辞审校（第七轮已按收口清单对齐，待最终审）

### 11.3 后续讨论议题（`requirements.md §11.2 / §11.3` 留口）

- 其他 Flow 模式（除圆桌/流水线/扇出外）——用户提"可能还有其他场景后续再说"
- 暂停-恢复的 UI 暗示（机制不拍，UI 归属 DSH/UI 侧）——运行中 DSH 不在线时如何在 UI 上暗示"无推进"
- 视觉细节 backlog（配色 / 字体 / 圆角 / 间距 / 决策点角标颜色 / A2A 消息密度渲染）
- `read_only` 角色 + `orchestra_report` 通道（`§14.5 D8-1` 维持不做，等真实用户声音 / 合规审计需求）

---

## 12. 实现阶段（1.0 路线）

按 `requirements.md` 已闭环项 + 依赖关系排序：

| 阶段 | 范围 | 关键依赖 | 验收口径（`§19` 配套）|
|---|---|---|---|
| **P0 骨架** | `dsh-team-plugin` 包结构 + 实体 + 状态机 + 启动对账 + `start-team` skill + 最小 panel slot + 1 个 Member（hermes acp）| DSH 仓 + `subagent-acp` + `skill` | Story 1（简化：固定 members，无收敛门，无 plan）能跑通——3 成员讨论得出最终回包 |
| **P1 完整 Story 1** | `handoff-round-table` flow + 收敛门 + 兜底门 + 用户门 + `user-intervention-log` + 决策点 UI 卡片 + degraded flag | P0 | Story 1 全过；DSH handoff 中断-接管能恢复 |
| **P2 Story 2** | `pipeline-with-feedback` flow + handoff-log + DSH-routing 路由占位 + feedback loop | P0 + `§2.5 P2-1` | Story 2 全过；handoff 退回红色变体 |
| **P3 Story 3** | `fan-out-collect` flow + 预飞行确认 + aggregator 派发 + 并发 ≤4 | P0 | Story 3 全过；3+ 路 fan-out 弹预飞行确认 |
| **P4 Plan + Artifact** | `PlanService` + artifact 不可变快照 + 跨 Run 引用 + plan UI 渲染 | P0/P1 | `plan_output=true` 时 DSH 写 plan；软参考 + 留痕 |
| **P5 多 Team + 历史** | 多 Run 索引 + 侧栏 + 历史 Run 只读视图 + 重跑注入原 artifacts | P0 | 2 个 Run 同时跑；侧栏角标 + 历史折叠 |
| **P6 成本纪律** | 预飞行 / 上限门 / 分流超时 三道防线 | P3 + P4 | fan-out ≥3 弹预飞行；`cost_cap` 触顶开决策点 |
| **P7 失败处理** | abort / interrupted / dispatch 终态三态化 / 启动对账 | P0 | abort 任意非终态进入；DSH 崩溃下次启动对账标 interrupted |
| **P8 全 Adapter** | mcode + claude-code adapter（provider 注册）| P0 | 三 Adapter 全部跑通；成员可混搭 |

**Story 验收**（`§19.5`，六轮收口）：

- **Story 1** = 完整流程（建队→讨论→决策点→用户确认→收尾）+ 失败路径三项（abort 重开 / DSH 崩溃对账 / 组装失败重跑）；通过 = 全流程无人工剧本外介入走完
- **Story 2** = 完整口径含 fan-out / degraded flag / 循环插队走通 + 失败路径两项（成员挂→degraded→partial / 步骤失败→DSH 介入点）；通过 = 一条 pipeline 完整走通 + 两条失败路径各触发一次

> Story 1/2 是两种产品形貌，均属 1.0 支柱（用户已拍板不降级，`§19.4 C`）——**两端都跑通**才算 v1 闭环。

---

## 13. 不做什么（显式非目标）

继承 `requirements.md §11.3 + §9.7 / §9.11.6 / §12.1 / §12.2 B4 + 第七轮拍板的非目标：

- ❌ **过程性手动介入**（V 决策）：Team 启动后无"任意时刻手动介入"；只 abort + 决策点响应 + ad-hoc 门
- ❌ **`paused` 状态**（`§9.7 + D2-1`）：由 DSH handoff 隐式覆盖
- ❌ **`read_only` 角色** + `orchestra_report` 通道（`§14.5 D8-1` 维持不做）
- ❌ **外部 A2A 协议**暴露（`§4.2 Q-M3`）：保持核心优势（Member 各自 LLM），不要求 Adapter 实现 A2A endpoint
- ❌ **`opencode` Adapter 1.0 实现**（`§6`）：架构上预留扩展位，1.0 仅 `hermes / claude-code / mcode` 三个
- ❌ **persona 模板库**（A2）："先不用，到时候再说"
- ❌ **AI 生成 / 上传 avatar**（A6 + M, N）：仅默认几何
- ❌ **artifact 自动清理**（`§9.11.6`）：1.0 不实现
- ❌ **插件层排队 / Run 数限制**（`§9.12.9`）：并发上限直接引用宿主
- ❌ **真实隔离（沙箱 / 权限 / 独立目录挂载）**：信任域 `§5.3 P1-2` 现状承诺；1.0 不承诺
- ❌ **plan 按需导出 / summary 机制**独立化（`§9.9.1 D4-1`）：后续想要 = 重跑注入旧产物

---

## 14. 实现侧 checklist（开发前对齐用）

- [ ] 与 `requirements.md §8` 30+ 决策逐项对位，确认无遗漏
- [ ] `package.json` 与 DSH 仓内 `subagent` / `skill` / `session` / `storage` / `acp` / `web` 对齐 peer deps
- [ ] `start-team` skill 的 `SKILL.md` frontmatter 必含 `name` + `description` + `whenToUse`
- [ ] `lib/index.js` 的 `inject: ['skills', 'subagents', 'slots', 'storage']`（硬依赖）；其他用 `ctx.get()` + undefined 检查
- [ ] Slot 注册用 `ctx.effect(() => slots.register(...))`——卸载自动清理
- [ ] 5 个协调日志写入路径全部走 Service（单写入者承诺 `§2.4`）
- [ ] 状态机转换前**先**写 `state-history`，再更新 `meta.json`
- [ ] abort / interrupted / failed 状态转换 reason 必填
- [ ] dispatch 终态三态化（`completed | failed | interrupted`）
- [ ] 启动对账在 `host/boot` 事件上注册（只跑一次）
- [ ] 决策点等待按 flow 分流超时（round-table→abort，pipeline/fan-out→continue）
- [ ] 物理并发 ≤4（直接引用 `acp_adapter/server.py:231` 的 `ThreadPoolExecutor`）
- [ ] 预飞行确认走现有"ask user"通道（不新造）
- [ ] 验证：`pnpm build` + 启动 dsh → `dsh plugin list` 看到 `team` → 跑通 P0 骨架场景
- [ ] `npm pack --dry-run` 确认发布内容含 `lib/` / `skills/` / `cordis.patch.yml` / `plugin.json`（如适用）

---

## 15. 一句话总结

DSH Team 是以**静态双格式 Cordis 插件**形态交付的、组合 `@dsh/subagent-acp` + `@dsh/skill` + `@dsh/client-ui-*` 等现有 DSH 能力的**协作调度层 + Linear 风 UI 层**；每 Member 一个独立 ACP 进程（各自不同 LLM）= 核心优势保留；五条协调日志 append-only + 单写入者=DSH；Adapter 集合封闭（首批 3 个 + opencode 预留）；UI 不暴露过程性介入，只暴露 abort + 决策点 + ad-hoc 门；Story 1/2/3 三 flow 1.0 全部支柱，验收口径跑通。

---

## 附录 A：DSH Team Service 完整接口清单

```ts
// ========== 核心 Service ==========
interface TeamService {
  start(req: StartTeamRunRequest): Promise<TeamRun>;
  abort(runId: string, reason: string): Promise<void>;
  rerun(runId: string, opts: RerunOptions): Promise<TeamRun>;
  list(opts?: ListOptions): TeamRun[];
  get(runId: string): TeamRun | undefined;
  reconcileOnBoot(): Promise<{ interrupted: string[] }>;
}

interface MemberService {
  createMember(input: NewMember): Member;
  updateMember(memberId: string, patch: Partial<Member>): Member;
  deleteMember(memberId: string): void;
  joinRun(runId: string, memberId: string): Promise<SubagentHandle>;
  wake(memberId: string, hint: WakeHint): void;
  dispatch(memberId: string, payload: DispatchPayload): Promise<DispatchReceipt>;
  sendMessage(fromMemberId: string, msg: A2AMessage): void;
  triggerSelfHandoff(memberId: string, reason: 'context-overflow'): Promise<void>;
  leaveRun(runId: string, memberId: string): Promise<void>;
}

interface DispatchService {
  dispatch(req: { runId, from: 'scheduler', to: MemberId, task, contextRefs }): DispatchLogEntry;
  handoff(req: { runId, from: MemberId, to: MemberId | 'DSH-routing', task, artifacts, reason }): HandoffLogEntry;
}

interface MessageService {
  send(req: { runId, from: MemberId, to: MemberId | 'broadcast', topic, intent, payload, inReplyTo? }): A2AMessageLogEntry;
}

interface DecisionPointService {
  open(req: OpenDecisionPointRequest): DecisionPoint;
  respond(dpId: string, response: DecisionPointResponse): void;
  waitingDecisions(runId?: string): DecisionPoint[];
}

interface PlanService {
  generate(req: GeneratePlanRequest): PlanArtifact;
  get(planId: string): PlanArtifact | undefined;
  list(runId: string): PlanArtifact[];
}

interface ArtifactRegistry {
  register(artifact: Artifact): void;
  resolve(ref: ArtifactRef): Artifact | undefined;
  get(id: string): Artifact | undefined;
  list(runId: string): Artifact[];
  // 引用计数 + 锁存
  refCount(id: string): number;
  canDelete(id: string): boolean;
}

interface LogWriter {
  append(log: 'dispatch-log' | 'handoff-log' | 'a2a-message-log' | 'user-intervention-log' | 'state-history', runId: string, entry: object): void;
}

// ========== 实体 Service（素材库）==========
interface RoleService { create / update / delete / list / get }
interface MemberCRUDService { create / update / delete / list / get }
interface TeamTemplateService { create / update / delete / list / get }

// ========== 流程 Service ==========
interface FlowEngine {
  run(runId: string): Promise<void>;
  // 内部 case：RoundTableFlow / PipelineFlow / FanOutFlow
}
```

## 附录 B：DSH Team 关键事件清单

| 事件 | 来源 | 监听 / 发出 | 用途 |
|---|---|---|---|
| `host/boot` | DSH host | **监听** | 触发 `TeamService.reconcileOnBoot` |
| `host/shutdown` | DSH host | **监听** | 标记活跃 Run 为 interrupted 候选（由下次启动对账）|
| `subagent/agent-start` | `@dsh/subagent` | 监听 | Member session 生命周期（写 session-state.json）|
| `subagent/agent-end` | `@dsh/subagent` | 监听 | 同上 |
| `subagent/child-message` | `@dsh/subagent` | 监听 | 收集 A2A 消息 |
| `subagent/fork` / `subagent/spawn` | `@dsh/subagent` | 监听 | 防止 Member 内部 fork（深度控制）|
| `tool/before-call` / `tool/after-call` | DSH 工具系统 | 监听 | 拦截 `team.*` 工具调用 |
| `team/run-state-change` | DSH Team 自定义 | **发出** | 状态机变更通知（写 state-history.jsonl + 通知 UI）|
| `team/decision-point-open` | DSH Team 自定义 | 发出 | 决策点开启通知（侧栏 + 状态 pill 角标）|
| `team/decision-point-respond` | DSH Team 自定义 | 发出 | 用户响应通知（写 user-intervention-log）|
| `team/member-send-message` | DSH Team 自定义 | 发出 | Member A2A 消息通知 |
| `team/degraded` | DSH Team 自定义 | 发出 | degraded flag 置位通知 |
| `team/artifact-produced` | DSH Team 自定义 | 发出 | artifact 产出通知（写 artifact registry + 反向追溯更新）|
| `team/run-started` / `team/run-ended` | DSH Team 自定义 | 发出 | Run 生命周期对（侧栏活跃列表订阅）|

> 自定义事件 mode 默认为 `emit`（广播）；如有依赖关系需短路则查 `dsh-dual-plugin-guide/references/events-hooks.md` 81 个事件清单。

## 附录 C：与现有 DSH 子系统关系总结

| 子系统 | DSH Team 是否依赖 | 说明 |
|---|---|---|
| `subagent` + `subagent-acp` | **强依赖** | Member 的实现路径（§4.2 / §10）|
| `workflow` | 可选 | 1.0 不依赖；2.0 可包装 Team Run |
| `skill` | **依赖** | skill 入口（§1.2）|
| `plan-mode` | **不依赖** | DSH Team 自建 PlanService（§4.6）|
| `user-questions` | 复用 | 决策点 UI（§4.5）|
| `goal` | **不依赖** | DSH Team 自有状态机（§4.1）|
| `jobs` | 可选 | 1.0 不依赖 |
| `session-persistence` | 通过 subagent 间接依赖 | Member session 持久化 |
| `client-ui-*` | **依赖** | 常驻面板 Slot（§7）|

---

> 文档完。实现方开工前先读本架构 + `requirements.md` §2 / §5 / §9 三节；任何与 `requirements.md` 冲突的描述以 `requirements.md` 为准（本文件是实现侧，不是产品再讨论）。
