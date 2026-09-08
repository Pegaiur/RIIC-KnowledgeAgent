# D4 hitrate 逐题指标展示计划

> 创建日期：2026-09-08
> 状态：已完成
> 需求入口：[inbox](../inbox.md)

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

## 实施纪要

# 实施笔记：D4 hitrate 逐题指标展示

> 对应 spec：docs/plan-tech-debt-d4-hitrate-display.md
> 开始日期：2026-09-08

## 决策偏离

### 2026-09-08 — 采用单 K 紧凑指标单元
- **背景**：逐题表需要同时增加 precision 与 nDCG，并继续支持任意数量的自定义 topK。
- **选项**：
  - A: 每个 K 拆成 recall、precision、nDCG 三列，表格随 K 数量快速变宽。
  - B: 每个 K 保留一列，在单元中按固定顺序展示 recall、precision、nDCG。
- **决策**：选择 B，保持自定义 topK 下表格可读，并不改变结果对象。
- **影响**：Markdown 逐题输出格式变化；既有汇总表、计算结果和 miss 文本保持不变。

## 实现调整

## 债务记录

### 2026-09-08 — D4 逐题 precision/nDCG 展示
- **债务**：D4 已偿还；逐题明细现在读取并展示既有 `QuestionHit` 指标。
- **未来偿还**：无。

## 意外发现

### 2026-09-08 — 展示回归验证
- **发现**：现有 `QuestionHit` 已足够支撑逐题展示；无需修改结果类型、计算函数或检索排序。
- **影响**：使用内存合成结果核对自定义 `topKs=[1,4]`、0 槽位 precision、非零 precision 与视野外 miss；输出符合计划，无需新增 ADR。

## 阻塞与解决

> ✅ 已完成于 2026-09-08
