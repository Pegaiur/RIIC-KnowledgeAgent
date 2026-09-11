# ADR 索引

> 此表是 ADR 状态的**唯一权威来源**。新增 ADR 时在表尾追加一行，编号自增。
> 各 ADR 的完整内容见对应文件。
> 行格式（编号列必须为 `[NNN](文件名)` 链接形式，doc-check D2 按此解析；`[NNN]` 为占位，登记时替换为实际编号）：`| [NNN](ADR-NNN-标题.md) | 提议 | 标题 | 2026-01-01 |`

| 编号 | 状态 | 标题 | 日期 |
|------|------|------|------|
| [001](ADR-001-jieba-node-中文分词.md) | 已实施 | 引入 jieba-node 中文分词优化 BM25 检索 | 2026-09-01 |
| [002](ADR-002-facts-record-card-source.md) | 已实施 | 事实记录卡采用确定性源解析 | 2026-09-04 |
| [003](ADR-003-rag-facts-hybrid-retriever.md) | 已实施 | 新增 RAG 与 facts 混合检索模式 | 2026-09-04 |
| [004](ADR-004-query-agent-knowledge-layering.md) | 已实施 | 查询 Agent 采用单一指令源与分层证据 | 2026-09-04 |
| [005](ADR-005-chat-auto-tool-budget.md) | 已实施 | Chat auto 工具循环与每题积分预算 | 2026-09-05 |
| [006](ADR-006-independent-function-tools.md) | 已实施 | 按检索模式暴露独立函数工具与扁平参数 | 2026-09-07 |
| [007](ADR-007-single-term-facts-tool.md) | 已实施 | 单词条 facts 统一入口 | 2026-09-07 |
| [008](ADR-008-section-navigation.md) | 已实施 | 增加原文小节阅读能力 | 2026-09-08 |
| [009](ADR-009-exp-document-workflow.md) | 已实施 | 试验工作采用 exp 文档并仅保留过程结果结论 | 2026-09-09 |
| [010](ADR-010-facts-alias-disambiguation.md) | 已实施 | facts 别名、集合词条真源与同名全部返回契约 | 2026-09-09 |
| [011](ADR-011-retriever-tool-convergence.md) | 提议 | 检索模式与工具集合收敛 | 2026-09-10 |
| [012](ADR-012-tool-budget-attempt-limit.md) | 提议 | 工具预算改为失败不消耗与双上限，取消并行调用 | 2026-09-10 |
