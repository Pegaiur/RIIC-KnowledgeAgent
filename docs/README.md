# 文档导航

当前回答判定使用 [spec v4](spec/rag-answer-baseline.md)。[v4 重评草案](reports/draft-answer-baseline-v4.md) 经抽查发现误述与漏检，汇总已撤回，待全量语义复核；当前没有审定的 v4 结果报告，也未指定正式质量基线。

| 分类 | 入口与用途 |
|---|---|
| 待决策事项 | [inbox](inbox.md)：仅保留未结束需求 |
| 活跃草案 | [性能评估](draft-harness-performance.md)、[实体标记验证](draft-entity-marking-probe.md)：待确定是否实施，文中旧协议描述属于历史观察 |
| 长期核查规格 | [spec](spec/rag-answer-baseline.md)：跨运行复用的判定口径 |
| 待复核报告 | [reports](reports/draft-answer-baseline-v4.md)：保留 worker 初稿与更正记录，不能用于最终比较 |
| 架构决策 | [ADR 索引](adr/INDEX.md)：接口与选型的决策依据 |
| 历史资料 | [归档索引](archive/INDEX.md)：完成计划、实施纪要、已被替代的草案与旧报告 |
| 维护约定 | [生命周期](rules/document-lifecycle.md)、[术语规范](rules/rag-prose-terminology.md)、[模板](templates/plan.md) |

## 本轮收尾（2026-09-08）

按合并准备要求完成分类：D4 计划通过归档脚本合并实施笔记；工具前序草案、基线校正记录和 v3 报告归档；v4 重评移入 reports 并标为待复核草案。已完成需求从 inbox 清除，其中“按设计契约调整策略”已由完成的 [facts 工具计划](archive/plan-facts-tool-optimization.md) 承接，不再重复挂为待办。v4 全量复核仍留在 inbox。历史结论保留原上下文，不作为当前规格。
