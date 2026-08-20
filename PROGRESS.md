# DSH Team 插件 — 进度记录

> 记录时间：2026-08-20 · HEAD = `aedbd10` · branch = `main`
>
> 本文件是工作进度快照（不是规范/合同）。规范请读 [`docs/requirements.md`](./docs/requirements.md) + [`docs/architecture.md`](./docs/architecture.md)；插件边界/读者请读 [`AGENTS.md`](./AGENTS.md)。

---

## 1. v1.0 已闭环

v1.0 实现路线 `architecture.md §12` 的 P0–P8 全部完成。9 个功能 commit + 4 个装机/文档/结构 commit，HEAD 在 main 上。

| 阶段 | commit | 范围 | 证据 |
|---|---|---|---|
| P0 骨架 | `7c8a1e8` | dual-format 5 文件（package.json + plugin.json + cordis.patch.yml + lib/index.js + SKILL.md） | `node scripts/verify.mjs` 5 层绿 |
| P0 完整 | `c74e1db` | 实体 / 状态机 / `team.*` 工具 / 启动对账 + UI slot 最小实现 | smoke-test 覆盖 |
| P1 Story 1 | `34b2d20` | DecisionPointService + MessageService + FlowEngine + RoundTableFlow | smoke-test 覆盖 |
| P1 UI 切片 | `8480483` | 5 个 `React.createElement` 组件 + slot 注册 | smoke-test 覆盖 |
| P2 Story 2 | `c1c5e0f` | PipelineFlow + feedback loop + DSH-routing handoff | smoke-test 覆盖 |
| P3 Story 3 | `c32c6e6` | FanOutFlow + 预飞行 DP + aggregator + 4-worker 物理 cap | smoke-test 覆盖 |
| P4–P8 | `c1374e5` | PlanService + ArtifactRegistry（跨 Run + 不可变 + 删除保护）+ team.rerun + cost-cap DP + 3 Adapter providers | smoke-test 覆盖 |
| fix(install) | `8f7c3fe` | 2 处 DSH host 侧真错（`inject: slots` / `output.render`） | `dsh --profile web --port 0` 起来 |
| docs(agents) | `0ff8f9b` | 装到本地 DSH 步骤 + 2 处 host 侧真错记录进 AGENTS.md | 本仓文档 |
| docs(structure) | `9cd7965` | 把 `requirements.md` / `architecture.md` / `discussion-log.md` 移到 `docs/` 子目录 + 修正跨文件相对链接 | `node scripts/verify.mjs` 5 层绿 |
| docs(progress) | `a0eb57e` | 新增 `PROGRESS.md` 记录 v1.0 → 2.0 进度 + AGENTS.md 索引更新 | `node scripts/verify.mjs` 5 层绿 |
| P1.5-a / P1.5-b | `d478fdd` | `ui/team-plan.js` 新建 + slot 注册 + DP 实时订阅桥 (`wireDecisionPointBridge` → `team/decision-point-open` / `-respond` 事件总线) + `subscribeDps(ctx, onChange)` helper | `node scripts/verify.mjs` 5 层绿 · smoke-test 84 → 97 checks |
| 2.0 #1 (部分) | `530af83` | 拍板: parent = exec.agent (option A);三个 subagent-acp entry 进 `cordis.patch.yml`;`MemberService.joinRun` / `leaveRun` 走 `ctx.subagents.startContinuable`;`services/adapters.js#registerAdapters` 改为 verify (不 register);`sendMessage / dispatch / wake / triggerSelfHandoff` 留 2.x | `node scripts/verify.mjs` 5 层绿 · smoke-test 97 → 110 checks |
| 2.0 #3 | `d381f73` | `lib/index.js` 新增 `createTeamServiceBundle()` + `registerTeamServices(ctx)`;六个 service 模块聚合为一个 frozen 对象,作为 `team` 走 `ctx.provide('team', bundle)`(Cordis `reflect.ts#provide`)挂到 ctx;`apply()` step 3d 调用,effect-wrapped 自动清理;跨插件消费者 `const t = ctx.get('team'); t.members.list(); t.decisions.waitingDecisions(...);` | `node scripts/verify.mjs` 5 层绿 · smoke-test 110 → 120 checks |
| 审阅收口 #1 | `aedbd10` | `reconcileOnBoot` 补全 per-dispatch mark:扫 dispatch-log,append `terminal=interrupted, reason=process-killed` 到每个 in-flight dispatch 末尾(原 issue 行不动,append-only 语义保留);`requirements.md §5.2/§4.3/§9.10.3` 加 `is_ad_hoc` 字段(schema 漂移修);`§9.7` 重连用语收口;`architecture.md §6.3` 切清 `team.resume` vs `team.rerun`;smoke-test [4/19] 扩 4 个新 check(in-flight 标 interrupted + reason + 已完成不被覆盖 + 原 issue 行保留) | `node scripts/verify.mjs` 5 层绿 · smoke-test 120 → 124 checks |

### 1.1 验证

- `node scripts/verify.mjs` — 5 层 + 124 烟雾，**独立于 DSH** 跑（不依赖装到 DSH）
- 预期输出：`✅ verify passed (0 warnings, 0 errors)`

### 1.2 装机状态

- 装在 `web` profile（`pnpm link`，仓根 → `D:\dsh-plugins\dsh-team-plugin` 的 junction 避开路径空格）
- `dsh --profile web --port 0` 启动验证过（`http://127.0.0.1:<port>`，stderr 空）
- 装机后 P1.5-a / P1.5-b 的两个事件（`team-plan` slot + DP 桥）会在 reload 时自然启用，无需重新装机
- 2.0 #1 的 joinRun / leaveRun 真实路径需要 `@deepseek-ai/dsh-subagent-acp` + 三个 adapter CLI（`hermes` / `mcode` / `claude-agent-acp`）一并装到同 profile；`cordis.patch.yml` 已声明三个 entry,DSH host 加载 cordis.yml 时自动起

### 1.3 远程仓库

- URL: https://github.com/Fectivnfy112357/dsh-team-plugin
- 可见性: public
- 默认分支: main
- 20 个 commit 已 push（v1.0 全量 + 2 个文档结构/进度 + P1.5-a/P1.5-b + 2.0 #1 拍板 + joinRun/leaveRun + 2.0 #3 service bundle + 1 个 build 杂项 + 审阅收口 #1）
- Description 用 `package.json#description` 原文

---

## 2. 未完成的明确任务

按依赖顺序排列，**先做哪个优先**。

### 2.0 路线 — 1 项 + 3 项留口（按依赖递增）

#### #1 MemberService 真子代理驱动 — 🟡 部分完成 (commit `530af83`)

**已完成** (本轮):
- ✅ 拍板 design 开放项:**parent = exec.agent (option A)**
- ✅ 拍板 adapter 注册路径:**三个 `@deepseek-ai/dsh-subagent-acp` Cordis 实例通过 `cordis.patch.yml` 声明**,`registerAdapters(ctx)` 改为 verify-and-warn
- ✅ `joinRun(ctx, runId, memberId, opts)` — 调 `ctx.subagents.startContinuable({ provider, label, request: { parent, prompt, persona? }, signal })` + 写 `session-state.json` (state=running, child_id, provider, label, joined_at, session_chain) + 写 `dispatch-log` (kind=member-join)
- ✅ `leaveRun(ctx, runId, memberId, opts)` — best-effort `ctx.subagents.interrupt(targetSessionId, authority)` + 写 `session-state.json` (state=terminated, left_at, leave_reason) + 写 `dispatch-log` (kind=member-leave)
- ✅ Idempotency: joinRun 二次调用返 existing,leaveRun 二次调用 no-op

**留口** (下轮 / 2.x):
- 🟡 `sendMessage` / `dispatch` / `wake` / `triggerSelfHandoff` —— 全部 4 个方法都是基于 joinRun 的 subagent 转发/调度,等 joinRun 跑稳再接
- 🟡 flow engine 改造 —— v1.0 round-table / pipeline / fan-out 还是 DSH 侧 handoff 占位 (`signalStepTerminal` / `signalBranchTerminal`),要替换为 MemberService.joinRun + followup 链路

**依赖**: 无前置 (独立模块,本轮已闭环核心)

#### #2 跨 Run artifact 反向引用索引

**Why deferred**: v1.0 `artifact-registry.js#refCount` 是 lazy 线性扫描。Run 多了会变慢（O(n) 每次 refCount 查询）。

**目标形态**:
- 维护 `refCountIndex: Map<artifactId, Set<runIds>>`
- `register()` 时更新索引
- `refCount(id)` 走 O(1) 索引查询
- 跨 Run `canDelete(id)` 走索引 + 引用 Run 集合

**依赖**: 无（独立优化）

#### #3 Cordis Service 跨插件注册 — ✅ 完成 (commit `d381f73`)

**已完成** (本轮):
- ✅ 拍板 API:`ctx.provide(name, value)`(Cordis `reflect.ts#provide`,`ctx.provide` 经 `mixin('reflect', ['provide', ...])` 混到 ctx 上)
- ✅ `createTeamServiceBundle()` —— 六个 service 模块聚合为一个 frozen 对象 `{ team, members, decisions, messages, plans, artifacts }`,并行 `Promise.all` 加载(模块缓存后零成本)
- ✅ `registerTeamServices(ctx)` —— `ctx.effect(() => ctx.provide('team', bundle))`,effect 卸载时自动调 dispose
- ✅ `apply()` step 3d 在 DP bridge 之后调用,无 `ctx.provide` 时短路(无运行时 smoke-test 场景)
- ✅ smoke-test 110 → 120 checks: bundle shape / 6 keys / frozen / 每 key 函数齐全 / no-op ctx / `ctx.provide` 形参与名 / effect 包装 / dispose 链

**留口**: 无

**依赖**: 无前置 (独立模块)

#### #4 pipeline-with-feedback step handoff → next step context_refs 传播

**Why deferred**: v1.0 `services/pipeline-flow.js#runPipeline` 在 `signalStepTerminal` 收 `produced_artifact_ids` 后**没**自动带入下一步 dispatch 的 `context_refs`;`§4.7.2` 流程图也只写「查 plan 后派单」未明文规定 context 传递语义。fan-out §4.7.3 已经显式写了 `aggregator context_refs = completed_members.artifacts`,pipeline 写法不一致,产物跨步传递不显式。

**目标形态**:
- `services/pipeline-flow.js` 在收 `signalStepTerminal(runId, stepIndex, 'complete', { produced_artifact_ids })` 后,记到 in-memory step registry(`Map<runId, stepOutputs[]>`)
- 派下一步 dispatch 时 `context_refs` 默认从 `stepOutputs[i-1].produced_artifact_ids` 派生(可被 `flow_config.context_refs_override` 显式覆盖)
- `signalStepTerminal(..., 'fail', { feedback })` 走的 feedback loop retry 时,**不**自动带前步的 produced_artifact_ids(retry 是同 member 同 task,前步产物自然有);由 retry 路径自己拼 feedback
- smoke-test 加: 2-step pipeline,step 0 产 `a-1`,step 1 dispatch.context_refs 应含 `a-1`(以及 step 0 的 `inbox`);可加 1 个 override 路径的 case

**依赖**: 不依赖 #1 留口(`signalStepTerminal` 协议不动,只补内部 state 派生);与 #1 留口并行开发 OK

#### #5 reconcileOnBoot per-dispatch mark 补全 — ✅ 完成 (commit `aedbd10`)

**已完成** (本轮):
- ✅ `reconcileOnBoot` 扫每 run 的 `dispatch-log.jsonl`,对每个 `terminal` 为空的 dispatch 调 `DispatchService.markTerminal(runId, dispatchId, 'interrupted', { reason: 'process-killed' })` —— append 一行,原 issue 行不动
- ✅ smoke-test [4/19] 扩 4 个 check: in-flight 标 `interrupted` + reason; 已完成的不被覆盖; 原 issue 行保留
- ✅ 文档: `requirements.md §9.6` 早就要求,`architecture.md §6.2` 同样写;1.0 收口时漏了,审阅发现

**留口**: 无

**依赖**: 无

#### #6 重跑 interrupted 语义切分 — ✅ 拍板 (commit `aedbd10`, 文档)

**已完成** (本轮):
- ✅ 拍板: 重跑 interrupted = 两个动作分清:
  - **同 run 状态回滚** = `team.resume`(v1.0 留口,P1 实现) — 用现有 ALLOWED 转换 `interrupted → assembling`,同 run-id,保留历史
  - **配置克隆** = `team.rerun`(v1.0 已实现,`lib/tools/team-tools.js:547`) — 新 run-id,`teamService.start()` 拿新 id
- ✅ `architecture.md §6.3` 加表格区分,2.0 实施时给 UI 的 interrupted 卡片放两个按钮

**留口**:
- 🟡 `team.resume` 工具实现(v1.0 暂不暴露,2.0 实施时加):读 `meta.json` 当前状态 → ALLOWED 转换 `interrupted → assembling` → 重 join 成员 → 重启 flow engine

### P1.5 路线 — ✅ 已闭环（commit `d478fdd`）

#### P1.5-a `team-plan` slot UI ✅

- `ui/team-plan.js` 新建: 接收 `plan` 对象或 `planId` 三态(loading/error/content)
- slot id: `team-plan`（keyed）已注册到 `lib/index.js`
- `loadPlan(planId)` helper 导出,host 在 useEffect 里 resolve 后通过 `props.plan` 传入

#### P1.5-b `team-panel` 实时 DP 订阅 ✅

- `lib/index.js` 新增 `wireDecisionPointBridge(ctx)` (export),effect-wrapped 在 `apply()` 阶段挂上
- `DecisionPointService.on('open'|'respond')` → `ctx.emit('team/decision-point-open' | '-respond', dp)`
- `ui/team-panel.js` 新增 `subscribeDps(ctx, onChange)`: host React 端 useEffect 调用,onChange 收到 `{ runId, kind, action, dp }` 触发重渲染
- `plugin unload` 时 dispose 自动调用(由 effect 的 disposer 链保证)

---

## 3. 待用户拍板（不是实现任务，是机制/措辞决策）

`requirements.md §11.4` / `architecture.md §11.2` 共 5 条 OQ + 1 条 2.0 拍板记录 + 1 条本轮新增的机制决策。v1.0 实现里已经用**倾向值**（tentative defaults）写死了，但措辞上仍 open。

| OQ | 倾向值（已写进实现）| 拍板状态 |
|---|---|---|
| OQ-1 plan step intent 枚举值集 | `produce \| review \| collect \| synthesize \| decide` | **closed (commit `aedbd10`)** — 5 值已写进 `lib/tools/team-tools.js:449` schema + `services/plan-service.js` 校验 + smoke-test [16/19] 验过 `produce` / `review`;实现层已锁定,只待用户在 `requirements.md §11.4` 措辞最终签字 |
| OQ-2 决策点等待默认 10 分钟 | 是（写进产品默认值）| open（实现层: `services/decision-point-service.js:85` 写死 `DEFAULT_WAIT_MINUTES = 10`,`open()` 默认取它;**实质已落,等措辞签字**）|
| OQ-3 跨 Run artifact id 内 run 归属段编码格式 | 实现层定（已用 `<run-id>/<artifact-id>`）| open |
| OQ-4 state-history 必含字段的准确措辞 | 实现已落，措辞用户审 | open |
| OQ-5 `requirements.md §4` 重写终稿措辞 | 第七轮已对齐收口清单，待最终审 | open |
| 2.0 #1 parent resolution | `parent = exec.agent` (option A) + adapter 由 cordis.patch.yml 三 entry 声明 | **closed (commit `530af83`)** |
| 2.0 #6 重跑 interrupted 语义 | `team.resume`(同 run 状态回滚) + `team.rerun`(配置克隆) 分清 | **closed (commit `aedbd10`)** — 文档入 `architecture.md §6.3` |

**含义**: 5 OQ 中 OQ-1 实质已落(实现锁 5 个值),OQ-2 实质已落(`DEFAULT_WAIT_MINUTES = 10` 在 `services/decision-point-service.js:85`);后 3 条 (OQ-3/4/5) 仍 open,等措辞签字,不阻塞 2.0 开发。

---

## 4. 留口（不属于"未完成"，是"未来议题"）

`requirements.md §11.2 / §11.3` + `architecture.md §11.3`:

- **其他 Flow 模式**（除圆桌 / 流水线 / 扇出外）—— 用户提"可能还有其他场景后续再说"
- **暂停-恢复的 UI 暗示**（机制不拍，UI 归属 DSH/UI 侧）—— 运行中 DSH 不在线时如何在 UI 上暗示"无推进"
- **视觉细节 backlog**: 配色 / 字体 / 圆角 / 间距 / 决策点角标颜色 / A2A 消息密度渲染
- **`read_only` 角色 + `orchestra_report` 通道**（`§14.5 D8-1`）—— 维持不做，等真实用户声音 / 合规审计需求

---

## 5. 推进顺序（建议）

```
P1.5-a team-plan slot UI       ✅ commit d478fdd
P1.5-b 实时 DP 订阅             ✅ commit d478fdd
2.0 #1 MemberService 真子代理    🟡 commit 530af83 (joinRun/leaveRun 闭环; sendMessage/dispatch/wake/triggerSelfHandoff + flow engine 改造 留 2.x)
2.0 #3 Cordis Service 注册       ✅ commit d381f73 (frozen bundle on ctx.team via ctx.provide)
2.0 #5 reconcileOnBoot per-dispatch mark ✅ commit aedbd10 (审阅收口 #1)
2.0 #6 重跑 interrupted 语义      ✅ 拍板 (commit aedbd10)  team.resume 留口
2.0 #4 pipeline context_refs    ← 与 #1 留口并行,可独立做
2.0 #2 跨 Run artifact 索引     ← 独立优化,最后做
```

每一项完工动作: 代码 → smoke test → `node scripts/verify.mjs` → commit → push → 回到本文件更新 §1/§2。

---

## 6. 协议

- 进度变更**只动本文件**: §1 增加 commit 记录、§2 把已完成项移到 §1 + 从 §2 移除、§3/§4 用户拍板后从 open 移到 closed
- 不要在 PROGRESS.md 里堆细节（细节去 commit message + smoke test）
- 每次 commit 完顺手更新本文件 + 同一 commit 里 push（避免漂移）
