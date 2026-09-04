# 归档索引

> 按完成日期降序排列。版本列为发版归档时的根版本（非发版归档填 `—`）。
> 摘要写一句话成果摘要（归档脚本缺省从 plan「## 目标」段首条 bullet 提取，可 --summary 覆盖）。

| 完成日期 | 版本 | 文件 | 摘要 |
|----------|------|------|------|

| 2026-09-04 | — | [plan-hybrid-facts.md](plan-hybrid-facts.md) | facts-first 确定性记录卡、lookup/query_operators 与全量 425 卡运行时切换完成 |
| 2026-09-04 | — | [plan-facts-record-cards.md](plan-facts-record-cards.md) | 完成 425 名干员记录卡确定性解析、分类/等价关系拼装与全量门禁 |
| 2026-09-04 | — | [plan-facts-query-contract.md](plan-facts-query-contract.md) | 收紧 query_operators 正向条件与非法参数校验，阻止无条件全库输出 |
| 2026-09-04 | — | [plan-prts-crawl.md](plan-prts-crawl.md) | 按 PRTS 核对并落位 8 页基建机制公式基础规则 |
| 2026-09-04 | — | [plan-rag-facts-hybrid.md](plan-rag-facts-hybrid.md) | 新增 hybrid 模式同时暴露 RAG 与 facts 工具并完成 Qwen 冒烟 |
| 2026-09-04 | — | [plan-rag-prose-cleaning.md](plan-rag-prose-cleaning.md) | plan-rag-prose-cleaning |
| 2026-09-04 | — | [plan-agent-facts-knowledge-layering.md](plan-agent-facts-knowledge-layering.md) | 将查询指令收敛为 knowledge/AGENTS.md 单一真源，并按 RAG 与 facts 能力动态生成工具契约 |
| 2026-09-04 | — | [plan-base-corpus-optimization.md](plan-base-corpus-optimization.md) | 重建基建机制 base 语料、自然标题切块与 F01–F10 通用规则边界 |
| 2026-09-04 | — | [plan-rag-facts-quality-loop.md](plan-rag-facts-quality-loop.md) | 重建 20 题 questions/gold/spec 门禁，并冻结 Qwen off + hybrid 首次真实质量基线（严格折算 25%） |
| 2026-09-03 | — | [plan-facts-source-purge.md](plan-facts-source-purge.md) | plan-facts-source-purge |
| 2026-09-02 | — | [plan-retrieval-tuning.md](plan-retrieval-tuning.md) | 以命中率评测（R2，recall@5=33.5%）为基准，验证检索注入收敛（R1，权衡后维持 topK=5/maxContextChars=12000）与中文分词 jieba（R3 全面略降，维持 bigram），落盘三项结论 |
| 2026-09-02 | — | [plan-retrieval-experiment.md](plan-retrieval-experiment.md) | 受控实验评估检索策略：P1 minRag=1 采纳（消除 0 检索、成本最优）；P2 专名 boost 与 P3 grep 不采纳；P5 双工具不采纳但保留末位强制作答轮 |
| 2026-09-02 | — | [plan-rules-prefix.md](plan-rules-prefix.md) | R4 规则前缀（检索词引导）A/B/off 三组实测，结论暂不采纳；默认基准调整为 qwen + thinking=off + 取消限流 |
| 2026-09-02 | — | [plan-hy3-rag-bench.md](plan-hy3-rag-bench.md) | 搭建基于腾讯混元 Hy3（TokenHub）的简化版查询 Agent 成本基准：架构落地 + 真实 low 档 20 题全量运行，验证思考 token 计入输出且随题目难度分化（off/high 全量经验收条件修订不再补跑） |
| 2026-09-02 | — | [plan-qwen37-flash-bench.md](plan-qwen37-flash-bench.md) | qwen3.7-flash 接入 bench（Provider 参数化）：输出成本约为 hy3 的 1/5，但检索更少、编造倾向更强，成本-可靠性权衡落盘（全量补跑经验收条件修订不再执行） |
