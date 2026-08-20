# DSH Team 插件 — 进度记录

> 记录时间：2026-08-20 · HEAD = `530af83` · branch = `main`
>
> 本文件是工作进度快照（不是规范/合同）。规范请读 [`docs/requirements.md`](./docs/requirements.md) + [`docs/architecture.md`](./docs/architecture.md)；插件边界/读者请读 [`AGENTS.md`](./AGENTS.md)。

---

## 1. v1.0 已闭环

v1.0 实现路线 `architecture.md §12` 的 P0–P8 全部完成。9 个功能 commit + 4 个装机/文档/结构 commit，HEAD 在 main 上。

| 阶段 | commit | 范围 | 证据 |
|---|---|---|---|
| P0 骨架 | `7c8a1e8` | dual-format 5 文件（package.json + plugin.json + cordis.patch.yml + lib/index.js + SKILL.md） | `node scripts/verify.mjs` 5 层绿 |
| P0 完整 | `c74e1db` | 实体 / 状态机 / `team.*` 工具 / 启动对账 / UI slot 最小实现 | smoke-test 覆盖 |
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

### 1.1 验证

- `node scripts/verify.mjs` — 5 层 + 110 烟雾，**独立于 DSH** 跑（不依赖装到 DSH）
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
- 16 个 commit 已 push（v1.0 全量 + 2 个文档结构/进度 + P1.5-a/P1.5-b + 2.0 #1 拍板 + joinRun/leaveRun）
- Description 用 `package.json#description` 原文

---

## 2. 未完成的明确任务

按依赖顺序排列，**先做哪个优先**。

### 2.0 路线 — 1 项 + 2 项留口（按依赖递增）

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

#### #3 Cordis Service 跨插件注册

**Why deferred**: v1.0 services 是 bare modules（`import { list } from './services/member-service.js'`），其他插件拿不到 DSH Team 的运行时能力。

**目标形态**:
- 在 `apply(ctx)` 里 `ctx.effect(() => ctx.register('team', { ... }))`
- 暴露：`ctx.team`（TeamService）、`ctx.team.members`（MemberService）、`ctx.team.decisions`（DecisionPointService）、`ctx.team.messages`（MessageService）、`ctx.team.plans`（PlanService）、`ctx.team.artifacts`（ArtifactRegistry）
- `lib/index.js` 当前不注册 Cordis service —— 加 5 行 `ctx.effect(() => ctx.register(...))` 即可

**依赖**: 顺序在 #1 之后（先有 service 实例，再注册到 ctx），但与 #1 可并行开发（接口形状已知）

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

`requirements.md §11.4` / `architecture.md §11.2` 共 5 条 OQ + 1 条 2.0 拍板记录。v1.0 实现里已经用**倾向值**（tentative defaults）写死了，但措辞上仍 open。

| OQ | 倾向值（已写进实现）| 拍板状态 |
|---|---|---|
| OQ-1 plan step intent 枚举值集 | `produce \| review \| collect \| synthesize \| decide` | open |
| OQ-2 决策点等待默认 10 分钟 | 是（写进产品默认值）| open |
| OQ-3 跨 Run artifact id 内 run 归属段编码格式 | 实现层定（已用 `<run-id>/<artifact-id>`）| open |
| OQ-4 state-history 必含字段的准确措辞 | 实现已落，措辞用户审 | open |
| OQ-5 `requirements.md §4` 重写终稿措辞 | 第七轮已对齐收口清单，待最终审 | open |
| 2.0 #1 parent resolution | `parent = exec.agent` (option A) + adapter 由 cordis.patch.yml 三 entry 声明 | **closed (commit `530af83`)** |

**含义**: 5 OQ 不阻塞 2.0 开发；用户可以随时拍板，对应实现里已用倾向值，改动面小。

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
2.0 #3 Cordis Service 注册       ← 独立重构,可与 #1 并行
2.0 #2 跨 Run artifact 索引     ← 独立优化,最后做
```

每一项完工动作: 代码 → smoke test → `node scripts/verify.mjs` → commit → push → 回到本文件更新 §1/§2。

---

## 6. 协议

- 进度变更**只动本文件**: §1 增加 commit 记录、§2 把已完成项移到 §1 + 从 §2 移除、§3/§4 用户拍板后从 open 移到 closed
- 不要在 PROGRESS.md 里堆细节（细节去 commit message + smoke test）
- 每次 commit 完顺手更新本文件 + 同一 commit 里 push（避免漂移）
