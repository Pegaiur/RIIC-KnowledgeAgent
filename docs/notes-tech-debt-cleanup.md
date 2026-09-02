# 实施笔记：技术债治理一轮（repo 结构整理）

> 分支：feature/tech-debt-cleanup
> 开始日期：2026-09-02
> 依据：skills/tech-debt-governance（三维度扫描 → 双 agent 交叉审查 → 只做 ROI「立即」项，其余记 backlog/不修）

## 决策偏离

- **本分支无对应 spec/plan**（独立清理轮）：按 tech-debt-governance 技能以仓库既有生产代码（bench/src、scripts/**）为工作范围，head-diff 相对 main 为空（新分支），故不按分支增量，改为全仓扫描。
- **只做 ROI 判定「立即」的收敛**（成本低、零行为变化、既有测试在位），大重构记 backlog，避免为抽象而抽象。

## 实现调整

本轮落地的低风险收敛（均为零行为变化/纯类型/去死代码）：

- `types.ts`：新增 `isRetrievalTool` 谓词——替代 agent/report 中散落的硬编码 `name === 'rag_search' || name === 'grep_search'` 字符串谓词（单一事实源）。
- `retriever.ts`：导出 `IndexEntry`；`report.ts`：导出 `BenchReport`——替换跨模块 `ReturnType<typeof buildIndex/aggregate>` 的类型泄漏（类型收紧，additive 非破坏）。
- `agent.ts`：删除 `AgentOptions.chunks/index` 死字段（runQuery 实际走位置参数，opts 内字段从未消费）；循环内 `usedTools` 一次派生供 `records.tools` 与 `toolTrace` 复用。
- `runner.ts`：`agentOpts` 不再冗余传 `chunks/index`。
- `cli.ts`：合并 `--out` 四分支为单分支；hitrate 上下文参数串提为局部 `contextLine`。

## 债务记录

- **backlog（近期，未做）**：
  - A1 `agent.ts runQuery`（129 行）上帝函数重构——需检索门面承载两套注入语义（grep 全量命中实注入 vs rag 按 maxContextChars 预算判定），中风险，不宜与合并前零行为收敛混批。
  - A2 `report.ts aggregate`（93 行）模板虚高——可提局部 `groupBy/sum` 助手。
  - D1 `hitrate` 结果落 `bench/runs/<ts>-hitrate/`（可复现，当前仅 stdout/--out）。
  - D4 `hitrate` 逐题补渲染 precision/nDCG 列（数据已在 `QuestionHit` 算好，仅渲染未暴露）。
- **不修（依据「避免为抽象而抽象 / 受控对照契约 / 依赖方向单向 / 测试基建债成本低收益低」）**：
  - scripts 侧 `main()` 骨架、`isMain` 样板（9 处）——isMain 恰是脚本可被 import 无副作用的前提；抽公共引导层属为样板而抽象。
  - 退出码常量 / 正整数校验 / `today()` 跨基准与脚本域统一——违反依赖方向单向；`today()` 双实现实为时间戳与 runTag slug，非漂移副本。
  - function-calling 形状三处定义——请求侧定义 / wire 形状 / 内部归一键，职责不同，强行统一会抽象泄漏。
  - `BenchConfig` 上帝对象（22 字段）——项目规模小，单对象扁平反而省事。
  - `pricing.ts` 兼容别名（`PRICE_*_PER_M` 从 `HY3_PRICES` 派生）——仅供测试断言引用，属测试基建债。
  - `retriever.ts` 依赖全局 `EXPERIMENT`——项目刻意"集中配置、改值全局生效"设计（不读 env 防 shell 残留污染），全局单例是特性非缺陷。
  - `rate-limiter` 模块级单例——全程共享的有意全局节流，当前 `RATE_LIMIT_RPM=100000` 实际不限速。
  - `tokenizeBigram` 与 grep 词元化统一——二者**语义刻意不同**（BM25 词袋加权 vs 字面命中计数），统一会破坏 P3 对照契约与 grep-retriever 测试断言。
  - grep 侧加 entityBoost 词表开关——与 grep-retriever"无 IDF 加权、受控对照"设计矛盾，且 `entityBoost` 已是死开关（P2 未采纳，默认 0）。

## 意外发现

- **注入覆盖率与 hitrate 是两条测量管线**：覆盖率（基于一次 agent run 的 `injected.json`，测"实测注入了什么"）与 hitrate（基于 `gold.json`，测"检索质量 recall/precision/nDCG"）职责不同；覆盖率计算脚本仍在 `dev-temp`（gitignore 不入库）。**不建议**把覆盖率并入 hitrate 工具（职责混淆），如需复现应作为独立工具入库。
- **repo 结构本身较干净**：`dev-temp` 已 gitignore；`docs/` 的 draft/notes/archive 分层清晰；语料 `arknights-base-vault/docs` 按 0-规则/2-体系/4-散件分目录合理，无需大规模重排。

## 验证

- 本轮改动：`pnpm run typecheck` 通过、`vitest` 60/60 通过、`pnpm run build` 通过；改动为纯类型/零行为变化/去死代码。
