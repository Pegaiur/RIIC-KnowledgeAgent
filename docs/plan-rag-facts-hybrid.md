# RAG 与 facts 混合工具跑通计划

> 创建日期：2026-09-04
> 状态：施工中

## 目标

新增 `hybrid` 检索模式，使同一个查询 Agent 同时获得 BM25 机制语料检索与 facts 精确查询能力，并使用默认 Qwen、关闭思考完成真实端到端工具调用冒烟。

## 非目标

- 不改变 `both` 的 BM25 + grep 既有语义。
- 不调整默认检索器、工具预算、模型、价格或问题集。
- 不评估答案质量或运行全量成本基准；本轮只验收工具发现、调用、结果回填和最终作答。

## 架构分析

工具执行与消息回填已经按工具名统一派发，缺口仅在检索器枚举、工具暴露、混合系统提示和验证入口。新增显式模式可以复用既有实现，同时保持历史实验配置不受影响。

## 实施方案

1. 扩展 `RetrieverId` 与 CLI 帮助，新增 `hybrid`，混合模式继续加载白名单语料。
2. 为混合模式暴露 `rag_search/lookup/query_operators`，补充工具分工提示，沿用两次共享预算。
3. 增加单测与 dry 回归，验证 RAG 和 facts 的工具结果均回填到第二轮消息。
4. 以默认 Qwen、`thinking=off` 运行单题真实冒烟，核对运行记录中的工具序列与最终回答。

## 验收清单

- [x] `hybrid` 同时暴露并派发 `rag_search/lookup/query_operators`
- [x] 混合模式单测和 dry run 通过
- [x] 默认 Qwen、关闭思考的真实单题工具调用通过
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] `pnpm run build` 全通过

## 关联 ADR

- ADR-003 — 新增 RAG 与 facts 混合检索模式

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan docs/plan-rag-facts-hybrid.md --apply）时替换此行，标记完成日期 -->
