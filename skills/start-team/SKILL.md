---
name: start-team
description: 当用户表达"组建 / 拉起 / 召集"一组 Agent 一起完成一个相对完整任务时触发。典型触发词：`/start-team`、`/start-team-skill`、`帮我组建一个团队`、`让这几个 agent 一起做`、`多 agent 协作`、`团队跑一下`、`群里讨论下`。本 skill 是 DSH Team 插件的入口薄包装（thin wrapper），把所有 Team Run 的启动参数收集好再调用 `team.start` 插件工具；不实现核心调度逻辑（核心逻辑在 Cordis 插件层 `lib/` `services/` `ui/`）。
whenToUse: 用户希望按 handoff-round-table / pipeline-with-feedback / fan-out-collect 三种 flow 之一组织多个 Agent 协作完成一个可交付任务。
---

# start-team — DSH Team 启动入口

DSH Team 插件把"角色 + 团队"的视角带入 DSH WebUI（详见 [`requirements.md`](../../requirements.md) / [`architecture.md`](../../architecture.md)）。

`start-team` 是**用户启动入口**（需求 §4.1 锁定）：

| 入口 | 触发方式 |
|---|---|
| skill（`/start-team`） | 斜杠命令 + 自然语言双触发 |
| 插件工具 `team.start` | DSH 通过 Cordis 注入；skill 不实现核心能力，只在文档层告诉 agent 怎么调 |

**架构归属**：核心逻辑全部在 **Cordis 插件**（`lib/index.js` 注册入口，`services/` 实现 8 个 Service，`ui/` 实现常驻面板）。本 skill **不**写任何调度/状态机代码，只做"参数收集 + 工具调用 + 结果回报"。

## 何时使用

满足以下任一条件即应触发本 skill：

- 用户显式触发：`/start-team`、`/start-team-skill`、`<team>` 任意别名
- 用户自然语言：
  - "帮我组建一个团队做 X"
  - "让 A、B、C 一起讨论 X"
  - "用 pipeline 跑一下这个需求"
  - "fan-out 一下这几路并发查"
  - "召集 brainstormer / critic / synthesizer 三个角色"
- 用户在 DSH WebUI 常驻面板**顶部输入框**直接输入 `/start-team <task>`（DSH 把斜杠命令转给本 skill）

**不要**在以下场景触发：

- 用户只是想**问 DSH 自己**一个问题 → 走普通对话，不需要团队
- 用户要**单 agent 完成**一个任务 → 不需要 start-team
- 用户说"看一下当前 Team 的状态" → 用 `team.list` 工具，不调本 skill
- 用户说"停止 / 中断 / abort 当前的 Team" → 直接调 `team.abort(runId, reason)` 工具，不调本 skill

## 调用流程

按以下步骤串行执行；任一步失败 → 停止后续步骤，把错误回报给用户。

### Step 1 — 收集 task description

`task_description` 是这次 Team Run 要做的事的完整描述。向用户确认：

- 一句话说不清的复杂任务 → 引导用户用 2-4 句说明（含背景、目标、关键约束）
- 任务的目标产物（artifact）是什么？—— 用于评估收敛门
- 任务"成功"的标准是什么？—— 用于决策点 confirm

如果用户已经在斜杠命令后写了任务描述（如 `/start-team 调研 Q3 LLM 推理框架的对比`），直接采用，不再追问。

### Step 2 — 确认 flow 类型

按 `requirements.md §3` 三选一：

| Flow | 适用 | 默认 |
|---|---|---|
| `handoff-round-table` | 多角色讨论收敛（脑暴 / 评审 / 综合）| **默认** |
| `pipeline-with-feedback` | 顺序加工有回路（写 → 审 → 改）| 用户显式选 |
| `fan-out-collect` | 并行收集 → 汇总（多路调研 / 多视角）| 用户显式选 |

引导用户：

> "这个任务更适合哪种协作方式？默认是 `handoff-round-table`（多角色讨论收敛）。"

如果用户说"你定"，默认走 `handoff-round-table`。

### Step 3 — 选 / 拼 members

按 `requirements.md §2.1 / §2.2`，每个 member 由 role 实例化得到。两个来源：

1. **从 `team-template`**：调 `team.list_templates`，给用户看可用模板；用户选一个 → 用模板里的 members
2. **手动拼队**：从 `members/` 已有素材中挑，或临时新建 member（需要 role_id）

P0 阶段：DSH Team 插件的 member / template 素材库 CRUD 尚未实现（详见 `architecture.md §12` 实施阶段）。此时**只接受从 team-template 启动**；如果 `team-templates/` 为空，向用户报告：

> "目前 DSH Team 插件的素材库尚未初始化（属于 P0 阶段以外的实施内容）。请先用配置中心创建 role / member / team-template，或改用 DSH 自带的多 agent 能力。"

### Step 4 — 调 `team.start` 工具

DSH 通过 Cordis 注入的工具名是 `team.start`（**不是** `start_team` / `startTeam`）。按 `architecture.md §4.1` 的 `StartTeamRunRequest` schema：

```json
{
  "taskDescription": "<step 1 收集>",
  "flow": "handoff-round-table | pipeline-with-feedback | fan-out-collect",
  "flowConfig": {
    "max_rounds": 5,
    "ad_hoc_decision_points": true,
    "cost_cap": { "per_round_tokens": 200000 }
  },
  "members": [
    {
      "member_id": "<from template or local>",
      "instance_alias": "brainstormer"
    }
  ],
  "templateId": "<可选，来自 team-template>"
}
```

工具调用由 DSH agent 运行时经 `tools/call` 完成（详见 `references/agent-plugins-1.0.md` 的 tool 协议）。

### Step 5 — 回报结果

工具返回 `TeamRun`（含 `runId` / `state: pending`）。向用户简短回报：

> "Team Run `runId=...` 已创建，正在拼队（`assembling`）。完成后会在常驻面板（`team-panel` slot）显示活动状态；出现决策点时面板会有角标提示。"

如果工具返回错误（`team.start` 报 `team_templates_empty` / `adapter_not_registered` 等），原样把错误消息转给用户，并给出**一个**修复建议（不要罗列所有可能性）。

## 关键边界

按 `requirements.md §4` 用户与 Team 的交互边界：

- **本 skill 是入口**，不实现任何调度 / 状态机 / artifact / 决策点逻辑
- Team Run 启动后，**用户没有过程性手动介入权**——不要在启动后试图让 agent "插话"
- 用户唯一的两个主动动作：
  1. **abort**（独立终态，`team.abort` 工具）—— 任意非终态可入
  2. **决策点响应**（`team.respond_decision_point` 工具，flow 触发的门 + ad-hoc 门）—— action ∈ {continue / complete / abort}，可附 feedback

这两个动作由用户在常驻面板直接操作，**不**通过本 skill 触发。

## 故障模式

| 症状 | 原因 | 应对 |
|---|---|---|
| `team.start` 报 `team_templates_empty` | 素材库未初始化 | 引导用户去 team-config 配置中心建 role / member / template |
| `team.start` 报 `adapter_not_registered: <name>` | Role 选用了未注册的 adapter | 检查 `architecture.md §10.1` 封闭 adapter 集合（`hermes` / `mcode` / `claude-code`）|
| 工具调用超时 | DSH 阻塞 / 网络问题 | 重试 1 次；仍失败 → 报告"DSH Team 插件暂不可用" |
| 用户描述任务含糊（如"帮我优化一下"）| task description 缺关键信息 | 走 Step 1 追问，不要凭印象默认填 |

## 实施状态（P0 骨架）

当前 P0 仅完成 **包结构 + skill 注册**：

- ✅ `package.json` + `plugin.json` + `cordis.patch.yml`（双格式契约）
- ✅ `lib/index.js`（注册 `start-team` skill 到 `ctx.skills`）
- ✅ `skills/start-team/SKILL.md`（本文件 — 内容唯一源）
- ⏳ `team.start` / `team.list` / `team.abort` 插件工具 → P1 实施（`architecture.md §12`）
- ⏳ TeamService / MemberService / DispatchService / ... → P1 实施
- ⏳ team-panel / team-config UI Slot → P1 实施
- ⏳ 启动对账 `reconcileOnBoot` → P0 内交付，绑定 `host/boot` 事件

**当前阶段可跑通**：用户在 DSH 输入 `/start-team`，DSH agent 加载本 skill，但调 `team.start` 会返回"工具未注册"——这是预期，直到 P1 实施完毕。

> 详细阶段划分见 [`architecture.md §12`](../../architecture.md)。
