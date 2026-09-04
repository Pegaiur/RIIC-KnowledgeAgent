# 实施笔记：RAG 与 facts 混合工具跑通计划

> 对应 spec：`docs/plan-rag-facts-hybrid.md`
> 开始日期：2026-09-04

## 决策偏离

> 暂无。

## 实现调整

- 2026-09-04：新增 `hybrid` 检索器，复用现有 BM25 索引、facts store 和统一工具调用预算；保留 `both` 为 BM25 + grep。

## 债务记录

> 暂无。

## 意外发现

- 2026-09-04：验收需求是同一 Agent 的“RAG + facts”，而原 `facts` 模式只暴露两项记录卡工具，因此不能用既有模式直接完成真实冒烟。
- 2026-09-04：单测、类型检查与构建通过；全量测试为 18 个文件、165 个用例。单题 dry 使用 `hybrid` 按顺序调用 `rag_search` 与 `lookup` 后完成作答。
- 2026-09-04：真实探针未显式传 `--provider` 或 `--thinking`，元信息确认使用默认 `qwen3.7-flash`、`thinking=off`。首轮同时调用 `rag_search` 与 `lookup`，第二轮完成作答；共 2 次 LLM 调用、638 输出 token、0 reasoning token、0 失败、0 截断，总成本 ¥0.001089。
- 2026-09-04：真实答案正确区分机制语料与刻俄柏记录卡；末段把“心情每小时消耗 -0.25”概括为“心情恢复效率”措辞不严谨，但不影响本轮仅验收工具链路的结论，答案质量另行评测。

## 阻塞与解决

- 2026-09-04：`node scripts/verify.mjs merge -- --base main` 的类型检查与 165 个测试通过；文档一致性仍被上游 `docs/plan-hybrid-facts.md` 的 6 个未完成验收项阻塞。本轮不代勾尚未执行的参考要点重制、人工抽检与评测结论。
