# 实施笔记：facts 多词条数组查询计划

> 对应 plan：docs/plan-facts-multi-term-query.md
> 开始日期：2026-09-12

## 决策偏离
> plan 中没有提到，但在实施中做出的重要决策

### 2026-09-12 — 步骤 1–2 完成后交接
- **背景**：计划步骤 1（配置通道）与步骤 2（schema 动态上限与版本）已实施并各自提交（921a765、3dd3d3e），验收清单第 1、2 项已勾选；步骤 3–9 未开始。用户要求在此交接。
- **选项**：
  - A: 当前任务继续实施步骤 3–9；
  - B: 交接给后续任务，从步骤 3 起继续。
- **决策**：按用户要求采用 B 交接。后续任务从 plan 步骤 3「参数解析与根级状态」开始；勿在过渡态跑正式基准或合并。
- **影响**：实现提交停在 3dd3d3e（本交接记录另成一笔文档提交），工作区干净；本轮未产生 dev-temp 临时产物，无需清理；未结束事项以 docs/plan-facts-multi-term-query.md（步骤 3–9 与验收清单）与 ADR-015 为准，注意「schema 已声明 queries、解析器与 description 尚未同步」的过渡态。

## 实现调整
> plan 中有描述，但实际实现方式不同

### 2026-09-12 — 步骤 1：配置项配套装配同步
- **plan 原文**：步骤 1 新增 `factsQueryListLimit` 并入 ExperimentConfig/EXPERIMENT/BenchConfig/loadConfig，validateBenchConfig 校验为正整数，并纳入 inputs 的 config 捕获。
- **实际做法**：落地时还需同步 `validateBenchConfig` 的 `Pick<...>` 形参签名与 bench/src/inputs.ts 的 `RunInputs.config` 类型字段，否则类型检查不通过；两处均按 plan 语义补齐，无行为差异。
- **原因**：plan 未逐字枚举这两处纯类型装配点。
- **后果**：无下游文档需更新；步骤 2 将消费同一 config 字段。

### 2026-09-12 — 步骤 2：动态 maxItems 的实现方式与签名
- **plan 原文**：步骤 2 把 facts_search 参数改为 `queries` 并「为 toolsForRetriever / toolSchemaMetadata 增加上限入参并更新全部取用点」。
- **实际做法**：把原 `TOOL_DEFINITIONS` 常量拆为 `STATIC_TOOL_DEFINITIONS`（rag_search/read_section）与 `factsSearchDefinition(limit)` 构建器；`toolsForRetriever` 与 `toolSchemaMetadata` 的首参去掉了原 `= 'hybrid'` 默认值，两参均改为必填（上层调用方本就传 retriever）。
- **原因**：maxItems 需随配置动态生成，静态常量无法承载；且 TypeScript 不允许必填参数跟在带默认值的可选参数之后，故不能只给上限加默认值而保留 retriever 默认值。
- **后果**：测试取用点（agent.test.ts、facts-tools.test.ts、tool-executor.test.ts、runner.test.ts）随签名更新传入上限；步骤 3 将让解析器接受 `queries`，闭合 schema 与执行的一致性。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项（纯权衡取舍、无遗留债务的决策记入「决策偏离」）
> 可定位到代码的债务须在代码处写 `TODO(tech-debt) <编号>：` 注释（AGENTS.md 编码核心约束 #5），此处只记编号、结论与未来偿还条件

## 意外发现
> 实施中发现的 plan 未覆盖的依赖/边界/风险

### 2026-09-12 — 步骤 1：「inputs/meta」中的 meta 需单独接线
- **发现**：plan 步骤 1 措辞「供 inputs/meta 直接核对实际生效上限」包含 meta；但 runner.ts 的 meta.json 投影与 snapshot.ts 的 META_ALLOWED_KEYS 各自维护字段白名单，仅改 inputs 捕获不会让该字段出现在 meta 或共享快照中。
- **影响**：已同步在 runner.ts meta 投影与 snapshot.ts META_ALLOWED_KEYS 登记 factsQueryListLimit，并补 runner.test.ts、snapshot.test.ts 断言；plan 验收清单首条补记「meta 投影」。不涉及架构决策，无需新建 ADR。

### 2026-09-12 — 步骤 2：schema 与执行、描述的过渡态
- **发现**：步骤 2 只改 schema 与版本（10→11），解析器仍只接受单个字符串 `query`（步骤 3 才改），tool description 也仍写「用一个完整词条」（步骤 6 更新）。因此本提交后，模型看到的是 `queries` 数组参数，但执行器对该形态仍会判 invalid_params。
- **影响**：这是计划顺序决定的过渡态，非缺陷；步骤 3 完成后 schema 与执行一致，步骤 6 再统一描述与指令。已以显式取值（非默认上限）覆盖 maxItems 动态派生与不同配置互不污染。

## 阻塞与解决
> 遇到的阻塞问题及解决方案
