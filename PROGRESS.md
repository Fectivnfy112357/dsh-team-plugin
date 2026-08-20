# DSH Team 插件 — 进度记录

> 记录时间：2026-08-20 · HEAD = 待 commit · branch = `main`
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
| 2.0 #1 (部分) | `530af83` + `40fe5fe` + `756b7b1` | 第一轮:parent = exec.agent (option A) 拍板;三个 subagent-acp entry 进 `cordis.patch.yml`;`MemberService.joinRun` / `leaveRun` 走 `ctx.subagents.startContinuable`;`services/adapters.js#registerAdapters` 改为 verify (不 register)。第二轮:4 留口方法 `sendMessage` / `dispatch` / `wake` / `triggerSelfHandoff` 全部落地(`MemberService.dispatch` 接 `ctx.subagents.followup` + auto-join)。第三轮 (本轮):flow engine rewiring 落地,三个 flow 替换 `dispatchLog` 为 `dispatchTask` helper(双路径:production 走 `MemberService.dispatch`,legacy 走 `dispatchLog`);`lib/index.js` 闭包 `ctx` 到 `args.__dshCtx` 让 `team.start` 真驱动子代理;`pending → assembling` 转换补全。**全闭环** | `node scripts/verify.mjs` 5 层绿 · smoke-test 97 → 110 → 146 → 176 checks |
| 2.0 #3 | `d381f73` | `lib/index.js` 新增 `createTeamServiceBundle()` + `registerTeamServices(ctx)`;六个 service 模块聚合为一个 frozen 对象,作为 `team` 走 `ctx.provide('team', bundle)`(Cordis `reflect.ts#provide`)挂到 ctx;`apply()` step 3d 调用,effect-wrapped 自动清理;跨插件消费者 `const t = ctx.get('team'); t.members.list(); t.decisions.waitingDecisions(...);` | `node scripts/verify.mjs` 5 层绿 · smoke-test 110 → 120 checks |
| 审阅收口 #1 | `aedbd10` | `reconcileOnBoot` 补全 per-dispatch mark:扫 dispatch-log,append `terminal=interrupted, reason=process-killed` 到每个 in-flight dispatch 末尾(原 issue 行不动,append-only 语义保留);`requirements.md §5.2/§4.3/§9.10.3` 加 `is_ad_hoc` 字段(schema 漂移修);`§9.7` 重连用语收口;`architecture.md §6.3` 切清 `team.resume` vs `team.rerun`;smoke-test [4/19] 扩 4 个新 check(in-flight 标 interrupted + reason + 已完成不被覆盖 + 原 issue 行保留) | `node scripts/verify.mjs` 5 层绿 · smoke-test 120 → 124 checks |
| 2.0 #1 留口 (第二批) | `40fe5fe` | `MemberService` 4 个留口方法落地:`sendMessage`(a2a-log + inbox + 轻量 followup);`dispatch`(自动 join if needed + scheduler->member followup + dispatch-log 落 scheduler + context_refs);`wake`(force-wake 无 dedup);`triggerSelfHandoff`(interrupt 旧 child + startContinuable 新 child + session_chain/handoff_files/self_handoff_count append + dispatch-log 落 kind=member-self-handoff);smoke-test [9j] 加 22 个新 check | `node scripts/verify.mjs` 5 层绿 · smoke-test 124 → 146 checks |
| 2.0 #4 | (待 commit) | pipeline-with-feedback 跨步 `context_refs` 自动传播:`runPipeline` 维护 `stepOutputs[i] = { produced_artifact_ids }` in-memory map,派下一步时按优先级 (1) `step.context_refs` (2) `flow_config.context_refs_override[i]` (3) 派生自 `stepOutputs[i-1]` 三层 fallback;feedback retry 路径取最终 attempt 的产物;smoke-test [12b/19] 加 8 个新 check (auto-derive / step override / flow override / feedback retry / 隔离 / reset);导出 `_resetStepOutputsForTests(runId)` | `node scripts/verify.mjs` 5 层绿 · smoke-test 146 → 154 checks |
| 2.0 #1 留口 (rewiring) | (待 commit) | 三个 flow (pipeline / round-table / fan-out) 替换 `dispatchLog` 占位为 `MemberService.dispatch`:`dispatchTask(ctx, runId, memberId, opts)` helper —— 有 `ctx.subagents.followup` 走 `MemberService.dispatch` (写 dispatch-log + followup + auto-join),否则回退到 v1.0 `dispatchLog` 纯日志路径;`lib/index.js` 在 tool 注册时闭包 `ctx` 到 `args.__dshCtx`,`team.start.execute` 读它并透传给 `flowSvc.run`;`team.start` 补 `pending → assembling` 转换;唯一写入者承诺 / 4 worker 上限 / degraded flag / max_rounds 全部保留;smoke-test [12c/19] / [12d/19] / [12e/19] / [12f/19] 加 22 个新 check (pipeline auto-join + followup + 跨步 context_refs 透传 / round-table dispatchTask fallback / fan-out 平行 + aggregator 含 context_refs / team.start → flowSvc.run → dispatchTask → MemberService.dispatch 端到端) | `node scripts/verify.mjs` 5 层绿 · smoke-test 154 → 176 checks |
| P1 #6 team.resume | (待 commit) | `team.resume` 工具落地:读 meta → 校验 `interrupted → assembling` ALLOWED 边 → 重 join 成员 (`MemberService.joinRun`,idempotent) → 重启 flow engine;`__dshCtx` 透传 production 路径走 `MemberService.dispatch` followup,无 ctx 走 v1.0 `dispatchLog` fallback;terminated member 走 best-effort rollback(状态机 `assembling → interrupted` 不在 ALLOWED 表里,直接 append state-history + 改 meta.json);与 `team.rerun` 语义切分保持(同 run 回滚 vs 配置克隆);smoke-test [20/19] 加 14 个新 check (not-found / non-interrupted 拒绝 / 端到端 mock ctx re-join + flow 重启 / state-history edge / session-state running / dispatch-log member-join / 无 ctx fallback) | `node scripts/verify.mjs` 5 层绿 · smoke-test 176 → 190 checks |
| 2.0 #2 | (待 commit) | artifact O(1) 反向引用索引 `_refCountIndex: Map<ref, Set<consumerArtifactId>>`:`register()` 时按 derived_from 逐 dep 加边(intra-artifact dedup);`refCount()` 改 O(1) 索引查(两个等价形式 `<runId>/<id>` 和 bare `<id>` 取并集);`canDelete()` 复用;`rebuildIndex()` 首次 refCount 调用时从磁盘懒加载(在已有 manifest 累积时);`_resetIndexForTests` 清空+重载。语义兼容 v1.0 线性扫(每 artifact 最多计 1 次,即使 derived_from 含重复 dep)。smoke-test [17b/19] + [17c/19] 加 8 个新 check (3 consumers / cross-form dedup / idempotent re-register / reset rebuild / unknown ref / 95 refs < 50ms 缩放) | `node scripts/verify.mjs` 5 层绿 · smoke-test 190 → 198 checks |
| P2 抛光 — A2A payload 上限 | (待 commit) | `message-service.js` 加 `A2A_PAYLOAD_MAX_BYTES = 1 MiB`(架构 §9.4 没硬定,1 MiB 是经验值:`a2a-message-log.jsonl` 单条 append 阻塞风险 + 对齐常见 ACP message 单条上限);`send` 入口按 `JSON.stringify(payload)` 长度校验;超限抛 `MessagePayloadTooLargeError`(可单独 catch,避免 pattern-match 错误字符串);失败时**不**写 a2a-log 也**不**碰 inbox(fail-fast);smoke-test [6b/19] 加 7 个新 check (1KB 接受 / 边界接受 / 超限抛 / 错误信息含 cap / 不漏到 a2a-log / 不碰 inbox / 常量值) | `node scripts/verify.mjs` 5 层绿 · smoke-test 198 → 206 checks |
| P2 抛光 — cross-Run 引用硬删兜底 | (待 commit) | `team.delete_artifact` 工具落地:走 `canDelete` 引用检查,refcount>0 拒绝(`deleted: false` + `refCountAtDelete`);refcount=0 时改 manifest + unlink 文件 + 失效反向索引(`_resetIndexForTests`);**没有** `force: true` 覆盖(单写入者承诺 + 防止"绕过 ref guard 误删");审计行(state-history)同时记录拒绝和成功(`kind: 'artifact-delete-attempt'`, `outcome: 'refused' \| 'deleted'`);smoke-test [17d/19] 加 11 个新 check (refused 不漏写 / audit trail / ref 删后 canDelete 变 true / 删除成功改 manifest / unlink 文件 / resolve undefined / refCount 0 / ghost 防御 / 缺 runId 抛) | `node scripts/verify.mjs` 5 层绿 · smoke-test 206 → 221 checks |
| P2 抛光 — §10 视觉 backlog 评估 | (待 commit) | 视觉 backlog 评估:配色/字体/圆角/间距/决策点角标颜色/A2A 消息密度 6 项均归 DSH host UI 侧(architecture §10 视觉子节明确归属 DSH),`ui/_react.js` 沙箱不持有实际样式;**不**在插件层实现,等真实用户声音 / DSH host 集成触发后由 DSH 端承担。本仓维持 `ui/team-*.js` React.createElement 最小骨架 + 已有 sentinel `data-*` 属性,等 host 端做最终样式 | `node scripts/verify.mjs` 5 层绿 · smoke-test 仍 221 checks |
| 5 OQ 全部 close (措辞签字) | (待 commit) | 2026-08-20 用户一次性签字 OQ-2/3/4/5 (按推荐项);`docs/requirements.md §11.4` / `docs/architecture.md §11.2` / `docs/requirements.md §17.5` 措辞收口,OQ-1 在 `aedbd10` 实质闭环;5 OQ 全部 closed,实现层与文档措辞一致 | `node scripts/verify.mjs` 5 层绿 · smoke-test 仍 221 checks (文档-only) |

### 1.1 验证

- `node scripts/verify.mjs` — 5 层 + 221 烟雾，**独立于 DSH** 跑（不依赖装到 DSH）
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
- 22 个 commit 已 push（v1.0 全量 + 2 个文档结构/进度 + P1.5-a/P1.5-b + 2.0 #1 拍板 + joinRun/leaveRun + 2.0 #3 service bundle + 1 个 build 杂项 + 审阅收口 #1 + 2.0 #1 留口第二批 + 2.0 #4 pipeline context_refs + 2.0 #1 留口 rewiring + P1 #6 team.resume + 2.0 #2 artifact 索引 + P2 抛光 A2A payload + P2 抛光 硬删兜底 + P2 抛光 §10 视觉评估 + 5 OQ close 措辞签字）
- Description 用 `package.json#description` 原文

---

## 2. 未完成的明确任务

按依赖顺序排列，**先做哪个优先**。

### 2.0 路线 — 5 项 closed（按依赖递增）

#### #1 MemberService 真子代理驱动 — ✅ 完成 (commit `530af83` + `40fe5fe` + `756b7b1`)

**已完成** (第一轮 `530af83`):
- ✅ 拍板 design 开放项:**parent = exec.agent (option A)**
- ✅ 拍板 adapter 注册路径:**三个 `@deepseek-ai/dsh-subagent-acp` Cordis 实例通过 `cordis.patch.yml` 声明**,`registerAdapters(ctx)` 改为 verify-and-warn
- ✅ `joinRun(ctx, runId, memberId, opts)` — 调 `ctx.subagents.startContinuable({ provider, label, request: { parent, prompt, persona? }, signal })` + 写 `session-state.json` (state=running, child_id, provider, label, joined_at, session_chain) + 写 `dispatch-log` (kind=member-join)
- ✅ `leaveRun(ctx, runId, memberId, opts)` — best-effort `ctx.subagents.interrupt(targetSessionId, authority)` + 写 `session-state.json` (state=terminated, left_at, leave_reason) + 写 `dispatch-log` (kind=member-leave)
- ✅ Idempotency: joinRun 二次调用返 existing,leaveRun 二次调用 no-op

**已完成** (第二轮 `40fe5fe` — 4 留口方法落地):
- ✅ `sendMessage(ctx, runId, fromMemberId, msg, opts)` — 走 `MessageService.send` 落 a2a-message-log + 投 inbox,收件人是单个已 join member 时 `ctx.subagents.followup` 推轻量 prompt("你有一条新消息");broadcast 不触发 followup(每个 member 自己读 inbox)
- ✅ `dispatch(ctx, runId, toMemberId, opts)` — 未 join 自动 joinRun + 已 join 复用,`ctx.subagents.followup` 推 task prompt,dispatch-log 落 `from: scheduler, to: member, context_refs` 单写入者承诺
- ✅ `wake(ctx, runId, toMemberId, opts)` — force-wake 无 dedup(对比 `MessageService.send` 内的 shouldWake dedup 路径);live child 不存在返 `dispatched: false`
- ✅ `triggerSelfHandoff(ctx, runId, memberId, opts)` — interrupt 旧 child + startContinuable 新 child + session-state.json 更新(current_session_id 替换、session_chain/handoff_files append、self_handoff_count +1、state 保持 running);dispatch-log 落 `kind: member-self-handoff`
- ✅ smoke-test [9j] 22 个新 check(124 → 146): 各方法的 entry shape / dispatch-log row / session-state 字段 / no-op 路径 / idempotency / 边界

**已完成** (第三轮 `756b7b1` — flow engine rewiring):
- ✅ **flow engine rewiring** —— `dispatchTask` helper 在三个 flow (pipeline / round-table / fan-out) 替换 `dispatchLog` 占位为 `MemberService.dispatch` (production) / `dispatchLog` (legacy test) 双路径;`lib/index.js` 闭包 `ctx` 到 `args.__dshCtx` 让 `team.start` 真驱动子代理;`pending → assembling` 转换补全;smoke-test 154 → 176 (22 个新 check)
- ✅ 唯一写入者承诺 / 4 worker 上限 / degraded flag / max_rounds 全部保留;`signalStepTerminal` / `signalBranchTerminal` 仍是 test + production 共同的"step / branch 完成"信号(子代理在 DSH 内部走 `team.complete_step` 工具)

**依赖**: 无前置 (独立模块,本轮已全闭环)

#### #2 跨 Run artifact 反向引用索引 — ✅ 完成 (commit `63864c9`)

**Why deferred**: v1.0 `artifact-registry.js#refCount` 是 lazy 线性扫描。Run 多了会变慢（O(n) 每次 refCount 查询）。

**已完成** (本轮):
- ✅ 维护 `_refCountIndex: Map<ref, Set<consumerArtifactId>>`,in-memory
- ✅ `register()` 走 `indexAdd` 加边,intra-artifact dedup 维持 v1.0 线性扫语义
- ✅ `refCount()` 改 O(1) 索引查;两个等价形式 (`<runId>/<id>` + bare `<id>`) 集合并集
- ✅ `rebuildIndex()` 首次 `refCount` 调用时从磁盘懒加载;`_resetIndexForTests()` 暴露给测试 + cold-start 路径
- ✅ smoke-test [17b/19] + [17c/19] 加 8 个新 check (3 consumers / cross-form dedup / idempotent re-register / reset rebuild / unknown ref / 95 refs < 50ms 缩放)

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

#### #4 pipeline-with-feedback step handoff → next step context_refs 传播 — ✅ 完成 (commit `fe38a78`)

**Why deferred**: v1.0 `services/pipeline-flow.js#runPipeline` 在 `signalStepTerminal` 收 `produced_artifact_ids` 后**没**自动带入下一步 dispatch 的 `context_refs`;`§4.7.2` 流程图也只写「查 plan 后派单」未明文规定 context 传递语义。fan-out §4.7.3 已经显式写了 `aggregator context_refs = completed_members.artifacts`,pipeline 写法不一致,产物跨步传递不显式。

**已完成** (本轮):
- ✅ `services/pipeline-flow.js#runPipeline` 维护 in-memory `stepOutputs[stepIndex] = { produced_artifact_ids }`(`Map<runId, Array<{...}>>`);feedback retry 路径取最终 attempt 的产物(覆盖式写)
- ✅ 派下一步时按优先级解析 `context_refs`:(1) `step.context_refs` 静态覆盖 → (2) `flow_config.context_refs_override[stepIndex]` flow 覆盖 → (3) 派生自 `stepOutputs[i-1].produced_artifact_ids`(空数组 / 缺失时降级为 `[]`)
- ✅ smoke-test [12b/19] 加 8 个新 check:auto-derive (3-step + multi-artifact)/ step-level override / flow-level override / feedback retry 取最终产物 / 空产物边界 / 跨 run 隔离 / `_resetForTests` 清空
- ✅ 导出 `_resetStepOutputsForTests(runId)`(备 2.x cold-resume 场景)

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
- ✅ `team.resume` 工具实现(本轮 commit) — 读 `meta.json` 当前状态 → ALLOWED 转换 `interrupted → assembling` → 重 join 成员 → 重启 flow engine

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
| OQ-1 plan step intent 枚举值集 | `produce \| review \| collect \| synthesize \| decide` | **closed (commit `aedbd10`)** — 5 值已写进 `lib/tools/team-tools.js:449` schema + `services/plan-service.js` 校验 + smoke-test [16/19] 验过 `produce` / `review`;2026-08-20 用户签字 |
| OQ-2 决策点等待默认 10 分钟 | 是（写进产品默认值）| **closed (commit `750f837`)** — 2026-08-20 用户签字;`services/decision-point-service.js:85` 写死 `DEFAULT_WAIT_MINUTES = 10`,`open()` 默认取它 |
| OQ-3 跨 Run artifact id 内 run 归属段编码格式 | `<run-id>/<artifact-id>` (canonical) + 裸 `<id>` 兼容 (intra-Run) | **closed (commit `750f837`)** — 2026-08-20 用户签字 |
| OQ-4 state-history 必含字段的准确措辞 | `from_state` / `to_state` / `reason` / `timestamp` | **closed (commit `750f837`)** — 2026-08-20 用户签字;`services/team-service.js:153` 实写 |
| OQ-5 `requirements.md §4` 重写终稿措辞 | 第七轮收口清单（`docs/discussion-log.md` 末段）已对齐 | **closed (commit `750f837`)** — 2026-08-20 用户签字 |
| 2.0 #1 parent resolution | `parent = exec.agent` (option A) + adapter 由 cordis.patch.yml 三 entry 声明 | **closed (commit `530af83`)** |
| 2.0 #6 重跑 interrupted 语义 | `team.resume`(同 run 状态回滚) + `team.rerun`(配置克隆) 分清 | **closed (commit `aedbd10`)** — 文档入 `architecture.md §6.3` |

**含义**: 5 OQ + 2 条 2.0 拍板记录 (parent resolution + 重跑 interrupted 语义) 全部 closed。2026-08-20 用户一次性签字 OQ-2/3/4/5（按推荐项），OQ-1 在 commit `aedbd10` 已实质闭环。措辞已写入 `docs/requirements.md §11.4` / `docs/architecture.md §11.2`，§4 即终稿。

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
2.0 #1 MemberService 真子代理    ✅ commit 530af83 (joinRun/leaveRun) + ✅ commit 40fe5fe (sendMessage/dispatch/wake/triggerSelfHandoff) + ✅ (本轮 commit) flow engine rewiring (dispatchTask in 3 flows + lib/index.js ctx 闭包 + team.start 端到端)
2.0 #3 Cordis Service 注册       ✅ commit d381f73 (frozen bundle on ctx.team via ctx.provide)
2.0 #5 reconcileOnBoot per-dispatch mark ✅ commit aedbd10 (审阅收口 #1)
2.0 #6 重跑 interrupted 语义      ✅ 拍板 (commit aedbd10)  team.resume 留口
2.0 #4 pipeline context_refs    ✅ (本轮 commit)
2.0 #2 跨 Run artifact 索引     ✅ (本轮 commit)
```

每一项完工动作: 代码 → smoke test → `node scripts/verify.mjs` → commit → push → 回到本文件更新 §1/§2。

---

## 6. 协议

- 进度变更**只动本文件**: §1 增加 commit 记录、§2 把已完成项移到 §1 + 从 §2 移除、§3/§4 用户拍板后从 open 移到 closed
- 不要在 PROGRESS.md 里堆细节（细节去 commit message + smoke test）
- 每次 commit 完顺手更新本文件 + 同一 commit 里 push（避免漂移）
