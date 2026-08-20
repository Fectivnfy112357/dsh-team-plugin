# DSH Team 插件 — 进度记录

> 记录时间：2026-08-20 · HEAD = 待 commit · branch = `main`
>
> 本文件是工作进度快照（不是规范/合同）。规范请读 [`docs/requirements.md`](./docs/requirements.md) + [`docs/architecture.md`](./docs/architecture.md)；插件边界/读者请读 [`AGENTS.md`](./AGENTS.md)。
>
> **范围重述（2026-08-20）**：本仓即 DSH Team 体验的 host——`client-ui-*` 槽位的实现组件、常驻面板 chrome（顶栏/sidebar/footer/主区头/团队操作按钮）、决策点响应卡片、ad-hoc 决策点按钮、多 Team 视图、重跑按钮、视觉细节 token、配置中心、Role/Member/TeamTemplate CRUD UI 全部归本仓；不再推到外部 DSH 端。

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
| 2.0 #4 | (待 commit) | pipeline-with-feedback 跨步 `context_refs` 自动传播:`runPipeline` 维护 `stepOutputs[i] = { produced_artifact_ids }` in-memory map,派下一步时按优先级 (1) `step.context_refs` (2) `flow_config.context_refs_override[i]` (3) 派生自 `stepOutputs[i-1]` 三层 fallback;feedback retry 路径取最终 attempt 的产物;smoke-test [12b/19] 加 8 个新 check (auto-derive / step override / flow override / feedback retry / 隔离 / reset);导出 `_resetStepOutputsForTests(runId)` | `node scripts/verify.mjs` 5 层绿 · smoke-test 146 → 154 checks |
| 2.0 #1 留口 (rewiring) | (待 commit) | 三个 flow (pipeline / round-table / fan-out) 替换 `dispatchLog` 占位为 `MemberService.dispatch`:`dispatchTask(ctx, runId, memberId, opts)` helper —— 有 `ctx.subagents.followup` 走 `MemberService.dispatch` (写 dispatch-log + followup + auto-join),否则回退到 v1.0 `dispatchLog` 纯日志路径;`lib/index.js` 在 tool 注册时闭包 `ctx` 到 `args.__dshCtx`,`team.start.execute` 读它并透传给 `flowSvc.run`;`team.start` 补 `pending → assembling` 转换;唯一写入者承诺 / 4 worker 上限 / degraded flag / max_rounds 全部保留;smoke-test [12c/19] / [12d/19] / [12e/19] / [12f/19] 加 22 个新 check (pipeline auto-join + followup + 跨步 context_refs 透传 / round-table dispatchTask fallback / fan-out 平行 + aggregator 含 context_refs / team.start → flowSvc.run → dispatchTask → MemberService.dispatch 端到端) | `node scripts/verify.mjs` 5 层绿 · smoke-test 154 → 176 checks |
| P1 #6 team.resume | (待 commit) | `team.resume` 工具落地:读 meta → 校验 `interrupted → assembling` ALLOWED 边 → 重 join 成员 (`MemberService.joinRun`,idempotent) → 重启 flow engine;`__dshCtx` 透传 production 路径走 `MemberService.dispatch` followup,无 ctx 走 v1.0 `dispatchLog` fallback;terminated member 走 best-effort rollback(状态机 `assembling → interrupted` 不在 ALLOWED 表里,直接 append state-history + 改 meta.json);与 `team.rerun` 语义切分保持(同 run 回滚 vs 配置克隆);smoke-test [20/19] 加 14 个新 check (not-found / non-interrupted 拒绝 / 端到端 mock ctx re-join + flow 重启 / state-history edge / session-state running / dispatch-log member-join / 无 ctx fallback) | `node scripts/verify.mjs` 5 层绿 · smoke-test 176 → 190 checks |
| 2.0 #2 | (待 commit) | artifact O(1) 反向引用索引 `_refCountIndex: Map<ref, Set<consumerArtifactId>>`:`register()` 时按 derived_from 逐 dep 加边(intra-artifact dedup);`refCount()` 改 O(1) 索引查(两个等价形式 `<runId>/<id>` 和 bare `<id>` 取并集);`canDelete()` 复用;`rebuildIndex()` 首次 refCount 调用时从磁盘懒加载(在已有 manifest 累积时);`_resetIndexForTests` 清空+重载。语义兼容 v1.0 线性扫(每 artifact 最多计 1 次,即使 derived_from 含重复 dep)。smoke-test [17b/19] + [17c/19] 加 8 个新 check (3 consumers / cross-form dedup / idempotent re-register / reset rebuild / unknown ref / 95 refs < 50ms 缩放) | `node scripts/verify.mjs` 5 层绿 · smoke-test 190 → 198 checks |
| P2 抛光 — A2A payload 上限 | (待 commit) | `message-service.js` 加 `A2A_PAYLOAD_MAX_BYTES = 1 MiB`(架构 §9.4 没硬定,1 MiB 是经验值:`a2a-message-log.jsonl` 单条 append 阻塞风险 + 对齐常见 ACP message 单条上限);`send` 入口按 `JSON.stringify(payload)` 长度校验;超限抛 `MessagePayloadTooLargeError`(可单独 catch,避免 pattern-match 错误字符串);失败时**不**写 a2a-log 也**不**碰 inbox(fail-fast);smoke-test [6b/19] 加 7 个新 check (1KB 接受 / 边界接受 / 超限抛 / 错误信息含 cap / 不漏到 a2a-log / 不碰 inbox / 常量值) | `node scripts/verify.mjs` 5 层绿 · smoke-test 198 → 206 checks |
| P2 抛光 — cross-Run 引用硬删兜底 | (待 commit) | `team.delete_artifact` 工具落地:走 `canDelete` 引用检查,refcount>0 拒绝(`deleted: false` + `refCountAtDelete`);refcount=0 时改 manifest + unlink 文件 + 失效反向索引(`_resetIndexForTests`);**没有** `force: true` 覆盖(单写入者承诺 + 防止"绕过 ref guard 误删");审计行(state-history)同时记录拒绝和成功(`kind: 'artifact-delete-attempt'`, `outcome: 'refused' \| 'deleted'`);smoke-test [17d/19] 加 11 个新 check (refused 不漏写 / audit trail / ref 删后 canDelete 变 true / 删除成功改 manifest / unlink 文件 / resolve undefined / refCount 0 / ghost 防御 / 缺 runId 抛) | `node scripts/verify.mjs` 5 层绿 · smoke-test 206 → 221 checks |
| P2 抛光 — §10 视觉 backlog 评估 | (待 commit) | **撤销"归 DSH host 端"判定**。本仓即 DSH Team 体验的 host,所有视觉细节(配色/字体/圆角/间距/决策点角标颜色/A2A 消息密度/常驻面板 chrome 全部)归本仓。`ui/_react.js` 沙箱将升级为持有实际样式 token(色板/字号/圆角/间距变量)与具体子组件;`ui/team-*.js` React.createElement 骨架扩展为带 sentinel `data-*` 属性的完整可读组件(本轮只声明留口,具体排版与微交互归 2.0 实现轮) | `node scripts/verify.mjs` 5 层绿 · smoke-test 仍 221 checks |
| 5 OQ 全部 close (措辞签字) | (待 commit) | 2026-08-20 用户一次性签字 OQ-2/3/4/5 (按推荐项);`docs/requirements.md §11.4` / `docs/architecture.md §11.2` / `docs/requirements.md §17.5` 措辞收口,OQ-1 在 `aedbd10` 实质闭环;5 OQ 全部 closed,实现层与文档措辞一致 | `node scripts/verify.mjs` 5 层绿 · smoke-test 仍 221 checks (文档-only) |

### 1.1 验证

- `node scripts/verify.mjs` — 5 层 + 221 烟雾，**独立于 DSH** 跑（不依赖装到 DSH）
- `node scripts/test-install.mjs` — 实启 `dsh --profile web --port 0` 13 项 host 启动门（prerequisites / manifest / boot / teardown）— **依赖 DSH**
- 预期输出：`✅ verify passed (0 warnings, 0 errors)` + `13 passed, 0 failed`

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

## 2. 2.0 路线 — 未完成的明确任务（17 项，按依赖递增）

`2026-08-20` 重排。按"先小后大、先核心 chrome 后增量"顺序，每项带工作量估时。**所有项归本仓 `ui/` + `services/` + `lib/`；不依赖外部 DSH 端集成。**

### A 类 — 配置中心 + Role/Member/TeamTemplate CRUD（5 项，估时 1-2 天）

> 文档承诺的 `team-config` slot 是"Role / Member / Team-Template 配置中心",目前只到"读"。`RoleService` / `TeamTemplateService` / `MemberService` 三个 service 的持久化层都缺 `create / update / delete`;`team-config` slot 和 `settings.section` slot 错把 `TeamPanel`(run-state 组件)当成 form 用了。

| # | 项 | 工作内容 | 估时 |
|---|---|---|---|
| A1 | `RoleService` CRUD | 加 `create / update / delete` 方法(写到 `~/.dsh/team-assets/roles/<id>.json`);id 格式校验 (`/^[a-z0-9][a-z0-9._-]*$/`);schema 校验 (id/display_name/persona/adapter/cli_options/tools_allowed/avatar);ref-count 引用检查 (被 member / template 引用则拒绝删);smoke-test 扩 N check | 0.25d |
| A2 | `TeamTemplateService` CRUD | 同上模式,落 `~/.dsh/team-assets/team-templates/<id>.json`;schema 校验 (id/name/flow/flow_config/members 数组);ref-count 引用检查 (被 run 引用则拒绝删,可软删 + tombstone) | 0.25d |
| A3 | `MemberService` 持久化 CRUD | 加 `create / update / delete`(运行时 joinRun/leaveRun/sendMessage 等 8 个方法不动);落 `~/.dsh/team-assets/members/<id>.json`;schema 校验 (id/role_id/display_name/persona/cli_options_override);ref-count 引用检查 (被 team-template 引用则拒绝删) | 0.25d |
| A4 | 配置中心表单组件 | 新建 `ui/team-config.js`(替代错用的 TeamPanel),3 tab:Role / Member / TeamTemplate;每 tab 一个 list + 新增/编辑/删除按钮 + 表单字段(参考 architecture §5.2 schema);实时预览(§12.1 A4);smoke-test 走 service 路径不验 UI | 0.5d |
| A5 | `team-config` slot + `settings.section` slot 重接 | `ui/team-panel.js` 把 `team-config` / `settings.section` 的 `component` 改成 `TeamConfigPanel`(来自 A4);保留 `team-panel` 跑原 `TeamPanel`(run-state);label / props 调整 | 0.1d |

### A 类配套 — 工具层(给 agent 编程用,3 项,估时 0.5d)

| # | 项 | 工作内容 | 估时 |
|---|---|---|---|
| A6 | `team.create_role` / `team.update_role` / `team.delete_role` 工具 | 接 RoleService CRUD,加到 `lib/tools/team-tools.js`;output schema 走 `check-output-schema.mjs`;smoke-test 扩 N check;`/start-team` SKILL Step 3 引导可走工具链 | 0.15d |
| A7 | `team.create_member` / `team.update_member` / `team.delete_member` 工具 | 同上,接 MemberService CRUD | 0.15d |
| A8 | `team.create_template` / `team.update_template` / `team.delete_template` 工具 | 同上,接 TeamTemplateService CRUD | 0.15d |

### B 类 — UI chrome 与决策点响应（9 项，估时 2-3 天）

> 文档承诺的所有 `client-ui-*` 槽位组件、面板 chrome、决策点响应卡片、ad-hoc 按钮、多 Team 视图、视觉细节 token —— 全部归本仓。

| # | 项 | 工作内容 | 估时 |
|---|---|---|---|
| B1 | 视觉 token 系统 | 扩展 `ui/_react.js`:持有 CSS 变量对象(色板/字号/圆角/间距/动效时长);导出 `tokens` 常量供所有 `ui/*.js` 引用;mockups/panel-linear.html 风格定为 default theme;`check-output-schema.mjs` 加 token 必填校验 | 0.25d |
| B2 | 顶栏 brand + Team 运行状态 pill | 新建 `ui/layout.js`:注册到 `client-ui-layout` 槽位;brand logo + 当前活跃 Team 的运行状态 pill(state 颜色由 B1 token 决定);空状态显示 "DSH Team" 占位 | 0.3d |
| B3 | 左 sidebar 活跃 + 历史 Team + 素材库入口 | 新建 `ui/sidebar.js`:注册到 `client-ui-sidebar` 槽位;活跃 Team 列表(从 `TeamService.runStore.list({ state: 'non-terminal' })`);历史 Team 折叠区 "历史 (N)";素材库入口跳转配置中心(A4 的 team-config slot) | 0.4d |
| B4 | 主区头 Team 名 + flow 类型 + 团队操作按钮 | 扩展 `ui/team-panel.js` 或新建 `ui/main-header.js`:Team 名(从 `runMeta`)+ flow 类型 pill + 重跑/中止按钮(走 `team.rerun` / `team.abort` 工具);决策点小角标(接 B7) | 0.25d |
| B5 | 全局 footer ACP / artifact / dispatch / message 计数 + 命令面板 | 新建 `ui/footer.js`:注册到 `client-ui-layout` 槽位的 footer 段;4 个计数(从 `~/.dsh/team-assets/` 目录或 `TeamService` stat 读);命令面板 `⌘K` 快捷键入口(可选) | 0.4d |
| B6 | 决策点响应卡片(输入框 + action 三选 + 消息一体) | 扩展 `ui/team-decision-badge.js` + 新建 `ui/user-questions.js`:注册到 `client-ui-user-questions` 槽位;决策点事件卡片包含 prompt 文本 + action 三选(continue / complete / abort)+ 可选 feedback 输入框;submit 走 `team.respond_decision_point` 工具;实时 DP 订阅接 P1.5-b 桥 | 0.5d |
| B7 | 决策点角标 + "无推进"暗示 | 扩展 `ui/team-decision-badge.js`:状态 pill 上的小角标(不新 pill);DSH handoff 期间 session 保活但无推进的角标状态(`session-state.json.state == 'running' && last_dispatch_at > 5min`);颜色用 B1 token | 0.15d |
| B8 | 主区 timeline + A2A 消息密度 + in_reply_to 关系 | 新建 `ui/conversation.js`:注册到 `client-ui-conversation` 槽位;消息气泡 + handoff 卡片 + A2A 消息气泡;按 flow 自适应密度(round-table 中 A2A 为主, pipeline / fan-out 中 A2A 穿插);in_reply_to 一级虚线引导 | 0.5d |
| B9 | ad-hoc 决策点按钮 + 多 Team 视图 + 重跑按钮 | `ui/main-header.js` 加 "插入决策点" 按钮(只在 `running` + `flow_config.ad_hoc_decision_points=true` 时显示);侧栏多 Team 上下同框(B3 已含);重跑按钮走 `team.rerun`,复用 members + flow_config + 预填 task_description | 0.3d |

### B 类配套 — toolview 槽位扩展(2 项,估时 0.2d)

| # | 项 | 工作内容 | 估时 |
|---|---|---|---|
| B10 | 工具调用呈现 (dispatch / handoff 卡片) | 新建 `ui/tool.js`:注册到 `client-ui-tool` 槽位;工具调用卡片,dispatch / handoff 用 `ui/team-handoff-card.js` + `ui/team-handoff-redo.js` 已落,补全通用工具调用框架 | 0.1d |
| B11 | plan 通用呈现(与 `team-plan` 协同) | 新建 `ui/plan.js`:注册到 `client-ui-plan` 槽位;与 `team-plan` slot 协同(已有 P1.5-a);DSH 通用 plan UI fallback | 0.1d |

### 依赖关系

- A1-A3 是 A4-A8 的前置(没 service CRUD,form 跟 tool 没法用)
- A4 是 A5 的前置(没 form 组件,slot 接不上)
- B1 是 B2-B9 的前置(token 不定,所有 chrome 没法配色)
- A 类与 B 类**互相独立**,可并行排
- 总估时 1.5 + 0.5 + 2.5 + 0.2 = **约 4-5 天**

### 验证门

每项完工动作:
- 代码 → smoke test → `node scripts/verify.mjs` → `node scripts/test-install.mjs` → commit → push → 回到本文件 §1 加 commit 记录 + §2 移走

新增 smoke-test 覆盖:
- A1-A3: 增删改查 schema 校验 / 引用检查 / idempotent / 文件落盘
- A4-A5: snapshot test(form render 关键路径)
- A6-A8: 工具 entry shape / 错误透传 / smoke-test 不依赖 UI
- B1: token 必填校验
- B2-B11: 静态组件 render 测试(React.createElement 输出) + 端到端 boot 仍干净

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

---

## 4. 留口（不属于"未完成"，是"未来议题"）

> 真正的"未来议题"——`requirements.md §11.2 / §11.3` + `architecture.md §11.3` 中**确实需要拍板或等触发条件**的项,不属于 §2 那种"已经知道怎么干、只是没排活"的工程任务。

- **其他 Flow 模式**（除圆桌 / 流水线 / 扇出外）—— 用户提"可能还有其他场景后续再说";等真实用例出现
- **`read_only` 角色 + `orchestra_report` 通道**（`§14.5 D8-1`）—— 维持不做,等真实用户声音 / 合规审计需求

> §2 路线已涵盖"暂停-恢复 UI 暗示"和"视觉细节 backlog",从本节移除。

---

## 5. 推进顺序（建议）

### 第一批:配置中心(2.0 路线 A 类)
```
A1 RoleService CRUD                       0.25d
A2 TeamTemplateService CRUD               0.25d
A3 MemberService 持久化 CRUD              0.25d
A4 配置中心表单组件 (Role/Member/Template 3 tab)  0.5d
A5 team-config + settings.section slot 重接  0.1d
A6-A8 3 套 CRUD 工具 (role/member/template) 0.5d
─────────────────────────────────────────────────
小计                                      ~1.85d
```
解锁:用户在 DSH 设置页 "Team" 项里能增删改 Role / Member / TeamTemplate,SKILL.md 引导可走通。

### 第二批:UI chrome (B 类)
```
B1 视觉 token 系统                         0.25d
B2 顶栏 brand + Team 运行状态 pill        0.3d
B3 左 sidebar 活跃 + 历史 Team + 素材库入口  0.4d
B4 主区头 Team 名 + flow 类型 + 团队操作按钮 0.25d
B5 全局 footer ACP/artifact/dispatch/message 计数  0.4d
B6 决策点响应卡片 (输入框 + action 三选 + 消息一体)  0.5d
B7 决策点角标 + "无推进"暗示              0.15d
B8 主区 timeline + A2A 密度 + in_reply_to  0.5d
B9 ad-hoc 决策点按钮 + 多 Team 视图 + 重跑按钮  0.3d
B10-B11 tool / plan 通用呈现              0.2d
─────────────────────────────────────────────────
小计                                      ~3.25d
```
解锁:常驻面板 chrome 完整,决策点响应可点击,ad-hoc 介入按钮可见,多 Team 切换可达。

### 总计
两批合计约 **5 天**;A 类与 B 类**互相独立**,可以并行排给两个 worker。

每一项完工动作: 代码 → smoke test → `node scripts/verify.mjs` → `node scripts/test-install.mjs` → commit → push → 回到本文件 §1 加 commit 记录 + §2 移走。

---

## 6. 协议

- 进度变更**只动本文件**: §1 增加 commit 记录、§2 把已完成项移到 §1 + 从 §2 移除、§3 用户拍板后从 open 移到 closed、§4 留口触发后从 open 移到 §1 或 §2
- 不要在 PROGRESS.md 里堆细节（细节去 commit message + smoke test）
- 每次 commit 完顺手更新本文件 + 同一 commit 里 push（避免漂移）
- §2 新增项 = 已经知道怎么干、只是没排活的工程任务;§4 留口 = 需要拍板或等触发条件;**不要把留口塞进 §2**
