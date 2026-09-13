# facts 多词条数组查询计划

> 创建日期：2026-09-12
> 状态：已完成

## 目标

把 facts_search 的入参从单个字符串 `query` 改为简单字符串数组 `queries`，一次查询多个完整词条：逐词分段返回并提供结构化逐项状态，跨词同卡去重，整批仍按一次调用结算成功额度。目的是让多具名对象的取证只需一次工具调用。

## 非目标

- 不引入自然语言解析、分词、模糊匹配、子串兜底或复合条件；沿用 ADR-007 的精确词条边界，数组不是复合过滤语法。
- 不按词数扣成功额度；不改动 RAG 内部 facts 附带（buildFactsAttachment）与底层 store.factsSearch 的单次语义。
- 首版不新增分页/截断/字符上限机制——上限只约束词数，不代表输出容量上限（见「输出容量边界」）；若未来增加，须同时重定义 `complete` 与送达计数。
- 不把「具名干员必须调用一次 facts」的强制取证策略并入本计划，该策略独立评估、独立交付。
- 不承诺 token、费用或回答质量收益，不以评测分数作为依据；不新增哈希/指纹字段。

## 架构分析

### 现状与痛点

- 工具 schema 的 facts_search 只声明单个字符串 `query`（additionalProperties false）：bench/src/tool-executor.ts 的 TOOL_DEFINITIONS；当前 `TOOL_SCHEMA_VERSION = 10`。
- parseToolParams 对 facts/rag 共用分支，硬编码 `allowedKeys = ['query']` 并经 parseRequiredString 拒绝非字符串，数组会整条判 invalid_params；bench/tests/facts-tools.test.ts 现有用例显式断言这一点。
- 底层 store.factsSearch(query: string) 只接受单字符串，返回 `{ query, paths, matches }`，按 canonical 稳定去重；它没有 topK 或字符上限，单词宽查可全量返回（facts-tools.test.ts 的 U08）。
- 结算在 executeOne / executeBatch：一次调用「检查上限 → 获准 → 执行 → 结算」，仅 executed 且 status==='success' 时扣 1 点；facts 状态由 hitIds.length>0 决定 success/empty，空查不扣点；异常走 error + fatal。FactsResultMetadata 现含 `factsResultVersion`（当前 5）、`matchedCount`、`returnedCount`、`complete`、`scope = parsed.value`、`resolution`。

### 可复用与边界

buildFactsAttachment 已实现「逐词查询 + 跨词 canonical 去重（deliveredSet）+ 逐词块渲染」，可参考其去重思路；但它没有「逐张重复卡列名」与「首次分段引用」，不能直接视为已实现本计划的返回契约，需新写序列化。

### 预期效果（措辞边界）

executor 已支持同一模型响应内多个 tool_calls。当多个原本独立的词条查询被合并时，数组化减少工具调用条数，但不一定减少模型往返（取决于模型是否本来就同批发起），也不能直接保证少漏查。改善覆盖是待观测的预期，不是承诺。

## 实施方案

按依赖顺序实施；每步给出输入、输出与验收口径。

### 1. 配置通道（bench/src/config.ts）

- 输入：现有 ExperimentConfig/EXPERIMENT 常量与其默认值。
- 输出：新增 `factsQueryListLimit`（默认 3），并入 ExperimentConfig、EXPERIMENT、BenchConfig、loadConfig；validateBenchConfig 校验为正整数（与 toolBudget/attemptLimit 同口径）；同步把 `factsQueryListLimit` 纳入 bench/src/inputs.ts 的 config 捕获（第 160-194 行，对齐 toolBudget/toolAttemptLimit 的登记口径），供 inputs/meta 直接核对实际生效上限。
- 验收：默认值生效；非正整数被拒绝并给出中文错误；inputs 捕获中可见该字段。
- 边界：tool description 与 knowledge/AGENTS.md 不得硬编码「最多 3 个」，改用「受运行配置限制」之类表述。

### 2. Schema 动态上限与版本

- 输入：配置 `factsQueryListLimit`、现有 toolsForRetriever/toolSchemaMetadata。
- 输出：facts_search 参数改为 `queries`（`type: 'array'`，`items` 非空字符串，`minItems: 1`，`maxItems` 由配置派生）；`TOOL_SCHEMA_VERSION` 10→11；为 toolsForRetriever / toolSchemaMetadata 增加上限入参并更新全部取用点：bench/src/agent.ts（第 153 行）、bench/src/runner.ts（第 78-79 行）及 toolSchemaMetadata 内部调用。
- 验收：不同 `factsQueryListLimit` 生成不同 maxItems；先后以不同配置生成 schema 互不污染（无跨配置缓存残留）；工具 schema 指纹随配置变化符合预期；inputs 捕获值与实际生效上限一致。

### 3. 参数解析与根级状态

- 输入：tool call 的 arguments。
- 输出：仿 parseReadSectionParams 拆出 facts 专用分支。
  - 根级非法（非对象、缺 `queries`、`queries` 非数组、额外字段、超上限、空数组）→ 整批 invalid_params，不执行。
  - 元素级非法（非字符串、去空白后为空）→ 逐项记为 invalid，合法元素继续执行。
  - 上限按**原数组长度**检查：不得先过滤非法项或去重再计长度。
  - 合法元素为 0（全非法或空数组）→ 整批 invalid_params。
- 验收：合法元素被 trim 后保留内部空格与标点；原数组索引与逐项记录可对应。

### 4. 执行、去重与引用定位

- 输入：解析后的合法词条列表与 context。
- 输出：
  - **原子性**：先在局部组装全部结果，全部查询成功后统一返回；中途 store 抛错整次失败，沿用 error + fatal，不留下部分注入记录、不扣成功额度，但占用一次获准尝试。不得因元素级容错而吞掉 store 异常。
  - 逐词分段**按输入顺序**产出；段内卡顺序沿用 store 稳定顺序。
  - **去重范围仅限本次 facts_search**：不因之前 RAG 或 facts 已返回过某卡就省略本次正文。首现段返回完整卡，后续段命中的同一 canonical 只列名称、省略正文。
  - **重复词**仍保留各自分段，按 trim 后词条在本次调用内复用查询结果，不重复查询底层；不同词条即使命中相同 canonical 也分别查询，以保留各自路径。
  - 原数组每个元素均占一个分段，非法项为错误提示段；交叉引用用「第 N 段」，N 固定为原数组零基索引加一，避免两个同名词段无法区分。
- 验收：重复词、别名重叠、跨调用重新返回完整卡三类场景的段序、去重与引用均可复现。

### 5. 结果契约与元数据

- 输入：逐词查询结果与逐项状态。
- 输出：
  - **逐项结构化记录**唯一存放在 `FactsResultMetadata.resolution.items`，随既有序列化展开到 tool 消息根级的 `resolution.items`，trace 的 writtenContent 使用同一消息。每项固定包含 `index`（原数组零基索引）、`query`（合法词条 trim 后字符串；非法项为 null）、`status`（success / empty / invalid）、`paths`（该词完整 ResolutionPath 数组）、`canonicals`（该词全部命中 canonical，沿 store 顺序去重）、`message`（非法项的中文错误原因；合法项为 null）。empty / invalid 的 canonicals 为空；invalid 的 paths 为空；empty 的 paths 保留 store 返回值，允许存在有路径但无卡的合法词条。
  - **根级 status**：
    - 有命中 → `success`，扣一次成功额度；
    - 合法词全部未命中（即使夹有非法元素）→ `empty`；
    - 没有合法元素 → `invalid_params`。
  - `complete` 明确**只表示本次合法词条命中的卡已完整送达**，不得理解为全部输入均成功。
  - `matchedCount` / `returnedCount` 取跨词并集去重后的 canonical 数量。
  - `scope` 保持对象外壳：`scope: { queries: [...] }`，值取 trim 后的合法词条，按输入顺序保留重复项；`actualParams` 使用同一规范化参数对象，不混入解析器内部状态。原始输入由调用 arguments 保留，逐项状态经原数组索引关联。
  - v6 使用 `resolution: { items: [...] }` 替代 v5 的 `resolution: { paths: [...] }`；不再并存根级 paths 或另一份逐项列表。items 与原数组一一对应，保留重复词、空结果和非法项；每项 canonicals 包含跨词重复卡，总计数及 hitIds / injectedIds 才取并集，按首次出现顺序排列。
  - 元数据仅在整次执行返回 success / empty 时提供，二者 complete 均为 true。全非法、空数组及其他根级参数错误返回 invalid_params、executed=false，仅给中文错误消息，不返回 factsResultVersion / scope / resolution / complete / 计数 / hitIds / injectedIds；全非法时消息逐项列出原索引和原因。运行时异常返回 error、executed=true、fatal=true，同样不返回上述证据字段或局部逐项结果。预算拒绝沿用原行为、不进行逐项解析。获准的参数错误或运行时异常均占一次尝试，不扣成功额度。
  - `FACTS_RESULT_VERSION` 5→6；历史结果按原版本仍可读。
- 验收：混合非法与空结果、重复词段、并集计数、scope 外壳与逐项索引均与契约一致；trace/report 等消费方同步。

#### 消息形状示例

以下为协议测试的合成夹具，不代表真实知识事实。输入为 `{"queries":[" 示例甲 ",null,"示例甲"]}`，夹具 store 为「示例甲」返回一张正文为「夹具完整正文」的卡；假设调用前剩余成功额度为 5。完整 tool 消息示例如下；内部 hitIds / injectedIds 均为 `["示例甲"]`，actualParams 为 `{"queries":["示例甲","示例甲"]}`。

```json
{
  "status": "success",
  "executed": true,
  "data": "第 1 段｜示例甲｜命中 1 张\n精确：干员正式名\n示例甲：夹具完整正文\n\n第 2 段｜参数错误：第 2 项必须是非空字符串\n\n第 3 段｜示例甲｜命中 1 张\n精确：干员正式名\n示例甲（已在第 1 段返回，此处仅列名）",
  "budget_remaining": 4,
  "factsResultVersion": 6,
  "matchedCount": 1,
  "returnedCount": 1,
  "complete": true,
  "scope": { "queries": ["示例甲", "示例甲"] },
  "resolution": {
    "items": [
      {
        "index": 0,
        "query": "示例甲",
        "status": "success",
        "paths": [{ "kind": "exact", "category": "operator", "term": "示例甲", "memberIds": ["示例甲"] }],
        "canonicals": ["示例甲"],
        "message": null
      },
      {
        "index": 1,
        "query": null,
        "status": "invalid",
        "paths": [],
        "canonicals": [],
        "message": "第 2 项必须是非空字符串"
      },
      {
        "index": 2,
        "query": "示例甲",
        "status": "success",
        "paths": [{ "kind": "exact", "category": "operator", "term": "示例甲", "memberIds": ["示例甲"] }],
        "canonicals": ["示例甲"],
        "message": null
      }
    ]
  }
}
```

正文示例约束段序、完整正文仅首现、后续列名及引用归属，不要求生产 renderer 逐字使用夹具文案；路径类别与 memberIds 继续遵循 store 类型。

### 6. 指令同步

- 输入：knowledge/AGENTS.md 第 3 条、tool description。
- 输出：说明可一次传多个完整词条、每项仍是完整词条、不拆词/不解析句子或复合条件、上限受配置约束（不写死数字）。
- 同步 bench/src/tool-executor.ts 的 exampleFor：facts_search 错误提示示例改为 `{"queries":["完整词条"]}`；rag_search 和 read_section 保持各自现行参数示例。
- 验收：指令与 description 无「最多 3 个」硬编码，未引入自然语言解析语义。

### 7. 测试（TDD 先行）

- 先写表达预期行为的失败用例，再实现使其转绿。优先覆盖：
  - 混合非法与空结果（合法词全未命中但夹非法 → empty；有命中夹非法 → success）；
  - 中途 store 抛错（整次 error + fatal、无部分注入、不扣成功额度、占一次获准尝试）；
  - 重复词与别名重叠（分段保留、引用可区分、底层不重复查询）；
  - 跨调用重新返回完整卡（去重仅限本次调用）；
  - 非默认上限贯通（模型收到的 schema、executor 校验、inputs 捕获值与 meta 一致，且不同配置 schema 互不污染）；
  - 同步既有版本/指纹断言：bench/tests/tool-executor.test.ts 的 `toolSchemaVersion: 10`（第 52 行）与 sha 断言（第 53-54 行）、bench/tests/runner.test.ts 的 `toolSchemaVersion: 10`（第 34 行），以及 toolsForRetriever 的测试取用点（agent.test.ts 第 22 行、facts-tools.test.ts 第 455 行、tool-executor.test.ts 第 27/37 行）；inputs.test.ts 的合成版本夹具不随真实版本变化；
  - 旧版本结果读取：v5 的 resolution.paths 仍可读，v6 的 resolution.items 按原索引解析，当前输出不同时携带两种结构；
  - 新入口 `{"queries":["词"]}` 接受；保留 facts-tools.test.ts 旧 `{"query":["词"]}` 拒绝用例，并补旧 `{"query":"词"}`、两个字段同时出现及 queries 非数组的拒绝断言；
  - 空数组、全非法、恰好上限、超过上限；含非法项或重复项的超限数组仍整批拒绝且不查询 store；
  - 全非法 / 根级参数错误 / 运行时异常不伪造证据元数据；混合项消息与 trace 保留 index、query=null、中文原因、逐词路径及 canonical，非法段占位后的重复段引用仍正确；
  - 参数错误示例推荐新的 queries 数组，rag_search / read_section 示例不被误改。
- 验收：新增/修改用例先红后绿；修改测试后运行全套 `pnpm run test`。

### 8. 输出容量边界评估（离线）

- 输入：宽查（设施/职业词）与低重叠组合的本地语料。
- 输出：离线检查最终序列化字符量的记录，明确接受「上限只约束词数、不代表输出容量上限」这一边界。
- 验收：记录宽查组合的实际字符量；首版维持完整返回，不引入分页/截断。

### 9. 验证

- `pnpm run typecheck` 与全套 `pnpm run test` 通过；`node scripts/doc-check.mjs` 通过。

## 验收清单

- [x] 配置项 factsQueryListLimit 集中于 EXPERIMENT 并贯通 BenchConfig/loadConfig/validateBenchConfig/inputs 捕获与 meta 投影，非正整数被拒绝
- [x] facts_search 参数为 `queries: string[]`，maxItems 动态取自配置；不同配置的 schema 互不污染
- [x] 工具 description 与 knowledge/AGENTS.md 未硬编码上限数字，未引入自然语言解析或复合条件
- [x] 根级状态符合契约：有命中 success 扣 1 点；合法词全部未命中（含夹非法元素）empty；无合法元素 invalid_params
- [x] 元素级非法只记为该项 invalid 并继续其余合法词；上限按原数组长度检查
- [x] 新 queries 数组接受；旧 query 两种形态、双字段、非数组、空数组、全非法及原长度超限均按契约拒绝，并覆盖错误示例迁移
- [x] 逐项结构化记录（原索引、规范化词条、状态、命中路径、canonical 列表）可供统计区分全量与部分失败
- [x] v6 仅以 resolution.items 承载逐项记录；非法项 query=null 且带中文原因；非法项占段，段号为 index+1；参数错误和运行时异常不返回证据元数据
- [x] 中途 store 抛错为整次 error + fatal，无部分注入、不扣成功额度、占一次获准尝试
- [x] 逐词分段按输入顺序、卡顺序沿用 store；重复词保留分段；交叉引用用「第 N 段」
- [x] 去重仅限本次调用，不因之前 RAG/facts 返回过而省略正文；首现完整、后续仅列名
- [x] `complete` 语义为「合法词条命中的卡已完整送达」；matchedCount/returnedCount 取并集
- [x] scope 为 `{ queries: [...] }` 对象外壳，值为 trim 后合法词条，逐项经原索引关联
- [x] FACTS_RESULT_VERSION 与 TOOL_SCHEMA_VERSION 递增，历史结果仍可读，trace/report 消费方同步
- [x] 混合非法与空结果、中途抛错、重复词与别名重叠、跨调用重返回、非默认上限贯通、旧版本读取用例先红后绿
- [x] 宽查/低重叠组合的序列化字符量已离线记录，并接受首版完整返回的容量边界
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过

## 关联 ADR

- ADR-015 — facts 多词条数组查询（已决策）：确立 `queries` 数组形态、按调用扣点、跨词仅名去重、动态 maxItems、元素级报错与并集计数等决策。
- ADR-007 — 单词条 facts 统一入口；ADR-015 局部替代其单词条与「不解析多个条件」的决策，其余契约继续有效。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->

## 实施纪要

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

### 2026-09-12 — 步骤 3：解析分支落位与 resolution.paths 过渡契约
- **plan 原文**：步骤 3 仿 parseReadSectionParams 拆出 facts 专用分支；根级非法（非对象、缺 queries、非数组、额外字段、超上限、空数组）整批 invalid_params，元素级非法逐项记为 invalid，上限按原数组长度检查。
- **实际做法**：新增 `parseFactsParams` 与 `ParsedToolParams`（携带 `factsItems` 逐项解析记录，非法项也占位），`parseToolParams` 增加 factsQueryListLimit 入参；执行侧新增 `factsSearchOperation`，按原数组顺序逐项查询并分段渲染，重复词在本次调用内复用查询结果。步骤 3 暂保留 v5 的 `resolution.paths`（逐词路径按输入顺序汇总），待步骤 5 改为 v6 `resolution.items`。
- **原因**：若解析器先接受 `queries` 而执行侧仍读单字符串 `params.query`，会形成比现状更严重的过渡断层；plan 未逐字规定逐项解析记录由谁承载，故由解析结果携带给执行侧。
- **后果**：`resolution.paths` 的多词汇总只是过渡契约，会在步骤 5 被 items 取代；本次逐项解析记录尚未进入 wire 元数据。

### 2026-09-12 — 步骤 3：多词测试需显式提高 factsQueryListLimit
- **背景**：元素级非法的回归用例含 4 个元素，默认上限为 3，会先被根级上限拒绝而无法覆盖元素级分支。
- **实际做法**：该用例显式设 `config.factsQueryListLimit = 4`，保持 4 个元素以覆盖「非法项占原索引段」。
- **原因**：上限检查按原数组长度先于元素级校验，属计划既定顺序。

### 2026-09-12 — 步骤 4：跨词去重与引用定位落位
- **plan 原文**：首现段返回完整卡，后续段命中同一 canonical 只列名称、省略正文；重复词保留各自分段并在本次调用内复用查询；交叉引用用「第 N 段」（N 为原数组零基索引加一）；中途 store 抛错整次 error + fatal，不留下部分注入、不扣成功额度、占一次获准尝试。
- **实际做法**：在 `factsSearchOperation` 内维护调用级 `deliveredAt`（canonical → 首现段号），段内卡按 store 稳定顺序渲染，已送达卡渲染为 `名称（已在第 N 段返回，此处仅列名）`；查询缓存按 trim 后词条复用；原子性由「局部组装 + 异常冒泡到 executeOne 的 catch」保证，未新增任何共享状态写入。
- **原因**：plan 未指定引用文案，沿用 plan「消息形状示例」的措辞以保证契约样例与实现一致。
- **后果**：去重状态只存在于单次调用内，跨调用重新返回完整卡；原子性用例已锁定「无部分注入、不扣成功额度、占一次尝试」。

### 2026-09-12 — 步骤 5：v6 逐项记录取代 resolution.paths
- **plan 原文**：v6 以 `resolution.items` 承载逐项记录（index/query/status/paths/canonicals/message）；根级 `scope: {queries:[...]}`；`complete` 只表示合法词条命中的卡已完整送达；`matchedCount`/`returnedCount` 取跨词并集；`FACTS_RESULT_VERSION` 5→6；参数错误与运行时异常不返回证据元数据。
- **实际做法**：新增导出类型 `FactsResolutionItem`，`FactsResultMetadata.resolution` 改为 `{ items }`；`factsSearchOperation` 逐项产出 items（非法项 query=null、message 为非空串中文原因、paths/canonicals 为空），并移除步骤 3 的逐词 `resolution.paths` 汇总，避免两份路径真源并存；`executeOne` 以 items 填充元数据，计数沿用并集 hitIds 长度。
- **原因**：reviewer 在步骤 4 已指出汇总是过渡态且会重复 push 同一路径；本步按计划一次收口，不再保留并列结构。
- **后果**：v5 的 `resolution.paths` 历史结果不再由本运行生成；trace/report 消费方只读取 `hitIds` 与 `writtenContent` 字符串，无需改动即可继续读旧结果。

### 2026-09-12 — 步骤 6：指令、描述与示例同步，闭合过渡态
- **plan 原文**：knowledge/AGENTS.md 第 3 条与 tool description 说明可一次传多个完整词条、每项仍是完整词条、不拆词/不解析句子或复合条件、上限受配置约束（不写死数字）；exampleFor 的 facts_search 示例改为 `{"queries":["完整词条"]}`，rag_search 与 read_section 保持各自现行示例。
- **实际做法**：knowledge/AGENTS.md 第 3 条改写为「可一次传入多个完整词条，每项仍须是完整词条；不拆词、不解析句子或多个条件，数组不是复合过滤语法；单次词条数受运行配置限制」；`factsSearchDefinition` 的 description 同口径补充；`exampleFor` 改为三分支（read_section / facts_search / 其余）。
- **原因**：plan 未指定示例文案，采用「完整词条」占位以对齐既有风格。
- **后果**：schema 声明、执行器、工具描述与人工指令至此一致，过渡态闭合；`agentInstructionsSha256` 与 `toolSchemaSha256` 随之变化，属预期指纹变化。

### 2026-09-12 — 步骤 7：补齐覆盖缺口
- **plan 原文**：优先覆盖混合非法与空结果、中途抛错、重复词与别名重叠、跨调用重返回、非默认上限贯通、版本/指纹断言同步、旧版本读取、拒绝矩阵、边界数组、证据元数据不伪造、示例迁移。
- **实际做法**：步骤 3–6 已落地大部分用例；本步补齐此前 reviewer 指出的缺口——「含非法项或重复项的超限数组整批拒绝且不查询 store」「恰好等于上限的数组被接受」「非法段占位后重复词引用仍指向首现段号」「v6 只携带 resolution.items」「历史 v5 结果仍按 paths 读取」「read_section 示例不被误改」，并新增 runner 级「非默认 factsQueryListLimit 贯通 meta、inputs 捕获与工具 schema maxItems」用例。
- **原因**：这些断言表达的是既有实现契约，实现已在步骤 3–6 完成，本步只补回归护栏，不改变行为。
- **后果**：全套用例由 508 增至 514，typecheck 与全套通过。

### 2026-09-12 — 步骤 8：宽查与低重叠组合的输出容量离线测量
- **过程**：`pnpm run build` 后以一次性脚本 `dev-temp/work/facts-capacity/measure.mjs`（只读 curated 语料、不发网络请求）逐案执行单次 `facts_search`，记录 `data` 与 tool message 的 UTF-16 字符量。样本覆盖宽查设施/职业词与低/高重叠组合。
- **结果**（命中卡数｜data 字符｜tool message 字符）：
  - 制造站 92｜15312｜17218；贸易站 77｜13767｜15403；控制中枢 65｜12959｜14429；近卫 83｜15116｜16872；发电站 31｜4755｜5688；
  - 低重叠组合（刻俄柏、能天使、德克萨斯）5｜1207｜2205；高重叠组合（推王、推进之王）2｜521｜1186（第 2 词仅列名，跨词去重生效）。
- **结论**：接受「上限只约束词数、不代表输出容量上限」这一边界，首版维持完整返回，不引入分页/截断。宽查单词输出可超过默认 `maxContextChars`（12000），与 U08 既有约定一致——facts 不套 RAG 字符上限；未来若引入分页/截断，须同时重定义 `complete` 与送达计数。
- **清理**：一次性脚本与目录已按 scripts/INDEX.md 的显式清单清理，数字即上文记录。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项（纯权衡取舍、无遗留债务的决策记入「决策偏离」）
> 可定位到代码的债务须在代码处写 `TODO(tech-debt) <编号>：` 注释（AGENTS.md 编码核心约束 #5），此处只记编号、结论与未来偿还条件

### 2026-09-13 — 本轮技术债治理（分支 feature/facts-multi-term-query）
> 三维度扫描 + 双代理交叉审查：无「合并前立即修」项。以下为登记债项，按「编号：结论。偿还条件：…」批量简写，对应模板的「债务/未来偿还」两要素；R5-10 登记于 docs/plan-single-tool-call-and-facts-evidence-notes.md。

- **R5-7（有代码锚点）**：facts_search 首版完整返回、无分页/截断，maxItems 只约束词数。偿还条件：引入分页或截断时须同步重定义 `complete` 与送达计数。锚点：bench/src/tool-executor.ts factsSearchOperation。
- **R5-8（有代码锚点）**：`serializeFactsMatches` 生产无引用、结论文案已被新渲染逐字复刻，属漂移副本。偿还条件：清理 facts 旧渲染契约时删除该函数并同步移除测试引用，或让新渲染复用它建立单一真源。锚点：bench/src/facts/store.ts。
- **R5-9（有代码锚点）**：新增配置字段需在 runner meta 投影、snapshot 的 META_ALLOWED_KEYS、inputs config 捕获三处手动登记，漏登静默丢字段。偿还条件：再次发生漏登，或决定引入统一字段登记表时收敛。锚点：bench/src/runner.ts meta 投影处。
- **R5-11**：`runBenchmark` 内联 meta 字面量与逐题流程混杂。偿还条件：需要降低该函数复杂度或再次改动 meta 字段装配时抽取 buildMeta。
- **R5-12**：`snapshotFromRunDir` 的 queryMap 构造三处近重复，且三处兜底语义不同。偿还条件：再次调整该函数或需要统一兜底语义时收敛。
- **R5-13**：trace schema 版本 3 硬编码于 bench/src/trace.ts 与 runner.ts meta 投影。偿还条件：trace 协议版本再次变更时下沉单源常量（需先确认跨模块常量归属）。
- **R5-14**：终止原因枚举在 bench/src/types.ts 与 snapshot.ts 各一份。偿还条件：该枚举再次增删时同步类型与运行时集合或引入单一真源。
- **R5-15**：类别枚举 `fact|system|gadget` 在 types.ts、snapshot.ts、benchmark-integrity.ts 多处消费。偿还条件：再次增删或出现新消费方时评估统一；当前用途不同，强行统一属抽象泄漏。
- **R5-16**：`getCardStore` 模块级单例不可注入（bench/src/facts/store.ts）。偿还条件：需要替换 facts store 数据源或做测试替身时引入注入点。
- 锚点口径：仅「由本分支引入或直接暴露」且可定位的债项落代码锚点（R5-7~R5-10）；R5-11~R5-16 为存量债，仅在本段登记、不落代码锚点，引用以文件与符号为准（不写易随注释增删漂移的行号）。
- 本轮判定「不值得修」不留债项：自然大函数（A1/A3/A5/A6）、展示契约不同的重复（B1/C5）、有意的独立兼容契约（B4b/B5）、语义不同的二次计数（C3）、谓词分类（C6）、不触发的限流单例（C7）。

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

### 2026-09-12 — 实施后核查修复：空路径语义与历史兼容覆盖
- **症状**：有登记路径但无匹配卡时，新 renderer 误报「未收录精确词条」；历史 v5 用例仅解析硬编码 JSON，未经过实际项目处理路径。
- **根因**：空卡分支未区分 paths 是否存在；原兼容测试没有调用 trace 消费方。
- **解决方案**：先补 executor 回归并观察文案断言失败，再让有路径空卡返回「本次路径没有可返回的记录卡」，保持 empty、完整路径及零扣点；以 trace.test.ts 中经过 serializeTrace 脱敏、序列化再读取的 v5 消息用例替代原 JSON.parse 用例，断言原版本、scope、paths 保留且内存原件不变。兼容用例在修改生产实现前已通过，本次无须改动 trace 实现。
- **预防**：executor 回归同时核对路径、计数、注入 ID 与预算；历史用例使用合成消息和敏感值，不访问本机历史运行目录。

> ✅ 已完成于 2026-09-13
