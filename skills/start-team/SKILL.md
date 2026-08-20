---
name: start-team
description: 当用户希望"组建 / 拉起 / 召集"一组 Agent 协作完成一个相对完整任务时触发。收集启动参数（task / flow / members）后调用 DSH 插件工具 `team.start` 启动一个 Team Run，把 DSH 返回的 runId 回报给用户。覆盖三 flow：`handoff-round-table`（默认，多角色讨论收敛）/ `pipeline-with-feedback`（顺序加工有回路）/ `fan-out-collect`（并行收集→汇总）。**触发**：斜杠命令 `/start-team` 或 `/start-team-skill`；自然语言如 "帮我组建一个团队做 X"、"让 A、B、C 一起讨论 X"、"用 pipeline 跑一下这个需求"、"fan-out 一下这几路并发查"、"召集 brainstormer / critic / synthesizer 三个角色"。**不要触发**：用户只问 DSH 自身问题（走普通对话）、单 agent 任务（不需要团队）、查询 Team 状态（用 `team.list` 工具）、abort Team（用 `team.abort` 工具）。
---

# start-team — DSH Team 启动入口

## 调用流程

按以下步骤串行执行；任一步失败 → 停止后续步骤，把错误回报给用户。

### Step 1 — 收集 task description

`task_description` 是这次 Team Run 要做的事的完整描述。向用户确认：

- 一句话说不清的复杂任务 → 引导用户用 2-4 句说明（含背景、目标、关键约束）
- 任务的目标产物（artifact）是什么？—— 用于评估收敛门
- 任务"成功"的标准是什么？—— 用于决策点 confirm

如果用户已经在斜杠命令后写了任务描述（如 `/start-team 调研 Q3 LLM 推理框架的对比`），直接采用，不再追问。

### Step 2 — 确认 flow 类型

三选一：

| Flow | 适用 | 默认 |
|---|---|---|
| `handoff-round-table` | 多角色讨论收敛（脑暴 / 评审 / 综合）| **默认** |
| `pipeline-with-feedback` | 顺序加工有回路（写 → 审 → 改）| 用户显式选 |
| `fan-out-collect` | 并行收集 → 汇总（多路调研 / 多视角）| 用户显式选 |

引导用户：

> "这个任务更适合哪种协作方式？默认是 `handoff-round-table`（多角色讨论收敛）。"

如果用户说"你定"，默认走 `handoff-round-table`。

### Step 3 — 选 / 拼 members

每个 member 由 role 实例化得到（一个 role = 一种能力描述，如 "brainstormer" / "critic" / "synthesizer"）。两个来源：

1. **从 `team-template`**：调 `team.list_templates`，给用户看可用模板；用户选一个 → 用模板里的 members
2. **手动拼队**：从 `members/` 已有素材中挑，或临时新建 member（需要 role_id）

如果素材库为空，向用户报告：

> "素材库尚未初始化。请先用配置中心创建 role / member / team-template，或改用 DSH 自带的多 agent 能力。"

### Step 4 — 调 `team.start` 工具

DSH 通过 Cordis 注入的工具名是 `team.start`（**不是** `start_team` / `startTeam`）。`StartTeamRunRequest` schema：

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

工具调用由 DSH agent 运行时经 `tools/call` 完成（Agent Plugins 1.0 tool 协议）。

### Step 5 — 回报结果

工具返回 `TeamRun`（含 `runId` / `state: pending`）。向用户简短回报：

> "Team Run `runId=...` 已创建，正在拼队（`assembling`）。完成后会在常驻面板（`team-panel` slot）显示活动状态；出现决策点时面板会有角标提示。"

如果工具返回错误（`team.start` 报 `team_templates_empty` / `adapter_not_registered` 等），原样把错误消息转给用户，并给出**一个**修复建议（不要罗列所有可能性）。

## 关键边界

Team Run 启动后的交互边界（不要违反）：

- Team Run 启动后，**用户没有过程性手动介入权**——不要在启动后试图让 agent 插话
- 用户唯一的两个主动动作：
  1. **abort**（独立终态，`team.abort` 工具）—— 任意非终态可入
  2. **决策点响应**（`team.respond_decision_point` 工具，flow 触发的门 + ad-hoc 门）—— action ∈ {continue / complete / abort}，可附 feedback

这两个动作由用户在常驻面板直接操作，**不**通过本 skill 触发。

## 故障模式

| 症状 | 原因 | 应对 |
|---|---|---|
| `team.start` 报 `team_templates_empty` | 素材库未初始化 | 引导用户去 team-config 配置中心建 role / member / template |
| `team.start` 报 `adapter_not_registered: <name>` | Role 选用了未注册的 adapter | 封闭 adapter 集合是 `hermes` / `mcode` / `claude-code`；让用户换一个 |
| 工具调用超时 | DSH 阻塞 / 网络问题 | 重试 1 次；仍失败 → 报告"DSH Team 插件暂不可用" |
| 用户描述任务含糊（如"帮我优化一下"）| task description 缺关键信息 | 走 Step 1 追问，不要凭印象默认填 |
