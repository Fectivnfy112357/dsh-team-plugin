# DSH Team 插件

> DSH WebUI 的 Agent Team 插件——多 Agent 协作的 UI 层。

## 文档索引

| 文档 | 内容 | 状态 |
|---|---|---|
| [requirements.md](./requirements.md) | 需求规格（产品形态 + 机制层定稿）| ✅ v1 闭环 + 第五轮机制层扩展 + 第六/七轮审阅收口 |
| [discussion-log.md](./discussion-log.md) | 讨论过程、关键决策、被否决方案（七轮）| ✅ 完整记录 |
| [architecture.md](./architecture.md) | 实现架构 | ✅ v1 骨架（模块 / 状态机 / 三个 flow / UI Slot / 打包） |
| [mockups/panel-linear.html](./mockups/panel-linear.html) | 常驻面板 mockup（Linear 风）| ✅ 骨架验证 |
| [mockups/panel-mock-v1-废弃.html](./mockups/panel-mock-v1-废弃.html) | 第一版 mockup（三个对比，已废弃）| 🗑 仅作历史 |

## 文档命名说明

- 仓库内已有的 `team-v3-design.md` / `team-v3-spec.md` 属于**深度研究团队**的设计文档（在 `docs/deep-research/` 下）
- 本目录的 `requirements.md` 是 **DSH 插件本身**的需求规格，是 DSH 插件的"产品定义"，**与深度研究团队是正交关系**
- 深度研究团队是 DSH Team 插件的一个使用场景（Story 3），但 DSH Team 插件不止服务深度研究

## 一句话定义

DSH Team 插件让用户在 DSH WebUI 里**以"角色 + 团队"的视角组织多个 Agent**——角色是素材库，团队是临时剧组。Agent 全部走 ACP 协议接入底层 CLI，成员之间通过结构化 handoff 协作。

## 阅读路径

按角色挑入口：

| 你想做的事 | 先读 | 关键章节 |
|---|---|---|
| 理解产品是什么 / 怎么定下来的 | `requirements.md` | §0 一句话 / §2 核心概念 / §8 已闭环决策 |
| 了解七轮讨论里关键决策和被否决方案 | `discussion-log.md` | 轮次索引 + §5-§9 各轮 |
| 写代码 / 评审实现方案 | `architecture.md` | §1 形态选型 / §4 核心子系统 / §5 数据存储 / §12 实现阶段 P0-P8 |
| 看 UI 长什么样 | `mockups/panel-linear.html` | 直接打开 |

## 开发入口
- **双格式打包**：[`/dsh-dual-plugin-guide` skill](C:/Users/32115/.agents/skills/dsh-dual-plugin-guide/SKILL.md) 走单目录同时是 DSH 静态插件包 + Agent Plugins 1.0 插件
- **DSH 源码**：`D:\programming\projects\study\dsh`（所有 Service / Slot / 事件 / 复用能力从此出发）
- **路线**：P0 骨架（`package.json` + `lib/index.js` + `skills/start-team/SKILL.md` + `cordis.patch.yml` + `plugin.json`）→ P1 Story 1 完整 → P2 Story 2 → P3 Story 3 → P4-P8 渐进
- **Open Questions**（实现前需用户拍板）：见 `architecture.md §11.2`（OQ-1 plan step intent 枚举 / OQ-2 决策点等待默认值 / OQ-3 跨 Run artifact id 编码格式 等）