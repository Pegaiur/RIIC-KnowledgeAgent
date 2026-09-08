# 引导指令证据忠实度与补读时机优化计划

> 创建日期：2026-09-08
> 状态：实施完成，待发版归档
> 需求入口：[inbox](inbox.md)

## 目标

把 `knowledge/AGENTS.md` 的抽象决策契约改写为简短、可执行的取证与作答规则，提高对已有工具证据的忠实度，并明确何时用 `read_section` 补读；不以增加工具调用次数为目标。

## 非目标

不改检索排序、分词、topK、切块、知识事实、工具展示或协议、预算、模型与 agent loop；不加强制阅读、固定自检轮次、独立审核模型或新配置体系；不写入当前测试题的具体事实、问法或预期答案。本计划只准备真实对照材料，不发起付费模型请求。

## 架构分析

`knowledge/AGENTS.md` 是所有检索模式唯一的人工指令源，运行时只按实际模式附加能力块。小节导航实跑观测（Qwen off/t0/hybrid/预算 5，4 题各一次）：3 次 `rag_search`、1 次 `facts_search`、0 次 `read_section`；存在条件改写、把“初始解锁”解释成“精英 1 即可使用”、声称“6 名”却只列 5 人。相关证据大多已由检索直接送达，补读与分页的实际收益尚未证明，因此本轮只改写人工规则，不改能力与策略开关。

## 实施方案

1. **记录需求与计划**：在 `docs/inbox.md` 登记并落本计划；实施完成后按实际结果勾选验收清单。
2. **重写人工指令**：`knowledge/AGENTS.md` 收束为三段短规则——取证、忠实原文、作答。保留领域范围、工具分流（完整词条事实 → `facts_search`，机制/组合 → `rag_search`，已定位小节缺口 → `read_section`）、独立事项拆分、逐项对应证据、证据足够直接作答；新增条件保留（仅/除外/达到后停止/解锁/替换等）、检索名单与完整名单区分及人数一致、`read_section` 的 `next_offset`/`complete=false` 语义、结论＋关键条件的作答格式。
3. **保存指令快照**：改动前后 `knowledge/AGENTS.md` 存入 `dev-temp/work/guided-evidence-test/snapshots/` 并记录指纹，保证后续固定模型、预算、检索与语料做对照。
4. **冻结对照材料**：dev 4 题（已知样例）与 4 道未参与指令设计的留出题（覆盖条件保留、解锁/替换、名单与证据缺口）写入 `questions-dev.json`、`questions-holdout.json`；`freeze.json` 记录冻结时间、指纹与固定配置。留出题在任一候选方案输出前写定，不传参考答案或预期工具路径。
5. **准备对照运行**：提供 `run-compare.mjs`（切换指令快照 → 跑 CLI → 还原）与 README 中的命令/handoff 说明；两方案各跑 8 题一次，共 16 次 query，本任务不执行。
6. **匹配检查**：运行 `node scripts/doc-check.mjs`、`pnpm run typecheck`、`pnpm run test`；不重复历史全量验收或合并门禁。

## 验收清单

- [x] `knowledge/AGENTS.md` 改写为简短可执行的取证与作答规则，保留领域范围、工具分流、条件保留、名单一致性、read_section 与停止条件
- [x] 唯一人工指令源不变，运行时代码未新增第二份行为提示
- [x] 改动前后指令快照已保存，固定对照配置已记录
- [x] dev 4 题与 4 道留出题已就绪，留出题在候选方案输出前冻结
- [x] 对照运行命令与 handoff 说明已准备，本任务未发起付费模型请求
- [x] `node scripts/doc-check.mjs`、`pnpm run typecheck`、`pnpm run test` 通过

## 关联 ADR

- [ADR-004](adr/ADR-004-query-agent-knowledge-layering.md)：继续由 `knowledge/AGENTS.md` 唯一承载人工查询契约。
- [ADR-008](adr/ADR-008-section-navigation.md)：沿用 `read_section` 接口与分页语义。
- 本轮仅改写人工规则措辞，不改跨模块接口、宿主循环或工具协议，无需新建 ADR。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
