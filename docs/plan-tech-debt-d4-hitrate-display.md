# D4 hitrate 逐题指标展示计划

> 创建日期：2026-09-08
> 状态：施工中
> 需求入口：[inbox](inbox.md)

## 目标

在现有 `HitrateResult` 已计算 precision@K 与 nDCG@K 的基础上，补齐 Markdown 逐题明细展示，便于逐题审计。

## 非目标

- 不修改 recall、precision、nDCG 的计算口径、排序或检索实现。
- 不新增 hitrate 默认落盘，不改变 JSON 结构、题集或 `--out` 行为。
- 不处理 R5-2、D1、A2 或其它技术债。

## 架构分析

`runHitrate` 已在 `QuestionHit` 中保存 `hits`、`precHits`、`precSlots` 和 `ndcg`，但 `renderHitrate` 的逐题表只读取 recall 与 miss。该债务是展示层缺口，不需要改变数据模型或检索管线。

## 实施方案

1. 在逐题表中按 `topKs` 原顺序为每个 K 展示 recall、precision 和 nDCG；precision 使用 `precSlots` 作分母，0 槽位显示 0。
2. 保留题目、golden 数和 miss 位次信息；补充现有 hitrate 测试覆盖自定义 topK、0 槽位、非零 precision 及 miss 保留。
3. 移除代码中的 D4 技术债标记，笔记登记编号及关闭结论。

## 验收清单

- [x] 逐题明细按自定义 `topKs` 展示 recall、precision、nDCG
- [x] 0 槽位 precision 显示为 0，原 miss 信息保留
- [x] `bench/tests/hitrate.test.ts` 覆盖新增 Markdown 输出
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] `node scripts/verify.mjs merge -- --base main` 全通过

## 关联 ADR

- 无。该变更为单模块展示层补全，不改变公共协议或依赖方向。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
