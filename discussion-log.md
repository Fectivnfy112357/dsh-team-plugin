# DSH Team 插件 — 讨论过程（2026-08-18 / 2026-08-19）

> 本文档记录产品形态的讨论路径，保留每一轮的关键决策和被否决的方案。
> 定稿请看 [requirements.md](./requirements.md)。

## 轮次索引

- [§1-§3 2026-08-18 第一轮 + 第二轮 + 第三轮 + 第四轮](#1-2026-08-18-第一轮讨论)（原文位置保留）
- [§7 2026-08-19 第五轮讨论（机制层全面扩展）](#7-2026-08-19-第五轮讨论机制层全面扩展) — 与 Product Architect 头脑风暴，session `20260819_144254_680037`
- [§8 2026-08-19 第六轮收口（审阅 + 收敛讨论）](#8-2026-08-19-第六轮收口审阅--收敛讨论) — 审阅 session `20260819_153611_90f4d1` + 收敛 session `20260819_154308_baeace`
- [§9 2026-08-19 第七轮（二次审阅 + 收敛拍板）](#9-2026-08-19-第七轮二次审阅--收敛拍板) — 二次审阅 session `20260819_162751_adcbc1`



---

## 0. 讨论起点

用户在 DSH WebUI 里想加类似 Hermes Bot Mode 的 Agent Team 功能，**但有一个根本不同**：成员不调用 Hermes 自身模型，而是可以绑定到 Claude Code / mcode 等外部 coding agent CLI。

---

## 1. 关键问题的演进

### Q1：Member 是否必须对应 Hermes Profile？

**讨论过程**：

- 一开始假设 Member = Hermes Profile（沿用 Bot Mode 模型）
- 用户澄清："DSH 的 agent team 插件又不在 Hermes 里运行"
- **结论**：不需要。DSH 维护自己的成员表，Hermes 只是可选 Adapter 之一

**影响**：所有后续设计脱离 Hermes 束缚，可以任意接入 CLI

---

### Q2：首批 Adapter 选哪几个？

**用户决定**：hermes、claude-code、mcode（首批三个）

---

### Q3：mcode 是什么？

**讨论过程**：

- 用户："MiniMax Code cli，命令是 mcode，也是一个 coding agent cli"
- 直接验证：`mcode --version` → 0.1.3，`mcode --help` 显示 `acp` 子命令
- **结论**：mcode = MiniMax Code CLI，原生支持 ACP（`mcode acp`）

---

### Q4：Hermes 是否有 ACP？

**讨论过程**：

- 一开始判定："Hermes 不在 ACP 列表里"
- 用户要求："hermes 完全没有吗？/github-explore 再去查一查"
- 用 `find_repos.py "hermes acp"` 搜索，发现：
  - 大量 `hermes-acp-*` / `*-hermes-acp-*` 项目存在
  - 关键：`hermes acp` 命令是官方原生的——"Start Hermes Agent in ACP mode for editor integration"
- **结论**：✅ Hermes 原生支持 ACP（`hermes acp`），之前误判

**纠正意义**：不需要为 Hermes 写桥接器，三个 Adapter 全走原生 ACP

---

### Q5：是否统一走 ACP 协议？

**用户决定**：让 Hermes、claude-code、mcode 都走 ACP

**现实情况**：

| Adapter | ACP 支持 |
|---|---|
| `hermes` | ✅ `hermes acp` 原生 |
| `mcode` | ✅ `mcode acp` 原生 |
| `claude-code` | ❌ 原生不支持，通过 `claude-agent-acp` 桥接 |

**结论**：DSH 侧只写一套 ACP 客户端代码，三个 Adapter 完全统一

---

### Q6 / Q7：DSH 侧用 Python/Node/Rust？

**用户纠正**："你不需要管 dsh 侧的实现，我们只来讨论产品，以及需求，实现是 dsh 侧的事情"

**影响**：实现细节完全剥离，所有讨论回到产品/需求层

---

### Q8：Member 之间的协作形态？

**用户描述三个场景**：

1. **模糊想法** → 多个 Agent 互相讨论，handoff
2. **开发任务** → developer 写代码 + 自测 → reviewer 审 → 有问题退回
3. **深度研究** → 多数据源并行采集 → 汇总分析 → 报告

**结论**：三种场景对应三种 Flow 模式（圆桌/流水线/扇出），**三种都支持**，不是二选一

---

### Q9：角色与团队的关系？

**用户澄清**："角色就这么多角色，但是团队可以根据需求来临时组建"

**结论**：

- 角色（Role）=能力模板，跨 Team 共享
- 团队（Team）= 一次具体协作，由角色实例组成
- 同一角色可在多个 Team 出现，同一 Team 可有多个相同角色实例

---

### Q10：Team 是预定义还是运行时拼？

**用户决定**：选项3，**两种都支持**

- **predefined**：用户预定义模板（场景 2、3 的重复任务）
- **runtime**：DSH 根据任务动态挑角色（场景 1 的模糊任务）

**附加规则**：运行时拼的 Team 可一键保存为模板

---

### Q11：handoff 的产物怎么处理？

**用户决定**：选项 C——**artifact + 引用关系**

- handoff 携带结构化 artifact（不是纯文本）
- artifact 之间有引用关系（可正反向追溯）
- 类型：code / report / data / analysis / decision / discussion

---

### Q12：DSH 调度者是谁？

**用户决定**：隐式 + 可配置混合

- 默认：DSH 内置调度策略
- 高级：用户可以为调度者指定一个 Role，用该角色的人格驱动调度

---

## 2. 核心洞察

### 洞察 1：之前误判"Hermes 无 ACP"是调查不全

教训：判断"某工具不支持某协议"前，必须用 GitHub 代码搜索 + 官方文档双验证，不能靠记忆和泛搜。

### 洞察 2："群聊 vs DAG"是伪二选一

三种场景分别对应三种协作模式：

- 圆桌讨论（场景 1）
- 流水线 + 反馈（场景 2）
- 扇出-汇总（场景 3）

真实需求是**同时支持多种 Flow**，不是选 A 还是 B。

### 洞察 3：用户提的"实现细节"问题要警惕

我曾问"DSH 用 Python 还是 Node"，被用户纠正——用户要的是产品形态，不是实现选型。

**原则**：讨论范围严格限制在产品/需求层，实现是 DSH 侧的事。

---

## 3. 文档目录

> 本节记录**第一轮**讨论时提出的结构提议。后续落实时**简化了路径**——所有文档从 `docs/dsh-team-plugin/` 提到仓根，code 也同仓落地（仓根即双格式包根）。当前实际结构见 [`README.md` §文档索引](../README.md) 与 [`AGENTS.md` §仓库结构](../AGENTS.md)。本节保留作历史记录。

```
docs/dsh-team-plugin/        ← 当时提议；现已简化为仓根
├── README.md             # 索引
├── requirements.md       # 需求规格（定稿）
├── discussion-log.md     # 本文档
└── architecture.md       # 实现架构，DSH 侧补
```

---

## 4. 第二轮讨论（2026-08-18）

第二轮讨论从"设置界面"开始（方向 A），然后进入"协作交互"（方向 B）。本节按方向分组记录新决策与被否决方案。完整决策表见 [requirements.md §8](./requirements.md#8-已闭环的产品决策)（H–V 共 14 项），详细讨论过程见 [requirements.md §11](./requirements.md#11-2026-08-18-第二轮决策设置界面--协作交互)。

### 4.1 方向 A — 设置界面

| # | 议题 | 决策 | 用户关键原话 |
|---|---|---|---|
| A1 | 角色编辑器技术暴露面 | L2（默认表单 + 高级折叠 JSON/YAML）| — |
| A2 | persona 模板库 | 不做 | "先不用，到时候再说" |
| A3 | Adapter 集合 | 封闭 + 扩展性预留 | "现在的架构设计就考虑上扩展性……用户无法自己新加 adapter，想添加只能修改插件源码" |
| A4 | Team 模板编辑 | JSON/YAML + 实时预览 | "简单可视优先，不要弄一大堆复杂表单以及配置" |
| A5 | Team 内 Role 实例命名 | 名字唯一 | "不会有同名出现，名字唯一" |
| A6 | avatar | 仅默认几何 | "默认几何没有 ai，也没有上传，边缘功能保持简洁……甚至无头像都没事" |

**被否决方案**：

- A1：L3 双视图（左右分屏表单 ↔ JSON）—— 投入产出比不值
- A3：暴露"自定义 Adapter"配置入口给用户 —— 会导致兼容性泥潭
- A5：自动编号 "brainstormer #1/#2" —— 增加心智负担

### 4.2 方向 B — 协作交互

| # | 议题 | 决策 | 用户关键原话 |
|---|---|---|---|
| B1 | Team 启动入口 | skill（斜杠 + 自然语言双触发），不是唯一 | "skill 只是方便 agent 阅读的，就算没有 skill，dsh 也能通过插件抛出的工具来开启一个 team" |
| B1' | 核心逻辑归属 | DSH 原生插件；skill 是 thin wrapper | "注意核心逻辑是使用 dsh 的原生插件完成的，skill 只是入口，不要把核心能力放到 skill 里" |
| B1'' | UI 角色 | 配置中心 + 常驻面板，不是启动入口 | "ui 只是个常驻面板，用来展示当前正在工作的团队以及成员" |
| B2 | 组装策略 | 全局默认 + 单次可覆盖（auto / manual）| "设置成 auto 的话……如果没有的话，会自动组建团队" |
| B3 | 常驻面板布局 | Linear 风 app shell（mockup 已通过 [`mockups/panel-linear.html`](./mockups/panel-linear.html) 落地）| "就按照这个来吧，要的只是这个布局……颜色包括细节设计到后边再说" |
| B4 | 6 种介入模式 | 全部砍掉 | "这些都不需要，开启团队后，目前版本无法手动介入操作" |
| B5 | handoff vs @mention | handoff 主区独立卡片；@mention 气泡 + 左侧边 | — |

**被否决方案**：

- B1：UI 上做"启动按钮" —— UI 不是启动入口
- B4：固定按钮条 / hover 浮动工具条 / `⌘K` 命令面板 / 上下文右键 —— 全部与"自治系统"产品定位冲突

### 4.3 mockup 文件位置

- 第一版（三个对比）废弃：`docs/dsh-team-panel-mock.html`（用户反馈"感觉很平淡，没有我想要的效果"）
- 第二版（Linear 风单风格）：`docs/dsh-team-panel-linear.html`
- 后续视觉细节（配色 / 字体 / 圆角 / 间距）单独讨论

### 4.4 第二轮未讨论议题（已记入 `requirements.md §10`）

- 其他 Flow 模式（除圆桌/流水线/扇出外）
- 多 Team 并存的 UI 设计
- Team 之间的资源共享
- Team 产物的版本管理
- 常驻面板视觉细节
- 历史 Team 切换查看
- Team 失败的处理路径

### 4.5 边界警告

本轮中曾出现一个**越界信号**——用户提到要讨论"核心流程 / 状态流转 / 数据存储格式"。这属于 DSH 侧实现层，已被 agent 拦回。所有讨论严格保持在产品/需求层。

> 边界规则回顾：实现是 DSH 侧的事，本文不规定任何"用什么语言"、"数据怎么存"、"状态机怎么流转"。

---

## 5. 第三轮讨论（2026-08-18）

第三轮从"调研 + 产品形态对齐"切入。本轮重点：**Role/Member/Task 概念重构 + Member Session 模型 + Self-handoff + DSH Handoff**。

### 5.1 调研结果（参考，不进入决策表）

调研对象：LangGraph / AutoGen / CrewAI / OpenAI Agents SDK / ACP / A2A，加上 Anthropic 的两篇工程博客（"How we built our multi-agent research system" / "Building Effective AI Agents"）。

**3 个 multi-agent 真正赢的场景**（Anthropic 自评）：

| 场景 | 价值 | DSH Team 对应 |
|---|---|---|
| Context protection | 子任务不污染主 agent | Team Run 边界天然隔离 |
| Parallelization | 可拆解成独立 facet 并行 | Story 3（fan-out-collect）|
| Specialization | 不同任务需不同 tool/persona | Member 由 Role 配置，是天然 specialization |

**Anthropic 自承**：coding tasks 不太适合 multi-agent；DSH Team 的 Story 2 价值可疑，Story 1/3 更合适。

**Artifact 经验**：artifact 写到文件系统，handoff 只传递引用——避免"电话游戏"。

### 5.2 概念重构（Q-M1 + Q-Run-1~5）

**前两轮的混淆**：

- 第一轮：Member = Role 在 Team 内的实例
- 第二轮引入 Task 概念（Member 的一次执行单元）——但跟用户说的"Task"冲突

**用户纠正**："你说的 task 是一个 task 吗？我指的 task 是就那刚才开发任务来说把，我把任务给到 dsh 后，到最后 team 任务完成了，代码跑起来了，结束了，这算一个 task 结束"

**对齐结果**：

- **Task = Team Run** = 一次完整运行（从用户输入到任务达成）
- **Member 一次执行 = Dispatch**
- 删掉 v1 引入的 `tasks/<task-id>/` 子目录

**Member 跨 Team Run 记忆**（用户原话"确定以及肯定的"）：

| 维度 | 累积 |
|---|---|
| 同 Team Run 内（同 session）| ✅ 累积 |
| 跨 Team Run（跨 session）| ❌ 不累积 |

跟"讨论需要连续上下文"不冲突——讨论=一次 dispatch 内多次 prompt，同 session 累积。

### 5.3 Member Self-handoff（Q-H1~4）

| # | 决策 | 用户原话 |
|---|---|---|
| H1 | 阈值 = 200k token | "超过两百k 就让 member 自己 进行 handoff" |
| H2 | handoff 文档位置 = 灵活 | "放哪都可以，哪里方便放哪里" |
| H3 | handoff 内容 = Member 自己生成 | "就按照 /handoff-hermes 的提示词来就行" |
| H4 | 新 session prompt 拼接 | "首先把 member 自己的人格设定给他，然后 handoff 的文档给他，之前的 task 指令给他" |

**机制核心**：不交接给别人，**交接给自己**——新 session + 改配置文件的 sessionId。

### 5.4 DSH 调度者 Session 控制（Q-DSH-1~4）

**关键认知**（用户纠正）："dsh 也跟你一样是有输入框的，所以 dsh 跟你一样，是我在与 dsh 交互……dsh 自己无法换 session，是我手动在输入框里触发 斜杠 handoff-hermes"

| # | 决策 | 备注 |
|---|---|---|
| DSH-1 | 复用 `handoff-hermes`，不新建 skill | 推荐被接受 |
| DSH-2 | DSH handoff = **纯手动** | 用户观察 session 长度自己触发 |
| DSH-3 | handoff 文档必含 Run ID + 关键路径 + 状态 | 让新 session 知道"我现在管哪个 Run" |
| DSH-4 | DSH 新 session 不重读全部历史 | 读 handoff + 按需读 state |

**本质区分**：

- Member：后台 agent，DSH 自动控制 session
- DSH：前台 agent，**用户控制** session

### 5.5 边界警告（澄清后）

第二轮讨论中用户提到"核心流程 / 状态流转 / 数据存储格式"——曾被 agent 误判为越界。

**澄清后边界**：

- ✅ 可聊：Team Run 状态枚举、状态转换图、artifact 字段、handoff log 结构、目录的逻辑划分
- ❌ 不能聊：用什么语言 / 库 / ORM / 数据库 / async 模型 / 文件路径

实现细节 DSH 侧决定，本文只规定**逻辑机制**。

### 5.6 第三轮决策汇总

完整 14 项新决策见 [requirements.md §8](./requirements.md#8-已闭环的产品决策)（M1 + Run-1~5 + H1~4 + DSH-1~4），详细讨论过程见 [requirements.md §13](./requirements.md#13-2026-08-18-第三轮决策核心机制team-run--member-session--self-handoff--dsh-handoff)。

---

## 6. 第四轮讨论（2026-08-18）

第四轮从"中央调度者 vs 事件驱动协调总线"的分歧出发，调研了 TimYuann/orchestra-dsh 库，最终选择**混合架构**。

### 6.1 核心争论

| 方案 | 内容 | 问题 |
|---|---|---|
| 纯中央调度（DSH 包揽一切）| 所有协作过 DSH | DSH 成瓶颈；"讨论"过重；DSH context 易爆 |
| 纯事件总线（Member ↔ Member 直接通讯）| 需要 Adapter 暴露 A2A endpoint | Adapter 不一定支持 |
| **混合架构** | dispatch 走 DSH；消息走 DSH 代理 | **选中** |

### 6.2 关键洞察——为什么不能走"真 A2A 协议"

**用户原话**："让 Member 可以用不同的 LLM（不只是 DSH 自己的）这是我们的核心优势，不能放弃"

- 我们核心优势 = **Member 用不同 LLM**（不是 DSH 自己的）
- 真 A2A 协议要求每个 Adapter 暴露 A2A endpoint——Adapter 是 DSH 外部进程，无法控制
- TimYuann 的 orchestra-dsh 不存在这问题，因为它的 Member 是 DSH 内部 session
- 我们不能放弃 Adapter 多样性 → **不能走真 A2A 协议**

### 6.3 TimYuann/orchestra-dsh 借鉴

| 它的设计 | 我们采纳 |
|---|---|
| A2A transport（消息层概念）| ✅ 概念借鉴，**底层还是 ACP** |
| `orchestra_report`（read-only 角色写通道）| ❌ 本轮不做 |
| `degraded` 状态 | ✅ 加进状态机 |
| Discussion = Plan（讨论即计划）| ✅ 概念纳入，**具体机制留后续** |
| Topology 7 问 | 部分借鉴 |
| 整个 DSH session 实现 | ❌ 不借鉴（要保留 ACP 进程级）|

### 6.4 ACP vs A2A 协议栈澄清

| 层 | 协议 |
|---|---|
| DSH ↔ Member | ACP（已定）|
| Member ↔ Member | **DSH 内部消息路由**（不是新协议，是数据结构）|
| DSH 内部 | dispatch-log + a2a-message-log |

**关键澄清**：

- A2A 协议（Linux Foundation 的 a2aproject）是**跨组织**用的——跟 DSH 内部 Member 协作**不是同一类需求**
- 我们走的是"ACP + DSH 内部路由"——保持核心优势（不同 LLM），不要求 Adapter 配合

### 6.5 第四轮决策（Q-M2 ~ M7）

| # | 决策 | 备注 |
|---|---|---|
| Q-M2 | Member 之间消息持久化到 `a2a-message-log.jsonl` | 跟 dispatch-log 平级 |
| Q-M3 | 混合架构 | dispatch 走 DSH；消息走 DSH 代理（不是外部 A2A 协议）|
| Q-M4 | 消息类型 = 结构化 `{topic, intent, payload}` | 便于路由/过滤/审计 |
| Q-M5 | Member inbox 自动消费（idle 时检查 inbox 醒来）| 无需 DSH 每条都参与 |
| Q-M6 | Team Run 状态机加 `degraded` | 部分失败 ≠ 完全失败（借鉴 TimYuann）|
| Q-M7 | read_only 角色 + orchestra_report 通道 = 本轮不做 | 留后续 |

### 6.6 借鉴但未采纳的点（明确不做什么）

- ❌ **不引入外部 A2A 协议**（a2aproject）——避免要求 Adapter 实现 A2A endpoint
- ❌ **不做 read_only 角色**（这一轮）——复杂度延后
- ❌ **不做 orchestra_report 通道**（这一轮）——同上
- ❌ **不做"显式 plan artifact"**（这一轮）——讨论结论的产出形式留后

### 6.7 第四轮决策汇总

完整 6 项新决策见 [requirements.md §8](./requirements.md#8-已闭环的产品决策)（M2~M7），详细讨论过程见 [requirements.md §14](./requirements.md#14-2026-08-18-第四轮决策混合架构a2a-style-消息)。

---

## 7. 2026-08-19 第五轮讨论（机制层全面扩展）

本轮从"失败处理"议题开始（议题 2），连拍 8 个议题组 + Q-M7 重开判定，共 36 项决策。讨论对象为 Product Architect（skeptic profile / `hermes -p skeptic`），全程 SOUL 硬规则：禁用 memory 工具、不写最终方案文档、一次一个问题、不复述对方原话、不用 AI 味客套话。

### 7.1 议题 2：失败处理路径（Q1-Q6 → §9.8）

**背景**：v1 §9.8 占位 + 失败处理相关讨论留白。

**核心争论**（议题 2 内部按依赖拆为 4 个子问题）：

- **Q1 abort 语义**：是"介入"还是"终止"？当前 §4 锁定"无介入权"，但失败清单里挂着"用户主动 abort"——矛盾
- **Q3 单步失败**：一刀切 / 交 DSH 判定 / 按 flow 语义 / 自动跳过——四选一
- **Q4 循环失败**：max_retries 耗尽时直接 failed / 进 degraded / DSH 兜底
- **Q5 degraded 进入**：硬规则 / DSH 判定 / 显式定义

**关键洞察**：

- abort = 终止，不是介入（与 V 决策正交）；独立终态而非 merged into failed
- 运行失败（进程挂/超时）与结果失败（有产物但判定不达标）必须二分——前者轻量重试不打扰 DSH，后者按 flow 语义分散处理
- degraded 是成员级故障（≥1 非全部不可恢复），不是流程未达成——讨论不收敛绝不能推到 degraded
- dispatch 终态三态化：`completed` / `failed` / `interrupted`（新增）

**决策**：Q1-Q6 全部拍板，详见 [requirements.md §9.8](./requirements.md)。

### 7.2 议题 3：Discussion = Plan 机制（Q7-Q17 → §9.9）

**背景**：v1 §2.7 artifact 类型枚举有 `decision` / `discussion` 但没规定具体产出形式。TimYuann/orchestra-dsh 的"Discussion = Plan"概念 v1 第四轮已借鉴但留后续。

**核心争论**：

- **Q7 plan 是否存在**：一刀切 / 完全解耦 / flow_config 可选
- **Q8 谁生成**：Member 自生成 / DSH / 任一 Member
- **Q9 枚举归属**：复用 decision / 复用 analysis / 新增 plan
- **Q11 plan 结构**：纯文本 / 完整 JSON schema / 折中
- **Q12 硬约束 vs 软参考**：DSH 是否被锁定在 plan 上
- **Q17 讨论不收敛处理**：plan 产"未收敛"状态 / 升 degraded / DSH 介入

**关键洞察**：

- 收敛点本身可结构化：成员声明收敛 → 消息 payload 带 `conclusion` 字段（Q-M4 已锁定 `{topic, intent, payload}`，零新机制）
- DSH 是唯一全局视野者，单个 Member 写 plan 是越权定方向
- plan 的 steps 是"提炼索引"不是"写作模板"——避免 DSH 为填 schema 而写空泛步骤
- `expected_artifact` 是 required = plan 产出资格的质检锚点（能产 plan 的收敛必有产出方向）
- 决策点 vs plan/intent 区分：plan step(intent 任务域动词) ≠ a2a 消息(intent 消息域动词)

**决策**：Q7-Q17 全部拍板，详见 [requirements.md §9.9](./requirements.md)。

### 7.3 §4 / Story 1 矛盾解决（Q18-Q21 → §9.10）

**关键发现**：本轮讨论中 Q17 "讨论不收敛"路径把 §4 与 Story 1 的矛盾炸到台前——v1 §4 锁定"用户无介入权"，但 Story 1 step 5-6 明确写了"用户看了结论后要求继续"。

**调和路径**（三选一）：

- (a) Story 1 写错——否决，Story 1 是产品中心场景
- (b) §4 写绝对了——**选中**。"介入"和"决策点响应"是两类不同动作
- (c) 套套逻辑——否决

**关键洞察**：

- "介入 = 过程控制（砍掉）"；"终止 = 结束整局（保留）"；"决策点响应 = 流程预声明的在场窗口（保留）"
- 衔接点由 flow 定义（结构性属性），flow_config 开关是否开放给用户——用户不能发明衔接点
- 默认值按 flow 类型：round-table 默认开 `["round-end"]`（Story 1 中心场景），pipeline/fan-out 默认关
- 决策点响应 = `{action: continue|complete|abort, feedback?}`——feedback 是自由文本（含追加约束），DSH 自治消化
- 持久化独立 `user-intervention-log.jsonl`（不混 a2a-message-log，不塞 dispatch context_refs）
- 决策点等待 = running 下的"DSH 主动等待"子状态（非新状态机状态），超时 = 自动 continue = 决策点透明化

**决策**：Q18-Q21 全部拍板，详见 [requirements.md §9.10](./requirements.md)。§4 重写（原 §4 整段替换）+ 新增 §4.3 介入持久化。

### 7.4 议题 4 第一场：产物共享 + 版本管理（Q22 → §9.11）

**核心争论**：

- 跨 Run 引用：引用式 vs 复制式
- 版本管理：链上版本 vs 不可变快照 vs 折中
- 清理策略：TTL / 冷区 / 不清理

**关键洞察**：

- 跨 Run 引用式 + id 带 run 归属段（`artifact.id = <run-id>/<artifact-id>`）——展示层可解析归属，但 artifact 体不分裂
- 不可变快照 = 零改写风险；"取最新版本"沿 `derived_from` 反向找链尾
- 归档 ≠ 删除：归档是软关闭（artifact 原地保留），锁存只挂在删除保护上
- 引用拆"记录"vs"注入"两步：原始记录 = user-intervention-log；注入 = DSH 处理时把 feedback 写进下一轮 dispatch 的 task 文本
- 当前版本不清理（无 TTL / 无冷区）——不是"永不"，是"本版本不实现"，结构留口

**决策**：Q22 全部拍板（Q22-1 ~ Q22-6），详见 [requirements.md §9.11](./requirements.md)。

### 7.5 议题 4 第二场：多 Team UI + 历史切换 + A2A 消息（Q23-Q30 → §9.12）

**核心争论**：

- 侧栏是否显示决策点等待状态
- 决策点提示视觉：高亮 / 新 pill / 角标
- 侧栏活跃 vs 历史：上下同框 / tab / 仅活跃
- 历史 Team 切换查看：只读 / 重跑 / 压缩
- A2A 消息 UI：统一 timeline / 独立侧流 / 默认隐藏
- 视觉区分维度：事件类型 / sender / 主题密度
- reply 视觉：完整线程树 / 一级虚线

**关键洞察**：

- 决策点是多 Team 场景下唯一对用户有召唤力的信号——侧栏**必须**显示
- 决策点视觉 = 状态 pill 上小角标（不新造 pill）——匹配机制语义"决策点不是新状态"
- 侧栏只导航，介入面板在 Team 主区 = timeline 自然延续"等待你的反馈输入卡"
- 重跑 = 复用 members + flow_config + 预填 task_description（可改）+ 启动前可勾选注入原 Run artifacts 为初始 context_refs
- 上下同框 + 历史区默认折叠（"历史 (N)"）——同框不贬低历史，折叠防历史淹没活跃
- 视觉区分按"事件类型"——sender 信息在 hover/详情
- **用户介入 = 决策点事件卡片（输入框+action+消息一体）**，不是红色气泡（红色 §10.2 已锁给 handoff 退回）
- in_reply_to 一级虚线引导（reply 气泡底部指向被回复气泡）——不画完整线程树（round-table 链式接力会视觉爆炸）

**决策**：Q23-Q30 全部拍板，详见 [requirements.md §9.12](./requirements.md)。

### 7.6 议题 4 第三场：read_only + orchestra_report（Q-M7 重开判定）

**第五轮开头提议**：第四轮 Q-M7 锁"本轮不做"，本轮讨论发现 read_only 角色似乎填补了若干场景（"观察门口"、"独立观察员"等），提议重开。

**反驳论据**（Product Architect 强列）：

1. **场景 A（客观观察者）**：能用任意 Member 产 analysis/report artifact 覆盖；reviewer 角色在 Story 2 已存在
2. **场景 B（静态检查）**：同上，reviewer + DSH 检验已覆盖
3. **场景 C（调试旁观）**：调试场景不进 v1 产品
4. **最硬论据——机制矛盾**：`read_only` 角色"看全集"与 Member 能力边界模型直接冲突。现有模型 Member 是受限 ACP 进程，DSH 注入什么看什么——没有任何 Member 生来能读 a2a-message-log / dispatch-log / 全部 artifacts。read_only 要"看全集"得开新通道 = 新权限模型 + 新审计面
5. **跨 Team 观察已被 Q22 覆盖**：跨 Run 引用式读取就够了
6. **orchestra_report 不可迁移**：在 orchestra-dsh 内部 session 模型成立；外部 ACP 进程权限边界完全不同——v1 第四轮"借鉴但未采纳"清单已记

**重开锚点**（不封死）：当出现"用户明确要求一个不参与讨论的独立观察者/裁判"（真实用户声音，不是机制推导）或"合规审计需要第三方独立报告"时，重开。当前两者都没有。

**决策**：Q-M7 维持不做。详见 [requirements.md §14.5](./requirements.md)。

### 7.7 第五轮核心 Trade-offs

- aborted 独立终态：审计清晰 ↔ 状态机增 + dispatch 增 `interrupted` 值
- 砍暂停：机制简单 ↔ 运行中 DSH 不在线的"停摆"无产品级表达（UI 暗示留待）
- plan 软参考：DSH 自适应保留 ↔ 计划偏差依赖"采纳留痕"才能追溯
- 不可变快照：零改写风险 ↔ "同源最新版本"需沿 `derived_from` 链反查
- 决策点窗口：用户参与感 ↑ ↔ 自治性被窗口打断（默认 10 分钟 + 超时 continue 缓冲）
- 无自动清理：简单 ↔ 长期存储成本未量化（接受）
- 侧栏折叠历史：防淹没 ↔ 历史可见性降一级（一次点击）
- 跨 Run 引用：复用率 ↑ ↔ Run 之间产生隐藏耦合

### 7.8 第五轮决策汇总

完整 36 项决策见 [requirements.md §8](./requirements.md#8-已闭环的产品决策)（Q1~Q30 + Q-M7），详细机制收录于 [requirements.md §17](./requirements.md)。

### 7.9 Open Questions（第五轮未拍板项）

- plan step intent 枚举值集（任务域动词最终值）
- 决策点等待默认 10 分钟是否写入产品默认值
- 跨 Run 引用 artifact id 内 run 归属段编码格式（DSH 实现层定）
- §4 重写及 state-history 必含字段的准确措辞

### 7.10 第五轮教训（避免重复犯错）

- **机制矛盾 vs 越界**：曾把"决策点响应"机制误判为"实现层"——澄清后：状态机本身、目录逻辑划分是**机制层**（可聊），只有"用什么技术实现"才是越界
- **范围 vs 边界**：Q17 讨论不收敛时，"用户能否介入决策点"撞上 §4；处理时不应直接跳到"§4 错了"，而应分层——"介入" ≠ "终止" ≠ "决策点响应"
- **架构师反驳场景的论据**：Q-M7 重开时提供 3 个场景但都被覆盖；要反驳必须有**机制矛盾**（属性冲突而非覆盖不足）作为最硬论据
- **决策点 vs plan/intent 区分**：plan step(intent 任务域动词) ≠ a2a 消息(intent 消息域动词)——容易混淆，要始终明确语义边界

---

## 8. 2026-08-19 第六轮收口（审阅 + 收敛讨论）

本节记录审阅（Product Architect session `20260819_153611_90f4d1`）+ 收敛讨论（session `20260819_154308_baeace`）的过程与教训。**全部 13 条问题 + 3 项交叉决策已收口并入 requirements.md §19**。

### 8.1 审阅背景

用户要求对第五轮文档做整体审阅，只找架构层面 + 产品方向的大缺口/大问题，零碎小问题不管。审阅产出 13 条问题，按严重度排序：S1 硬缺口 3 条、S2 机制矛盾 3 条、S3 一致性缺口 4 条、S4 定位 2 条、S5 措辞 1 条。

### 8.2 三条硬缺口（S1）——任何实现方第一天就撞墙

1. **flow 操作语义未闭环**：fan-out 的 join 条件/触发者无定义；round-table 轮次边界无定义；pipeline 顺序强制靠成员自觉
2. **handoff 无持久化归宿**：dispatch-log 装不下（from 枚举只有 scheduler）、a2a-message-log 被区分原则排除、handoff-md 只是 self-handoff——核心原语不可追溯
3. **DSH 运营模型未闭环**：崩溃恢复缺失、手动 handoff 不对称、"全局视野"与"按需读"矛盾

### 8.3 关键争论与修正（讨论轮）

- **degraded 的修法争论**：执行侧主张补 degraded→running 迁移；架构师反驳——既然 degraded 可继续时行为与 running 无差异，就不该是独立状态，直接改为 running 的修饰 flag（进入条件 + 终态判定影响两条规则）。**采纳 flag 方案**，状态机零新增迁移
- **derived_from 修法争论**：执行侧主张"必填放宽为二选一 + convergence_note"；架构师反驳 convergence_note 是空转产物本身。**采纳取值域扩展**（{decision | 收敛消息 | 用户决策点记录}），succeeded=用户确认使 round-table 天然有锚，DSH 零新造
- **崩溃恢复归属争论**：执行侧怀疑是平台能力；架构师切分——重连进程是平台能力，但"Run 状态标记"是插件职责（启动对账），**采纳**；且 interrupted 是新状态不是修辞，必须有出口
- **A2A 唤醒争论**："无需 DSH 参与"措辞误导——投递即唤醒是机制事实，真实边界是"不读内容、仅路由+唤醒"；正名后立论成立

### 8.4 三交叉决策（用户拍板）

- **A. 成员生命周期**：DSH 死 = 整队销毁、产物保留可回看、重跑重新组队（用户确认）
- **B. 宿主并发上限**：查实 `acp_adapter/server.py:231` ThreadPoolExecutor(max_workers=4)——ACP 执行并发的硬上限；文档引用宿主限制，不写自造数字
- **C. 产品形貌**：**用户否决架构师降级推荐，拍板不降级**——Story 1/2 均 1.0 支柱，验收完整口径 + 失败路径

### 8.5 第六轮教训

- **查证而非臆断**：#11 的"资源耗尽平台兜底"是空话还是真话，取决于宿主有没有真实上限——去读了 acp_adapter/server.py 源码，4 worker 是实打实的硬上限，且同时约束单 Run 内 fan-out 并行（比跨 Run 更狠）
- **架构师的价值在反驳**：执行侧两次提案（degraded 迁移、derived_from 二选一）都被架构师反驳出更优解——讨论轮的价值是让对方打回 bad take，不是互相确认
- **措辞也是机制**："无需 DSH 参与"这类立论措辞会推错结论——正名为"不读内容仅路由+唤醒"后，读者不会以为 wake 有独立通道
- **验收必须含失败路径**："用户决策点走一遍=通过"不含 abort/重开/中断对账/组装失败——产品支柱的验收过的时候恰恰是产品最脆的时候

---

## 9. 2026-08-19 第七轮（二次审阅 + 收敛拍板）

本节记录二次审阅（session `20260819_162751_adcbc1`）+ 收敛拍板的过程。审阅基于第六轮收口后的最新定稿（1603 行）独立重审，重点找"上一轮遗漏的、或收口过程新引入的"问题；收敛讨论接受用户两项产品方向拍板。

### 9.1 二次审阅发现的 6 条增量问题

- **P0-1 成本模型完全缺失**（六轮全漏·产品方向）：核心卖点 = 拉多个付费 agent，但全文无"成本"维度——无估算/预算/预飞行确认/熔断
- **P0-2 决策点节奏未定义**（收口后放大·产品方向）：round-end 每轮决策点 vs max_rounds 收敛点双反馈环打架；无人值守圆桌永不结束 + 白烧付费
- **P1-1 单写入者=DSH 与 self-handoff 自写矛盾**（收口新引入·机制矛盾）：§2.4 立"成员不落盘"，§9.3 成员自己写 handoff-md——第六轮该顺势收没收
- **P1-2 信任模型空洞**（遗留·架构）："无跨 Run 寻源权/不落盘/只读自己"对完整能力编码 agent 物理不成立
- **P2-1 dispatch from=member 与 handoff-log 双重记录**（收口新增·一致性）：同一移交两个事实源
- **P2-2 崩溃时在途 dispatch 终态未定义**（收口遗漏·一致性）：对账后 completed_at=null 的死记录无归属

### 9.2 关键争论与修正（收敛讨论）

- **P0-2 的"同步 vs 异步"二分被推翻**：真正的抉择不是同步/异步，是"用户介入的触发权在谁手里"。执行侧"混合节奏"（DSH 判值不值得开）= 黑盒被否；"仅 final round"= 杀掉中途纠偏被否。**采纳"收敛门 + 用户门"**：决策点开点 = [收敛信号 / max_rounds / 用户主动拉 ad-hoc 门] 三选一，零 DSH 裁量
- **架构师修正自己上一轮的一处（P1-1）**：单写入者矛盾不止 handoff-md 一条——§9.5 artifact 本来就是成员直接落盘，跟整个机制矛盾。真正改法是**重定范围**：五个协调日志归 DSH，artifact/self-handoff 归成员；废弃执行侧"DSH 代写 handoff"补丁
- **P0-1 主战场纠正**：成本主战场是 Story 3（fan-out 拉付费 collector），不是 Story 1——Story 1 的成本早被 max_rounds×队形封顶
- **P0-1 超时缺省张力**：自治（continue）vs 成本（abort）——按 flow 分流解决：round-table abort、pipeline/fan-out continue

### 9.3 三决策拍板（用户）

1. **P0-2 主轴**：采纳"收敛门 + 用户门"——用户"随时拉门插话"判定为扩展介入时机、不扩介入动作集，可接受（非裸插话，走决策点包装）
2. **P0-1 成本纪律三项全采纳**：① fan-out≥3 预飞行确认 ② 决策点超时按 flow 分流（round-table→abort）③ 单 Run 成本上限→触顶开"续/停"决策点，用户不在默认停止（非 failed）
3. **机制层 4 条**（P1-1/P1-2/P2-1/P2-2）按架构师建议直接落，无异议

### 9.4 第七轮教训

- **"收口"本身会引入新矛盾**：第六轮为修 handoff 无归宿，立单写入者 + 扩 from=member，却同时撞上 §9.5 artifact 直写机制 + 制造双事实源——收口要回查是否与旧机制打架
- **先找物理现实再看承诺**：P1-2 的隔离承诺对带 shell 的编码 agent 物理不成立——需求层要么承认同信任域、要么真做隔离，不能停在"既宣称又不可行"
- **产品方向问题要合起来看**：P0-1（成本）与 P0-2（决策点节奏）是一体的——决策点被点名频率 × 付费 agent 轮次 = 真实成本曲线，分开拍会在机制层制造矛盾
- **用户拍板不是终点，是收敛入口**：两项产品拍板后仍需架构师出逐条 diff 才算收口——拍板定了方向，diff 落成机制
