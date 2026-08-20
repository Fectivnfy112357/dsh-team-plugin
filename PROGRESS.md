# DSH Team 插件 — 进度记录

> 记录时间：2026-08-20 · HEAD = `a0eb57e` · branch = `main`
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

### 1.1 验证

- `node scripts/verify.mjs` — 5 层 + 84 烟雾，**独立于 DSH** 跑（不依赖装到 DSH）
- 预期输出：`✅ verify passed (0 warnings, 0 errors)`

### 1.2 装机状态

- 装在 `web` profile（`pnpm link`，仓根 → `D:\dsh-plugins\dsh-team-plugin` 的 junction 避开路径空格）
- `dsh --profile web --port 0` 启动验证过（`http://127.0.0.1:<port>`，stderr 空）

### 1.3 远程仓库

- URL: https://github.com/Fectivnfy112357/dsh-team-plugin
- 可见性: public
- 默认分支: main
- 14 个 commit 已 push（v1.0 全量 + 2 个文档结构/进度）
- Description 用 `package.json#description` 原文

---

## 2. 未完成的明确任务

按依赖顺序排列，**先做哪个优先**。

### 2.0 路线 — 3 项（按依赖递增）

#### #1 MemberService 真子代理驱动

**Why deferred**: v1.0 `services/member-service.js` 只实现 CRUD（`list` / `get`），`joinRun` / `sendMessage` / `dispatch` / `wake` / `triggerSelfHandoff` 是 JSDoc 合同没真接 `ctx.subagents.startContinuable(...)`。Flow engine 现在跑的是 DSH 侧 handoff 占位（`signalStepTerminal` / `signalBranchTerminal`），Members 还没真起子代理。

**接入点**（`subagent/README.zh.md`）:
- API: `ctx.subagents.startContinuable({ provider, label, ... })` → `{ childId, messageId, handle }`
- 要求: `ctx.agents`、会话持久化、provider 有 `prepareContinuable` 能力
- 失败语义: 兑现前失败 → 调用被拒绝、**完全回滚**该子 agent（不返回 id）

**设计开放项**: `startContinuable` 要求 caller 处于"delegating parent"位置。team service 是 static plugin 不是 agent，**parent 怎么解析**待查（`ctx.agents.create()` 起 system agent？还是 DSH 暴露 `ctx.systemAgent`？）。

**当前 `services/adapters.js` 的 stub 错**: `ctx.subagents.registerProvider(def.provider, def)` —— 实际 API 是 `registerProvider(providerObject)`，且 ACP provider 是通过 `import { apply as applyAcp } from '@deepseek-ai/dsh-subagent-acp'` 调三次（providerName 分别为 `acp-hermes` / `acp-mcode` / `acp-claude-code`）。

**目标形态**:
- `registerAdapters(ctx)`: 真调 `applyAcp` × 3
- `joinRun(runId, memberId)`: `startContinuable` → 写 `session-state.json`（childId / provider / handle 引用）→ 写 `dispatch-log`
- `leaveRun(runId, memberId)`: dispose handle + 删 `session-state.json` + 写 `state-history`
- `sendMessage` / `dispatch` / `wake` / `triggerSelfHandoff`: 等 parent 解析方案定下来再接

**依赖**: 无前置（独立模块）

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

### P1.5 路线 — 2 项（独立可做，不依赖 2.0）

#### P1.5-a `team-plan` slot UI

**Why deferred**: `architecture.md §7.3` 规定了 plan 渲染结构，但 `ui/team-plan.js` 没建。当前 `plan_output=true` 写盘了 plan 但面板无渲染。

**目标形态**:
- 新建 `ui/team-plan.js`
- slot id: `team-plan`
- 接收 `planId` props，从 `PlanService.get(planId)` 拿 plan artifact 渲染（content_ref + steps 索引）
- 在 `lib/index.js` 注册

#### P1.5-b `team-panel` 实时 DP 订阅

**Why deferred**: `decision-point-service.js` 的 `on()` 订阅接口已就绪（`subscribe(observer)` 返回 unsubscribe），`team-panel.js` 没接。当前决策点开启要等用户刷新才看到。

**目标形态**:
- `team-panel.js` 启动时调 `decisions.on(observer)`
- observer 收到 DP 变化 → 重渲染对应 `team-decision-badge`
- plugin unload 时自动 dispose

---

## 3. 待用户拍板（不是实现任务，是机制/措辞决策）

`requirements.md §11.4` / `architecture.md §11.2` 共 5 条 OQ。v1.0 实现里已经用**倾向值**（tentative defaults）写死了，但措辞上仍 open。

| OQ | 倾向值（已写进实现）| 拍板状态 |
|---|---|---|
| OQ-1 plan step intent 枚举值集 | `produce \| review \| collect \| synthesize \| decide` | open |
| OQ-2 决策点等待默认 10 分钟 | 是（写进产品默认值）| open |
| OQ-3 跨 Run artifact id 内 run 归属段编码格式 | 实现层定（已用 `<run-id>/<artifact-id>`）| open |
| OQ-4 state-history 必含字段的准确措辞 | 实现已落，措辞用户审 | open |
| OQ-5 `requirements.md §4` 重写终稿措辞 | 第七轮已对齐收口清单，待最终审 | open |

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
P1.5-a team-plan slot UI       ← 独立,纯 UI,可最先做
P1.5-b 实时 DP 订阅             ← 独立,纯 UI,可与 P1.5-a 并行
2.0 #1 MemberService 真子代理    ← 需先解 parent 解析
2.0 #3 Cordis Service 注册       ← 独立重构,可与 #1 并行
2.0 #2 跨 Run artifact 索引     ← 独立优化,最后做
```

每一项完工动作: 代码 → smoke test → `node scripts/verify.mjs` → commit → push → 回到本文件更新 §1/§2。

---

## 6. 协议

- 进度变更**只动本文件**: §1 增加 commit 记录、§2 把已完成项移到 §1 + 从 §2 移除、§3/§4 用户拍板后从 open 移到 closed
- 不要在 PROGRESS.md 里堆细节（细节去 commit message + smoke test）
- 每次 commit 完顺手更新本文件 + 同一 commit 里 push（避免漂移）
