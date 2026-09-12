# 实施笔记：测试架构计划

> 对应 plan：docs/plan-testing-architecture.md
> 开始日期：2026-09-12

## 决策偏离

无。按用户要求补全已转换的实施计划，保留规则文本先行与增量适用范围。

## 实现调整

### 2026-09-12 — 第 1 步：建立 ADR-014 与 INDEX 登记

- **plan 原文**：按 document-lifecycle「ADR 判定与维护」取当前最大编号 +1 新建 ADR（参照 adr.md 模板），INDEX.md 追加一行；建立时为「已决策」，全部完成后两处同步为「已实施」；同步替换计划验收清单中的编号占位。
- **实际做法**：新建 docs/adr/ADR-014-testing-convention.md（状态「已决策」），在 docs/adr/INDEX.md 表尾登记 014；将计划验收清单与「关联 ADR」中的编号占位替换为 ADR-014。
- **原因**：ADR 编号已确定，保持计划可追溯一致。
- **后果**：第 5 步须将 ADR-014 与 INDEX 状态同步为「已实施」。
- **验证**：`git diff --cached --check` 通过；`node scripts/doc-check.mjs --json` 仅 13 条施工中 D1，D2/D5 零错误；首轮独立审查指出的编号占位缺项已在同一提交内修复。

### 2026-09-12 — 第 2 步：起草 docs/rules/testing.md

- **plan 原文**：新建 docs/rules/testing.md，frontmatter description 为「新增或修改 bench/src、scripts 的运行时行为，或新增、修改、删除相关测试时生效」；六组内容（覆盖对象与豁免、落位与命名、行为与回归断言、隔离与替身、数据与断言维护、验证与变更说明）分批收录；纳入存量处理原则、A/B 两段清理示例与六类变更判据；每组如实标注检查方式，API 语义依据两条 Vitest 2 文档链接。
- **实际做法**：按上述结构成文，「存量差异的增量适用」含四条处理范围、范例 A（fetch 全局替身清理）、范例 B（EXPERIMENT 前值恢复）与范例 C（旧落位/CLI/数据维护对照表）；六类变更判据独立成表；未写入未生效的候选条款。
- **原因**：检查方式尚无机械实现，全部如实标注为人工审查或现有门禁执行结果，避免条文写出 API 即被误认为已自动校验。
- **后果**：AGENTS.md 与 skills/commit-convention 按名称引用本文件（第 3、4 步），不复制条文。
- **验证**：`git diff --cached --check` 通过；`node scripts/doc-check.mjs --json` 仅 13 条施工中 D1，无新增 D3/D4/S 错误（规则内 Vitest 为外部 URL，不受引用名称约定限制）。

### 2026-09-12 — 第 3 步：AGENTS.md 与 scripts 导航、验证路由

- **plan 原文**：规则索引表新增一行指向 docs/rules/testing.md；「运行与验证」补充修改测试代码后运行全套 `pnpm run test`；「AI 代理发现流程」注明新增/修改运行时行为及新增/修改/删除测试前先读该规则；scripts/INDEX.md 目录职责追加 scripts/tests/（只在首次新增测试时实际创建）并按名称引用该规则，不复制断言规范或新增注册表。
- **实际做法**：AGENTS.md 规则索引新增第 7 行；发现流程第 2 条加入 testing.md 触发场景并注明「不等到已经决定写测试才读」；运行与验证注释补「修改测试代码后必须运行全套 `pnpm run test`（定向命令不能替代最终全套验证）」；scripts/INDEX.md 目录职责追加一行，注明不参与 task/lib 发现并引用 testing.md 名称。
- **原因**：让规则可从入口发现，避免只在已决定写测试时才读取。
- **后果**：AGENTS.md 与 scripts/INDEX.md 均只按名称引用，不复制六组条文。
- **验证**：`git diff --cached --check` 通过；`node scripts/doc-check.mjs --json` 仅 13 条施工中 D1；已人工核对 AGENTS、scripts/INDEX 到 docs/rules/testing.md 的引用存在、触发范围完整（D4 不覆盖这两处 Markdown 引用）。

## 债务记录

未新增技术债登记；计划中的存量实例用于说明规则适用方式，不作为新增补测任务清单。

## 意外发现

### 2026-09-12 — 转换后的执行边界与验收缺项

- **发现**：计划转换后遗漏副作用行为覆盖、资源清理、默认离线、存量处理与六类变更走查；仍保留过窄的模块复位限制，且高估 doc-check 对 Markdown 引用及隔离规则的检查范围。
- **影响**：已回馈 plan 的规则内容、存量处理范例、执行步骤与验收清单；未恢复原草案。实施细节以 plan 为准。

## 阻塞与解决

### 2026-09-12 — 计划补全后的文档验证

- **症状**：`node scripts/doc-check.mjs --json` 退出码为 1，仅报告本计划 13 个未勾选实施项的 D1，其他错误和警告为零。
- **根因**：本轮只完善计划，规则等交付尚未完成。
- **解决方案**：保留未勾选状态，不称文档检查全通过；`git diff --check` 已通过。仅修改 plan/notes，未重跑类型检查和测试，不沿用此前 493 用例结果冒充本轮执行。
- **预防**：后续按验收证据收束清单，再执行完整文档检查；不通过放宽 D1 或提前勾选消除施工状态。
