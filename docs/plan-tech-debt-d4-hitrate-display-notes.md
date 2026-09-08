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
