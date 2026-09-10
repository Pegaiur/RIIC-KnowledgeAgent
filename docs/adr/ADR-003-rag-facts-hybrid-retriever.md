# ADR-003：新增 RAG 与 facts 混合检索模式

- 日期：2026-09-04
- 状态：已实施

## 背景

现有 `RetrieverId` 将散文 RAG 与 facts 记录卡查询互斥：`bm25` 暴露 `rag_search`，`facts` 暴露 `lookup/query_operators`，`both` 仅组合 BM25 与 grep。分支收敛前需要验证同一个 Agent 能在一次对话中同时调用机制语料与事实记录卡工具。

## 决策

新增向后兼容的 `hybrid` 检索模式，同时暴露 `rag_search`、`lookup` 与 `query_operators`。三者共享现有 `MAX_RAG_CALLS=2` 预算；`both` 的既有 BM25 + grep 语义不变。混合模式加载白名单语料并按需惰性读取 facts 卡片。

## 理由

新增显式模式不会改变既有实验组语义，调用方可以清楚区分纯 RAG、纯 facts 与混合查询。复用现有工具实现和统一预算即可完成端到端验证，无需新增依赖或改动 `runQuery` 签名。

## 备选方案

- 改写 `both` 为 RAG + facts — 放弃原因：会破坏既有 BM25 + grep 对照语义。
- 把 facts 工具无条件加入所有模式 — 放弃原因：污染既有基准组，无法保持历史结果可比。

## 后果

CLI 的 `--retriever` 增加 `hybrid` 可选值；系统提示必须明确三类工具分工。混合模式的两次共享预算意味着复杂问题最多进行两次工具调用，后续只有真实证据显示不足时才另行调整。

## 关联

- 规划文档：`docs/archive/plan-rag-facts-hybrid.md`
