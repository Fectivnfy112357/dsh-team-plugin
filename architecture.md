# DSH Team 插件 — 实现架构

> **状态**：2026-08-19 起稿。配套 [requirements.md](./requirements.md)（v1 + 七轮审阅收口）与 [discussion-log.md](./discussion-log.md)。本文是**设计意图层**——只描述"在 DSH 仓内怎么落"的方向、模块切分、状态机、关键接口对位与实现阶段。本仓 AGENTS.md 明确不写可执行代码,代码归 DSH 仓。
>
> 写作边界:
> - ✅ 模块划分、状态机、关键接口对位、组件关系、生命周期、数据形态、并发边界、不做什么
> - ❌ 具体 TypeScript / Python 代码、API 端点、文件路径、数据库 schema、ORM / async 模型

---

## 0. 位置与形态

DSH Team 是 **DSH 仓内一等公民插件**(`packages/team` 级别),与 `skill` / `host` / `subagent` / `session` / `acp` / `web` 平级。它**不是** dsh-dual-plugin-guide 那种"独立可分发 .zip 插件包"——它涉及 DSH 内核多个能力面(skill 注册、subagent provider、Slot 注入、事件订阅、session 复用),必须以 monorepo 一等公民实现才能正确对接。

但其**入口(Team 启动 skill)按 Agent Plugins 1.0 双格式**打包,可经 `dsh plugin --profile add` 安装到 DSH 实例——具体打包方式由 `cordis.bundle.patch` 在 build 阶段注入到 `lib/index.js`。详见 §1.3 / §13。

---

## 1. 整体架构

### 1.1 模块分层

```
┌────────────────────────────────────────────────────────────┐
│ DSH 客户端 (web)                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Team Panel  (Slot 注入,§7)                          │  │
│  │  ├─ Sidebar    (active/historical teams, 状态 pill)   │  │
│  │  ├─ Header     (Team 名 + flow + 操作按钮)            │  │
│  │  ├─ Member row (chip 形式, 状态点)                   │  │
│  │  ├─ Timeline   (dispatch / handoff / a2a / 决策点)  │  │
│  │  └─ Footer     (计数 + 命令面板)                     │  │
│  └────────────────────────────────────────────────────┘  │
└────────┬───────────────────────────────────────────────────┘
         │ ctx 事件 / 服务调用
         ▼
┌────────────────────────────────────────────────────────────┐
│ packages/team (本插件)                                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Service Layer                                      │  │
│  │   ├─ team-registry  (Role/Member 素材库)            │  │
│  │   ├─ team-runner    (Team Run 生命周期 + 状态机)    │  │
│  │   ├─ dispatcher     (DSH 派单 + 协调日志)           │  │
│  │   ├─ a2a-router     (Member↔Member 消息代理)        │  │
│  │   ├─ artifact-store (artifact 文件 + 引用关系)      │  │
│  │   ├─ decision-pt    (决策点 / 用户介入 / 持久化)     │  │
│  │   ├─ plan-engine    (DSH 生成 plan, 软参考)         │  │
│  │   └─ cost-guard     (预飞行 / 上限门 / 分流超时)     │  │
│  │  Storage Adapter (jsonl append-only + 文件快照)     │  │
│  │  Slot 注入 (Team Panel 配置中心 + 常驻面板)         │  │
│  │  Skill 注入 (team skill + handoff-hermes 复用)      │  │
│  └────────────────────────────────────────────────────┘  │
└────────┬───────────────────────────────────────────────────┘
         │
         │  ┌─────── 复用 ───────┐
         ├──┤ @dsh/subagent     │  Named provider registry(acp / in-process / fork)
         ├──┤ @dsh/session      │  SessionId / Turn / Persistence 复用
         ├──┤ @dsh/storage      │  Domain + JSON 适配
         ├──┤ @dsh/skill        │  多 provider skill 注册
         ├──┤ @dsh/host         │  apiproxy + webserver 暴露
         ├──┤ @dsh/web          │  Client Slot 注册点
         └──┤ @dsh/acp          │  stdio JSON-RPC 客户端实现
```

**关键设计选择**:Team 不"重新发明" subagent / session / skill——它**组合**现有能力,只补 Team Run / dispatch / handoff / a2a / plan / decision 这层**协作调度**能力,以及 Linear 风 UI 层。

### 1.2 信任边界与写入者

按 requirements §2.4 / §5.3 锁定:

- **5 个协调日志(append-only jsonl)** 的**唯一写入者 = DSH**:
  - `dispatch-log.jsonl`
  - `handoff-log.jsonl`
  - `a2a-message-log.jsonl`
  - `user-intervention-log.jsonl`
  - `state-history.jsonl`
- **成员可写自己的**:artifacts + self-handoff 文档(`sessions/<member-id>/artifacts/`、`sessions/<member-id>/handoff-<n>.md`)
- **成员可读项目内全部文件**(同信任域,1.0 不做沙箱)

边界在 Service Layer 用"writer injection" 模式实现——所有写协调日志的路径必须经过 `dispatcher.write()` / `handoff-writer.write()` 等**有显式身份的函数**,普通 Member 写入路径不暴露这些函数。

### 1.3 入口形态

- **Skill(双触发)**: `team` skill,`/start-team <task>` + 自然语言"帮我组建团队做 X",由 `team-runner.start({ task })` 实际触发;**skill 是 thin wrapper**(P 决策,核心能力不在 skill 内)
- **Plugin Tool**: DSH 通过 `harness.defineTool` 暴露 `team_start` / `team_abort` / `team_inject_feedback` 等工具,供 agent 直接调用(不依赖 skill)
- **UI**: 启动入口不在 UI(§4 / B1');UI 是**配置中心 + 常驻面板**,只展示运行中的 Team,不暴露启动按钮

Skill 打包方式: `team/SKILL.md` 是内容唯一源,`team/lib/index.js` 启动时读文件并经 `ctx.skills.register({ source: 'runtime' })` 注册(参考 dsh-dual-plugin-guide `apply` 模板)。Agent Plugins 1.0 兼容由 build 阶段在 `package.json` 加 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 注入。

---

## 2. 关键模块(对应 requirements §2 概念)

| 需求层概念 | 落地模块 | 关键职责 | 依赖 DSH 包 |
|---|---|---|---|
| Role(§2.1) | `team-registry.role-store` | 角色模板 CRUD;adapter 枚举封闭 | `storage-domain`(role entity) |
| Member(§2.2) | `team-registry.member-store` | 成员 CRUD;metadata 持久化;删除前引用检查 | `storage-domain`(member entity) |
| Team Template(§2.3) | `team-registry.template-store` | Team 模板 CRUD;runtime 拼队结果可一键保存 | `storage-domain`(template entity) |
| Team Run(§2.3) | `team-runner.run-store` + `state-machine` | Team Run 生命周期 + 状态机 + 拼队 | `storage-domain`(run entity) + `subagent` |
| Dispatch(§2.4) | `dispatcher` | 派单 + `dispatch-log.jsonl` 写入 + dispatch 终态 | `subagent`(continuable) + `acp` |
| Handoff(§2.5) | `handoff-writer` | 结构化移交;`handoff-log.jsonl`;`to=DSH-routing` 路由占位 | `dispatcher`(派下一棒) |
| A2A Message(§2.6) | `a2a-router` | 成员消息代理 + inbox 投递 + 唤醒 + 唤醒去重 | `subagent`(turn/followup) |
| Artifact(§2.7) | `artifact-store` | 文件存储 + 引用关系 + 不可变快照 | `storage`(file/jsonl) |
| Member Session(§2.2) | `session-proxy` | 包装 subagent 的 continuable child,管 self-handoff 链 | `subagent` + `session` |
| Plan(§9.9) | `plan-engine` | DSH 生成 plan;steps 索引;软参考;收敛锚点 | `artifact-store` + `a2a-router`(读收敛点) |
| Decision Point(§9.10) | `decision-pt` | 决策点开点 + 等待 + 响应注入 + 持久化 | `team-runner`(状态机) + `web`(UI 卡片) |
| Cost Guard(§9.13) | `cost-guard` | 预飞行确认 + 上限门 + 分流超时 | `team-runner`(flow hook) |

---

## 3. 数据形态

按 requirements §5 锁定,本节说明落地要点。**具体文件路径 / ORM / 数据库由 DSH 实现决定**。

### 3.1 实体类型(storage-domain)

| Entity | 关键字段(参考 §5.2) | 持久化位置 | 删除规则 |
|---|---|---|---|
| `Role` | id, display_name, persona, adapter(enum), cli_options, tools_allowed, avatar | 全局素材库 | 无引用检查(成员快照挂原 role 引用) |
| `Member` | id, role_id, display_name, persona, cli_options_override, metadata | 全局素材库 | 引用检查:被 team-templates / 在跑 run 引用 = 拒绝 |
| `TeamTemplate` | id, name, flow, flow_config, members(members 引用 + instance_alias) | 全局或项目级 | 引用检查:被 team-template 嵌套引用 / in-flight run 引用 = 拒绝 |
| `TeamRun` | id, state, degraded_flag, flow, flow_config, members(含 member_snapshot), task_description, current_round, created/started/ended_at | 项目级(`.dsh/team-runs/<run-id>/`) | 终态后归档(archived 软关闭);物理清理 = 引用检查 |

### 3.2 协调日志(append-only jsonl,单写入者=DSH)

| 文件 | 行 schema | 触发源 |
|---|---|---|
| `dispatch-log.jsonl` | {id, from, to, task, context_refs, issued_at, completed_at, produced_artifact_ids, run_id, seq, terminal?: completed\|failed\|interrupted} | `dispatcher` 派单 + 终态标记 |
| `handoff-log.jsonl` | {id, from, to(member\|DSH-routing), task, artifacts[], context, reason, run_id, seq, timestamp} | `handoff-writer`(DSH 代理 member→member 移交) |
| `a2a-message-log.jsonl` | {id, from, to(member\|broadcast), topic, intent, payload, in_reply_to, timestamp, delivered_to_inbox_at, kind: message\|system-wake} | `a2a-router` 转发 + wake 事件 |
| `user-intervention-log.jsonl` | {id, decision_point_id, user_message, action: continue\|complete\|abort, timestamp, is_ad_hoc} | `decision-pt` 接收响应 |
| `state-history.jsonl` | {from_state, to_state, reason, timestamp} | `team-runner.state-machine` 转换 |

**关键约束**:成员进程**不**持有这些文件的写句柄;写由 DSH 进程经 `team-runner` / `dispatcher` / `handoff-writer` / `a2a-router` / `decision-pt` 集中发出。多进程并发 append 同一 jsonl = 加文件锁 / 串行队列(实现细节)。

### 3.3 Member session 状态

`sessions/<member-id>/session-state.json`:

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

由 `session-proxy` 维护(在 subagent 提供的 AgentHandle 之上),与 DSH session 模型解耦——DSH session 是用户前台,Member session 是 Team Run 内的子 agent session。

### 3.4 Artifact 存储

- **位置**:Team Run 实例下,`sessions/<member-id>/artifacts/<artifact-id>.<ext>`,`plan` 类型例外:在 Team Run 顶层(`team-runs/<run-id>/plans/`)
- **元数据**:`artifacts/<id>.meta.json`(与文件同目录,便于按目录扫描),记录 `produced_by` / `produced_in_dispatch` / `produced_in_session` / `derived_from` / `type` / `created_at`
- **不可变快照**:重跑 → 新 id;原文件保留;同源链 `derived_from`
- **跨 Run 引用**:id 带 run 归属段 `<run-id>/<artifact-id>`,**引用式不复制**
- **删除保护**:`derived_from` 计数 + 跨 Run 反向引用计数,被引用 = 拒绝(§9.11.3)

---

## 4. 状态机

### 4.1 Team Run 状态机(§2.3 + 第六轮收口)

```
                            ┌──────────────┐
                            │   pending     │
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
                │           │ + degraded?  │      │          │
                │           └─┬──┬──┬──┬─┘      └──────────┘
                │             │  │  │  │
                │ 收敛/兜底    │  │  │  │ 自然达成     全部成员
                │ 门 + 用户    │  │  │  │ (round-     不可恢复
                │ 确认         │  │  │  │  table 必)  (DSH 判定)
                │             │  │  │  ▼             ▼
                │             │  │  │ succeeded  ┌──────────┐
                │             │  │  │ (partial?)  │  failed  │
                │             │  │  │             └──────────┘
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

**关键实现点**:

- `degraded` **不是状态**,是 `running` 状态上的修饰 flag(`meta.json.degraded_flag` + `state-history.jsonl` 记录置位时刻)
- 状态转换触发器在 `team-runner.state-machine`(`onTransition(from, to, ctx)`);转换前**先写 state-history**,再更新 `meta.json`——确保审计可重放
- `assembling → failed` 出口存在,但**禁止断点续跑**(requirements §2.3 收口,留 2.0);失败时复用素材 + plan 可重跑组装
- `interrupted` 仅由**启动对账**(§9.6)标记——DSH 启动时扫描所有 `state=running` 的 run,持有进程不在 = 标记 interrupted,reason=`process-killed`;同步把 in-flight dispatch 标记 `terminal=interrupted` + 同步 `dispatch-interrupted` 到 `state-history`

### 4.2 Dispatch 状态机(§9.8.5)

```
pending → running → {completed | failed | interrupted}
                       ↑             ↑              ↑
                  自然完成     运行失败/结果失败   被 abort 打断
```

- 三态枚举直接落到 `dispatch-log.jsonl` 的 `terminal` 字段(顶层,非嵌套)——便于扫描
- `interrupted` 与 `failed` 必须区分(§9.8.1 D1-6):前者是"被中止",后者是"自然失败",审计/可观察性不同
- 半成品 artifact 保留(不可变快照,§9.11.4),重跑注入可被 DSH 注入到新 dispatch

### 4.3 Member 状态机(§9.2 + §9.3)

```
idle ↔ working → failed (终端,dispatch 失败会上报 DSH 走 §9.8.2/§9.8.3)
        ↓
     (context > 200k token) → self-handoff(不重建 session,链式续接)
```

- session **不重建**直到 Run 终态(§9.2 + §13.3 Run-2)
- self-handoff 触发时:**成员自己**写 `handoff-<n>.md` → `session/close` → `session/new` → `session/prompt`(按 H4 拼接)→ `session_chain` 追加;**不**走协调日志(§2.4 / §9.3 锁定:成员直接落盘)
- 200k token 阈值检测 = 成员进程内部能力(acp session event 暴露 context length);DSH 仅在 `session-state.json` 记录 handoff_count,不做拦截

---

## 5. 三种 Flow 的实现路径

每个 flow 是 `team-runner` 内部的一个 **flow strategy**(策略对象),`flow_config` 决定参数;新 flow 可通过实现 strategy 接口加(§11.2 留口"其他 Flow 模式后续")。

### 5.1 handoff-round-table(Story 1)

**核心循环**(`team-runner.flow.round-table.run(runCtx)`):

```
state = running
rounds = 0
while rounds < max_rounds:
  轮次边界:
    dsh 扫描 a2a-message-log + dispatch-log,检收敛候选
    if 收敛候选命中 → 开收敛门(决策点) → 走 §9.9.6 三态判定
    rounds++
  向当前全部成员逐一发送发言邀请(sequential prompt 队列)
  等待全员回包(超时按 flow 分流)
  把回包 / A2A 消息写入 a2a-message-log
  检 max_rounds → 兜底门
if 用户确认 complete → succeeded (user-intervention-log 锚)
if abort → aborted
```

**关键点**:

- **扫过制**(§3.1):轮次边界是机制可判定(邀请-回包),不依赖 DSH 判断内容
- **决策点开点** = [收敛门 / 兜底门 / 用户 ad-hoc 门] 三合一,零 DSH 裁量(§9.10.1,第七轮拍板 1);`flow_config.decision_points[]` 控制哪个门向用户开放
- 缺席成员 = 标记但不阻塞;"轮"=邀请-回包对数,不依赖"全员发言"
- 物理并发 ≤4(§9.12.9):轮中"全员逐一"是顺序遍历,4 worker pool 不被 fan-out 占据
- `succeeded(round-table)` 唯一入口 = 用户在决策点确认(§9.9.6);DSH 判定不直接落 succeeded

### 5.2 pipeline-with-feedback(Story 2)

**核心循环**:

```
state = running
for step in steps:
  target = step.member
  dsh 派 dispatch(target, task=step.task, context_refs=inject(step))
  等待 target 终态(complete / fail)
  if complete:
    收集 produced_artifact_ids → 写 dispatch-log
    target 走 handoff(到下一棒 to=DSH-routing,§3.2/§2.5 P2-1)
    dsh 查 plan → 派下一个 step
  if fail:
    if retry < step.max_retries:
      retry++
      重派同 target + feedback(从 handoff 携带的"需修改清单")
    else:
      # 默认 failed;dsh 可插队一次
      if dsh 没有插队决策(超时)→ failed
      if dsh 重派/换人 → state=running(继续循环)
      if dsh terminate → failed
```

**关键点**:

- **顺序强制在 DSH 侧**(§3.2,第六轮收口):成员 handoff 写 "完成 step N" 不点名下一棒,`to=DSH-routing` 路由占位;DSH 查 plan 后派单
- 成员发起的移交**不污染 dispatch-log**(§2.5 P2-1 第七轮收口):成员→DSH-routing 落 handoff-log,DSH→具体成员 落 dispatch-log
- feedback loop 用 `flow_config.feedback_loops: { "step_i → step_j": { max_retries } }` 配置
- pipeline 决策点**默认关**;若 `flow_config.decision_points[]` 显式开启 → 等待按 §9.10.4 分流超时(→ continue)

### 5.3 fan-out-collect(Story 3)

**核心循环**:

```
state = running
  # 预飞行确认(§9.13 ①,§3.3 P0-1①)
  if len(parallel) >= 3:
    向用户确认"将并行启动 N 个成员 agent + 预估成本/本轮上限"
    用户 cancel → aborted;continue → 继续

  # 派发(逻辑并行,物理 ≤4)
  dispatch 队列 = [d for d in parallel]  # 物理并发 = 4 worker pool
  await Promise.allSettled(dispatch 队列)

  # 收尾:join by DSH(幂等派发,§3.3 第六轮收口)
  completed_members = [d for d in dispatch if d.terminal == completed]
  failed_members = [d for d in dispatch if d.terminal == failed]
  if failed_members:
    meta.degraded_flag = true   # 部分失败置 flag,不全挂不进 failed
    state-history 记录置位
  # 派发 aggregator(若配置)
  if aggregator:
    dispatch aggregator(participants=completed_members, artifacts=their_artifacts)
    await aggregator terminal

  if subsequent_steps: 走 pipeline 风格继续
  if 全部完成 → succeeded (partial? 看 degraded_flag)
  if 全部失败 → failed
```

**关键点**:

- N 路并行是**逻辑并行**;物理并发 = ACP adapter 的 4 worker 上限(§9.12.9 引用 `acp_adapter/server.py` 行 231);5+ 路时 4 并发 N-4 排队
- **join 由 DSH 判定一次性派发**(第六轮):`handoff to=DSH-routing` 模式,成员各自 handoff 给 aggregator 的写法**不采用**——会重复触发汇总
- **完成定义** = 显式 complete + 产物/引用存在;显式空结果("查无资料")= complete;沉默死亡 = 视为 failed
- join 超时留足排队余量,防"资源排队"误判为"成员死亡"
- aggregator 派单带 `context_refs = completed_members.artifacts` 一次性注入

---

## 6. ACP 集成(§6)

### 6.1 Adapter 枚举(封闭,§12.1 A3)

| Adapter | 实现方式 | Provider 名称 |
|---|---|---|
| `hermes` | `hermes acp` 原生 stdio | `acp-hermes` |
| `mcode` | `mcode acp` 原生 stdio | `acp-mcode` |
| `claude-code` | `claude-agent-acp` 桥接 | `acp-claude-code` |

通过 subagent 的 named provider registry 注册(`@dsh/subagent` 已有此 seam,参考 `packages/subagent/subagent-acp`):

```text
SubagentProvider('acp-hermes', { exec: 'hermes', args: ['acp'], schema: AcpSchema })
SubagentProvider('acp-mcode', { exec: 'mcode', args: ['acp'], schema: AcpSchema })
SubagentProvider('acp-claude-code', { exec: 'claude-agent-acp', schema: AcpSchema })
```

`Role.adapter` 字段决定实例化时选哪个 provider;**用户不能新增 adapter**(J 决策)——需扩就改 `team` 包源码 + build。

### 6.2 Member 进程生命周期

```
Team Run 进入 running
  → team-runner 遍历 members
    → 对每个 member 调 subagent.startContinuable({ provider: <adapter>, persona, system, cwd })
      → subagent-acp 起 stdio 进程 → session/new
      → 返回 AgentHandle(acp-session-id)
  → session-proxy 包装 AgentHandle,初始化 session-state.json
  → inbox 监听就位

dispatch 派单
  → subagent.followup({ handle, prompt: <task + context_refs 内容解析> })
  → acp session/prompt
  → 等 prompt response 或 acp event

Run 终态
  → 遍历所有 member session
  → subagent.drainContinuableDescendants([handle, ...])(@dsh/acp 已提供此 seam)
  → session-state.json 标 state=terminated
```

### 6.3 Context 注入

- DSH 派 dispatch 时把 `context_refs` 解析为 artifact 文件路径(按 `derived_from` 链展开)
- 注入到 acp `session/prompt` 的 prompt 文本(模板:`"请参考以下产物: <path1>\n<path2>\n\nTask: <task>"`)
- 大块产物只传路径,Member 按需读(Anthropic 经验,§9.5)

### 6.4 Self-handoff(§9.3)

- 阈值检测:由 acp session event 暴露 context length(acp 协议未硬性规定,各 adapter 实现差异——`packages/subagent/subagent-acp` 需做 adapter-specific 适配)
- 触发:成员进程自己写 `handoff-<n>.md` → acp `session/close` → `session/new` → `session/prompt`(按 H4 拼接:①member 人格 ②handoff 文档 ③原 task 指令)
- DSH 侧:`session-state.json` 记录 `session_chain` / `handoff_files` / `self_handoff_count`
- **成员直接落盘,不走协调日志**(§2.4 / §9.3 锁定)

---

## 7. UI 集成(§10)

### 7.1 Slot 注入

按 requirements §10.1 / B3,常驻面板采用 Linear 风 app shell;**视觉细节(配色/字体/圆角/间距)留 UI backlog**(§11.3),本架构只规定**结构组件**与**Slot 注册点**。

`@dsh/web` 暴露 Client Slot 体系;Team 插件注册两个 slot:

| Slot 名 | 类型 | 内容 | 优先级 |
|---|---|---|---|
| `team-panel` | list(slot 列表) | 常驻面板根组件 | 1(主面板) |
| `team-config` | keyed | Team / Role / Member 配置中心(键盘快捷 / 命令面板入口) | 2 |

注册方式: 参考 `packages/host/frontend-static` 等已有 slot 模式——`@dsh/team` 的 `apply(ctx)` 内 `ctx.effect(() => slots.register('team-panel', { component: ... }))`,卸载自动清理(按 dsh-dual-plugin-guide "副作用必须可清理"原则)。

### 7.2 Timeline 渲染

| 事件类型 | 渲染组件 | 视觉特征(已锁) |
|---|---|---|
| dispatch / handoff | `HandoffCard` | 主区独立卡片;轮次 + 流向;artifact 列表 |
| handoff 退回 | `HandoffCard` 红色变体 | 同一组件,色变;红色已锁 |
| A2A-style 消息 | `MessageBubble` | 聊天气泡(无 mention 边) |
| @mention 发言 | `MessageBubble` + 左侧 mention 边 | 黄色 |
| 用户介入(决策点) | `DecisionPointCard` | 输入框 + action 三选 + 用户消息一体;**不**用红色气泡 |
| in_reply_to | 一级虚线引导 | reply 气泡底部指向被回复 |

按 flow 自适应密度: round-table 中 A2A 消息为主事件,timeline 主体就是它;pipeline / fan-out 中 A2A 是穿插。

### 7.3 决策点 UI(§9.10.3 + §9.12)

- 状态 pill 上**小角标**(§9.12.2 D7-2):不是新 pill,不是高亮——匹配"决策点不是新状态"的机制
- 介入面板 = timeline 自然延续(§9.12.3 D7-3):最后一条消息后出现"等待你的反馈"输入卡
- 侧栏活跃 Run 项显示决策点等待状态(§9.12.1 D7-1)——多 Team 多个决策点时"可扫一眼识别"
- 用户主动 ad-hoc 门:timeline 顶栏有"插入决策点"按钮(只在 running 期间可见,`flow_config.ad_hoc_decision_points=true` 才显示)——这是 UI 暴露介入时机的唯一入口,不是过程性介入按钮

### 7.4 多 Team 视图(§9.12)

- **侧栏上下同框** + 历史区默认折叠 "历史 (N)";**不用 tab**(D7-5)
- 活跃 Run 列表项 = Team 名 + 状态 pill + 成员数 + 决策点小角标
- 历史 Run 列表项 = Team 名 + 终态 + 终态时间;点击 = 进入只读视图
- 重跑(§9.12.4 D7-4)= 复用 `members` + `flow_config` + 预填 `task_description`(可改)+ 启动前可勾选注入原 Run artifacts 为初始 `context_refs`

### 7.5 Slot 依赖与可发现性

- Panel 组件从 `team-runner` 订阅 runs / events;不直接持有状态,只渲染(单源真相 = `team-runner.run-store`)
- 决策点等待信号来源:`team-runner.decision-pt.waitingDecisions()`(Service 方法)
- 历史 Run 列表:`team-runner.run-store.list({ state: terminal })`
- Team 配置中心通过 `team-registry` CRUD;编辑实时预览(§12.1 A4)

---

## 8. 决策点(§9.10)

### 8.1 抽象

`team-runner.decision-pt` 统一管理决策点生命周期:

- **开点(零 DSH 裁量,§9.10.1)**:三源并集
  1. **收敛门**:`round-table-flow.checkConvergence()` 在轮次边界检收敛候选,检出即开
  2. **兜底门**:`round-table-flow.atMaxRounds()` 必开
  3. **用户门(ad-hoc)**:UI 顶栏按钮 → 拉临时决策点
- **响应模型**(§9.10.2):`{ action: continue|complete|abort, feedback?: string, is_ad_hoc?: boolean }`——所有门同构
- **持久化**:统一写 `user-intervention-log.jsonl`;ad-hoc 与 flow 触发同 schema,`is_ad_hoc` 区分(§9.10.2 第七轮拍板 1)
- **注入机制**:DSH 处理响应时把 `feedback` 文本写进下一轮 dispatch 的 `task` 字段(§4.3 + §9.10.3)

### 8.2 等待机制(§9.10.4)

- 两级 wait_minutes:全局默认 10 分钟 + `flow_config.decision_points[i].wait_minutes` 单点 override
- 窗口内多次介入:DSH 取**最后一条 action** 为准;`feedback` 不合并(保留"改主意")
- 窗口外迟到消息无决策点归属,但 DSH 调度时可见
- **超时按 flow 分流**(第七轮拍板 2):
  - `round-table` 收敛门 / 兜底门超时 → **abort**(释放资源;产物 / artifact 保留,可回看可重跑)
  - `pipeline-with-feedback` / `fan-out-collect` 门超时 → **continue**(默认决策点关,只在显式开启时生效)
- **用户失联 ≠ 自动 succeeded**(§9.9.6 + §9.10.4):round-table 无用户确认停留等待态,不自动落 succeeded

### 8.3 决策点与 Plan(§9.9.5)

- `plan.derived_from` 必填:取自 decision artifact / 带 `conclusion` 的收敛消息 / user-intervention-log 中 `action=complete` 记录——三选一,无新造记录
- `convergence_note` 降级为兜底注释字段(非决策点路径用,且必须引用具体消息 id 区间)

---

## 9. Plan 机制(§9.9)

`team-runner.plan-engine` 由 DSH 调用,流程:

1. **触发条件**:`flow_config.plan_output=true` **且** 收敛候选命中
2. **生成步骤**:
   - 读 `a2a-message-log.jsonl` 找收敛消息(`payload.conclusion`)
   - 读 `artifacts/` 找决策锚点
   - DSH 写 plan 正文(自由自然语言)→ 提炼 3-5 步索引(`role` + `intent` + `expected_artifact{type, desc}`)→ 落到 `team-runs/<run-id>/plans/plan-<n>.md` + `.meta.json`
3. **derived_from 必填**:从收敛锚点列表(decision / 收敛消息 / 用户决策点记录)选
4. **软参考 + 采纳留痕**:`dispatch.context_refs` 引用对应 plan step;DSH 偏离允许,但偏离也留痕(`dispatch.task` 文本里注明"偏离 plan step X,原因: ...")
5. **与 DSH handoff 协同**:handoff 文档模板加"最近 active plan: <id> <path>",仅引用未执行完的 plan

**intent 枚举(§11.4 OQ-1,待拍)**:倾向 `produce | review | collect | synthesize | decide`——**实现时预留枚举扩展点**,用户拍板后填具体值。

---

## 10. 失败处理(§9.8)

### 10.1 失败二分(§9.8.2)

```
失败检测
  ├── 运行失败(进程挂 / 超时 / 无产物)
  │   → 轻量重试(DSH 不参与)
  │   → 耗尽 → 上报 DSH 走 §9.8.3
  │
  └── 结果失败(有产物但判定不达标)
      → 按 flow 语义:
         pipeline → 走 feedback loop
         fan-out → 置 degraded flag, join 照常
         round-table → "无结果失败",失败标准 = 不收敛(§9.9.6)
      → 耗尽 → 上报 DSH
```

### 10.2 循环失败(§9.8.3)

- `pipeline-with-feedback`:feedback loop 连续 `max_retries` 次失败 → 默认 `failed`
- DSH 可**插队一次**:重派 / 换人 → `running`;终止 → `failed`
- DSH 不响应 → 自然落 `failed`(无 N 步计数约束)
- `degraded` flag **不适用 pipeline**(顺序 flow 无"其他存活成员"概念)

### 10.3 degraded 修饰 flag(§9.8.4)

- 判定时点:flow 中途即可
- 判定规则:`≥1 非全部 Member 不可恢复`(可机器判定:进程挂 / 超时 / 重试耗尽)
- flag 置位后行为:
  - 不再向已死成员派发任务
  - 终态判定门槛放宽 → `succeeded(partial)` 标注参与 / 失败成员清单
  - 其余流程照常(join 照常 / analyzer 照跑)
- **全部挂 = failed**(不是 degraded)
- DSH 判定仅在"边界模糊"(如 Member 自评"任务不可能完成")时启用

### 10.4 dispatch 终态枚举(§9.8.5)

- `completed`:自然完成
- `failed`:自身失败(运行失败或结果失败)
- `interrupted`:被 abort 打断(区别于 failed,审计不同)

`dispatch-log.jsonl` 顶层 `terminal` 字段(三态)+ `terminal_at` 时间戳。

### 10.5 abort(§9.8.1)

- 独立终态(D1-1),与 failed 不合并
- 进入条件:用户显式触发,任意非终态(含 `pending` / `assembling` / `running` / `interrupted`)
- 进入动作:DSH 立即停止派发新 dispatch + 中断当前在跑 dispatch(标记 `terminal=interrupted`);已完成 dispatch 产物保留
- **进程层被杀** = DSH 进程死亡(桌面客户端退出 / 崩溃)→ 归 `interrupted`,**不**归 `aborted`(D1-5 第六轮收口);语义不可混淆
- `state-history` 必含 `aborted` 转换的 reason(形式待定,§11.4 OQ-4)

### 10.6 启动对账(§9.6)

DSH 启动时跑一次 `startup-reconcile()`:

```
扫描所有 .dsh/team-runs/*/meta.json
  for run with state in {assembling, running}:
    if run 持有进程不在(本 DSH 进程 / 已知 PID 都不在):
      run.state = interrupted
      state-history.append({ from: state, to: interrupted, reason: process-killed })
      同步把 run 内所有 completed_at=null 的 dispatch:
        dispatch.terminal = interrupted
        dispatch-log append({ ...existing..., terminal: interrupted, terminal_at: now })
```

**这是墓碑写入者的唯一答案**(§9.6 第六轮收口)——死进程写不了墓碑,DSH 启动时补上。

---

## 11. DSH 调度者 Session 控制(§9.6 + §13.5)

### 11.1 DSH 是前台,Member 是后台

| 维度 | Member | DSH 调度者 |
|---|---|---|
| 可见性 | 后台(ACP 进程) | 前台(DSH 输入框) |
| session 谁控制 | DSH 自动 + Member 自管 self-handoff | **用户**手动 |
| 换 session 触发 | 200k token 阈值 | **用户观察后手动** |
| handoff 文档生成 | Member 自己(按 `/handoff-hermes` 提示词) | DSH 自己(同 skill) |
| handoff 文档必含 | Member 自身状态 | Run ID + 关键路径 + 当前状态 + (可选)下一步建议 |

### 11.2 DSH handoff 流程

复用 `@dsh/skill` 的 `handoff-hermes` skill(DSH-1 锁定,不复建),但**模板由 team 插件增强**:

- 强制包含:Team Run ID + `team-runs/<run-id>/` 绝对路径 + `meta.json` / `dispatch-log.jsonl` / `a2a-message-log.jsonl` / 各 Member artifacts 目录路径 + 当前 state(从 `meta.json` 读)+ 最近 active plan(若有)
- 新 DSH session 接管:`dsh` session event 触发 → 读 handoff 文档 → 按需读 state(不重读全部历史,DSH-4 锁定)→ 重连所有 Member session(`subagent.followup(handle, system)` 注入"你正在 Run <id>,当前 state=...")→ 继续调度

### 11.3 切换期间 Team 行为(§9.7)

- `running` 状态保持不变(无 `paused` 状态,§9.7 第六轮收口)
- DSH 不在 → 成员进程保活,无调度者推进新 dispatch → 自然冻结(机制事实,不是状态变更)
- 新 DSH session 接管后继续

### 11.4 全局视野(§9.6 第六轮)

- DSH **不常驻全量上下文**——维护轻量 **Runs 索引**(`{ run_id, state, members_count, last_event_at }`)到内存;plan 生成(§9.9.2 需要全局视野)基于索引 + 按需读指定文件
- 索引启动时由 `startup-reconcile()` 顺便建立(扫描 + sort by last_event_at)

---

## 12. 产物共享(§9.11)

### 12.1 跨 Run 引用(§9.11.1)

- 引用式不复制;`artifact.id` 带 run 归属段 `<run-id>/<artifact-id>`
- 展示层可解析归属(外部 vs 内部引用);同 Run 引用无类型差别
- Q-M1(§13.2 Member 跨 Run 不累积)只约束 session 上下文,不限产物引用

### 12.2 引用时机(§9.11.2)

- `dispatch.context_refs` 注入(DSH 调度时)
- `plan.derived_from` 注入
- 成员**无跨 Run 寻源**=注入策略约定,非能力边界(§5.3 P1-2 信任域承诺)——成员与 DSH 同信任域、可读项目内全部文件;DSH 不注入 = 不引导成员读外部 Run。成员可在 dispatch 完成时表达"我需要 X",DSH 决定是否注入

### 12.3 生命周期(§9.11.3 + §9.11.5)

- 归档 = 软关闭:artifact 原地保留,**不**检查引用
- 删除 = 引用检查:被引用 = 拒绝 + 提示
- 归档时记录 warning 到 `state-history.jsonl`("N 个 artifact 仍被外部引用,已锁存")

### 12.4 版本管理(§9.11.4)

- 不可变快照:重跑 → 新 id,原文件保留
- 引用指向具体 id,不指向"最新"
- 同源链 `derived_from`(新 artifact `derived_from` 旧 artifact)
- `metadata` 版本号降为描述性信息

### 12.5 清理(§9.11.6)

- 1.0 不做自动清理(无 TTL / 冷区);结构留口(`created_at` + `derived_from` 已有,未来加清理机制不改结构)

---

## 13. 入口与打包(§1.3 + §4.1)

### 13.1 Skill 入口

- **team skill**: 双触发 `/start-team <task>` + 自然语言;`SKILL.md` 是内容唯一源
- **handoff-hermes skill**: 复用现有 skill(DSH-1 锁定);team 插件扩展 handoff 文档模板(§11.2)
- skill 是 thin wrapper;**核心能力不在 skill 内**——B1' 决策

### 13.2 Plugin Tool 入口

通过 `harness.defineTool` 暴露工具,供 agent 不经 skill 直接调用:

- `team_start({ task, flow?, members?, team_template_id?, assembly_strategy? })`
- `team_abort({ run_id })`
- `team_inject_feedback({ run_id, decision_point_id, action, feedback? })`
- `team_query({ run_id | { state?, ... } })` —— 查 run 状态

工具的 `execute` 路径 = `team-runner.start/abort/decision-pt.*` Service 方法;返回 JSON 兼容值(lossless)。

### 13.3 打包

- 仓内一等公民包: `D:\programming\projects\study\dsh\packages\team\`
- 入口: `lib/index.js`(Cordis 插件,`apply(ctx)` 注册服务 + Slot + Skill)
- skill 注册: `lib/index.js` 读 `skills/team/SKILL.md` → `ctx.skills.register({ source: 'runtime' })`
- 打包方式: monorepo pnpm workspace;`package.json` + `cordis.bundle.patch.yml` 注入到 DSH 主 bundle
- Agent Plugins 1.0 兼容: `plugin.json` 放在包根(可选,本地开发不需要)
- install 验证: 在 dsh 仓根跑 `pnpm build` + 启动 dsh cli → `dsh plugin list` 应看到 `team`

### 13.4 与 dsh-dual-plugin-guide 的关系

| 项 | dsh-dual-plugin-guide 风格 | team 插件实际 |
|---|---|---|
| 包位置 | 独立可分发 .zip | DSH 仓内 monorepo 一等公民 |
| 入口 | 函数形 `apply(ctx)` | 同 |
| Skill 注册 | `ctx.skills.register({ source: 'runtime' })` | 同 |
| Bundle 注入 | `cordis.bundle.patch` | 同(由 dsh 仓 build 工具支持) |
| 卸载清理 | `ctx.effect` 自动 | 同 |
| Agent Plugins 1.0 | `plugin.json` 必需 | 可选(本地 dev 跳过;发布到外部仓时补) |

**关键差异**:team 插件是**核心能力**(State machine / dispatcher / a2a-router / plan-engine),不像 dsh-dual-plugin-guide 那样只是 skill 注册器;但**入口侧的 skill 注册仍按 dsh-dual-plugin-guide 模板**(`lib/index.js` + `SKILL.md`)。

---

## 14. 成本纪律(§9.13)

`team-runner.cost-guard` 是独立服务,三道防线:

### 14.1 预飞行(§3.3 P0-1① + §9.13 ①)

- 触发:`fan-out-collect` 且 `parallel.length >= 3` (阈值 tunable,默认 3)
- 动作:在派发前**中断** dispatch 队列 → 弹窗给用户确认"将并行启动 N 个成员 agent + 预估成本/本轮上限"
- 用户 cancel → aborted(不是 failed);用户 continue → 继续
- 弹窗通过 `harness.call` / 客户端事件发出;**不是新机制**,沿用 DSH 现有的"ask user" 通道

### 14.2 上限门(§9.13 ③)

- 触发:单 Run 触顶 `flow_config.cost_cap`(按轮次 / agent 分钟计;具体计费策略由 DSH 实现,本架构只规定 hook 点)
- 动作:开一个"续 / 停"决策点(`action: continue(续 N 轮) | complete | abort`);用户失联 → 默认 abort 系
- **触顶不评 failed**(预算 ≠ 产品缺陷)

### 14.3 分流超时(§9.10.4 + §9.13 ②)

- 决策点等待超时按 flow 分流(§9.10.4 第七轮拍板 2):
  - `round-table` → abort
  - `pipeline-with-feedback` / `fan-out-collect` → continue
- 与 14.1 预飞行 + 14.2 上限门三道防线,覆盖"无人值守"的每条路径,无死角

---

## 15. 并发与资源(§9.12.9)

- **1.0 不做插件层排队 / 上限**——活跃 Run 数量无产品层队列 / 拒绝规则
- **并发上限 = 宿主限制**:`packages/acp/acp_adapter/server.py` 行 231 `ThreadPoolExecutor(max_workers=4)`;插件不写自造数字
- **该上限同时约束单 Run 内并行度**:fan-out N 路 = 逻辑并行,物理并发 ≤4
- **多 Run 共享素材库不受并发保护**:跨 Run 共享承诺标注"不受并发保护"——用户不能拿单 Run 语义推导多 Run 行为
- **UI 可见化**:侧栏活跃 Run 项可加进程数角标(具体 UI 细节 backlog,§11.3)

---

## 16. 实现阶段(1.0 路线)

按 requirements 已闭环项 + 依赖关系排序,推荐阶段:

| 阶段 | 范围 | 关键依赖 | 验收口径(§19 配套) |
|---|---|---|---|
| **P0 骨架** | `packages/team` 包结构 + 实体 + 状态机 + 启动对账 + `team` skill + 最小 panel slot + 1 个 Member (hermes acp) | DSH 仓 + `subagent-acp` + `skill` | Story 1(简化:固定 members,无收敛门,无 plan)能跑通——3 成员讨论得出最终回包 |
| **P1 完整 Story 1** | `handoff-round-table` flow + 收敛门 + 兜底门 + 用户门 + user-intervention-log + 决策点 UI 卡片 + degraded flag | P0 | Story 1 全过;DSH handoff 中断-接管能恢复 |
| **P2 Story 2** | `pipeline-with-feedback` flow + handoff-log + DSH-routing 路由占位 + feedback loop | P0 + §2.5 P2-1 | Story 2 全过;handoff 退回红色变体 |
| **P3 Story 3** | `fan-out-collect` flow + 预飞行确认 + aggregator 派发 + 并发 ≤4 | P0 | Story 3 全过;3+ 路 fan-out 弹预飞行确认 |
| **P4 Plan + Artifact** | `plan-engine` + artifact 不可变快照 + 跨 Run 引用 + plan UI 渲染 | P0/P1 | plan_output=true 时 DSH 写 plan;软参考 + 留痕 |
| **P5 多 Team + 历史** | 多 Run 索引 + 侧栏 + 历史 Run 只读视图 + 重跑注入原 artifacts | P0 | 2 个 Run 同时跑;侧栏角标 + 历史折叠 |
| **P6 成本纪律** | 预飞行 / 上限门 / 分流超时 三道防线 | P3 + P4 | fan-out ≥3 弹预飞行;cost_cap 触顶开决策点 |
| **P7 失败处理** | abort / interrupted / dispatch 终态三态化 / 启动对账 | P0 | abort 任意非终态进入;DSH 崩溃下次启动对账标 interrupted |
| **P8 全 Adapter** | mcode + claude-code adapter(provider 注册) | P0 | 三 Adapter 全部跑通;成员可混搭 |

**Story 验收(§19,六轮收口)**: Story 1 = 用户在场,Story 2 = 成员链式自动化,均属 1.0 支柱(用户已拍板不降级)。**两端都跑通**才算 v1 闭环。

---

## 17. 不做什么(显式非目标)

继承 requirements §11.3 + §9.7 / §9.11.6 / §12.1 / §12.2 B4 + 第七轮拍板的非目标:

- ❌ **过程性手动介入**(V 决策):Team 启动后无"任意时刻手动介入";只 abort + 决策点响应 + ad-hoc 门
- ❌ **`paused` 状态**(§9.7 + D2-1):由 DSH handoff 隐式覆盖
- ❌ **read_only 角色** + orchestra_report 通道(§14.5 D8-1 维持不做)
- ❌ **外部 A2A 协议**暴露(§4.2 Q-M3):保持核心优势(Member 各自 LLM),不要求 Adapter 实现 A2A endpoint
- ❌ **persona 模板库**(A2):"先不用,到时候再说"
- ❌ **AI 生成 / 上传 avatar**(A6 + M,N):仅默认几何
- ❌ **artifact 自动清理**(§9.11.6):1.0 不实现
- ❌ **插件层排队 / Run 数限制**(§9.12.9):并发上限直接引用宿主
- ❌ **真实隔离(沙箱 / 权限 / 独立目录挂载)**:信任域 §5.3 P1-2 现状承诺;1.0 不承诺
- ❌ **plan 按需导出 / summary 机制**独立化(§9.9.1 D4-1):后续想要 = 重跑注入旧产物

---

## 18. 风险与开放问题

### 18.1 风险

- **acp 协议 context length 暴露不一致**——不同 adapter(hhermes / mcode / claude-agent-acp)实现差异,200k 阈值检测在 subagent-acp 层需做 adapter-specific 适配(可能要做 `session/info` 探测)
- **多进程并发 append 协调日志**——成员进程 + DSH 进程 + 启动对账对同一 jsonl 的并发写;需要文件锁 / 串行队列(实现层)
- **DSH handoff 期间 Run 长时间无调度者**——成员 session 保活但无推进,产品价值损失;UI 可加"无推进"暗示(§11.2 留 UI backlog)
- **plan intent 枚举**未拍板(§11.4 OQ-1)——影响 §9.9.3 schema
- **artifact 跨 Run 引用 的 ID 编码格式**(§11.4 OQ-3)——具体格式 DSH 实现层定,但要在 `artifact-store` 提供一致抽象

### 18.2 开放问题(继承 requirements §11.4)

- OQ-1: plan step intent 枚举值集(倾向 `produce | review | collect | synthesize | decide`,待拍)
- OQ-2: 决策点等待默认 10 分钟是否写入产品默认值(倾向是)
- OQ-3: 跨 Run artifact id 内 run 归属段编码格式(机制层锁定,具体格式 DSH 实现定)
- OQ-4: state-history 必含字段的准确措辞(用户落文档时定)
- OQ-5: requirements §4 重写的终稿措辞审校(第六轮已按收口清单对齐,待最终审)

### 18.3 后续讨论议题(§11.2 留口)

- 其他 Flow 模式(除圆桌/流水线/扇出外)——用户提"可能还有其他场景后续再说"
- 暂停-恢复的 UI 暗示(机制不拍,UI 归属 DSH/UI 侧)
- 视觉细节 backlog(配色 / 字体 / 圆角 / 间距 / 决策点角标颜色 / A2A 消息密度渲染)

---

## 19. 实现侧 checklist(开发前对齐用)

- [ ] 与 requirements §8 30+ 决策逐项对位,确认无遗漏
- [ ] `packages/team/package.json` 与 `subagent` / `skill` / `session` / `storage` / `acp` / `web` 对齐 peer deps
- [ ] `team` skill 的 `SKILL.md` frontmatter 必含 name + description + whenToUse
- [ ] `lib/index.js` 的 `inject: ['skills', 'subagents', 'slots', 'storage']`(硬依赖);其他用 `ctx.get()` + undefined 检查
- [ ] Slot 注册用 `ctx.effect(() => slots.register(...))` —— 卸载自动清理
- [ ] 5 个协调日志写入路径全部走 Service(单写入者承诺 §2.4)
- [ ] 状态机转换前**先**写 state-history,再更新 meta.json
- [ ] abort / interrupted / failed 状态转换 reason 必填
- [ ] dispatch 终态三态化(`completed | failed | interrupted`)
- [ ] 启动对账在 DSH 启动 hook 上注册(只跑一次)
- [ ] 决策点等待按 flow 分流超时(round-table→abort,pipeline/fan-out→continue)
- [ ] 物理并发 ≤4(直接引用 `acp_adapter/server.py` 的 ThreadPoolExecutor)
- [ ] 预飞行确认走现有"ask user" 通道(不新造)
- [ ] 验证:`pnpm build` + 启动 dsh → `dsh plugin list` 看到 team → 跑通 P0 骨架场景
- [ ] `npm pack --dry-run` 确认发布内容含 `lib/` / `skills/` / `cordis.patch.yml` / `plugin.json`(如适用)

---

## 20. 一句话总结

DSH Team 是 DSH 仓内 `packages/team` 一等公民插件,组合现有 `subagent-acp` / `skill` / `session` / `storage` 能力,补 Team Run 状态机 + dispatch / handoff / a2a 路由 + plan / 决策点 / cost-guard 调度层 + Linear 风 Panel Slot;五条协调日志 append-only + 单写入者=DSH;5 个 Adapter 封闭(3 个首批);核心优势保留——Member 各自独立 ACP 进程 = 各自独立 LLM;UI 不暴露过程性介入,只暴露 abort + 决策点 + ad-hoc 门;Story 1/2/3 三 flow 1.0 全部支柱,验收口径跑通。
