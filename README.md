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