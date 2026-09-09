# 文档导航

当前回答判定使用 [spec v4](spec/rag-answer-baseline.md)。[v4 重评草案](reports/draft-answer-baseline-v4.md) 已完成 40 份原答、144 个必答编号、额外断言与送达归因的全量复核，仍待独立审定；当前没有正式质量基线。

| 分类 | 入口与用途 |
|---|---|
| 待决策事项 | [inbox](inbox.md)：仅保留未结束需求 |
| 已完成能力迭代 | [标题上下文与小节读取](archive/plan-section-navigation.md)、[上级范围阅读](archive/plan-scope-reading.md)：已实现并完成真实对照 |
| 已完成输入与引导迭代 | [harness 首轮迭代](archive/plan-harness-next-iteration.md)、[取证引导](archive/plan-guided-evidence.md)、[整理实验（已撤回）](archive/plan-answer-format.md) |
| 活跃草案 | [性能评估](draft-harness-performance.md)、[实体标记验证](draft-entity-marking-probe.md)：待确定是否实施，文中旧协议描述属于历史观察 |
| 长期核查规格 | [spec](spec/rag-answer-baseline.md)：跨运行复用的判定口径 |
| 待审定报告 | [reports](reports/draft-answer-baseline-v4.md)：保留 worker 初稿、更正记录和本轮全量复核，不能替代正式质量基线 |
| 架构决策 | [ADR 索引](adr/INDEX.md)：接口与选型的决策依据 |
| 历史资料 | [归档索引](archive/INDEX.md)：完成计划、实施纪要、已被替代的草案与旧报告 |
| 维护约定 | [生命周期](rules/document-lifecycle.md)、[术语规范](rules/rag-prose-terminology.md)、[模板](templates/plan.md) |

## 本轮收尾（2026-09-08）

按合并准备要求完成分类：D4 计划通过归档脚本合并实施笔记；工具前序草案、基线校正记录和 v3 报告归档；v4 重评移入 reports 并标为待审定草案。已完成需求从 inbox 清除，其中“按设计契约调整策略”已由完成的 [facts 工具计划](archive/plan-facts-tool-optimization.md) 承接，不再重复挂为待办。v4 全量复核和 harness 首轮输入/离线验证已完成，仍保留待审定与后续 ROI 任务。历史结论保留原上下文，不作为当前规格。

## 本轮收束（2026-09-09）

五份计划与实施纪要已归档。保留输入留档、小节与上级范围阅读、取证引导；名单作答整理实验未达到目标，新增规则已撤回。真实测试的观察、报告更正和本地证据保留用途见各归档计划末尾。质量报告独立审定与实体标记探索属于后续事项，不阻塞本轮本地合并。当前未创建版本标签，不发版、不推送。
