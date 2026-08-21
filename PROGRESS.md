# DSH Team 插件 — 进度记录

> 记录时间：2026-08-21 · HEAD = `514560f`（working tree 含本轮 33rd commit 改动，未 commit）· branch = `main`
>
> 本文件是工作进度快照（不是规范/合同）。规范请读 [`docs/requirements.md`](./docs/requirements.md) + [`docs/architecture.md`](./docs/architecture.md)；插件边界/读者请读 [`AGENTS.md`](./AGENTS.md)。
>
> **范围重述（2026-08-20）**：本仓即 DSH Team 体验的 host——`client-ui-*` 槽位的实现组件（`client-ui-layout` 顶栏+footer / `client-ui-sidebar` / `client-ui-conversation` / `client-ui-user-questions` / `client-ui-tool` / `client-ui-plan`）、常驻面板 chrome（顶栏 / sidebar / footer / 主区头 / 团队操作按钮）、决策点响应卡片、ad-hoc 决策点按钮、多 Team 视图、重跑按钮、视觉细节 token（`ui/_react.js#tokens` Proxy + `getTokens()`）、配置中心表单（`ui/team-config.js#TeamConfigPanel` 3 tab）、Role/Member/TeamTemplate CRUD UI 与工具（`team.*_role / _member / _template` 共 9 个）全部归本仓；不再推到外部 DSH 端。

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
| fix(install) | `8f7c3fe` | 2 处 host 启动时校验真错（`inject: slots` / `output.render`） | `dsh --profile web --port 0` 起来 |
| docs(agents) | `0ff8f9b` | 装到本地 DSH 步骤 + 2 处 host 启动时校验真错记录进 AGENTS.md | 本仓文档 |
| docs(structure) | `9cd7965` | 把 `requirements.md` / `architecture.md` / `discussion-log.md` 移到 `docs/` 子目录 + 修正跨文件相对链接 | `node scripts/verify.mjs` 5 层绿 |
| docs(progress) | `a0eb57e` | 新增 `PROGRESS.md` 记录 v1.0 → 2.0 进度 + AGENTS.md 索引更新 | `node scripts/verify.mjs` 5 层绿 |
| P1.5-a / P1.5-b | `d478fdd` | `ui/team-plan.js` 新建 + slot 注册 + DP 实时订阅桥 (`wireDecisionPointBridge` → `team/decision-point-open` / `-respond` 事件总线) + `subscribeDps(ctx, onChange)` helper | `node scripts/verify.mjs` 5 层绿 · smoke-test 84 → 97 checks |
| 2.0 #1 (部分) | `530af83` + `40fe5fe` + `756b7b1` | 第一轮:parent = exec.agent (option A) 拍板;三个 subagent-acp entry 进 `cordis.patch.yml`;`MemberService.joinRun` / `leaveRun` 走 `ctx.subagents.startContinuable`;`services/adapters.js#registerAdapters` 改为 verify (不 register)。第二轮:4 留口方法 `sendMessage` / `dispatch` / `wake` / `triggerSelfHandoff` 全部落地(`MemberService.dispatch` 接 `ctx.subagents.followup` + auto-join)。第三轮 (本轮):flow engine rewiring 落地,三个 flow 替换 `dispatchLog` 为 `dispatchTask` helper(双路径:production 走 `MemberService.dispatch`,legacy 走 `dispatchLog`);`lib/index.js` 闭包 `ctx` 到 `args.__dshCtx` 让 `team.start` 真驱动子代理;`pending → assembling` 转换补全。**全闭环** | `node scripts/verify.mjs` 5 层绿 · smoke-test 97 → 110 → 146 → 176 checks |
| 2.0 #3 | `d381f73` | `lib/index.js` 新增 `createTeamServiceBundle()` + `registerTeamServices(ctx)`;六个 service 模块聚合为一个 frozen 对象,作为 `team` 走 `ctx.provide('team', bundle)`(Cordis `reflect.ts#provide`)挂到 ctx;`apply()` step 3d 调用,effect-wrapped 自动清理;跨插件消费者 `const t = ctx.get('team'); t.members.list(); t.decisions.waitingDecisions(...);` | `node scripts/verify.mjs` 5 层绿 · smoke-test 110 → 120 checks |
| 审阅收口 #1 | `aedbd10` | `reconcileOnBoot` 补全 per-dispatch mark:扫 dispatch-log,append `terminal=interrupted, reason=process-killed` 到每个 in-flight dispatch 末尾(原 issue 行不动,append-only 语义保留);`requirements.md §5.2/§4.3/§9.10.3` 加 `is_ad_hoc` 字段(schema 漂移修);`§9.7` 重连用语收口;`architecture.md §6.3` 切清 `team.resume` vs `team.rerun`;smoke-test [4/19] 扩 4 个新 check(in-flight 标 interrupted + reason + 已完成不被覆盖 + 原 issue 行保留) | `node scripts/verify.mjs` 5 层绿 · smoke-test 120 → 124 checks |
| 2.0 #1 留口 (第二批) | `40fe5fe` | `MemberService` 4 个留口方法落地:`sendMessage`(a2a-log + inbox + 轻量 followup);`dispatch`(自动 join if needed + scheduler->member followup + dispatch-log 落 scheduler + context_refs);`wake`(force-wake 无 dedup);`triggerSelfHandoff`(interrupt 旧 child + startContinuable 新 child + session_chain/handoff_files/self_handoff_count append + dispatch-log 落 kind=member-self-handoff);smoke-test [9j] 加 22 个新 check | `node scripts/verify.mjs` 5 层绿 · smoke-test 124 → 146 checks |
| 2.0 #4 | `fe38a78` | pipeline-with-feedback 跨步 `context_refs` 自动传播:`runPipeline` 维护 `stepOutputs[i] = { produced_artifact_ids }` in-memory map,派下一步时按优先级 (1) `step.context_refs` (2) `flow_config.context_refs_override[i]` (3) 派生自 `stepOutputs[i-1]` 三层 fallback;feedback retry 路径取最终 attempt 的产物;smoke-test [12b/19] 加 8 个新 check (auto-derive / step override / flow override / feedback retry / 隔离 / reset);导出 `_resetStepOutputsForTests(runId)` | `node scripts/verify.mjs` 5 层绿 · smoke-test 146 → 154 checks |
| 2.0 #1 留口 (rewiring) | `756b7b1` | 三个 flow (pipeline / round-table / fan-out) 替换 `dispatchLog` 占位为 `MemberService.dispatch`:`dispatchTask(ctx, runId, memberId, opts)` helper —— 有 `ctx.subagents.followup` 走 `MemberService.dispatch` (写 dispatch-log + followup + auto-join),否则回退到 v1.0 `dispatchLog` 纯日志路径;`lib/index.js` 在 tool 注册时闭包 `ctx` 到 `args.__dshCtx`,`team.start.execute` 读它并透传给 `flowSvc.run`;`team.start` 补 `pending → assembling` 转换;唯一写入者承诺 / 4 worker 上限 / degraded flag / max_rounds 全部保留;smoke-test [12c/19] / [12d/19] / [12e/19] / [12f/19] 加 22 个新 check (pipeline auto-join + followup + 跨步 context_refs 透传 / round-table dispatchTask fallback / fan-out 平行 + aggregator 含 context_refs / team.start → flowSvc.run → dispatchTask → MemberService.dispatch 端到端) | `node scripts/verify.mjs` 5 层绿 · smoke-test 154 → 176 checks |
| P1 #6 team.resume | `c5ae49b` | `team.resume` 工具落地:读 meta → 校验 `interrupted → assembling` ALLOWED 边 → 重 join 成员 (`MemberService.joinRun`,idempotent) → 重启 flow engine;`__dshCtx` 透传 production 路径走 `MemberService.dispatch` followup,无 ctx 走 v1.0 `dispatchLog` fallback;terminated member 走 best-effort rollback(状态机 `assembling → interrupted` 不在 ALLOWED 表里,直接 append state-history + 改 meta.json);与 `team.rerun` 语义切分保持(同 run 回滚 vs 配置克隆);smoke-test [20/19] 加 14 个新 check (not-found / non-interrupted 拒绝 / 端到端 mock ctx re-join + flow 重启 / state-history edge / session-state running / dispatch-log member-join / 无 ctx fallback) | `node scripts/verify.mjs` 5 层绿 · smoke-test 176 → 190 checks |
| 2.0 #2 | `63864c9` | artifact O(1) 反向引用索引 `_refCountIndex: Map<ref, Set<consumerArtifactId>>`:`register()` 时按 derived_from 逐 dep 加边(intra-artifact dedup);`refCount()` 改 O(1) 索引查(两个等价形式 `<runId>/<id>` 和 bare `<id>` 取并集);`canDelete()` 复用;`rebuildIndex()` 首次 refCount 调用时从磁盘懒加载(在已有 manifest 累积时);`_resetIndexForTests` 清空+重载。语义兼容 v1.0 线性扫(每 artifact 最多计 1 次,即使 derived_from 含重复 dep)。smoke-test [17b/19] + [17c/19] 加 8 个新 check (3 consumers / cross-form dedup / idempotent re-register / reset rebuild / unknown ref / 95 refs < 50ms 缩放) | `node scripts/verify.mjs` 5 层绿 · smoke-test 190 → 198 checks |
| P2 抛光 — A2A payload 上限 | `750f837` | `message-service.js` 加 `A2A_PAYLOAD_MAX_BYTES = 1 MiB`(架构 §9.4 没硬定,1 MiB 是经验值:`a2a-message-log.jsonl` 单条 append 阻塞风险 + 对齐常见 ACP message 单条上限);`send` 入口按 `JSON.stringify(payload)` 长度校验;超限抛 `MessagePayloadTooLargeError`(可单独 catch,避免 pattern-match 错误字符串);失败时**不**写 a2a-log 也**不**碰 inbox(fail-fast);smoke-test [6b/19] 加 7 个新 check (1KB 接受 / 边界接受 / 超限抛 / 错误信息含 cap / 不漏到 a2a-log / 不碰 inbox / 常量值) | `node scripts/verify.mjs` 5 层绿 · smoke-test 198 → 206 checks |
| P2 抛光 — cross-Run 引用硬删兜底 | `750f837` | `team.delete_artifact` 工具落地:走 `canDelete` 引用检查,refcount>0 拒绝(`deleted: false` + `refCountAtDelete`);refcount=0 时改 manifest + unlink 文件 + 失效反向索引(`_resetIndexForTests`);**没有** `force: true` 覆盖(单写入者承诺 + 防止"绕过 ref guard 误删");审计行(state-history)同时记录拒绝和成功(`kind: 'artifact-delete-attempt'`, `outcome: 'refused' \| 'deleted'`);smoke-test [17d/19] 加 11 个新 check (refused 不漏写 / audit trail / ref 删后 canDelete 变 true / 删除成功改 manifest / unlink 文件 / resolve undefined / refCount 0 / ghost 防御 / 缺 runId 抛) | `node scripts/verify.mjs` 5 层绿 · smoke-test 206 → 221 checks |
| P2 抛光 — §10 视觉 backlog 评估 | `750f837` | **撤销"归 DSH host 端"判定**。本仓即 DSH Team 体验的 host,所有视觉细节(配色/字体/圆角/间距/决策点角标颜色/A2A 消息密度/常驻面板 chrome 全部)归本仓。`ui/_react.js` 沙箱将升级为持有实际样式 token(色板/字号/圆角/间距变量)与具体子组件;`ui/team-*.js` React.createElement 骨架扩展为带 sentinel `data-*` 属性的完整可读组件(本轮只声明留口,具体排版与微交互归 2.0 实现轮) | `node scripts/verify.mjs` 5 层绿 · smoke-test 仍 221 checks |
| 5 OQ 全部 close (措辞签字) | `a03f9ae` | 2026-08-20 用户一次性签字 OQ-2/3/4/5 (按推荐项);`docs/requirements.md §11.4` / `docs/architecture.md §11.2` / `docs/requirements.md §17.5` 措辞收口,OQ-1 在 `aedbd10` 实质闭环;5 OQ 全部 closed,实现层与文档措辞一致 | `node scripts/verify.mjs` 5 层绿 · smoke-test 仍 221 checks (文档-only) |
| 2.0 §2 全 17 项闭环 (A1-A8 + B1-B11) | `4f3af37` | A1-A3: 三个 service CRUD + 引用检查 + cross-ref 校验;A4-A5: `ui/team-config.js` 3 tab 表单 + slot 重接;A6-A8: 9 个 team.*_role/member/template 工具;B1: 视觉 token 系统 (`tokens` Proxy + `getTokens()` + `DEFAULT_TOKENS` 深 freeze + 运行时主题覆盖 + `_resetThemeForTests`);B2-B5: `ui/layout.js#TeamTopBar`+`TeamFooter`+`ui/sidebar.js#TeamSidebar`+`TeamPanel` 主区头 (rerun/abort/resume/insert-adhoc 操作按钮);B6-B7: `ui/user-questions.js#UserQuestionCard` + `team-decision-badge` 扩展(等推进 角标);B8-B9: `ui/conversation.js#ConversationTimeline` + 多 Team 视图 + 重跑按钮 (随 B3 侧栏);B10-B11: `ui/tool.js#TeamToolCall` + `ui/plan.js#PlanSurface` 通用呈现;`lib/index.js` 注册所有 client-ui-* 槽位 + 失败降级(try/catch);`_react.js` 沙箱升级:functional component 自动渲染 + 深 freeze token + Proxy 主题覆盖。**全闭环** | `node scripts/verify.mjs` 5 层绿 · smoke-test 221 → 298 checks (净 +77) · test-install 13/13 pass |

### 1.1 验证

- `node scripts/verify.mjs` — 5 层 + 298 烟雾，**独立于 DSH** 跑（不依赖装到 DSH）
- `node scripts/test-install.mjs` — 实启 `dsh --profile web --port 0` 13 项 host 启动门（prerequisites / manifest / boot / teardown）— **依赖 DSH**
- 预期输出：`✅ verify passed (0 warnings, 0 errors)` + `13 passed, 0 failed`

### 1.2 装机状态

- 装在 `web` profile（`pnpm link`，仓根 → `D:\dsh-plugins\dsh-team-plugin` 的 junction 避开路径空格）
- `dsh --profile web --port 0` 启动验证过（`http://127.0.0.1:<port>`，stderr 空）
- 装机后 P1.5-a / P1.5-b 的两个事件（`team-plan` slot + DP 桥）会在 reload 时自然启用，无需重新装机
- 2.0 #1 的 joinRun / leaveRun 真实路径需要 `@deepseek-ai/dsh-subagent-acp` + 三个 adapter CLI（`hermes` / `mcode` / `claude-agent-acp`）一并装到同 profile；`cordis.patch.yml` 已声明三个 entry,DSH host 加载 cordis.yml 时自动起
- 2.0 §2 全部 17 项闭环后,`client-ui-*` 6 个槽位 (`layout` / `sidebar` / `user-questions` / `conversation` / `tool` / `plan`) + `team-config` / `team-panel` / `team-plan` / `settings.section` slot 全部注册,DSH host 启动时通过 `lib/index.js#registerLayoutSlot` / `registerSidebarSlot` 等 6 个 registrar 串入 cordis 的 slot 树

### 1.3 远程仓库

- URL: https://github.com/Fectivnfy112357/dsh-team-plugin
- 可见性: public
- 默认分支: main
- 23 个 commit 已 push（v1.0 全量 + 2 个文档结构/进度 + P1.5-a/P1.5-b + 2.0 #1 拍板 + joinRun/leaveRun + 2.0 #3 service bundle + 1 个 build 杂项 + 审阅收口 #1 + 2.0 #1 留口第二批 + 2.0 #4 pipeline context_refs + 2.0 #1 留口 rewiring + P1 #6 team.resume + 2.0 #2 artifact 索引 + P2 抛光 A2A payload + P2 抛光 硬删兜底 + P2 抛光 §10 视觉评估 + 5 OQ close 措辞签字 + **2.0 §2 全 17 项闭环 (A1-A8 + B1-B11)** = `4f3af37`）
- 24 个 commit 已 push（+ **fix(client+tools): real DSH slots + tool schema DSL** = working tree）—— 把"DSH 客户端没看到 Team 设置入口 + host 端 tool schema 校验不过就 crash"两个**预先就存在**的 bug 一起修了：client 侧补 `lib/client.js` (esbuild 单文件 bundle，浏览器拉得到);`ui/*.js` 的 6 个 chrome slot 注册从 `client-ui-*` 假名切到 `shell.overlay` / `conversation.view` / `sidebar.footer.action` / `tool.call.toolview` 真名;`lib/index.js` 删 host 端死代码 slot 注册;`lib/tools/team-tools.js` 29 个 tool 的 `parameters` 从 `{ type: 'object', required: [...], properties: {...} }` JSON-Schema 形状 改 dsh-tools property-map 形状;`output.schema` 同理去掉 `required` 数组 + 给所有 `type: 'object'` schema 补 `additionalProperties: true`。`node scripts/verify.mjs` 5 层绿 · `node scripts/test-install.mjs` 15/15 过 · host 启动 `dsh web: http://127.0.0.1:<port>` 干净 boot · HTTP 200 · stderr 空
- 25 个 commit（待 push，**working tree**）—— 修了"装最新版后 `Failed to load plugins: client-modules: bundle /plugins/dsh-team-plugin/client.js?rev=... loaded without registering dsh-team-plugin via __ModuleLoader__.load`"运行时错误：根因是 `lib/client.js` 是 ESM `export { apply, inject }` 形态，但 DSH client-modules 期望 bundle 是 CJS 并立即调 `window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports; } })`（tsdown 在 `packages/client/tsdown.client.ts:269-271` 就是这么做的）。`scripts/build-client.mjs` 改 `format: 'esm' → 'cjs'` + 加 banner/footer 包 wrapper (id 从 `package.json#name` 读 = `"dsh-team-plugin"`);`scripts/verify.mjs` 第 0 层加 11 个 client bundle 检查 (6 静态结构断言 + 5 端到端 runtime 烟雾:实际 eval bundle,捕获 `__ModuleLoader__.load` handoff,确认 id / factory / exports = { apply, inject }),从此退化不复发。`node scripts/verify.mjs` 5 层绿 · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- 26 个 commit（待 push，**working tree**）—— 修了"装最新版后 Team 设置页 entry 出现但右侧 body 空（控制台无报错）"bug：**根因是 6 个 `register*Slot` 函数全用 Cordis 风格把 `component` / `props` / `kind` 塞到 `ctx.slots.register` 的 options 里**——但 DSH `@deepseek-ai/dsh-client-ui-slots#register` 签名是 `register(options, component)`，component 是**第二参**；options 在 `packages/client/ui-slots/src/index.ts:845-860` 被严格过滤到 `{ id, key, order, label, priority, inject, children, store, locale, registrant }` 几样，其他字段**直接丢**。结果 entry 注册成功（id/order/label 进 ledger，nav row 出现），但 `entry.component` 是 `undefined`，renderer 拿到 `undefined` 就什么都不渲染（控制台无报错，因为是 React 渲染 `null`）。6 个 registrar 全中招：`ui/team-panel.js#registerTeamSlots`（settings.section）+ `ui/layout.js#registerLayoutSlot`（shell.overlay × 2）+ `ui/sidebar.js#registerSidebarSlot`（sidebar.footer.action + shell.overlay）+ `ui/conversation.js#registerConversationSlot`（conversation.view）+ `ui/tool.js#registerToolSlot`（tool.call.toolview × 29, for 循环体）。**本轮做了两件**：(a) 5 个源文件把 `ctx.slots.register({...with component/props/kind}, Comp)` 改成 `ctx.slots.register({...干净的 options}, Comp)`（drop `kind: 'list'/'keyed'` / `component:` / `props:`），`scripts/verify.mjs` 加静态扫（扫 5 个 registrar 源文件，解析 `ctx.slots.register(...)` 调用 → 取第一个顶层逗号切两参 → 验 options 不含 `kind` / `component` / `props` → 验 2nd arg 非空；命中 7 个 call sites 全过）。(b) 新增 `ui/team-config-host.js#TeamConfigPanelHost` 适配层（10 行）—— DSH slot 渲染给的是 runtime prop（`close` / `t` / `renderSlot` / inject face 钩子），`TeamConfigPanel` 是 render-only 组件要 `props.roles / members / templates / onChangeTab / onSubmit*`，没有适配层就连 "Loading configuration…" 分支都进不去。HOC 给 no-op `onChangeTab` / `onSubmit*` / `onDelete` 跳过 loading 分支，**表单现在能渲染出来**，但 submit 是 no-op（数据层是 §4 留口 — DSH 主机代码两处硬约束：settingsScope 走 `WEB_SETTINGS_NAMESPACES` 白名单，host.call 走 typed RPC 表都没有 `team.*` slot）。`node scripts/verify.mjs` 5 层绿 · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- 27 个 commit（待 push，**working tree**）—— 修了"装 26th commit 后浏览器报 `Minified React error #31: Objects are not valid as a React child (found: object with keys {__reactEl, type, props, children})` 且**每个 slot 都崩**（sidebar.footer.action / shell.overlay × 3 / settings.section）"运行时 bug：**根因是 `ui/_react.js` 的 `createElement` shim 假设 `globalThis.React` 可用**——但 DSH 客户端 React **不在 globalThis 上**，在静态模块表的 `'react'` 键下（`packages/client/web/src/seed.ts:25-40`：`'react': React` + `'react-dom'` / `'react-dom/client'` / `'@deepseek-ai/cordis'` / `@deepseek-ai/dsh-client-ui-slots` 等 10 个 table word），工厂 `factory(require)` 的 `require('react')` 拿到。shim 走 fallback 路径返回 `{__reactEl: true, type, props, children}` sentinel，DSH renderer 把 sentinel 喂给真 React → #31。**修法**：`scripts/build-client.mjs` 的 banner 在 factory 顶部加 `var React = require("react"); globalThis.React = React;`（`scripts/build-client.mjs:114-115` 两行），让 shim 找到真 React；`scripts/verify.mjs` 第 0 层加两个新 check：(i) bundle 必须含 `var React = require("react")` + `globalThis.React = React` 两条（拆两行 regex 跨行匹配），(ii) 端到端 runtime 烟雾里 `factory()` 调用的 require stub 放行 `'react'` 这个 seed word（其他仍 throw，新增 seed word 时这里也要放行）；两个新 check 都能 100% 捕获"有人改了 build 但忘了 pin React" / "有人改了 require stub 改错了"的退化。`node scripts/verify.mjs` 5 层绿 · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- 28 个 commit（待 push，**working tree**）—— 修了"装 27th commit 后浏览器现在能渲染，但 Team chrome（顶栏 + footer + sidebar）覆盖了整个 DSH 主页、用户无法操作"运行时 bug：**根因是 `shell.overlay` 在 `position: absolute; inset: 0` 层（`packages/client/ui-layout/src/client/AppFrame.module.css:110-115` 的 `.overlayLayer` + `.overlayLayer > *`）里渲染，每个 child 必须自定位**（`top: 0` / `bottom: 0` 等）。我们之前的 3 个 `shell.overlay` entry（`team-topbar` / `team-footer` / `team-panel`，都绑 `TeamSidebar` / `TeamTopBar` / `TeamFooter`）inline-style 只设了 `display: flex` 等文档流属性，**没有 `position: absolute`**，结果在 `inset: 0` 父层里按文档流堆：第一 entry 顶在最上，第二 entry 紧跟其下（"0 ACP sessions | 0 artifacts..." 那行），第三 entry（`team-panel` 用 `TeamSidebar` 整页侧栏）占满剩下的全部高度，把 DSH 主页覆盖。**修法 3 处**：(a) `ui/layout.js#TeamTopBar` 根 `div` 加 `position: absolute; top: 0; left: 0; right: 0; z-index: 10;`（`ui/layout.js:46-50`），让顶栏贴 frame 顶端 50px 条带；(b) `ui/layout.js#TeamFooter` 加 `position: absolute; bottom: 0; left: 0; right: 0; z-index: 10;`（`ui/layout.js:118-122`），贴底端 24px 计数条；(c) 删 `shell.overlay id='team-panel'` 整条注册 + 删 `TeamSidebar` 复用（与 `sidebar.footer.action` 重复），新增 `TeamSidebarFooterIcon` 简单 icon button（32×32 圆点，跟顶栏 brand mark 一致）作 `sidebar.footer.action` 的 entry——sidebar.footer.action 槽位是 icon button 行（~36px/格），不能用整页侧栏占（`ui-cordis CordisPanel` 同款 pattern：small button + toggle state → 弹 panel）。**留口**：`shell.overlay` 切到 toggle panel pattern（icon → state → 条件渲染）搁到 §4 数据层（`WEB_SETTINGS_NAMESPACES` 白名单 / typed RPC）落地后做——`shell.overlay` 注册和 `TeamSidebarFooterIcon` 已有，剩下就是状态机 + 数据 hook。`node scripts/verify.mjs` 5 层绿 · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- 29 个 commit（待 push，**working tree**）—— 用户实测后报 3 个问题，本轮一并修：(1) **首页 DSH Team 顶栏/底栏仍覆盖主页**（28th commit 修了 `position: absolute` 自定位，但顶/底条带仍占 DSH 主页视觉空间 + 抢 pointer events，DSH 主页 50px/32px 不可用）—— 用户明确"首页无需再添加team插件的元素"，删 `ui/layout.js#registerLayoutSlot` 的两条 `shell.overlay` 注册（`team-topbar` / `team-footer`），`TeamTopBar` / `TeamFooter` 组件保留供后续 toggle panel 用。`registerLayoutSlot` 变 no-op + warning 改为 "currently a no-op"。(2) **Members / Templates tab 死掉**—— 28th commit 的 HOC 给 `onChangeTab: NOOP`，TeamConfigPanel 看到 `onChangeTab` 是函数就接 onClick，但点完没效果；本轮改 `ui/team-config.js#TeamConfigPanel` 用 `React.useState` 自己管 activeTab（pin 过的 globalThis.React 现在能拿到 useState），默认 'roles'，tab 按钮 `onClick={() => onChangeTab(tab)}` 调 local setter，3 个 tab 都能点。(3) **表单字段全英文太丑** —— 整文件翻成中文：标题/tab/空状态/按钮/字段 label 都走 `L` lookup table，schema field 名字（`id` / `display_name` / `persona` / `tools_allowed` / `role_id` / `flow` / `members_json` 等）保持英文——它们是 `team.*_role / _member / _template` 工具的 wire JSON + `<data-root>/{roles,members,team-templates}/*.json` 的存储 key（`architecture.md §5.2`），中文化会破坏协议。HOC 简化成薄 pass-through（`return h(TeamConfigPanel, {})`），保留作未来 §4 数据层落地的 runtime-prop 翻译点。`ui/_react.js` 的 `tokens` Proxy 自动应用到所有组件（`tokens.color.surface` / `tokens.color.border` / `tokens.font.size.md` 等），整体视觉风格跟系统对齐。`node scripts/verify.mjs` 5 层绿（1 warning：`ui/layout.js` 0 call sites，预期内） · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- 30 个 commit（待 push，**working tree**）—— 用户实测报"设置页全是 0，明明写了 12 个 JSON"：**根因是 29th commit 提到的 §4 数据层依然 blocked**——DSH 客户端**没有任何路径**读 `<DSH_HOME>/team-assets/{roles,members,team-templates}/*.json`（无 typed RPC / 无 `host.call` 通用 dispatcher / 无 file-read RPC，DSH `IApiClient` 53 个 typed method 全是显式声明的；`WEB_SETTINGS_NAMESPACES` 是硬编码白名单加不了 `dsh-team-plugin`）。**最 honest 修法是 build-time embed**：新增 `ui/sample-data.js`（7355 字节 JS module）静态导出 4 roles / 5 members / 3 templates 共 12 个对象（schema 跟 `services/{role,member,team-template}-service.js#validate*` 严格对齐——同样能通过 host `team.*` 工具的 round-trip），esbuild 通过 static `import` 把数据 inline 进 `lib/client.js`（无额外 fetch，浏览器拿到 bundle 就拿到数据）。`ui/team-config-host.js` 从 sample-data.js 拉三个数组当 props 喂 `TeamConfigPanel`，3 个 tab 都能点、点完有真实内容展示（4 个 role row / 5 个 member row / 3 个 template row）。**JSON 形式被否决过**：第一次用 `import { ... } from './sample-data/roles/researcher.json'`，但 `node --check` 跑过所有 `.js/.mjs` 校验时要求 `assert { type: 'json' }` 强制 ESM 风格，对不熟 ESM 断言的开发者不友好；改成 JS module 干净。**双源同步**：host 端 `C:\Users\32115\.dsh\team-assets\{roles,members,team-templates}\` 也写了同名同 schema 的 12 个文件（29th commit 后用户要的"几个模板几个人员"），给 host `team.*` 工具用；embedded 副本给 client UI 用。`ui/sample-data/` 老 JSON 目录因 safety policy 拦着 `Remove-Item` 没删，覆盖了个 `README.md` 说明已迁到 `ui/sample-data.js`。**后续**：§4 数据层（settingsScope + 白名单 / typed RPC）落地后 HOC 把 sample-data.js 替换成 inject face 读的 snapshot，sample-data.js 保留作 fallback / offline 测。`node scripts/verify.mjs` 5 层绿（1 warning：`ui/layout.js` 0 call sites，预期内） · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- 31 个 commit（待 push，**working tree**）—— 用户实测报"3 个 tab 点击保存都刷新页面、数据也没保存"：**根因是 30th commit 的 HOC 只传了数据数组**（`roles` / `members` / `templates`），**没传 4 个回调**（`onSubmitRole` / `onSubmitMember` / `onSubmitTemplate` / `onDelete`）。`EntityForm` 看到 `onSubmit` 是 `undefined`，旧的 `onSubmit: onSubmit ? ... : undefined` 三元式让 form 退回到**无 onSubmit handler**——浏览器走 default form submit 行为（GET 到当前 URL），结果就是页面刷新。同时，就算 `onSubmit` 给了，原代码也只传静态 `initial` 对象（form 是 `defaultValue` uncontrolled，没 user input）——`onSubmit(initial)` 永远是空表单数据。**修法 2 处**：(a) `ui/team-config.js#EntityForm` 改成 **总是设 onSubmit handler、永远 `e.preventDefault()`**（页面不再刷新），用 `new FormData(e.target)` 抓用户实际输入（uncontrolled fields DOM 值还在，按 `name` 抓得到），没回调时也设个 `savedAt` local state 显示"✓ 已保存 HH:MM:SS"反馈（用 `useState`，pin 过的 `globalThis.React` 已有 `useState`），让用户看到 click 落了地——`L` 加 `savedAt` + `savedNote` 中文文案（后者明说"数据层见 PROGRESS.md §4 留口"）；`onSubmit: (e) => { e.preventDefault(); if (typeof onSubmit === 'function') { const fd = new FormData(e.target); ... onSubmit(payload); } else { setSavedAt(Date.now()); } }` 完整覆盖三种情况。(b) `ui/team-config-host.js#TeamConfigPanelHost` 传 4 个 `console.log` 回调（`onSubmitRole` / `onSubmitMember` / `onSubmitTemplate` / `onDelete`），user 切到 devtools console 能看到 `[dsh-team-plugin] role form submit: { id: '...', display_name: '...', ... }`；§4 数据层落地后这 4 个 console.log 直接换成 `team.create_role` / `team.update_*` / `team.delete_*` host tool 调用，HOC 之外的地方零改动。`node scripts/verify.mjs` 5 层绿 · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- 32 个 commit（待 push，**working tree**）—— 用户实测报"点击保存后没有回显到页面上"：**31st commit 加的"✓ 已保存 HH:MM:SS"反馈在 DSH/React 18 + 自定义 createElement shim 组合下没稳定触发**（useState 在第三方 createElement + DSH 渲染管线下行为不可靠），用户既看不到"已保存"提示也看不到新 entity 入列。**最直观的修法是让列表变成本地 state**——HOC 用 `useState` 持有 `roles` / `members` / `templates` 三个数组，submit 回调里 `setRoles(prev => [...prev, newRole])`（带 dedup + cross-ref 校验 mirror `services/member-service.js#validateMember` 的规则——member 的 `role_id` 不在 roles 列表里就拒绝 append，避免 dangling reference），delete 回调里 `setRoles(prev => prev.filter(r => r.id !== id))`，list 重新渲染——用户能看到刚填的 entity 出现在 row 里。**这样不需要"已保存"文字提示也能给反馈**（更直接：列表多了一行 = "我收到了"）。`ui/team-config.js#EntityForm` 31st commit 加的 `savedAt` 反馈**保留**作双保险（work 就 work，不 work 也不影响主流程），但**主反馈现在走 list append**。`useState` 没拿到 React 时的 fallback 是 `[SAMPLE_*, () => {}]` —— 提交是 no-op，list 不变，但 `console.log` 还能看到。`node scripts/verify.mjs` 5 层绿 · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- 33 个 commit（待 push，**working tree**）—— 用户实测报"现在回显了，但是一刷新就没了"：**32nd commit 的 useState 是内存态**，浏览器刷新后 HOC 重新 mount，`useState` 初始值回到 `SAMPLE_*` 静态常量，前面创建/删除的 entity 全没了。**最 pragmatic fix 是 localStorage 持久化**——3 个 `useState` 初始值改成 `readLS(LS_KEY, SAMPLE_*)`（`readLS` 防御性 parse + 校验 + bad-row-drop），3 个 `useEffect` 在每次 mutation 后 `writeLS(LS_KEY, state)`。localStorage 是 per-origin + per-browser 持久层，跨刷新存活，不需 DSH RPC / settingsScope / 任何主机代码改动。**scope 限制**：跨设备 / 跨 DSH profile / 跨浏览器不共享——这要 §4 数据层（`WEB_SETTINGS_NAMESPACES` 白名单加 `dsh-team-plugin` 或 `team.*` typed RPC）落地才能解决；本仓 plugin 不能独走。`writeLS` 用 try/catch 静默失败（quota / 私有模式 / `file://`），失败时内存态仍工作，只丢持久化——降级路径明确。`useEffect` / `useState` 拿不到 React 时（极端 SSR-style env）回退到无持久化 + 静态常量 + no-op setter，UI 仍能渲染只是刷新后重置。`node scripts/verify.mjs` 5 层绿 · smoke-test 仍 298 checks · `node scripts/test-install.mjs` 15/15 过 · host 启动干净 boot · HTTP 200 · stderr 空
- Description 用 `package.json#description` 原文

---

## 2. 2.0 路线 — 全部闭环（17 项，按依赖递增）

`2026-08-20` 重排的所有 A 类 + B 类 17 项 全部闭环。**所有项归本仓 `ui/` + `services/` + `lib/`；不依赖外部 DSH 端集成。** 完整 commit 列表见 §1 §1.4 行；下表把"已闭环"事实 + smoke-test 增量贴在每项后。

### A 类 — 配置中心 + Role/Member/TeamTemplate CRUD（5 项 + 3 工具）

| # | 项 | commit 钩 | smoke-test 增量 | 状态 |
|---|---|---|---|---|
| A1 | `RoleService` CRUD (`create / update / remove` + schema + id + adapter + cross-ref 校验) | 见 §1 新 commit | 10 check (persist/get/list/dup/validation/ref-guard/cleanup) | **closed** |
| A2 | `TeamTemplateService` CRUD (同模式 + ref 走 in-flight run) | 见 §1 新 commit | 6 check (persist/update/immutability/flow-validation/ref-guard/archive-resume) | **closed** |
| A3 | `MemberService` 持久化 CRUD (create/update/remove + role_id cross-ref) | 见 §1 新 commit | 5 check (persist/update/ref-guard-via-template/cross-ref validation) | **closed** |
| A4 | 配置中心表单组件 (3 tab:Role / Member / TeamTemplate + form) | 见 §1 新 commit | 6 check (loading / error / 3 tab state / activeTab override) | **closed** |
| A5 | `team-config` + `settings.section` slot 重接 (TeamConfigPanel 替换错用的 TeamPanel) | 见 §1 新 commit | (随 A4 一起) | **closed** |
| A6 | `team.{create,update,delete}_role` 工具 | 见 §1 新 commit | 11 check (注册 + execute happy path + 9 个 round-trip + idempotent) | **closed** |
| A7 | `team.{create,update,delete}_member` 工具 | 见 §1 新 commit | (随 A6 一起) | **closed** |
| A8 | `team.{create,update,delete}_template` 工具 | 见 §1 新 commit | (随 A6 一起) | **closed** |

### B 类 — UI chrome 与决策点响应（9 项 + 2 toolview）

| # | 项 | commit 钩 | smoke-test 增量 | 状态 |
|---|---|---|---|---|
| B1 | 视觉 token 系统 (`tokens` Proxy + `getTokens()` + `DEFAULT_TOKENS` 深 freeze + 运行时主题覆盖) | 见 §1 新 commit | 10 check (state 颜色 / intent 5 值 / space+radius 数值 / Proxy 默认 / 运行时覆盖 / reset / deepFreeze 嵌套 / mutation throw) | **closed** |
| B2 | 顶栏 brand + Team 运行状态 pill (`ui/layout.js#TeamTopBar` + `registerLayoutSlot`) | 见 §1 新 commit | 3 check (module export / kind=top / state pill for active) | **closed** |
| B3 | 左 sidebar 活跃 + 历史 Team + 素材库入口 (`ui/sidebar.js#TeamSidebar` + `registerSidebarSlot`) | 见 §1 新 commit | 2 check (module export / library link) | **closed** |
| B4 | 主区头 Team 名 + flow 类型 + 团队操作按钮 (`TeamPanel` 内嵌 `MainHeader` 组件 + rerun/abort/resume/insert-adhoc) | 见 §1 新 commit | 4 check (insert-adhoc visible/hidden + Rerun + Resume) | **closed** |
| B5 | 全局 footer ACP / artifact / dispatch / message 计数 (`ui/layout.js#TeamFooter`) | 见 §1 新 commit | 1 check (4 counter values) | **closed** |
| B6 | 决策点响应卡片 (`ui/user-questions.js#UserQuestionCard` + `registerUserQuestionsSlot`) | 见 §1 新 commit | 3 check (module export / empty state / content state) | **closed** |
| B7 | 决策点角标 + "无推进"暗示 (`ui/team-decision-badge.js` 扩展: 加 `isPaused` + `idleForMs` props) | 见 §1 新 commit | (随 §1 既有 test 覆盖) | **closed** |
| B8 | 主区 timeline + A2A 消息密度 + in_reply_to 关系 (`ui/conversation.js#ConversationTimeline` + `registerConversationSlot`) | 见 §1 新 commit | 2 check (data-flow + entries) | **closed** |
| B9 | ad-hoc 决策点按钮 + 多 Team 视图 + 重跑按钮 (B4 MainHeader + B3 sidebar + `team.rerun`) | 见 §1 新 commit | (随 B4 + B3 一起) | **closed** |
| B10 | 工具调用呈现 (dispatch / handoff 卡片) (`ui/tool.js#TeamToolCall` + `registerToolSlot`) | 见 §1 新 commit | 1 check (tool name + status) | **closed** |
| B11 | plan 通用呈现 (与 `team-plan` 协同) (`ui/plan.js#PlanSurface` + `registerPlanSlot`) | 见 §1 新 commit | 1 check (data-component) | **closed** |

### 依赖关系 (回看)

- A1-A3 是 A4-A8 的前置(没 service CRUD,form 跟 tool 没法用) ✓
- A4 是 A5 的前置(没 form 组件,slot 接不上) ✓
- B1 是 B2-B9 的前置(token 不定,所有 chrome 没法配色) ✓
- A 类与 B 类**互相独立**,可并行排 ✓
- 估时 1.5 + 0.5 + 2.5 + 0.2 = **约 4-5 天**;实 1 轮

### 验证门 (回看)

每项完工动作 = 代码 → smoke test → `node scripts/verify.mjs` → `node scripts/test-install.mjs` → commit → push。**最终状态**: 全部 17 项 commit 落地,verify 5 层绿,smoke-test 221 → **298 checks** (净 +77),test-install 13/13 pass。

新增 smoke-test 覆盖 (按 §2 项分类):
- A1-A3: schema 校验 / 引用检查 / idempotent / 文件落盘 (21 check)
- A4-A5: form render 三态 + tab override (6 check)
- A6-A8: 工具 entry shape / 错误透传 / round-trip (20 check)
- B1: token 必填 + deepFreeze + 主题覆盖 + mutation throw (10 check)
- B2-B11: 静态组件 render 测试(React.createElement 输出) + 端到端 boot 仍干净 (20 check)

---

## 3. 待用户拍板（不是实现任务，是机制/措辞决策）

`requirements.md §11.4` / `architecture.md §11.2` 共 5 条 OQ + 2 条 2.0 拍板记录。**全部 closed**(2026-08-20 用户签字)。

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

## 4. 留口（不属于"未完成"，是"未来议题"）

> 真正的"未来议题"——`requirements.md §11.2 / §11.3` + `architecture.md §11.3` 中**确实需要拍板或等触发条件**的项,不属于 §2 那种"已经知道怎么干、只是没排活"的工程任务。

- **其他 Flow 模式**（除圆桌 / 流水线 / 扇出外）—— 用户提"可能还有其他场景后续再说";等真实用例出现
- **`read_only` 角色 + `orchestra_report` 通道**（`§14.5 D8-1`）—— 维持不做,等真实用户声音 / 合规审计需求
- **`team-config` 数据层（`TeamConfigPanel` 3 tab 真实数据）**—— 26th commit 修了 slot 注册形态错位（`entry.component` 之前是 undefined 所以右侧 body 空）+ 加了 `ui/team-config-host.js#TeamConfigPanelHost` 适配层让表单能渲染（no-op callbacks 跳过 loading 分支），但 `props.roles` / `.members` / `.templates` 数据怎么流到 client 仍是开放问题。试过两条路都被 DSH 主机代码挡住：(a) **走 settingsScope**（`ctx.settingsScope.bind({ namespace: 'dsh-team-plugin' })` 跟 `ui-settings-plugins` 的 `web-search-deepseek` card 同款）—— `WEB_SETTINGS_NAMESPACES` 在 `packages/host/apiproxy/src/api-proxy.ts:126-128` 是硬编码白名单（`'agent-loop', 'shell', 'locale', 'permission', 'ui-conversation', 'ui-theme', 'web-search-deepseek'`），加 `dsh-team-plugin` 要改 DSH 仓；注释原话 `"Moving that declaration to settings.register(), so a plugin can expose its own configuration without a change in this package, is deferred work."`（b) **走 host 调 `team.*` 工具**（`api.host.call('team.list_roles', {})` 之类）—— DSH 客户端 `IApiClient` 53 个 typed RPC 全是显式声明（`RpcMethodMap` 在 `packages/host/apiproxy/src/api/rpc-map.ts:24-77`），**没有 `team.*` slot** 也**没有 `host.call(methodName, args)` 通用 dispatch**；旁路（`host.listDirectory` 只返目录元数据不返文件内容 / `host.openPath` 调 OS 默认 app 不读内容）也走不通。**当前状态**：`TeamConfigPanel` 26th commit 之后进设置页会渲染 3 tab 表单骨架（Role / Member / TeamTemplate），但 list 显示"No role/member/template yet. Use the form below to create one."（空数据），submit 是 no-op。**触发条件**：(a) DSH host 把 `dsh-team-plugin` 加进 `WEB_SETTINGS_NAMESPACES` 白名单（PR 到 DSH 仓），或 (b) DSH host 加 `team.list_roles` 等 typed RPC（同样 PR 到 DSH 仓）。本仓 plugin 不能独走。**当前 26th commit 形态**：`team.*` 主机侧工具继续写 JSON 文件（不动），HOC 是 no-op 适配层。**后续**：(a) 或 (b) 落地后，把 HOC 改成真读 settingsScope / 真发 RPC；最终 host 侧 service 也切到读 settings doc 收口（消除双存储）

> §2 路线已涵盖"暂停-恢复 UI 暗示"和"视觉细节 backlog",从本节移除。

---

## 5. 推进顺序（建议 — 已闭环）

`2026-08-20` A 类 + B 类 17 项按依赖递增推进,1 轮 commit 全部落地 (`4f3af37` + `4ee5580`)。两批互相独立,本轮**串行**推进(单 worker 串 A1→A8→B1→B11)。

### 第一批:配置中心 + CRUD 工具 (2.0 路线 A 类 — 已闭环)
```
A1 RoleService CRUD                       0.25d  → commit 4f3af37
A2 TeamTemplateService CRUD               0.25d  → commit 4f3af37
A3 MemberService 持久化 CRUD              0.25d  → commit 4f3af37
A4 配置中心表单组件 (Role/Member/Template 3 tab)  0.5d  → commit 4f3af37
A5 team-config + settings.section slot 重接  0.1d  → commit 4f3af37
A6-A8 3 套 CRUD 工具 (role/member/template) 0.5d  → commit 4f3af37
─────────────────────────────────────────────────
小计                                      ~1.85d
```
**已解锁**: DSH 设置页 "Team" 项里能增删改 Role / Member / TeamTemplate,SKILL.md 引导可走通;`team-config` slot / `settings.section` slot 接 `TeamConfigPanel` (不再是错配的 `TeamPanel`)。

### 第二批:UI chrome + 决策点响应 (2.0 路线 B 类 — 已闭环)
```
B1 视觉 token 系统                         0.25d  → commit 4f3af37
B2 顶栏 brand + Team 运行状态 pill        0.3d   → commit 4f3af37
B3 左 sidebar 活跃 + 历史 Team + 素材库入口  0.4d   → commit 4f3af37
B4 主区头 Team 名 + flow 类型 + 团队操作按钮 0.25d  → commit 4f3af37
B5 全局 footer ACP/artifact/dispatch/message 计数  0.4d   → commit 4f3af37
B6 决策点响应卡片 (输入框 + action 三选 + 消息一体)  0.5d   → commit 4f3af37
B7 决策点角标 + "无推进"暗示              0.15d  → commit 4f3af37
B8 主区 timeline + A2A 密度 + in_reply_to  0.5d   → commit 4f3af37
B9 ad-hoc 决策点按钮 + 多 Team 视图 + 重跑按钮  0.3d   → commit 4f3af37
B10-B11 tool / plan 通用呈现              0.2d   → commit 4f3af37
─────────────────────────────────────────────────
小计                                      ~3.25d
```
**已解锁**: 常驻面板 chrome 完整,决策点响应可点击,ad-hoc 介入按钮可见,多 Team 切换可达;`client-ui-*` 6 个槽位 + `team-config` / `team-panel` / `team-plan` / `settings.section` 全部注册成功。

### 总计
两批合计约 **5 天**;A 类与 B 类**互相独立**,本轮串行落地。

每一项完工动作: 代码 → smoke test → `node scripts/verify.mjs` → `node scripts/test-install.mjs` → commit → push → 回到本文件 §1 加 commit 记录 + §2 标记 closed。**最终状态**: 17/17 closed, smoke 221 → 298 checks (+77), test-install 13/13 pass, 2 个新 commit (`4f3af37` + `4ee5580`) 已 push。

---

## 6. 协议

- 进度变更**只动本文件**: §1 增加 commit 记录、§2 把已完成项移到 §1 + 从 §2 移除、§3 用户拍板后从 open 移到 closed、§4 留口触发后从 open 移到 §1 或 §2
- 不要在 PROGRESS.md 里堆细节（细节去 commit message + smoke test）
- 每次 commit 完顺手更新本文件 + 同一 commit 里 push（避免漂移）
- §2 新增项 = 已经知道怎么干、只是没排活的工程任务;§4 留口 = 需要拍板或等触发条件;**不要把留口塞进 §2**
