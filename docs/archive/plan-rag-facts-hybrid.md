# RAG 与 facts 混合工具跑通计划

> 创建日期：2026-09-04
> 状态：已完成

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

## 实施纪要

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

> ✅ 已完成于 2026-09-04
