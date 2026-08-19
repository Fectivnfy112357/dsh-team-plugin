# AGENTS.md

DSH Team 插件的需求/设计文档仓库——只装"产品是什么 / 怎么定下来的"和实现侧架构，**不含可执行代码**。
实现侧代码落地到独立双格式插件仓（路径见 `architecture.md §1.3`），不在本仓。

## 工具

- [`/dsh-dual-plugin-guide` skill](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) — DSH Cordis 插件开发指导（双格式打包 / Service / Slot / 事件 / 动态 Tool）
- `D:\programming\projects\study\dsh` — DSH 源码（实现侧一切从这出发）
- `architecture.md` — 本仓的**实现侧架构**（Service 接口骨架 / 状态机 / 三个 Flow / Slot / 包结构占位 / 风险与开放项）

## 仓库结构

| 路径 | 状态 | 用途 |
|---|---|---|
| `README.md` | ✅ | 文档总索引 + 一句话定义 |
| `requirements.md` | ✅ v1 闭环 + 第五轮机制层扩展 + 第六/七轮审阅收口 | 需求规格（产品形态 + 机制层定稿）|
| `discussion-log.md` | ✅ 七轮 | 讨论过程 / 关键决策 / 被否决方案（按轮次）|
| `architecture.md` | ✅ v1 骨架（模块 / 状态机 / 三个 Flow / UI Slot / 打包）| 实现侧架构（**新增**——本仓不写代码，仅到架构层）|
| `mockups/` | ✅ | UI 草图 HTML（`panel-linear.html` 为当前骨架）|
| `AGENTS.md` | — | 本文件——给 Agent 看的项目约定 |

## 实现从哪开始

1. **必读**：`requirements.md` §2（核心概念）/ §5（数据存储）/ §9（核心机制）三节
2. **开发路线**：`architecture.md` §12 实现阶段 P0-P8（按 Story 1 → Story 2 → Story 3 顺序）
3. **落地形态**：按 [`/dsh-dual-plugin-guide` skill](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) 的**双格式**打包（单目录同时是 DSH 静态插件包 + Agent Plugins 1.0 插件），不走 DSH 仓 monorepo 一等公民路线
4. **第一批打开的文件**（P0 骨架）:
   - `package.json`（`name` / `type:module` / `dsh.bundle.patch` / `files`）
   - `cordis.patch.yml`（`- insert: - id: <id>-skill, name: '<pkg-name>'`）
   - `plugin.json`（Agent Plugins 1.0 清单）
   - `lib/index.js`（`apply(ctx)` 注册 Service + Skill + Tool + Slot）
   - `skills/start-team/SKILL.md`（内容唯一源）

## 与深度研究团队的关系

仓库内已有的 `team-v3-design.md` / `team-v3-spec.md` 属于**深度研究团队**的设计文档（在 `docs/deep-research/` 下），是 DSH Team 插件的一个使用场景（Story 3），但**与本仓正交**——本仓的 `requirements.md` / `architecture.md` 是 DSH Team 插件本身的产品定义 + 实现架构，不专属深度研究。

## 写作边界（继承 `requirements.md §16`）

**严格只写产品/需求 + 机制层 + 实现架构**，不涉及具体技术实现代码：

- ✅ 可写：Team Run 状态枚举、状态转换图、artifact 字段、dispatch / 消息 log 结构、Service 接口骨架、目录逻辑划分、Slot 注册点、事件名清单
- ❌ 不写：具体 TypeScript / Python 代码、API 端点、数据库 schema、ORM / async 模型、UI 像素级设计


