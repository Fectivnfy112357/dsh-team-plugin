# DSH Team 插件 — 需求规格（v1 定稿 + 第五轮机制层扩展）

> **状态**：2026-08-18 第四轮产品形态拍板（v1 闭环）；2026-08-19 第五轮机制层全面扩展（abort 终态 / 失败处理 / Plan 机制 / 决策点 / 产物共享 / 多 Team UI / read_only 判定）。
> 本文档是"需求层"——只定义产品形态、用户故事、产品规则、机制层（Team Run / Member Session / 消息路由 / Plan / 决策点 / 产物体系），不涉及具体技术实现（实现见 `architecture.md` 与本仓 `lib/` `services/` `ui/` `skills/`）。
> 配套文档：[discussion-log.md](./discussion-log.md)（讨论过程，五轮）、[architecture.md](./architecture.md)（实现侧架构，v1 骨架）、[mockups/](./mockups/)（UI 草图）、[AGENTS.md](./AGENTS.md)（项目约定 + 仓库结构 + 写作边界分层）。

---

## 0. 一句话

DSH Team 插件让用户在 DSH WebUI 里**以"角色 + 团队"的视角组织多个 Agent**——角色是素材库，成员是持久化实体，团队运行是一次临时剧组。Agent 全部走 ACP 协议接入底层 CLI（Hermes / Claude Code / mcode），成员之间通过结构化 handoff 协作，handoff 携带结构化 artifact 与引用关系。**Team Run 采用混合架构**：调度走 DSH 中央调度者（dispatch / handoff），协作消息走 DSH 代理的 A2A-style 通道（Member ↔ Member 轻量消息）。用户可以预定义 Team 模板，也可以让 DSH 运行时拼队。

---

## 1. 用户故事

### Story 1 — 模糊想法的多角色讨论

**作为用户**，我脑子里有一个模糊想法，想让几个"擅长不同方向的"Agent 互相讨论，最后给我一个收敛的结论。

**场景**：

1. 用户："我有个想法：用 X 解决 Y 问题，但不确定是否可行"
2. DSH 自动挑出 `brainstormer` + `critic` + `brainstormer`
3. 三人在房间里轮流发言，可以互相 @ 接力
4. 一轮结束后输出结论给用户
5. 用户："critic 的质疑没说服我，让 brainstormer 再回应一下"
6. DSH 触发新一轮讨论
7. 用户满意，结束

### Story 2 — 开发任务的流水线 + 反馈循环

**作为用户**，我给一个开发任务，希望代码写完后被审，有问题退回重写，没问题交付。

**场景**：

1. 用户："实现 X 功能"
2. DSH 分配给 `developer`
3. `developer` 写代码 + 跑测试 → 产物 = 代码 + 自测报告
4. `developer` 声明"完成 step 1"→ DSH 查 plan 派单给 `reviewer`，附代码产物（顺序强制在 DSH，§3.2）
5. `reviewer` 审代码，发现问题 → 声明"step 1 未通过"→ DSH 派退回给 `developer`，附"需修改清单"
6. `developer` 修改 → 再次 handoff 给 `reviewer`
7. 重复 5-6 直到通过（或达到重试上限）
8. 交付物产出

### Story 3 — 深度研究的并行多源采集

**作为用户**，我给一个研究课题，希望多个 Agent 分别从不同数据源采集数据，汇总后给分析报告。

**场景**：

1. 用户："研究 X"
2. DSH 调度者派单给多个成员并行采集（fan-out）
3. 各成员产出原始数据 artifact（N 路并行是逻辑并行，物理并发≤4，§3.3）
4. 全部完成或超时（至少一路完成）→ DSH 一次性派发汇总任务给 `analyzer`（join 语义，§3.3）
5. `analyzer` 产出分析 artifact
6. handoff 给 `writer` 出报告
7. 用户看到最终报告

---

## 2. 核心概念

本节定义核心实体及其关系：

```
Role（角色模板，全局共享）
 ↓ 实例化
Member（成员实体，全局持久化）
 ↓ 加入
Team Run（一次完整协作运行）
   ├─ sessions/<member-id>/（每 Member 一个 session，跨 dispatch 持续）
   ├─ dispatch-log.jsonl（DSH 调度事件流）
   └─ a2a-message-log.jsonl（Member 之间消息流）
```

### 2.1 Role（角色）

**定义**：一个 Agent 能力模板，可在多个 Team 中复用。

**字段**（用户可编辑）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 全局唯一标识 |
| `display_name` | string | 显示名（如"代码评审员"）|
| `persona` | string | 性格提示词（多行文本）|
| `adapter` | enum | `hermes` / `claude-code` / `mcode` |
| `cli_options` | object | CLI 启动参数（每个 Adapter 不同）|
| `tools_allowed` | list | 该角色可使用的工具白名单 |
| `avatar` | object | 头像（默认几何）|

**重要规则**：

- Role 是**全局素材**，跨 Team 共享
- 同一 Role 可**实例化为多个 Member**
- Adapter 必须走 ACP（`hermes acp` / `mcode acp` / `claude-agent-acp`）
- Adapter 列表在产品层是**封闭集合**——架构上预留扩展性，但用户不能自加；要新增必须改插件源码（详见 §12.1 A3）
- avatar 仅默认几何（颜色按 adapter 分，形状按 role 类型分），无 AI 无上传

### 2.2 Member（成员）

**定义**：用户预先配置的**持久化 Agent 实体**，由 Role 实例化而来。

**关键属性**：

- **核心优势**：Member 可用**与 DSH 不同的 LLM**（hermes / claude-code / mcode 各自独立）——这是 DSH Team 的产品核心，**不能放弃**
- Member 是独立的 ACP 进程，DSH 通过 ACP 与每个 Member 通信
- Member 在 Team Run 内有**独立的 session context**（跨 dispatch 持续）

**与 Role 的区别**：Role 是模板，Member 是用户在 UI 里配置出来的具体实例（带 persona 微调、命名、持久配置）。此处"持久"指 **配置与元数据持久化**（`members/<member-id>.json`）；**会话上下文跨 Team Run 完全不累积**（Q-M1 锁定，§13.2）。同一个 Role 可实例化为多个 Member，每个 Member 有独立 id 和持久化的 `members/<member-id>.json`。

**字段**（用户可编辑）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 全局唯一标识 |
| `role_id` | string | 引用 Role（决定 adapter 等）|
| `display_name` | string | 显示名 |
| `persona` | string | Member 级人格覆盖（可选，未填则继承 Role）|
| `cli_options_override` | object | Member 级 CLI 参数覆盖（可选）|
| `metadata` | object | 元信息（created_at、updated_at、tasks_count 等）|

**重要规则**：

- Member **全局持久化**——可被多个 Team Run 复用
- **Member 跨 Team Run 完全不累积上下文**（Q-M1 锁定）——这是产品规则，跟 session 内的累积是两码事
- Member 在 Team Run 内的 session **跨 dispatch 持续**（详见 §9.2）

### 2.3 Team Run（团队运行）

**定义**：一次完整的协作运行（从 DSH 接到用户任务开始，到任务达成或终止结束）。可临时也可持久化保存。

**生命周期状态机**（第五轮扩 `aborted`；第六轮收口：`degraded` 改为 `running` 的修饰 flag、新增 `interrupted`）：

```
pending → assembling → running → succeeded
                           ↓ ↘
                       failed   interrupted
                           ↓
                     aborted（可从 running 或 interrupted 进入）
                           ↓
                     archived（可从任意状态转入）
```

| 状态 | 含义 | 进入条件 |
|---|---|---|
| `pending` | 已创建但未拼队 | 启动后 |
| `assembling` | 正在拼队 | 拼队逻辑开始 |
| `running` | 正在跑 flow | 至少一个 Member session 已建立 |
| `succeeded` | flow 走完，任务达成 | 用户确认（round-table，§9.9.6）或调度者判定（其余 flow） |
| `failed` | 完全失败，达到重试上限 / 不可恢复错误 / 组装失败 | 调度者判定 |
| `interrupted` | 持有进程（DSH）被杀 / 崩溃，Run 失去调度者 | 启动对账发现 running 但无持有进程（§9.6） |
| `aborted` | 用户主动终止 | 用户显式 abort；可从任意非终态进入（含 pending / assembling / running / interrupted） |
| `archived` | 用户删/归档 | 用户主动（可从任意状态转入）|

**`degraded` 是 `running` 的修饰 flag，不是独立状态**（第六轮收口，替代第五轮 Q-M6 / D3-3 的独立状态方案）：

- **进入条件**：≥1 非全部 Member 不可恢复（进程挂 / 超时 / 重试耗尽，可机器判定）；flow 中途即可
- **对终态判定影响**：带 flag 的 `succeeded` 必须标注 `partial` + 记录参与成员清单 / 失败成员清单
- **行为差异只有两条**：不再向已死成员派发任务；终态判定门槛放宽（部分达成可算 succeeded(partial)）。其余照旧——join 照常触发（剔除死路）、analyzer 照跑、收敛照走
- 全部成员不可恢复 = `failed`（不是 degraded）
- 状态机本身零改动——删独立节点后不需要 degraded→running 回迁

**`interrupted` vs `failed` vs `aborted` 的区别**（第六轮收口）：

- `interrupted` reason = `process-killed`——持有进程死亡（DSH 崩溃 / 桌面客户端退出），Run 失去调度者；**不是用户动作、不是 Team 自治失败**。出口：interrupted→重跑→running（用户点击重跑，重新组队）或 interrupted→aborted（用户放弃）
- `failed` reason 由 Team 自治产生（重试上限、不可恢复错误、循环失败）；`aborted` reason 是用户主动动作
- `aborted` 可从任意非终态进入（含 `interrupted`）

**字段**（`team-runs/<run-id>/meta.json`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | Team Run 实例唯一标识 |
| `state` | enum | 当前状态 |
| `flow` | enum | `handoff-round-table` / `pipeline-with-feedback` / `fan-out-collect` |
| `flow_config` | object | 流程参数 |
| `members` | list<MemberRef> | 本 Run 引用的 Member（含 instance_alias）|
| `task_description` | string | 本次 Run 的任务描述（用户的原始输入）|
| `created_at` | datetime | |
| `started_at` | datetime | 进入 running 的时间 |
| `ended_at` | datetime | 结束时间 |
| `current_round` | int | 当前轮次 |

**两种组装模式**：

| 模式 | 触发 | 适用场景 |
|---|---|---|
| `predefined` | 用户预先配置模板，运行时直接复用 | 重复任务（开发流水线、研究模板）|
| `runtime` | DSH 根据任务动态挑选 Member 组队 | 一次性、模糊任务 |

**组装策略**：全局默认（auto/manual），单次调用可在 prompt 里临时覆盖（详见 §12.2 B2）。

**组装失败路径**（第六轮收口）：拼队可能失败（角色库为空 / runtime 拼队找不到匹配角色 / 模板引用已删除成员 / ACP 进程起不来）——这是必然存在的现实路径：

- 状态机新增 `assembling → failed`（`reason=assembly`），不再是死胡同
- assembling 失败后允许**复用素材 + plan 重跑组装**（1.0 最小支持）；**禁止断点续跑**（从中途 session 恢复组装，留 2.0）
- `abort` 允许于任意状态（含 pending / assembling）——用户不是只能干等

**重要规则**：

- Team Run 启动时，DSH 调度者**按策略**决定 members 列表
- 每个 Member 加入 Run 时建立独立 session（详见 §9.2）
- Team Run 结束 → 销毁所有 Member session（进程层由 DSH 持有，DSH 死则整队销毁，§9.6）
- **abort 不删产物、只停执行**——已完成 dispatch 的 artifact / log 保留（审计需要）；pending 状态已派发但未执行的 dispatch 标记 `orphan`，成员回包时丢弃

### 2.4 Dispatch（派活）

**定义**：DSH 调度者向某个 Member 派一次活。Dispatch 是 Team Run 内的**任务派发单元**。

**字段**（`dispatch-log.jsonl` 每行一条）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | dispatch 唯一标识 |
| `from` | enum | `scheduler`（第七轮回退：恢复单值。成员发起的移交流统一进 handoff-log（§2.5/§3.2），dispatch-log 保持纯 DSH 调度语义，不再承担成员发起者身份）|
| `to` | Member | 接收方 |
| `task` | string | 派活描述 |
| `context_refs` | list<ArtifactRef> | 注入到该 Member session 的 context（其他 Member 的产出）|
| `issued_at` | datetime | |
| `completed_at` | datetime | |
| `produced_artifact_ids` | list<string> | 该 Member 产出的 artifact |
| `run_id` / `seq` | string / int | Run 归属 + 文件内序列号（与 handoff-log 跨文件排序用，§2.6）|

> **单写入者原则**（第七轮重定范围）：五个 append-only 协调日志——`dispatch-log` / `handoff-log` / `a2a-message-log` / `user-intervention-log` / `state-history`——的唯一写入者都是 DSH。**这不包括 artifact 与 self-handoff 文档**：artifact 与 `handoff-<n>.md` 由成员直接落盘（§9.5 既定机制，成员作者身份不可转移）。范围判据：成员被禁止 append 的是协调/审计日志（多进程并发 append 同一 jsonl = 锁 / 损坏风险）；成员写自己的 artifact 各归各目录、无并发写冲突，不受此限。一句话边界：**成员可直接写 → 自己的 artifact + self-handoff 文档；成员不可写 → 五个协调日志。**

### 2.5 Handoff（交接）

**定义**：Team Run 内成员之间的**结构化任务移交**，是协作的核心原语（产品层概念）。

**字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `from` | Member | 移交方 |
| `to` | Member | 接收方 |
| `task` | string | 任务描述（自然语言）|
| `artifacts` | list<ArtifactRef> | 携带的产物 |
| `context` | object | 上下文快照 |
| `reason` | string | 为什么移交 |
| `timestamp` | datetime | |

**持久化归属**（第六轮收口）：member→member 的 handoff 落 **`handoff-log.jsonl`**（per-run，§5.1）——唯一事实源；dispatch-log 的 from 枚举扩展后亦能表达成员发起的派单请求，但**结构化任务移交（含 from/to/reason/artifacts）以 handoff-log 为准**。`handoff-<n>.md`（§9.3）是派生视图（给人读），jsonl 是事实源。

**路由形态**（第七轮收口，P2-1）：`to` 可为具体 Member，也可为 `DSH-routing`——pipeline 场景成员声明"完成 step N"不点名下一棒（§3.2），由 DSH 查 plan 后派单；该形态仍落 `handoff-log`（唯一事实源），只是 `to` 为路由占位。结构化移交（含 from/to/reason/artifacts）一律以 handoff-log 为准，dispatch-log 不记录成员发起的移交。

**与"@mention 发言"的区别**：

- @mention 是对话中的"邀请发言"（轻量，文本为主）
- handoff 是**任务移交**（重量，结构化，携带产物）

### 2.6 A2A-style 消息（成员间消息）

**定义**：Team Run 内 Member ↔ Member 之间的**结构化轻量消息**——讨论、确认、通知（非任务派发）。

**与 handoff / dispatch 的区分**：

| 维度 | Dispatch / Handoff | A2A-style 消息 |
|---|---|---|
| 触发者 | DSH 调度者（dispatch）或完成任务的 Member（handoff）| 任何 Member |
| 语义 | "请做这个任务" + 携带产物 | "你怎么看？"、"我完成了 X"、讨论 |
| 是否带 artifact | 通常带 | 通常不带 |
| 持久化 | dispatch-log.jsonl / handoff-log.jsonl（按语义）| a2a-message-log.jsonl（含 kind=system-wake）|
| 谁消费 | DSH 路由到目标 Member | DSH 投递到目标 Member inbox |

**架构**：

- 走 **DSH 作为代理**——Member-A 发消息 → DSH 内部路由 → 投递到 Member-B 的 inbox
- 底层协议还是 **ACP**（不是外部 A2A 协议）——DSH 在中间完成路由
- **不暴露外部 A2A 协议**——保持核心优势（每个 Member 用不同 LLM），不要求 Adapter 实现 A2A endpoint

**字段**（`a2a-message-log.jsonl` 每行一条，Q-M3 锁定）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 消息唯一标识 |
| `from` | Member | 发送方 |
| `to` | Member / `broadcast` | 接收方（单点或广播）|
| `topic` | string | 主题（Q-M4 锁定结构化） |
| `intent` | enum | `discuss` / `notify` / `confirm` / `request-info` |
| `payload` | object | 结构化内容（Q-M4） |
| `in_reply_to` | string | 回复哪条消息（可选）|
| `kind` | enum | `message`（默认） / `system-wake`（DSH 投递唤醒，§9.4）|
| `timestamp` | datetime | |
| `delivered_to_inbox_at` | datetime | 投递时间 |

**Member inbox 行为**（Q-M5 锁定，措辞第六轮修正）：

- Member **idle 时自动检查 inbox**——有消息就"醒"（唤醒由 DSH 投递时触发，§9.4）
- 接收方处理消息 → 可能产出 artifact → 可能再发新消息
- DSH **不读内容，仅路由 + 唤醒**——看 header / topic / intent，不参与内容理解（"无需 DSH 每条都参与"的准确含义是"不参与内容"，不是"不在热路径"）

### 2.7 Artifact（产物）

**定义**：dispatch/handoff 携带的结构化产物，**有引用关系，可追溯**。

**字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 全局唯一（id 带 run 归属段 `<run-id>/<artifact-id>`，跨 Run 引用可解析） |
| `type` | enum | `code` / `report` / `data` / `analysis` / `decision` / `discussion` / `plan`（第五轮 D4-3 新增 plan） |
| `content_ref` | string | 内容引用（实际文件路径 / 外部 URI）|
| `produced_by` | Member \| `scheduler` | 产出者（第五轮 D4-7 扩展：type 允许 `scheduler` 代表 DSH 调度者） |
| `produced_in_dispatch` | string | 来自哪个 dispatch |
| `produced_in_session` | string | 来自哪个 Member session（scheduler 产出的 plan 可能为空） |
| `derived_from` | list<ArtifactRef> | 依赖的上游产物（引用关系） |
| `metadata` | object | 元信息（语言、版本号（描述性）、commit 等） |
| `created_at` | datetime | |

**关键规则**：

- 产物**持久化存储**——通过文件系统共享，handoff / 消息只传递引用（避免"电话游戏"信息丢失）
- 可以**反向追溯**："这段代码是谁在哪个 dispatch 写的、基于哪些上游产物"
- 可以**前向追溯**："这个数据最终被哪些报告引用了"
- **跨 Run 引用**（第五轮 D6-1）：引用式 + 版本号挂原 artifact；id 带 run 归属段（可解析归属）；与同 Run 引用无类型差别（详见 §9.11）
- **不可变快照**（第五轮 D6-4）：重跑产生新 id，原 artifact 保留；引用永远指向具体 id 不指向"最新"；同源关系走 `derived_from` 链（新 artifact `derived_from` 旧 artifact）；metadata 版本号降为描述性信息
- **归档 ≠ 删除**（第五轮 D6-3）：归档是软关闭（artifact 原地保留）；删除（物理清理）检查引用计数，被引用的拒绝删除

### 2.8 调度者（Dispatcher）

**定义**：DSH 客户端的中央调度者，负责"挑 Member、决定下一步、汇总、接管"。

**关键属性**：

- 调度者**就是用户在 DSH 客户端里直接对话的那个 agent**——跟 Member 同质（都是 LLM agent），但**由用户直接控制**
- 调度者从 Team Run 的 `meta.json` + `dispatch-log.jsonl` + `a2a-message-log.jsonl` + Member artifacts 中读取状态，作出调度决策
- 调度者 session 由用户在 DSH UI 手动切换（详见 §9.5）

**两种模式**：

| 模式 | 说明 |
|---|---|
| 默认（隐式）| DSH 内置调度策略，用户无感 |
| 高级（可配置）| 用户可以为调度者指定一个 Role，用该角色的人格驱动调度 |

---

## 3. 三种 Flow（协作流程）

### 3.1 handoff-round-table（圆桌讨论）

**适用场景**：Story 1（模糊想法讨论）

**规则**：

- 每个成员依次发言
- 任何成员都可以 @ 另一个成员，让对方接力
- **轮次边界 = 扫过制**（第六轮收口）：DSH 每轮向当前全部成员逐一发送发言邀请；全员回包（含显式"无补充"）即该轮结束。缺席成员标记但不阻塞轮次——"轮"是机制可判定的（邀请-回包），不是内容判定（不依赖 DSH 判断谁说没说话）
- 一轮结束后可触发下一轮；**轮末默认不开决策点**；决策点（门）只在三种情况开：[收敛信号触发 / max_rounds 兜底 / 用户主动拉 ad-hoc 门]，零 DSH 裁量（§9.10.1）。DSH 在任一轮边界检收敛候选，无候选则自动推进下一轮，至 max_rounds 兜底；用户失联按 flow 分流超时（§9.10.4）
- **N 路并行是逻辑并行，物理并发受宿主 worker 上限约束（≤4，§9.12.9）**；join 超时须留足排队余量，防"资源排队"误判为"成员死亡"

**参数**：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `max_rounds` | 5 | 最大轮次 |

### 3.2 pipeline-with-feedback（流水线 + 反馈循环）

**适用场景**：Story 2（开发任务）

**规则**：

- 步骤按顺序执行
- **顺序强制在 DSH 侧**（第六轮收口）：Member 完成某步后，其 handoff 目标写"完成 step N"（不是写具体下一个成员）；DSH 作为路由层查 plan 决定下一步并派单。Member 不感知全链——顺序强制不靠成员自觉。该 handoff 的 `to = DSH-routing`（不点名下一棒），落 handoff-log（§2.5/§5.2）；DSH 查 plan 后发 dispatch 派具体成员——成员发起的移交不污染 dispatch-log
- 每个步骤可以**退回**上一步
- 退回时携带 feedback artifact
- 达到最大重试次数则 Team 失败

> 流水线形态边界（第六轮收口，§19）：Story 2 是**成员链式自动化**——决策点出现在链的接入点（start / step 交接），链内过程闭环。与 Story 1 的"用户在场的对话协作"是两种产品形貌，均属 1.0 支柱（用户已拍板不降级），验收口径见 §19。

**参数**：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `steps` | 必填 | 步骤序列 |
| `feedback_loops` | 可选 | `step_i → step_j: {max_retries}` |
| `max_retries` | 3 | 默认重试上限 |
| `artifact_type` | code | 产物类型 |

### 3.3 fan-out-collect（扇出-汇总）

**适用场景**：Story 3（深度研究）

**规则**：

- 一个分发步骤（可省）
- 多路**并行**执行
- **join 由 DSH 判定并一次性派发（幂等）**（第六轮收口）：携带参与成员卷宗清单（明确"2/3 数据"是哪 2/3）；成员各自 handoff 给 aggregator 的写法**不采用**（会重复触发汇总）
- **完成定义**：成员显式宣称完成 + 产物 / 引用存在（显式空结果如"查无资料"也算完成；**沉默死亡不算**）
- **超时且至少一路完成**：置 degraded flag（§2.3），照常 join——剩余成员数据继续进 aggregator，不放弃全部
- 多个结果**汇总**到一个 aggregator
- 汇总后可继续后续步骤（如写作）
- **N 路并行是逻辑并行，物理并发受宿主 worker 上限约束（≤4，§9.12.9）**——5 路 fan-out 实际 4 并发 1 排队；join 超时留足排队余量，防资源排队误判为成员死亡
- **预飞行确认**（第七轮 P0-1①）：`parallel` 路数 ≥3（阈值 tunable，默认 3）时，启动前必须向用户确认"将并行启动 N 个成员 agent + 预估成本/本轮上限"，用户确认后才拉起（成本纪律详见 §9.13）

**参数**：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `parallel` | 必填 | 并行执行的成员列表 |
| `aggregator` | 可选 | 汇总角色 |
| `subsequent_steps` | 可选 | 汇总后的步骤 |

---

## 4. 用户与 Team 的交互边界

**用户对运行中的 Team 没有"过程性手动介入"权**——不能改方向、换人、插话、暂停 Team。Team 一旦启动，按其 flow 自治运行。

**用户仅有的两个主动动作**（第五轮 D5-1）：

1. **abort**：终止整个 Team Run（独立终态，详见 §2.3 / §9.8）
2. **决策点响应**：在 flow 预先声明的衔接点（§9.10）响应={`continue` / `complete` / `abort` + 可选 feedback}——是 Team 流程"点名"用户参与的窗口，**不是"任意时刻手动介入"**

两个动作的语义分界：**"介入" = 过程控制（砍掉）**；**"终止" = 结束整局（保留）**；**"决策点响应" = 流程预声明的在场窗口（保留）**。

**决策点响应含两类门**（第七轮收口，P0-2）：flow 触发的门（收敛门 / 兜底门）与用户主动拉的 ad-hoc 门——用户随时可在 timeline 拉一个临时决策点去插话/纠偏（§9.10.2）。用户拉门扩展的是介入**时机**（不再只能等 flow 点名），不扩展介入**动作集**（仍是 `{action: continue|complete|abort + feedback}`，非裸插话）——V 决策与本节边界不变。

### 4.1 启动入口（用户启动 Team 的路径）

| 入口 | 触发方式 | 说明 |
|---|---|---|
| **skill** | 斜杠命令 + 自然语言双触发 | `team` skill 同时支持 `/start-team xxx` 和"帮我组建团队做 X" |
| **插件工具** | DSH 通过插件抛出的工具直接调用 | 不依赖 skill；skill 只是入口层文档，让 agent 容易读懂怎么调用 |

**架构归属**：核心逻辑全部在 **DSH 原生插件** 内。skill 是 thin wrapper，不在 skill 里实现核心能力。UI 是配置中心 + 常驻面板（**不作为 Team 启动入口**）。

**§4 与 Story 1 的协调**（第五轮 D5-1）：Story 1 第 5-6 步描述"用户看完一轮结论后说'critic 没说服我，让 brainstormer 再回应一下'→ DSH 触发新一轮"——这是决策点响应（round-table 流程预声明的衔接点），不是"任意时刻手动介入"。§4 重写后这两者不冲突：用户在场是被流程点名的，不是自由介入的。

### 4.2 DSH 调度者 session 控制

DSH 调度者 session **由用户在 DSH UI 手动切换**：

- 用户观察 DSH session 长度 → 在输入框触发 `handoff-hermes` skill → DSH 自己写 handoff 文档 → 用户点 + 号开新会话 → 新会话读文档接管 Team Run
- 详见 §9.6

### 4.3 用户介入的持久化（第五轮 D5-4）

- 独立 `user-intervention-log.jsonl`（每行：`{id, decision_point_id, user_message, action, timestamp}`）
- 不混 a2a-message-log（保留 Member 语义）；不塞 dispatch context_refs（用户反馈不是 artifact）
- 注入 = DSH 处理时把 feedback 写进下一轮 dispatch 的 task 文本

---

## 5. 数据存储（机制层）

DSH 侧实现时的逻辑结构如下。**具体存储引擎（YAML/JSON/SQLite）、文件系统路径、消息队列等由 DSH 侧决定**——本文档只规定逻辑形态。

### 5.1 目录结构

```
<DSH 数据根>/
├── roles/                          # 角色模板（全局）
│   └── <role-id>.json
│
├── members/                        # 成员实体（全局持久化）
│   └── <member-id>.json           #   删除规则：删除前引用检查（team-templates / 历史 run）；Run 创建时对 members/roles 拍快照（§5.1 快照说明）
│
├── team-templates/                 # Team 模板（全局或项目级）
│   └── <team-template-id>.json
│
└── team-runs/                      # Team Run 实例
    └── <run-id>/
        ├── meta.json              #   state、flow、members、task_description
        ├── dispatch-log.jsonl     #   DSH 调度事件流（协调日志，append-only，唯一写入者=DSH @§2.4）
        ├── handoff-log.jsonl      #   member→member 任务移交（协调日志，唯一事实源，单写入者=DSH；to 可为 DSH-routing @§2.5）
        ├── a2a-message-log.jsonl  #   Member 之间消息流（append-only，Q-M2；含 kind=system-wake）
        ├── state-history.jsonl    #   Team Run 状态变更历史
        └── sessions/              #   该 Run 内所有 Member 的 session
            └── <member-id>/
                ├── session-state.json    #   current_session_id、session_chain、inbox
                ├── session-log.jsonl     #   session 内事件流
                ├── handoff-<n>.md    #   self-handoff 文档（成员直接落盘，按 artifact 处理 @§9.3）
                └── artifacts/            #   该 Member 产出的 artifact（成员直接落盘 @§2.4）
                    └── <artifact-id>.<ext>
```

### 5.2 关键文件 schema（参考）

**`members/<member-id>.json`**：

```json
{
  "id": "<member-id>",
  "role_id": "<role-id>",
  "display_name": "...",
  "persona": "...",
  "cli_options_override": {},
  "metadata": {
    "created_at": "<iso8601>",
    "updated_at": "<iso8601>",
    "tasks_count": 0
  }
}
```

**`team-runs/<run-id>/meta.json`**：

```json
{
  "id": "<run-id>",
  "state": "pending|assembling|running|succeeded|failed|interrupted|aborted|archived",
  "degraded_flag": false,   # running 期间的修饰标志（第六轮收口，§2.3）
  "flow": "handoff-round-table|pipeline-with-feedback|fan-out-collect",
  "flow_config": {},
  "members": [
    { "member_id": "<global-member-id>", "instance_alias": "<within-run-name>", "snapshot": { "role_id": "<role-id>", "display_name": "..." } }
  ],   # snapshot = 创建时快照（§5.2 快照说明），成员/角色删除后历史 Run 仍自足
  "task_description": "<user original input>",
  "created_at": "<iso8601>",
  "started_at": "<iso8601>",
  "ended_at": null,
  "current_round": 0
}
```

**`sessions/<member-id>/session-state.json`**：

```json
{
  "current_session_id": "<adapter-session-id>",
  "session_chain": ["<session-id-1>", "<session-id-2>"],
  "handoff_files": ["handoff-1.md", "handoff-2.md"],
  "inbox": {
    "pending": ["<msg-id>", ...],
    "processed": ["<msg-id>", ...]
  },
  "state": "active|terminated"
}
```

**`dispatch-log.jsonl`**（每行一条）：

```json
{
  "id": "<dispatch-id>",
  "from": "scheduler",
  "to": "<member-id>",
  "task": "<description>",
  "context_refs": ["<artifact-id>", ...],
  "issued_at": "<iso8601>",
  "completed_at": null,
  "produced_artifact_ids": []
}
```

**`handoff-log.jsonl`**（每行一条，第六轮新增；唯一事实源，单写入者=DSH）：

```json
{
  "id": "<handoff-id>",
  "from": "<member-id>",
  "to": "<member-id>|DSH-routing",   # pipeline 场景路由占位（§3.2）
  "task": "<task description>",
  "artifacts": ["<artifact-id>", ...],
  "context": { "<snapshot>" },
  "reason": "<why>",
  "run_id": "<run-id>",
  "seq": 1,
  "timestamp": "<iso8601>"
}
```

**素材库快照**（第五轮 #5 收口配套）：Run 创建时对 members / roles 拍快照（id + 名称嵌入 run 记录，可存 `meta.json` 的 `member_snapshot` 字段）——历史 Run 自足，素材库实体之后删除不破坏历史审计。删除前引用检查挡"被引用时删除"，快照挡"删除之后"破审计。**两者都要**。

**`a2a-message-log.jsonl`**（每行一条，Q-M3 + Q-M4）：

```json
{
  "id": "<msg-id>",
  "from": "<member-id>",
  "to": "<member-id>|broadcast",
  "topic": "<主题>",
  "intent": "discuss|notify|confirm|request-info",
  "payload": { "<structured content>" },
  "in_reply_to": "<msg-id>",
  "timestamp": "<iso8601>",
  "delivered_to_inbox_at": "<iso8601>",
  "kind": "message|system-wake"
}
```

**`state-history.jsonl`**（每行一条状态变更）：

```json
{
  "from_state": "running",
  "to_state": "running (degraded_flag=true)",
  "reason": "<member-id> unrecoverable (timeout)",
  "timestamp": "<iso8601>"
}
{
  "from_state": "running",
  "to_state": "interrupted",
  "reason": "process-killed (DSH crash)",
  "timestamp": "<iso8601>"
}
```

### 5.3 存储策略说明

- 角色库 + 成员库 + Team 模板：**全局**（用户私有素材库）
- Team Run 实例：**项目级**（`.dsh/team-runs/<run-id>/`，跟项目走）
- artifact：**Team Run 实例目录下**（便于随项目归档/分享）

> 项目级 vs 全局的存储策略是**机制层决策**——DSH 侧决定具体实现。

**信任边界承诺**（第七轮收口，P1-2）：成员与 DSH **同信任域**——
1. **读**：成员可读项目内全部文件（含各 run 目录、各协调日志）——不设成员级权限隔离；
2. **写-协调**：五个协调日志唯一写入者是 DSH（§2.4）——成员不 append 任何协调日志；
3. **写-artifact**：成员可写自己的 artifact 与 self-handoff 文档。
跨 Run"无权读"**不作为能力边界承诺**；真实隔离（沙箱 / 权限 / 独立目录挂载）是 2.0 方向，非 1.0 现状。

---

## 6. 适配的 Adapter

首批三个 Adapter，**全部走 ACP 协议**：

| Adapter | 原生 ACP | 备注 |
|---|---|---|
| `hermes` | ✅ `hermes acp` | 官方原生 |
| `mcode` | ✅ `mcode acp` | 官方原生 |
| `claude-code` | ✅ 通过 `claude-agent-acp` 桥接 | 第三方桥接包 |

**DSH 侧作为 ACP 客户端**，通过 stdio JSON-RPC 与三个 Adapter 通信。三个 Adapter 在 DSH 视角下完全统一。

**扩展规则**：架构上预留扩展性，hermes / claude-code / mcode 以及未来加入的 Adapter（如 opencode）都是平级条目。**用户不能自己加 Adapter**——要新增必须改插件源码（详见 §12.1 A3）。

**为什么 Member 各自独立 Adapter（不用 DSH 内部 session）**：

- **核心优势**：让 Member 可以用不同的 LLM（不只是 DSH 自己的）—— 这是 DSH Team 的产品核心，不能放弃
- 如果用 DSH 内部 session，所有 Member 共用一个底层模型
- 独立 ACP 进程 = 每个 Member 是真正的独立 LLM 实体

---

## 7. 与 Hermes Profile / Bot Mode 的关系

**DSH Team 是独立的产品形态，不依赖 Hermes Bot Mode。**

- DSH Member **不**是 Hermes Profile
- DSH 内部维护自己的成员表
- Hermes 只是三种 Adapter 中的一种，可选
- 用户不装 Hermes 也能用 Team（用 claude-code 或 mcode 即可）

---

## 8. 已闭环的产品决策

| # | 决策 | 选项 | 备注 |
|---|---|---|---|
| Q1 | Member 是否对应 Hermes Profile | B（独立）| 不依赖 Hermes Bot Mode |
| Q2 | 首批 Adapter | hermes / claude-code / mcode | |
| Q3 | mcode 是什么 | MiniMax Code CLI（`mcode` 命令）| 通过 `mcode acp` 接入 |
| Q4 | Hermes 是否支持 ACP | ✅ 官方原生（`hermes acp`）| 之前误判为无，已纠正 |
| Q5 | Adapter 协议 | 全部走 ACP | DSH 是 ACP 客户端 |
| Q6 | Member 常驻 | ✅ 是（非一次性）| 有 session、history |
| A | Team 形态 | A + B + C 同时支持 | 群聊 + DAG + 混合 |
| D | Team 组装方式 | predefined + runtime 都支持 | |
| E | handoff 产物 | artifact + 引用关系 | |
| F | Team 模板保存 | 支持（一键保存）| |
| G | 调度者 | 隐式 + 可配置混合 | |
| H | 角色编辑技术暴露面 | L2（默认表单 + 高级折叠 JSON/YAML）| 覆盖小白与硬核用户 |
| I | persona 模板库 | 不做 | 等真有人喊"懒得写"再加 |
| J | Adapter 集合 | 封闭 + 扩展性预留 | 用户不能自加；改插件源码才能扩 |
| K | Team 模板编辑 | JSON/YAML + 实时预览 | 节点图只读；不堆复杂表单；不主动提示 flow 选错 |
| L | Team 内 Role 实例命名 | 名字唯一 | 不允许同名重复 |
| M | avatar 来源 | 仅默认几何 | 无 AI 无上传 |
| N | avatar AI moderation | 不做 | 当前未生效；引入 AI 生图时再说 |
| O | Team 启动入口 | skill（斜杠 + 自然语言双触发）| skill 不是唯一；插件抛出的工具也能开 |
| P | 核心逻辑归属 | DSH 原生插件 | skill 是 thin wrapper |
| Q | 组装策略 | 全局默认 + 单次可覆盖 | auto / manual |
| R | 常驻面板布局 | Linear 风 app shell | 左 sidebar + 主区 timeline + footer |
| S | handoff 视觉 | 主区独立卡片 | 退回用红色 |
| T | @mention 视觉 | 聊天气泡 + 左侧 mention 边 | |
| U | 成员栏位置 | 主区顶部 | chip 形式 |
| V | 6 种介入模式 | 全部砍掉 | Team 启动后用户无法手动介入 |
| Q-M1 | Member 跨 Team Run 记忆 | **完全不累积** | **锁定** |
| Q-Run-1 | Team Run 概念 | 一次完整运行 | 从启动到任务达成 |
| Q-Run-2 | Member session 生命周期 | Team Run 内一个 session | 跨 dispatch 持续，不重建 |
| Q-Run-3 | dispatch-log | 调度事件流 | 不切 session |
| Q-Run-4 | artifacts 位置 | Member session 下 | `sessions/<member-id>/artifacts/` |
| Q-Run-5 | Member 状态机 | idle ↔ working ↔ failed | 可多次 working，session 不重建 |
| Q-H1 | Member self-handoff 阈值 | **200k token** | 超过即触发 |
| Q-H2 | handoff 文档位置 | 灵活 | 不强制 |
| Q-H3 | handoff 内容生成 | Member 自己 | 按 `handoff-hermes` 提示词 |
| Q-H4 | 新 session prompt 拼接 | ①人格 ②handoff ③task 指令 | |
| Q-DSH-1 | DSH handoff skill | **复用 handoff-hermes** | 不新建 handoff-dsh |
| Q-DSH-2 | DSH handoff 触发 | **纯手动** | 用户在 UI 触发 |
| Q-DSH-3 | handoff 文档结构 | 必含 Run ID + 关键路径 + 状态 | |
| Q-DSH-4 | DSH 新 session | 读 handoff + 按需读 state | 不重读全部历史 |
| Q-M2 | Member 之间消息持久化 | **a2a-message-log.jsonl** | 跟 dispatch-log 平级 |
| Q-M3 | 混合架构 | dispatch 走 DSH；消息走 DSH 代理 | 不暴露外部 A2A 协议 |
| Q-M4 | 消息类型 | **结构化** `{topic, intent, payload}` | 便于路由/过滤/审计 |
| Q-M5 | Member inbox 行为 | **投递即唤醒**（DSH 轻量提示，§9.4）| DSH 不读内容，仅路由+唤醒（第六轮措辞修正）|
| Q-M6 | Team Run 状态机加 `degraded` | 部分失败 ≠ 完全失败（第六轮：改 running 修饰 flag，非独立状态）| 借鉴 TimYuann orchestra-dsh + 第六轮修正 |
| Q-M7 | read_only 角色 | **维持不做**（第五轮重开判定，详见 §14.5）| 真实用户声音 / 合规审计需求出现时再开 |
| Q1 | abort 终态语义 | aborted 独立终态；可从任意非终态进入（含 pending/assembling/running/interrupted；第六轮扩展）| 第五轮 D1-1 / D1-2 + 第六轮修正 |
| Q2 | 暂停-恢复 | **砍**——机制由 DSH handoff 隐式覆盖；文档全量清理 pause 残留（第六轮确认） | 第五轮 D2-1 + 第六轮确认 |
| Q3 | 单步失败 | 运行失败轻量重试；结果失败按 flow 语义；耗尽才上报 DSH | 第五轮 D3-1 |
| Q4 | 循环失败 | 默认 failed；DSH 可插队一次（重派/换人/终止） | 第五轮 D3-2 |
| Q5 | degraded 进入 | ≥1 非全部 Member 不可恢复；flow 中途即可；检测机制化（第六轮收口：改为 running 的修饰 flag，§2.3/§9.8.4） | 第五轮 D3-3 + 第六轮修正 |
| Q6 | dispatch 终态 | 增 `interrupted`（被 abort / DSH 崩溃打断）；区别于 completed/failed | 第五轮 D1-6 + 第六轮：与 Run 级 interrupted 名称对齐 |
| Q7 | plan_output | 可选，默认 false，无按需导出 | 第五轮 D4-1 |
| Q8 | plan 生成者 | DSH 生成，基于收敛声明 conclusion 字段（无独立 summary 机制） | 第五轮 D4-2 |
| Q9 | plan 枚举 | artifact type 新增 `plan` | 第五轮 D4-3 |
| Q10 | conclusion 字段 | 强约束只在收敛点生效，普通消息 schema 保持松散 | 第五轮 D4-2 |
| Q11 | plan 结构 | 正文文档 + 提炼 steps[] 索引（role + intent + expected_artifact required） | 第五轮 D4-4 |
| Q12 | plan 耦合度 | 软参考；采纳必留痕（dispatch context_refs 引用 step） | 第五轮 D4-5 |
| Q13 | plan-decision 关系 | plan.derived_from 必指向收敛锚点（decision 或带 conclusion 的收敛消息） | 第五轮 D4-6 |
| Q14 | plan step schema | role + intent（任务域动词）+ expected_artifact（required，type 枚举+一句描述） | 第五轮 D4-4 |
| Q15 | plan 目录归属 | produced_by 类型扩展允许 scheduler；plan 放 Team Run 顶层 | 第五轮 D4-7 |
| Q16 | plan 与 handoff | handoff 模板加"最新 plan: <id> <path>"，仅引用未执行完的 plan | 第五轮 D4-8 |
| Q17 | 不收敛处理 | 三态判定：共识→plan / 有方向→decision / 卡死→DSH 介入 | 第五轮 D4-9 |
| Q18 | 决策点抽象 | 决策点开点 = [收敛门 / 兜底门 / 用户 ad-hoc 门] 三合一，零 DSH 裁量；普通轮默认关（第七轮拍板 1） | 第五轮 D5-2 + 第七轮拍板 1 |
| Q19 | 决策点响应 | 仍 `{action: continue\|complete\|abort, feedback?}`；ad-hoc 门同构（第七轮拍板 1） | 第五轮 D5-3 + 第七轮拍板 1 |
| Q20 | 决策点持久化 | 独立 user-intervention-log.jsonl；注入 = feedback 写进下一轮 dispatch task 文本 | 第五轮 D5-4 |
| Q21 | 决策点等待 | 两级 wait_minutes；超时按 flow 分流——round-table→abort，pipeline/fan-out→continue（第七轮拍板 2-②，覆盖原全局 continue）；窗口内多次介入取最后一条 action | 第五轮 D5-5 ~ D5-7 + 第七轮拍板 2 |
| Q22 | 产物共享 | 引用式 + id 带 run 归属段；不可变快照 + derived_from 同源链；归档 ≠ 删除；当前版本不清理 | 第五轮 D6-1 ~ D6-6 |
| Q23 | 侧栏决策点状态 | 要显示 | 第五轮 D7-1 |
| Q24 | 决策点视觉 | 状态 pill 上小角标，不新造 pill（匹配"决策点不是新状态"机制） | 第五轮 D7-2 |
| Q25 | 多 Team 介入交互 | 侧栏只导航；介入面板在 Team 主区 = timeline 自然延续（输入卡） | 第五轮 D7-3 |
| Q26 | 历史 Team 视图 | 只读默认 + 重跑按钮（复用 members+flow_config，预填 task，可勾选注入原 Run artifacts） | 第五轮 D7-4 |
| Q27 | 侧栏活跃/历史 | 上下同框 + 历史区默认折叠（"历史 (N)"） | 第五轮 D7-5 |
| Q28 | A2A 消息 UI | 统一进 timeline；密度按 flow 自适应（round-table 主事件，pipeline/fan-out 辅） | 第五轮 D7-6 |
| Q29 | 视觉区分 | 事件类型区分；用户介入 = 决策点事件卡片（输入框+action+消息一体），不用红色气泡（红色已锁给 handoff 退回） | 第五轮 D7-7 |
| Q30 | in_reply_to 视觉 | 一级虚线引导；不画完整线程树 | 第五轮 D7-8 |

> §12 补充了 H–V 共 14 项第二轮决策的讨论过程。
> §13 补充了 M1 + Run-1~5 + H1~4 + DSH-1~4 共 14 项第三轮决策。
> §14 补充了 M2~M7 共 6 项第四轮决策。
> 第六轮收口（2026-08-19 审阅后）：degraded 改 flag（Q5/Q-M6 措辞修正）、新增 interrupted（D1-5 语义修正）、assembling 出口、handoff 持久化、并发边界、双 Story 验收——详见 §19。
> 第七轮收口（2026-08-19 拍板后）：决策点收敛门 + 用户门模型、成本纪律（预飞行 / 分流超时 / 上限门）、单写入者重定范围、信任边界三句、dispatch from 回退、对账在途 dispatch——详见 §9.10.1 / §9.13 / §2.4 / §5.3 / §9.6。

---

## 9. 核心机制

本节定义 Team Run 的运行时机制——状态如何流转、session 如何管理、context overflow 怎么办、消息如何路由、DSH 调度者怎么换 session。

### 9.1 Team Run 生命周期

```
[用户输入] → skill / 插件工具触发
   ↓
[启动] 创建 run-id，状态 pending
   ↓
[拼队] DSH 按策略选定 members → 状态 assembling
   ↓
[运行] 为每个 member 建立 session → 状态 running
   ↓
   ├─→ dispatch 事件写入 dispatch-log.jsonl
   ├─→ Member 之间消息写入 a2a-message-log.jsonl
   ├─→ Member 产出 artifact → 落到 sessions/<member-id>/artifacts/
   ├─→ Member 内部 context 超阈值 → self-handoff（详见 §9.3）
   ├─→ DSH 内部 context 超阈值 → 用户手动 handoff（详见 §9.5）
   ↓
[结束] succeeded / failed / interrupted / aborted → 销毁所有 Member session（进程随 DSH 销毁，产物保留）
   ↓
[可选] 用户归档 → 状态 archived

`degraded` 不是结束态——running 期间可置 degraded flag（§2.3），只有最终落 succeeded(partial) / failed 才销毁 session。
```

### 9.2 Member Session 管理

**核心规则**：

- Member 加入 Team Run → **建立 1 个 session**（通过 ACP `session/new`）
- Member session 跨该 Run 内**所有 dispatch**——同一个 session 里多次 `session/prompt`
- Member session 跨 Run 边界**不继承**——新 Run = 新 session
- Team Run 结束 → **销毁所有 Member session**（通过 ACP `session/close`）

**为什么不"每 Dispatch 一个 session"**：

- "DSH 跟一个 Member 来回讨论把需求确定下来" = 一次 dispatch → 但内含多轮 prompt
- 拆 session 会让 Member **不记得刚说的话**——失去"对话感"
- 同 session 内多次 prompt 累积上下文，**这是 session 的内在属性**

**Member 在 Run 内的状态机**：

```
idle → working → idle → working → ...
                ↓
              failed
```

一个 Member 可多次 `working → idle → working`，但 session **不重建**。

### 9.3 Member Self-handoff（context overflow）

**触发**：Member session context 超过 **200k token**。

**机制**：Member **自我交接给自己**（不交接给别人）：

1. 触发阈值 → Member 按 `/handoff-hermes` 提示词**自己写一份 handoff 文档**
2. 写入 `sessions/<member-id>/handoff-<n>.md`（**成员直接落盘，按 artifact 处理**——不占用协调日志的"单写入者"承诺，§2.4；落盘方式不影响"自我交接"语义）
3. ACP `session/close` 关闭当前 session
4. ACP `session/new` 创建新 session
5. ACP `session/prompt` 给新 session 注入 prompt：

```
[Member 人格设定]
  +
[handoff-<n>.md 内容]
  +
[之前的 task 指令]
```

6. 更新 `session-state.json`：

```json
{
  "current_session_id": "<new-session-id>",
  "session_chain": ["<old-session-id>", "<new-session-id>"],
  "handoff_files": ["handoff-1.md", "handoff-2.md"]
}
```

### 9.4 混合架构——Dispatch + A2A-style 消息

DSH Team 采用**混合架构**：

| 层 | 通道 | 用途 | 谁发起 |
|---|---|---|---|
| **调度层** | dispatch / handoff（走 DSH）| 任务派发、任务移交、artifact 流转 | DSH（dispatch） / Member（handoff）|
| **协作层** | A2A-style 消息（DSH 代理）| 讨论、确认、通知 | 任何 Member |
| **终止层** | DSH 直接操作 | abort / 重派 / 失败处理 | DSH |

**协议栈**：

```
Member-A → ACP → DSH (路由层) → ACP → Member-B
            ↑
      a2a-message-log.jsonl
      dispatch-log.jsonl
```

- 底层协议都是 **ACP**
- DSH 在中间完成消息路由（不需要 Adapter 实现 A2A 协议）
- **不暴露外部 A2A 协议**——避免要求 Adapter 实现 A2A endpoint

**消息投递流程**（第六轮收口：投递即唤醒）：

```
Member-A 调用 ACP 让 DSH 发消息
   ↓
DSH 写入 a2a-message-log.jsonl
   ↓
DSH 投递到 Member-B 的 inbox（更新 session-state.json）
   ↓
DSH 向 Member-B 发轻量 ACP prompt："你有一条新消息"（只看 header 不读内容）
   ↓
Member-B 被唤醒 → 读取 inbox → 处理
   ↓
（可选）Member-B 发新消息回复 → 循环
```

**唤醒防活锁（第六轮收口）**：同一目标在已有未消费队列时，T 秒内不重复唤醒（`wake` 去重）。否则 A 回 B、B 回 A 的 ping-pong 会无限唤醒风暴。

**唤醒日志（第六轮收口）**：wake 消息进 `a2a-message-log.jsonl`，带 `kind=system/wake`——回看时能答"谁被唤醒了几次"，也解释"成员为何突然发言"。

**定时轮询不采用**（延迟不可控，明确一行）。

**与生命周期模型联动**：DSH 死 = 唤醒停 = Run 挂起（§9.6）——wake 没有独立通道能绕开 DSH 存活。

**为什么 Member 自己消费 inbox 而不是 DSH 调度**（Q-M5，措辞第六轮修正）：

- DSH **不读消息内容，仅路由 + 唤醒**（投递时唤醒是机制事实，但 DSH 只看 header/topic/intent，不参与内容理解）——"每轮推进"依赖此通道，唤醒触发者就是 DSH 的路由动作
- Member 自治接收——符合"自治系统"产品定位
- 减轻 DSH context 负担（不驻留全量消息）

**dispatch 和 A2A 消息的边界**：

| 场景 | 走哪条 |
|---|---|
| DSH 派活给 Member（带 task 描述 + context_refs）| **dispatch** |
| Member 完成 task 后移交产物给下一个 | **handoff** |
| Member 问另一个 Member "这个 API 边界行不行？"| **A2A 消息** |
| Member 通知其他 Member "我完成了 X" | **A2A 消息（broadcast）** |
| Member 请求另一个 Member 提供额外信息 | **A2A 消息（request-info）**|

**区分原则**：**有任务派发语义 → dispatch / handoff；纯讨论 / 通知 / 确认 → A2A 消息**。

### 9.5 Artifact 流转机制

**关键原则**：artifact **写到文件系统**，handoff / 消息只传递引用。

- Member 产出 → 写 `sessions/<member-id>/artifacts/<artifact-id>.<ext>`
- handoff / 消息携带 `artifacts: ["<artifact-id>"]`（不是 content 本体）
- 接收方按需读取文件内容

**理由**（来自 Anthropic 经验）：

> "Direct subagent outputs can bypass the main coordinator ... Subagents call tools to store their work in external systems, then pass lightweight references back to the coordinator. This prevents information loss during multi-stage processing and reduces token overhead."

——避免"电话游戏"信息丢失；大块输出不通过 DSH 转发。

### 9.6 DSH 调度者 Session 控制

DSH 调度者 session **由用户手动控制**——因为 DSH 是用户在前台直接对话的 agent。

**DSH 跟 Member 的本质区别**：

| 维度 | Member | DSH 调度者 |
|---|---|---|
| 用户可见性 | 后台（ACP 进程）| 前台（DSH 客户端输入框）|
| session 谁控制 | Member 自己 / DSH 自动 | **用户**手动 |
| 换 session 触发 | 自动（200k token 阈值）| **用户观察后手动** |
| handoff 谁生成 | Member 自己（按 `/handoff-hermes`）| DSH 自己（按 `/handoff-hermes`）|

**DSH handoff 流程**：

1. 用户感觉 DSH session 长了 → 在 DSH 输入框触发 `handoff-hermes` skill
2. DSH 写一份 handoff 文档（**强制包含**）：
 - Team Run ID + 绝对路径
 - `meta.json` / `dispatch-log.jsonl` / `a2a-message-log.jsonl` / 各 Member artifacts 目录路径
 - 当前 Team Run 状态（从 `meta.json` 读）
 - "下一步"建议（可选）
3. 用户在 DSH UI 点 + 号开新会话
4. 新 DSH 会话**先读 handoff 文档**——恢复"我现在管着哪个 Run"
5. **按需**读取 Team Run 状态文件（不是一次性全读——避免新 session 也爆）

**生命周期模型**（第六轮收口，融合 DSH 崩溃 / 停摆 / 全局视野）：

- **DSH 进程 = Run 生命周期持有者**。DSH 死 → 成员进程一并终止（整队销毁）——ACP session 在 adapter 内存中，重连不可能；产物保留在 run 目录可回看，重跑 = 重新组队（不自动恢复、不收养孤儿进程）。
- **启动对账（startup reconciliation）**：DSH 启动时扫描 Runs 目录——发现 `running` 但无持有进程的 Run，标记 `interrupted`（reason=`process-killed`）。死进程写不了墓碑，对账就是墓碑写入者的唯一答案。对账时对所有 `completed_at=null` 的在途 dispatch 统一标记 `dispatch-interrupted`（reason=`process-killed`，复用 D1-6/Q6 枚举，不新增独立值）；半成品 artifact 保留（不可变快照原则，§9.11.4），且随该 dispatch 记录可被重跑注入（§9.12.4）。——对账写 dispatch-log 落在"协调日志唯一写入者=DSH"，与 §2.4 自洽。
- **interrupted 出口**：interrupted → 用户点击重跑 → running（重新组队）；或 interrupted → aborted（放弃）。文档不写自动恢复。
- **全局视野 = 可寻址性，不是驻留**：DSH 不常驻全量上下文，而是维护轻量 **Runs 索引**（run_id / 状态 / 成员 / 关键事件指针）；plan 生成（§9.9.2 需要"全局视野"）基于索引 + 按需读指定文件。"按需读"（DSH-4）与"全局视野"（§9.9.2）不矛盾——索引解决找得到，按需读解决读得动。
- **DSH 不在线 = Run 挂起**：没有独立保底承诺（1.0 事实），回到后由对账恢复或标记。成员进程随 DSH 死亡而销毁，"停摆"自然表达为 Run 挂起，不需要单独产品承诺。

### 9.7 DSH 调度者 session 切换期间的 Team 行为（第五轮 D2-2）

**本文档不引入"暂停"机制**——它没有用户故事、没有触发源、是 DSH handoff 已有机制的自然延伸。

**机制层行为**（与状态机无关——`running` 状态保持不变）：

- **停摆**：DSH 调度者 session 切换期间，无调度者推进新 dispatch，flow 自然冻结（这是机制事实，不是状态变更）
- **保活**：Team Run 未进入终态前，所有 Member session 保持连接（§9.2 已隐含）。注意保活只覆盖**用户主动切 session**；DSH 进程死亡时成员进程一并销毁（§9.6 生命周期模型），不适用保活
- **恢复**：新 DSH session 接管时按 DSH-4 流程：读 handoff 文档 → 按需读 state → 重连所有 Member session → 继续调度

**为什么不引入 paused 状态**（第五轮 D2-1）：

- "用户主动暂停整个 Team"是 UI 层面被 6 种介入模式砍掉的项目（V 决策），无须新机制
- "DSH 主动暂停"不存在触发场景——DSH handoff 是用户触发的纯手动动作
- 现有的"DSH 不在 → 停摆 → 重连"链路自然覆盖了所有"暂停-恢复"需求（第六轮收口确认：文档全量清理 pause 残留，仅本论证与 §8 Q2 决策记录保留）

### 9.8 失败处理（第五轮 Q1-Q6 全部拍板，2026-08-19）

**§9.8 覆盖了原先 §9.8 占位 + 第二轮失败处理相关讨论的所有留白。**

#### 9.8.1 abort 语义（Q1 / D1-1~D1-7）

**abort = 终止，不是介入**（D1-2）。abort 与 V 决策（过程性介入砍掉）正交：用户唯一的"主动动作"。

- **独立终态**（D1-1）：`aborted` 与 `failed` 不合并。`failed` reason 由 Team 自治产生；`aborted` reason 是用户动作。审计/可观察性/可恢复性都不同。
- **进入条件**（D1-3）：用户显式触发 `aborted`；可从 `running` 或 `degraded` 进入（degraded 也是"自然结束前"）。
- **进入动作**（D1-4）：DSH 立即停止派发新 dispatch + 中断当前在跑的 dispatch；已完成 dispatch 的产物（artifact / log）保留——这是"终止"而非"回滚"。
- **进程层被杀**（D1-5，第六轮收口修正）：**指 DSH 进程被 kill**（桌面客户端退出 / 崩溃）——归类为新增的 `interrupted` 状态（reason=`process-killed`），**不再归入 `aborted`**（aborted 保留给用户主动动作，语义不可混淆）。不引入 `killed` 状态。
- **dispatch 终态**（D1-6）：`dispatch-log.jsonl` 新增终态值 `interrupted`（区别于 `completed` / `failed`），标记被 abort 打断的 dispatch，与被中断的半成品 artifact 对上。
- **state-history**（D1-7）：必记录 `aborted` 转换的 reason（形式待定，必须有）。

#### 9.8.2 单步失败（Q3 / D3-1）

失败分两类，处理路径不同：

- **运行失败**（进程挂 / 超时 / 无产物）：flow 无关，全局轻量重试（DSH 不参与）
- **结果失败**（有产物但判定不达标）：由 flow 语义定义——
  - `pipeline-with-feedback` → 走 feedback loop 重试
  - `fan-out-collect` → 部分失败 → 置 degraded flag（§2.3），join 照常触发（剔除死路），剩余成员继续，最终落 succeeded(partial) 或 failed
  - `round-table` 失败标准 = "讨论不收敛"（无"发言失败"概念，详见 §9.9 三态判定）

flow 规则耗尽才上报 DSH 兜底。

**否决**：单步失败 → Team 立即 failed（过度）；自动跳过 + warning（制造"假 succeeded"，脏化 succeeded 语义）。

#### 9.8.3 循环失败（Q4 / D3-2）

- `pipeline-with-feedback` 中 feedback loop 连续 `max_retries` 次失败 → **默认 `failed`**（符合已有"达到重试上限 = failed"规则）
- DSH 可**插队一次**（非必经步）：
  - 重派 / 换人 → Team 回 `running`
  - 终止 → `failed`
- DSH 不响应 → 自然落回 `failed`（无需 N 步计数约束）
- degraded flag **不适用 pipeline**（顺序 flow 没有"其他存活成员"概念；pipeline 单步失败直接走 feedback 或 failed）

#### 9.8.4 degraded 进入条件（Q5 / D3-3，第六轮收口改为 flag 语义）

`degraded` 不再是独立状态（§2.3），而是 `running` 的修饰 flag：

- **判定时点**：flow 中途即可（不收尾才判定）
- **判定规则**：≥1 非全部 Member 不可恢复 → 置 degraded flag（全部挂 = `failed`，不是 degraded）
- **"不可恢复"检测机制化**：进程挂 / 超时 / 重试耗尽 = 可机器判定
- DSH 判定仅在"边界模糊"时启用（如 Member 自评"任务不可能完成"）
- **flag 置位后行为**：不再向已死成员派发任务；终态判定门槛放宽（部分达成可算 succeeded(partial)，必须标注参与/失败成员清单）；其余流程照常——join 照常触发、analyzer 照跑
- **degraded 期间剩余成员再失败**：走正常失败路径（§9.8.2）；不定义 degraded→degraded 迁移（flag 一旦置位保持到终态）

#### 9.8.5 dispatch 终态枚举（Q6 / D1-6）

| 终态 | 含义 |
|---|---|
| `completed` | dispatch 自然完成 |
| `failed` | dispatch 自身失败（运行失败或结果失败） |
| `interrupted` | dispatch 被 abort 打断（区别于 failed，避免混淆"自然失败"与"被中止"）|

### 9.9 Plan 机制（Discussion → Plan，第五轮 Q7-Q17 全部拍板，2026-08-19）

**说明**：借鉴 TimYuann/orchestra-dsh 的"Discussion = Plan"概念，但保留 Adapter 独立性，**不引入 orchestra_report 通道**。本节定义讨论产出 plan 的机制。

#### 9.9.1 plan_output 开关（Q7 / D4-1）

- `flow_config.plan_output` 可选配置，**默认 `false`**
- 关闭时：讨论收敛自然产生 decision（结论），不产 plan
- 开启时：讨论收敛产生 plan（执行计划）
- **不做按需导出**：后续想要 plan = 重跑注入旧产物（a2a-message-log + artifacts 都在，context_refs 注入）

#### 9.9.2 plan 生成者（Q8 / D4-2）

- **DSH 生成**——唯一拥有全局视野的调度者（派过所有 dispatch、看过所有引用）
- 单个 Member 写 plan 是越权定方向（只看到子任务，看不到全局）
- **不引入独立 summary 机制**：讨论收敛点本身可结构化——任何成员声明收敛 → 消息 payload 带 `conclusion` 字段（Q-M4 已锁定 `{topic, intent, payload}`，零新机制）
- `conclusion` 强约束只在**收敛点**生效，普通消息 schema 保持松散（Q10 / D4-2）

#### 9.9.3 plan artifact 结构（Q9 / Q11 / Q14 / Q15 / D4-3 / D4-4 / D4-7）

- **artifact type 枚举新增 `plan`**（Q9 / D4-3）
- `produced_by` 类型扩展允许 `scheduler`（Q15 / D4-7）
- 目录归属：Team Run 顶层（与 `meta.json` 平级），**不归任何 Member session**
- `produced_in_session` 可空（scheduler 产出，无具体 session）

**plan 内容结构**：

```
plan = {
  content_ref: <正文文档（自由，自然语言）>,
  steps: [     # 提炼索引（不是写作模板）
    {
      role: <角色>,
      intent: <任务域动词，如 produce/review/collect/synthesize/decide>,
      expected_artifact: { type: <code|report|data|analysis|decision|discussion|plan>, desc: <一句描述> }  # required
    },
    ...
  ],
  derived_from: [<收敛锚点 id>],   # 详见 §9.9.5
  produced_by: scheduler,
  ...
}
```

**关键规则**（Q11 / Q14 / D4-4）：

- `steps` 是**提炼索引**不是写作模板——DSH 写 plan 时先写正文，再提炼 3-5 步索引。避免"以 schema 为第一写作目标"导致空泛步骤
- `expected_artifact` 是 **required**——它是 plan 产出资格的质检锚点：能产 plan 的收敛，必有产出方向；无产出方向时该走 §9.9.6 不收敛三态判定
- `topic` / `acceptance_criteria` 不预决，留给下游 dispatch
- `intent` 任务域动词独立于 a2a 消息 intent（消息域 discuss/notify/confirm/request-info 区分；**具体枚举值 produce/review/collect/synthesize/decide 待拍为 Open Question**）

#### 9.9.4 plan 与 dispatch 耦合（Q12 / D4-5）

- **软参考，非硬约束**——保留 DSH 调度者自适应能力
- **采纳必须留痕**：dispatch 采纳某 plan step 时，该 dispatch 的 `context_refs` 必引用对应 step
- 偏离允许，偏离留痕（commitment done）

#### 9.9.5 plan.derived_from 收敛锚点（Q13 / D4-6）

链条：`discussion → 收敛锚点 → plan → dispatch`

- `plan.derived_from` **保持必填**，取值域为（第六轮收口扩展）：
  - 一个 `decision` artifact（讨论"有结论无执行方向"时）
  - 一条带 `conclusion` 字段的收敛消息（讨论"结论和执行合一"时）
  - **用户决策点记录**（round-table 必经路径：succeeded = 用户确认，user-intervention-log 记录天然是锚，§9.9.6）——DSH 无需新造任何记录
- 不强制要求 decision 作为必经环节——避免空转产物
- **convergence_note 降级为兜底注释字段**：仅非决策点路径（pipeline / fan-out 的 plan）且确实无上述三类锚点时，DSH 可写，且必须引用具体消息 id 区间——不作为独立锚，避免"为填字段而造记录"
- decision 的 producer：discussion 收敛时"有结论无执行方向"自然产 decision

#### 9.9.6 讨论不收敛处理（Q17 / D4-9）

**不收敛 ≠ degraded**（degraded 是成员级故障，Q5 已锁）。DSH 在**任一轮边界**检收敛候选，检出即按三态判定开收敛门（§9.10.1）；`max_rounds` 到达为兜底门判定：

1. **有共识** → 产 `plan`（按 `flow_config.plan_output` 开关）→ **开决策点 → 用户确认 → succeeded**（用户不确认则 Run 停留等待态，不自动落 succeeded）
2. **无共识但有方向** → 产 `decision`（结论 = "方向未定/暂缓"）+ 呈现给用户 → **开决策点**（用户可 complete / continue / abort）
3. **卡死**（无进一步信息价值）→ DSH 介入：自动重派一次或终止

**succeeded(round-table) 唯一入口 = 用户在决策点确认完成**（第六轮收口，§9.9.6 / §2.3 状态表）：DSH 的收敛 / 卡死判定只决定"开决策点还是开介入点"，**不决定 succeeded**。succeeded 判定锚：用户决策点确认记录（user-intervention-log 中的 `action=complete`）——这也成为 §9.9.5 derived_from 的天然锚（见下）。

**其余 flow 的 succeeded**：pipeline / fan-out 默认决策点关闭（§9.10.1），succeeded 由调度者按 flow 完成条件判定（pipeline：最后一步通过；fan-out：join 完成 + aggregator 产出）。

**用户失联**：决策点等待超时按 flow 分流（round-table→abort，pipeline/fan-out→continue，§9.10.4）；round-table 无用户确认不自动落 succeeded（停留等待态，与 §9.6 的"DSH 死=挂起"同一精神）。

#### 9.9.7 plan 与 DSH handoff（Q16 / D4-8）

- DSH handoff 文档（§9.6）模板加一行：`最近 active plan: <id> <path>`
- **仅引用未执行完的 plan**——已执行完的 plan 降级为历史产物，不占 handoff 关注位

#### 9.9.8 plan 的定位（Q12 软参考后的校准）

- plan 的消费者：**未来 DSH session（跨 handoff）+ 回看的用户**
- plan 的本质：**调度决策的显式化记录**（不是"执行剧本"）
- 软参考 + 采纳留痕确保 plan 是"可审查事实"而非"调度指令"

### 9.10 决策点与用户介入（第五轮 Q18-Q21 全部拍板，2026-08-19）

**说明**：本节对应 §4 重写后的"决策点响应"机制——用户在 flow 预声明的衔接点被动参与的窗口。详见 §4 / §4.3。

#### 9.10.1 衔接点 / 决策点抽象（Q18 / D5-2，第七轮拍板 1 重写）

**决策点（门）的开点条件 = 以下三者的并集，零 DSH 裁量**：

1. **收敛门**：DSH 三态判定（有共识 / 有方向 / 卡死）在**任一轮边界**检出候选即开（§9.9.6，不再只等 max_rounds）；
2. **兜底门**：`max_rounds` 到达必开一次；
3. **用户门（ad-hoc）**：用户随时可在 timeline 主动拉一个临时决策点（插话 / 纠偏 / 加约束），走标准决策点响应（action + feedback 注入，§9.10.2）——扩展介入**时机**、不扩介入**动作集**（V / §4 边界不变）。

**普通轮结束默认不开门**（原 round-end 默认 ON → OFF）。门作为结构性属性由 flow 定义（用户不能发明）；`flow_config` 只控制收敛门 / 兜底门是否向用户开放（round-table 默认开收敛门 + 兜底门；pipeline / fan-out 默认关）。

#### 9.10.2 决策点响应模型（Q19 / D5-3）

```
decision_point_response = {
  action: continue | complete | abort,
  feedback?: <自由文本，含追加约束>
}
```

- **没有"评价"独立动作**——评价必须是 `continue` / `complete` 的载荷
- **没有"切换方向"独立动作**——用户追加约束是 feedback 的自然子集，DSH 自治消化
- `feedback` 是自由文本（含追加约束、信息补充、修正），DSH 自治决定如何用
- **用户主动拉的 ad-hoc 门与 flow 触发的门同构**（第七轮拍板 1）：同一 `decision_point_response = {action, feedback?}` 模型，可标记 `is_ad_hoc=true`；用户不需等 flow 点名即可开此门；其 feedback 走标准注入路径（写进下一轮 dispatch 的 task 文本，§4.3）

#### 9.10.3 决策点持久化（Q20 / D5-4）

- **独立 `user-intervention-log.jsonl`**（每行：`{id, decision_point_id, user_message, action, timestamp}`）
- **不混 a2a-message-log**（保留 Member 语义；`from` 字段不需要 user 枚举）
- **不塞 dispatch context_refs**（用户反馈不是 artifact）
- **注入机制**：DSH 处理决策点响应时，把 `feedback` 写进下一轮 dispatch 的 `task` 文本

#### 9.10.4 决策点等待机制（Q21 / D5-5 ~ D5-7）

- **决策点等待 = running 下的"DSH 主动等待"子状态**，**非新状态机状态**
- **有界等待**：`flow_config.decision_points[].wait_minutes` 可配
  - 两级配置：全局默认（默认 10 分钟）+ 单点 override（round-table 结构重复点适用）
  - 写法：`flow_config.decision_points[]: [{ id: "round-end", wait_minutes: 10 }]`
- **超时按 flow 分流**（第七轮拍板 2-②，覆盖原全局 continue）：
  - `round-table` 收敛门 / 兜底门超时 → 有界等待后 **abort**（释放资源；产物 / artifact 保留，可回看可重跑，非丢成果；与 §9.9.6"超时 ≠ 自动 succeeded"一致）
  - `pipeline-with-feedback` / `fan-out-collect` 门超时 → **continue**（步骤有明确边界、能自动落 succeeded，不失控；其决策点默认关，此规则仅在显式开启时生效）
- **窗口内多次介入允许**：
  - 窗口内所有用户消息 = 同一个决策点的响应流
  - DSH 在窗口关闭时以**最后一条 `action`** 为准做决策
  - `feedback` 不合并（保留"我改主意了"的推翻性）
  - 窗口外迟到消息无决策点归属，但 DSH 调度时可见

### 9.11 产物共享 + 版本管理（第五轮 Q22 全部拍板，2026-08-19）

#### 9.11.1 跨 Run 引用模式（Q22-1 / D6-1）

- **跨 Run 引用式**（非复制式）——B 队 Run 直接引用 A 队 Run 的 artifact id，读 A 的路径
- `artifact.id` 带 run 归属段（`<run-id>/<artifact-id>`）——展示层可解析归属（外部 vs 内部引用）
- 与同 Run 引用无类型差别（区分只在展示层）
- Q-M1（Member 跨 Run 不累积）只约束 session 上下文，不约束产物引用

#### 9.11.2 引用时机（Q22-2 / D6-2）

- **DSH 调度时引用**（`dispatch.context_refs`）
- **plan 时引用**（`plan.derived_from`）
- **成员无跨 Run 寻源 = 注入策略约定，非能力边界**（信任模型 §5.3 / P1-2）：成员与 DSH 同信任域、可读项目内全部文件（§2.4/§5.3）；DSH 不注入 = 不引导成员去读外部 Run。真实隔离（沙箱 / 权限 / 目录挂载）不在 1.0 承诺内。成员可在 dispatch 完成或 handoff 时表达"我需要外部数据 X"，DSH 调度决定是否注入

#### 9.11.3 生命周期与锁存（Q22-3 / D6-3）

- **归档（archived）= 软关闭**：artifact 原地保留，不检查引用
- **删除（物理清理）= 检查引用计数**：被引用的 artifact 拒绝删除
- **锁存锁的是删除，不是修改**（不可变快照下"不能改"是默认事实）
- 锁存只挂在删除保护上，与归档无关

#### 9.11.4 版本管理（Q22-4 / D6-4）

- **不可变快照**：重跑产生新 artifact id，原 artifact 永远保留
- 引用永远指向具体 id，**不指向"最新"**
- 同源关系：重跑的新 artifact `derived_from` 旧 artifact；"取同源最近版本" = 沿 `derived_from` 反向找链尾
- `metadata` 版本号降为**描述性信息**（非语义字段）

#### 9.11.5 归档可见性（Q22-5 / D6-5）

- 归档允许；归档时检查引用并记录 warning（"N 个 artifact 仍被外部引用，已锁存"）进 `state-history.jsonl`
- UI 呈现细节（弹窗 / 阻止按钮）不在本节范围

#### 9.11.6 清理策略（Q22-6 / D6-6）

- **当前版本不做自动清理**（无 TTL、无冷区）
- 限制措辞：不是"永不清理"，是"本版本不实现"
- 结构留口：artifact 已有 `created_at` + `derived_from`，未来加清理机制不需要改结构

### 9.12 多 Team UI + 历史切换 + A2A 消息呈现（第五轮 Q23-Q30 全部拍板，2026-08-19）

#### 9.12.1 侧栏决策点等待状态（Q23 / D7-1）

- **侧栏显示决策点等待状态**——决策点是多 Team 场景下唯一对用户有召唤力的信号
- 不显示 = 用户错过窗口 = 静默超时 = 自治走完，产品价值损失

#### 9.12.2 决策点提示视觉（Q24 / D7-2）

- **状态 pill 上小角标**（不是高亮，不是新 pill）
- 机制匹配：决策点不是新状态机状态，是 running 派系上的标记（小角标正好表达"上层信号，不破坏层级"）
- 具体颜色 / 动效进视觉细节 backlog
- 标准写死："可扫一眼识别"——多 Team 多个角标时必须明显但不打断

#### 9.12.3 多 Team 介入交互（Q25 / D7-3）

- **侧栏只导航**——不暴露介入操作
- **介入面板在 Team 主区 = timeline 自然延续**
- 形态：最后一条消息后出现"等待你的反馈"输入卡（action 三选 + 反馈输入）
- 介入动作嵌在事件流里，用户做 `continue` / `complete` 决策时有完整上下文在眼前

#### 9.12.4 历史 Team 视图（Q26 / D7-4）

- **只读默认** + **重跑按钮**
- **重跑 = 复用 members + flow_config + 预填 task_description（可改）+ 启动前可勾选注入原 Run artifacts 为初始 context_refs**
- 不压缩 timeline（历史是审计核心，压缩丢上下文）

#### 9.12.5 侧栏活跃 / 历史区分（Q27 / D7-5）

- **上下同框 + 历史区默认折叠**（"历史 (N)"）——展开见列表
- 不用 tab（tab 制造人为优先级）
- 不裸同框（防历史多时淹没活跃区）

#### 9.12.6 A2A 消息 UI 呈现（Q28 / D7-6）

- **统一进 timeline**，与 dispatch / handoff / 用户介入在同一个时间轴
- 渲染密度按 flow 类型自适应：
  - `round-table` 中 A2A 消息是主事件，timeline 主体就是它
  - `pipeline-with-feedback` / `fan-out-collect` 中 A2A 是辅助穿插
- visualization 与 v1 §10.2 已锁定"A2A 消息 = 聊天气泡（无 mention 边）"一致

#### 9.12.7 视觉区分（Q29 / D7-7）

按事件类型区分（handler 假设人类看的是"事件"而非"谁发的"）：

- `dispatch` / `handoff` = 主区独立卡片
- `handoff` 退回 = 同一卡片，红色变体（v1 §10.2 已锁定）
- `A2A-style 消息` = 聊天气泡（无 mention 边）
- `用户介入` = **决策点事件卡片**（输入框 + action + 用户消息一体）——**不是红色气泡**（红色已锁给 handoff 退回，语义冲突）
- sender 信息 hover / 点入查看详情

#### 9.12.8 in_reply_to 视觉（Q30 / D7-8）

- **一级虚线引导**（reply 气泡底部指向被回复气泡）
- 不画完整线程树（round-table 链式接力下，完整树视觉爆炸）

#### 9.12.9 并发与资源边界（第六轮收口）

- **1.0 不做插件层排队 / 上限**——活跃 Run 数量无产品层队列 / 拒绝规则
- **并发上限为实现层约束，直接引用宿主限制**：ACP adapter 的 agent 执行线程池硬上限 = **4 个并发 worker**（`acp_adapter/server.py` 行 231 `ThreadPoolExecutor(max_workers=4)`）——插件不写自造数字
- **该上限同时约束单 Run 内并行度**：fan-out N 路并行是**逻辑并行，物理并发 ≤4**（§3.1 / §3.3 已注明）——5 路 fan-out 实际 4 并发 1 排队；join 超时须留足排队余量，防"资源排队"误判为"成员死亡"（§3.3）
- **UI 可见化**：活跃 Run 列表展示成员进程数与状态，资源占用用户可见（§9.12.1 侧栏项可加进程数角标）
- **多 Run 共享素材库不受并发保护**：所有隐含的跨 Run 共享承诺（引用的素材模板、跨 Run artifact 引用的原 Run）均标注"不受并发保护"——用户不能拿单 Run 语义推导多 Run 行为

### 9.13 成本纪律（第七轮收口，P0-1）

> 产品核心 = 可并行拉起多个**付费** coding agent（Claude Code / mcode / hermes，独立 LLM、独立计费）。成本是**产品级约束**，不是实现细节。纪律三条：

- **① 预飞行确认**：fan-out 并行路数 ≥3（阈值 tunable，默认 3）时，启动前必须向用户确认"将并行启动 N 个成员 agent + 预估成本/本轮上限"（触发源 §3.3）。确认框的目的是把账单摆上桌面，不是走过场。
- **② 决策点超时按 flow 分流**：round-table 超时 → abort，pipeline / fan-out 超时 → continue（§9.10.4）。
- **③ 单 Run 成本上限**：`flow_config.cost_cap` 可配（按轮次 / agent 分钟计）。触顶 → 开一个"续 / 停"决策点（`action: continue(续 N 轮) / complete / abort`）；用户失联则默认停止（abort 系）。**触顶不评 failed**——预算 ≠ 产品缺陷，且触顶时往往已有可抢救的部分成果。
- **成本边界总包**：预飞行（启动前知情）→ 上限门（跑动中熔断）→ 分流超时（门点有默认动作）——三条覆盖"无人值守"的每条路径，无死角。
- **Story 1 的成本已由 `max_rounds`（默认 5）× 队形大小天然封顶**——采纳收敛门 + 用户门后无"无人值守白烧"路径，本条对 Story 1 主要起兜底声明作用。

---

## 10. 常驻面板布局规范

DSH Team 常驻面板采用 **Linear 风 app shell** 结构，骨架已通过 mockup [`mockups/panel-linear.html`](./mockups/panel-linear.html) 验证。本节只规定结构组件，**视觉细节（配色 / 字体 / 圆角 / 间距）留到后面单独定**。

### 10.1 区域结构

| 区域 | 内容 |
|---|---|
| 顶栏 | brand 标识 + Team 运行状态 pill |
| 左 sidebar | 活跃 Team + 历史 Team + 素材库入口 |
| 主区头 | Team 名 + flow 类型 + 团队操作按钮 |
| 主区成员栏 | chip 形式横向排列，状态点区分忙/闲 |
| 主区 timeline | 消息气泡（@mention 带左侧边）+ handoff 大卡片 + A2A 消息气泡 |
| 全局 footer | ACP / artifact / dispatch / message 计数 + 命令面板快捷键 |

### 10.2 handoff / dispatch / 消息视觉区分

| 元素 | 视觉 | 备注 |
|---|---|---|
| @mention | 聊天气泡 + 左侧 mention 边（黄色）| v1 §10.2 锁定 |
| dispatch / handoff | 主区独立卡片（图图标 + 轮次 + artifact 列表 + 流向）| v1 §10.2 锁定 |
| handoff 退回 | 同一卡片，红色变体 | v1 §10.2 锁定 |
| A2A-style 消息 | 聊天气泡（无 mention 边），区别于 handoff 卡片 | v1 §10.2 + 第五轮 D7-6 |
| **用户介入（决策点响应）** | **决策点事件卡片**（输入框 + action 三选 + 用户消息一体）| **第五轮 D7-7 新增**——不是红色气泡（红色已锁给 handoff 退回，语义冲突）|
| in_reply_to 关系 | 一级虚线引导（reply 气泡底部指向被回复气泡）| 第五轮 D7-8 新增 |
| 决策点等待信号 | 状态 pill 上小角标（不新造 pill）| 第五轮 D7-2 |

### 10.3 不做的事

- **不提供过程性介入入口**：常驻面板只展示当前正在工作的团队及成员，不暴露"任意时刻手动介入"按钮（V 决策已砍过程性介入）
- **介入操作的唯一入口是决策点输入卡**（§9.12.3）——flow 预声明的衔接点，在 Team 主区 timeline 自然出现，不是常驻面板的全局操作
- **不堆介入工具条**：底部不放按钮条、不放 `⌘K` 提示、不放右键菜单——Team 自治运行
- **不做花哨动效**：动画克制，不喧宾夺主

---

## 11. 后续待讨论与 Open Questions

### 11.1 第五轮讨论已闭环项（不再讨论）

- ✅ Team Run 暂停-恢复——**砍**（§9.7 / D2-1）
- ✅ Team 失败处理路径——§9.8 / D3-1~D3-3 全部拍板
- ✅ 多 Team 并存 UI 设计——§9.12 / D7-1~D7-8 全部拍板
- ✅ Team 之间资源共享（跨 Run 引用）——§9.11 / D6-1~D6-6 全部拍板
- ✅ Team 产物版本管理——§9.11.4 / D6-4 不可变快照
- ✅ 历史 Team 切换查看——§9.12.4 / D7-4
- ✅ `read_only` 角色 + `orchestra_report` 写通道——**维持不做**（§14.5 / D8-1，等待真实用户声音 / 合规审计需求）
- ✅ A2A-style 消息 UI 呈现细节——§9.12.6 / D7-6
- ✅ Member 之间的"讨论即计划"——§9.9 / D4-1~D4-9 全部拍板

### 11.2 仍待讨论项

- **其他 Flow 模式**（除圆桌/流水线/扇出外）——用户提"可能还有其他场景后续再说"
- **暂停-恢复的 UI 暗示**（机制不拍，UI 归属 DSH/UI 侧）——运行中 DSH 不在线时如何在 UI 上暗示"无推进"

### 11.3 视觉细节 backlog（已留待）

- 配色 / 字体 / 圆角 / 间距——骨架已通过 mockup 验证
- 决策点角标的具体颜色 / 动效
- A2A 消息在不同 flow 下的密度渲染策略细节

### 11.4 Open Questions（用户尚未拍板）

- **plan step intent 枚举值集**（§9.9.3）：倾向 `produce/review/collect/synthesize/decide`——任务域动词最终值待拍（第六轮收口未触及，仍开放）
- **决策点等待默认 10 分钟**（§9.10.4）：是否写入产品默认值——倾向是（第六轮收口未触及，仍开放）
- **跨 Run 引用 artifact id 内 run 归属段的编码格式**（§9.11.1）：机制层已锁定（id 带 run 段），具体格式 DSH 实现层定
- **state-history 必含字段的准确措辞**：用户落文档时定（第六轮已定 interrupted 记录样例，§5.2）
- **§4 重写的准确措辞**：第六轮已按收口清单对齐 §4 与 §9.10 引用，终稿措辞仍待用户审校

---

## 12. 2026-08-18 第二轮决策（设置界面 + 协作交互）

本节是 handoff 后第二轮讨论的产物。讨论从"设置界面"开始（方向 A），然后进入"协作交互"（方向 B）。

### 12.1 设置界面（方向 A）

**A1 角色编辑器的技术暴露面**

| 方案 | 内容 | 决策 |
|---|---|---|
| L1 纯表单 | 全是控件 | — |
| **L2 表单 + 高级折叠** | 默认 L1，高级面板里给 JSON/YAML 编辑 | ✅ 选中 |
| L3 双视图 | 左右分屏（表单 ↔ JSON）实时同步 | 否决（投入产出比不值）|

**A2 persona 模板库**：用户原话"先不用，到时候再说"——不做。

**A3 Adapter 集合**：封闭 + 扩展性预留。用户原话："现在的架构设计就考虑上扩展性……用户无法自己新加 adapter，想添加只能修改插件源码"。

**A4 Team 模板编辑**：JSON/YAML + 实时预览（不拖拽）；flow 选错不主动提示。用户原话："简单可视优先，不要弄一大堆复杂表单以及配置"。

**A5 Team 内 Role 实例命名**：名字唯一，不允许同名重复。用户原话："不会有同名出现，名字唯一"。

**A6 avatar**：仅默认几何，无 AI 无上传。用户原话："甚至无头像都没事"。

### 12.2 协作交互（方向 B）

**B1 Team 启动入口**：skill（斜杠 + 自然语言双触发），但 skill 不是唯一入口——插件抛出的工具也能开 Team。用户原话："skill 只是方便 agent 阅读的，就算没有 skill，dsh 也能通过插件抛出的工具来开启一个 team"。

**核心逻辑归属**：DSH 原生插件；skill 是 thin wrapper；UI 是配置中心 + 常驻面板，不是启动入口。用户原话："注意核心逻辑是使用 dsh 的原生插件完成的，skill 只是入口，不要把核心能力放到 skill 里"。

**B2 组装策略**：全局默认 + 单次可覆盖（auto / manual）。用户原话："设置成 auto 的话……如果没有的话，会自动组建团队"。

**B3 常驻面板布局**：Linear 风 app shell（mockup 见 `mockups/panel-linear.html`）。用户原话："就按照这个来吧，要的只是这个布局……颜色包括细节设计到后边再说"。

**B4 6 种介入模式——全部砍掉**。用户原话："这些都不需要，开启团队后，目前版本无法手动介入操作"。

**B5 handoff vs @mention**：handoff 主区独立卡片；@mention 气泡 + 左侧边。

---

## 13. 2026-08-18 第三轮决策（核心机制：Team Run / Member Session / Self-handoff / DSH Handoff）

本节是第三轮讨论的产物。本轮从调研多 Agent 协作产品机制开始（LangGraph / AutoGen / CrewAI / OpenAI Agents SDK / ACP / A2A），再调研 Anthropic 的工程实践，最终对齐到 DSH Team 的核心机制层。

### 13.1 概念对齐（Task 不再是一等实体）

**前两轮的混淆**：

- 第一轮：Member = Role 在 Team 内的实例（Team 结束 Member 销毁）
- 第二轮引入 Task 概念（Member 的一次执行单元）——但跟你说的"Task"冲突

**最终对齐**：

- **Task = Team Run** = 一次完整运行（从用户输入到任务达成）
- **Member 一次执行 = Dispatch**（不是 Task）
- 删掉之前 v1 引入的 `tasks/<task-id>/` 子目录

### 13.2 Member 跨 Team Run 记忆：完全不累积（Q-M1）

**用户原话**："这个是确定以及肯定的"

**机制**：

- Member 跨 Team Run = 新 session，零继承
- Member session 内 = 累积上下文（这是 session 的内在属性）
- 这两条不冲突——一个是 session 间规则，一个是 session 内属性

### 13.3 Team Run 内 Member Session 设计（Q-Run-1~5）

| # | 决策 | 备注 |
|---|---|---|
| Run-1 | Team Run = 一次完整运行 | 跟 v1 的 Team 实例同义，改名 Team Run |
| Run-2 | Member 在 Run 内 = **1 个 session** | 跨 dispatch 持续，不重建 |
| Run-3 | dispatch-log = 调度事件流 | 不是 session 切分 |
| Run-4 | artifacts 挂在 Member session 下 | `sessions/<member-id>/artifacts/` |
| Run-5 | Member 状态机 idle ↔ working ↔ failed | 可多次 working，session 不重建 |

### 13.4 Member Self-handoff（Q-H1~4）

| # | 决策 | 用户原话 |
|---|---|---|
| H1 | 阈值 = 200k token | "超过两百k 就让 member 自己 进行 handoff" |
| H2 | handoff 文档位置 = 灵活 | "放哪都可以，哪里方便放哪里" |
| H3 | handoff 内容 = Member 自己生成 | "就按照 /handoff-hermes 的提示词来就行" |
| H4 | 新 session prompt 拼接 | "首先把 member 自己的人格设定给他，然后 handoff 的文档给他，之前的 task 指令给他" |

### 13.5 DSH 调度者 Session 控制（Q-DSH-1~4）

**关键认知**：DSH 调度者**就是用户在 DSH 客户端里直接对话的那个 agent**——跟 Member 同质（都是 LLM agent），但**由用户直接控制**。DSH 自己的 session 由用户在 UI 手动切换。

| # | 决策 | 备注 |
|---|---|---|
| DSH-1 | 复用 `handoff-hermes`，不新建 skill | |
| DSH-2 | DSH handoff = **纯手动** | 用户观察 session 长度自己触发 |
| DSH-3 | handoff 文档必含 Run ID + 关键路径 + 状态 | 让新 session 知道"我现在管哪个 Run" |
| DSH-4 | DSH 新 session 不重读全部历史 | 读 handoff + 按需读 state |

### 13.6 调研对比

**Anthropic 的 3 个 multi-agent 价值场景**：

| 场景 | 多 Agent 价值 | DSH Team 对应 |
|---|---|---|
| Context protection | 子任务不污染主 agent | Team Run 边界天然隔离 |
| Parallelization | 可拆解成独立 facet 并行 | Story 3（fan-out-collect）|
| Specialization | 不同任务需不同 tool/persona | Member 由 Role 配置 |

**Anthropic 自承**：coding tasks 不太适合 multi-agent；DSH Team 的 Story 2 价值可疑，Story 1/3 更合适。

**产品形貌声明**（第六轮收口，用户已拍板不降级）：

- **Story 1 = 用户在场的对话协作**——决策闭环依赖用户（succeeded 必经用户确认，§9.9.6）
- **Story 2 = 成员链式自动化**——决策点出现在链的接入点（start / step 交接），链内过程闭环
- 两个产品形貌的差异写清、**并存声明**；Anthropic 的价值质疑不构成降级理由——1.0 两条 Story 均为支柱，验收口径见 §19

---

## 14. 2026-08-18 第四轮决策（混合架构：A2A-style 消息）

本节是第四轮讨论的产物。本轮从"中央调度 vs 事件驱动"的分歧出发，调研 TimYuann/orchestra-dsh（DSH 内部的 orchestra 插件），最终选择**混合架构**。

### 14.1 核心争论

| 方案 | 内容 | 问题 |
|---|---|---|
| 纯中央调度 | 所有协作过 DSH | DSH 成瓶颈；"讨论"过重 |
| 纯事件总线 | Member 直接发消息 | 需要 Adapter 暴露 A2A endpoint（Adapter 不一定支持）|
| **混合架构** | dispatch 走 DSH；消息走 DSH 代理 | **选中** |

### 14.2 为什么不做"真 A2A 协议"

我们核心优势 = Member 用不同 LLM（不是 DSH 自己的）。

- 真 A2A 协议要求每个 Adapter 暴露 A2A endpoint——Adapter 是 DSH 外部进程，无法控制
- TimYuann 的 orchestra-dsh 不存在这问题，因为它的 Member 是 DSH 内部 session
- 我们不能放弃 Adapter 多样性 → 不能走真 A2A 协议

### 14.3 混合架构决策（Q-M2 ~ M7）

| # | 决策 | 备注 |
|---|---|---|
| Q-M2 | Member 之间消息持久化到 `a2a-message-log.jsonl` | 跟 dispatch-log 平级 |
| Q-M3 | 混合架构 | dispatch 走 DSH；消息走 DSH 代理（不是外部 A2A 协议）|
| Q-M4 | 消息类型 = 结构化 `{topic, intent, payload}` | 便于路由/过滤/审计 |
| Q-M5 | Member inbox 自动消费（idle 时检查 inbox 醒来）| 无需 DSH 每条都参与 |
| Q-M6 | Team Run 状态机加 `degraded` | 部分失败 ≠ 完全失败（借鉴 TimYuann；第六轮改为 flag 语义，§2.3）|
| Q-M7 | read_only 角色 + orchestra_report 通道 = 本轮不做 | 留后续 |

### 14.4 借鉴 TimYuann/orchestra-dsh 的点

| 它的设计 | 我们采纳 |
|---|---|
| A2A transport（消息层概念）| ✅ 概念借鉴，**底层还是 ACP** |
| `orchestra_report`（read-only 角色写通道）| ❌ 本轮不做（Q-M7）|
| `degraded` 状态 | ✅ 概念采纳（Q-M6）——第六轮实现为 running 的修饰 flag（§2.3）|
| Discussion = Plan（讨论即计划）| ✅ 概念纳入，**具体机制留后续** |
| Topology 7 问 | 部分借鉴 |
| 整个 DSH session 实现 | ❌ 不借鉴（要保留 ACP 进程级）|

### 14.5 借鉴但未采纳的点（明确不做什么）

- ❌ **不引入外部 A2A 协议**（a2aproject）——避免要求 Adapter 实现 A2A endpoint（第六轮：A2A 唤醒机制见 §9.4，仍走 DSH 代理）
- ❌ **不做 read_only 角色**（这一轮）——复杂度延后。**第五轮重开判定：维持不做**（§17.6 / D8-1），理由：场景被现有机制覆盖 + "看全集"与 Member 能力边界模型冲突 + 跨 Team 观察已被跨 Run 引用覆盖 + orchestra_report 不可迁移。重开锚点：真实用户声音 / 合规审计需求出现时
- ❌ **不做 orchestra_report 通道**（这一轮）——同上（第五轮维持）
- ❌ **不做"显式 plan artifact"**（这一轮）——讨论结论的产出形式留后。**第五轮已实现**：§9.9 完整定义了 Plan 机制，含 plan_output 开关 / DSH 生成 / 软参考 / 与 decision 的关系等

---

## 15. 待办（不在本文档范围）

下列事项本文档不规定，由 DSH 侧在实现层决定：

- 存储引擎（YAML / JSON / SQLite）
- ACP 客户端实现语言
- DSH UI 组件的具体实现
- 性能优化（artifact 缓存、session 压缩等）
- 安全策略（tool 白名单强制、artifact 访问权限与成员级隔离等）——成员级隔离属 2.0 方向，1.0 采用"同信任域 + 注入策略"（§5.3 / §9.11.2），不承诺隔离
- Self-handoff 的具体实现细节（如何检测 200k 阈值）
- DSH handoff 文档的具体生成逻辑
- A2A-style 消息的路由策略（多播 / 单点 / 优先级）
- Member inbox 的存储实现（队列 / IndexedDB / 内存）

---

## 16. 边界规则

**严格只讨论产品/需求层 + 机制层（Team Run / Member Session / 消息路由）**，不涉及具体技术实现。

- ✅ 可聊：Team Run 状态枚举、状态转换图、artifact 字段、dispatch / 消息 log 结构、目录的逻辑划分
- ❌ 不能聊：用什么语言 / 库 / ORM / 数据库 / async 模型 / 文件路径 / 进程模型

实现见 `architecture.md` 接口骨架 + 本仓 `lib/` `services/` `ui/` `skills/`（待落地）。本文只规定**逻辑机制**。

---

## 17. 2026-08-19 第五轮决策（机制层全面扩展：abort / 失败 / Plan / 决策点 / 产物 / 多 Team / read_only 判定）

本节是第五轮讨论的产物（与 Product Architect 头脑风暴，session `20260819_144254_680037`）。本轮从议题 2（失败处理）开始，连拍 8 个议题组 + Q-M7 重开判定，共 36 项决策。

### 17.1 议题拆分

第五轮把 v1 §11 的待讨论项按依赖关系拆为：

1. **议题 2** — 失败处理路径（Q1-Q6）→ §9.8
2. **议题 3** — Discussion = Plan（Q7-Q17）→ §9.9
3. **§4/Story 1 矛盾** — 决策点响应定义（Q18-Q21）→ §9.10
4. **议题 4 第一场** — 产物共享 + 版本管理（Q22）→ §9.11
5. **议题 4 第二场** — 多 Team UI + 历史切换 + A2A 消息（Q23-Q30）→ §9.12
6. **议题 4 第三场** — `read_only` + `orchestra_report` 重开判定（Q-M7）→ §14.5 / D8-1

### 17.2 第五轮决策汇总（按组编号）

> 完整 36 项决策见 §8 表中的 Q1~Q30 + Q-M7 行；详细机制分别收录于 §2.3 / §2.7 / §4 / §9.8 / §9.9 / §9.10 / §9.11 / §9.12 / §10.2 / §11.1 / §14.5。

### 17.3 关键 Trade-offs

- aborted 独立终态：审计清晰 ↔ 状态机增 + dispatch 增 `interrupted` 值
- 砍暂停：机制简单 ↔ 运行中 DSH 不在线无产品级表达（UI 暗示留待）
- plan 软参考：DSH 自适应保留 ↔ 计划偏差依赖"采纳留痕"才能追溯
- 不可变快照：零改写风险 ↔ "同源最新版本"需沿 `derived_from` 链反查
- 决策点窗口：用户参与感 ↑ ↔ 自治性被窗口打断（默认 10 分钟 + 超时 continue 缓冲）
- 无自动清理：简单 ↔ 长期存储成本未量化（接受）
- 侧栏折叠历史：防淹没 ↔ 历史可见性降一级（一次点击）
- 跨 Run 引用：复用率 ↑ ↔ Run 之间产生隐藏耦合（A 归档后 B 的回看依赖 A 完整性）

### 17.4 关键技术洞察

- **机制矛盾的判定**：Q-M7 重开判定中，`read_only` 角色"看全集"与 Member 能力边界模型直接冲突——它需要新通道、新权限模型、新审计面；与 orchestra-dsh 内部 session 模型不可迁移
- **产品场景 vs 机制推导**：场景 A/B/C 全部已被现有机制覆盖（reviewer/analysis/DSH 检验）；只有"真实用户声音"或"合规审计需求"出现时才重开
- **架构借鉴的不变量**：v1 第四轮"借鉴但未采纳"清单里的差异（外部 ACP 进程 vs 内部 session）持续生效——很多 orchestra-dsh 概念不能直接迁移

### 17.5 第五轮未拍板项（Open Questions）

- plan step intent 枚举值集（§9.9.3 / §11.4）
- 决策点等待默认 10 分钟是否写入产品默认值（§9.10.4 / §11.4）
- 跨 Run 引用 artifact id 内 run 归属段编码格式（§9.11.1 / §11.4，DSH 实现层定）

### 17.6 read_only 重开判定（D8-1）

见 §14.5（维持不做的完整理由与重开锚点）。本节编号用于承接 §11.1 / §14.5 的 `§17.6 / D8-1` 引用。

---

## 19. 2026-08-19 第六轮收口（审阅后决策修订）

本节记录 Product Architect 审阅（session `20260819_153611_90f4d1`）+ 收敛讨论（session `20260819_154308_baeace`）后的文档修订。审阅清单全文见 `scripts/dsh-review-findings.md`（历史收口记录）。

**背景**：第五轮机制完整性很强（36 项决策有据可查），但审阅发现"机制可执行性"偏弱——flow 操作语义、handoff 存储、DSH 运营模型是任何实现方第一天就会撞墙的硬缺口。本轮全部 13 条问题 + 3 项交叉决策已收口。

### 19.1 三条硬缺口（原 S1）

1. **flow 操作语义闭环**（§3.1-3.3 / Story 1-3）：join 由 DSH 单次幂等派发 + 完成定义（显式宣称 + 产物存在）+ 超时至少一路完成即 degraded flag 照常 join；round-table 轮次改扫过制；pipeline 顺序强制在 DSH 侧
2. **handoff 持久化**（§2.4/§2.5/§5.1/§5.2）：新增 `handoff-log.jsonl`（per-run 唯一事实源，单写入者=DSH）；`from` 枚举扩 `scheduler|member`；`handoff-<n>.md` 降级为派生视图（**第七轮回退注记**：`dispatch-log` 的 `from=member` 撤销，成员发起的移交统归 `handoff-log`，详见 §2.4/§2.5/§3.2。此处第六轮措辞仅作历史留痕。）
3. **DSH 运营模型**（§9.6）：DSH 进程 = Run 生命周期持有者；死亡=整队销毁（进程）但产物保留；启动对账标记 interrupted；Runs 索引解决"全局视野 vs 按需读"矛盾；不自动恢复

### 19.2 状态机修订（原 S2/S3）

4. **degraded 改 flag**（§2.3/§9.8.4）：删独立状态节点，改 `running` 修饰标志——进入条件 + 终态判定影响（partial 标注）两条规则，状态机零迁移改动；修 failed→aborted 图笔误
5. **assembling 出口**（§2.3）：新增 assembling→failed(assembly)；abort 允许任意状态；失败后复用素材重跑组装（禁断点续）；素材库删除前引用检查 + Run 创建快照
6. **A2A 唤醒**（§9.4）：投递即唤醒（DSH 发轻量 ACP prompt 只看 header）；T 秒 dedupe 防活锁；wake 进日志（kind=system-wake）；Q-M5 措辞改"不读内容，仅路由+唤醒"
7. **succeeded 判定**（§9.9.6/§2.3）：round-table 唯一入口 = 用户决策点确认；DSH 三态判定只决定开决策点/介入点；用户失联不自动 succeeded
8. **derived_from**（§9.9.5）：必填保留，取值域扩 {decision | 收敛消息 | 用户决策点记录}；convergence_note 降级兜底注释

### 19.3 文档清洁（原 S3-S5）

9. §10.3 与 §9.12.3 冲突：§10.3 改为对齐决策点输入卡
10. pause 残留：全量清理（§9.4 终止层移除 pause；保留 §9.7 论证与 §8 Q2 记录）
11. 并发边界（§9.12.9）：不做插件层上限；引用宿主 4 worker 上限；UI 展示资源占用
12. 产品形貌（§13.6/§11）：双形貌并存声明；**用户拍板不降级**，双 Story 均 1.0 支柱
13. §2.2 措辞统一（"持久配置" vs Q-M1 "不累积"）

### 19.4 交叉决策最终态

- **A. 成员生命周期**（✅ 用户拍板）：DSH 死 = 整队销毁、产物保留可回看、重跑重新组队
- **B. 宿主并发上限**（✅ 事实查实）：`acp_adapter/server.py:231` ThreadPoolExecutor(max_workers=4)；落 §9.12.9 + §3.1/§3.3
- **C. 产品形貌**（✅ 用户拍板：不降级）：Story 1/2 均 1.0 支柱，验收完整口径 + 失败路径

### 19.5 双 Story 验收口径（第六轮新增，1.0 全量）

**Story 1 验收**：完整流程（建队→讨论→决策点→用户确认→收尾）+ 失败路径三项——
1. 一次执行中用户 abort 后重开成功
2. 一次中断（DSH 崩溃）后对账恢复或正确标记 interrupted（§9.6）
3. 组装失败重跑成功（§2.3 assembling 路径）
通过标准：全流程无人工剧本外介入走完（用户只做决策点输入）。

**Story 2 验收**：完整口径含 fan-out / degraded flag / 循环插队走通 + 失败路径两项——
1. 成员挂 → degraded flag 置位 → 剩余成员继续 → partial 终态正确（§9.8.4）
2. 步骤失败 → handoff 不触发 → DSH 介入点生效（§9.8.2）
通过标准：一条 pipeline 完整走通 + 上述两条失败路径各触发一次并正确落终态。
- §4 重写及 state-history 必含字段的准确措辞（§11.4）