# facts 多词条数组查询计划

> 创建日期：2026-09-12
> 状态：施工中

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
- [ ] facts_search 参数为 `queries: string[]`，maxItems 动态取自配置；不同配置的 schema 互不污染
- [ ] 工具 description 与 knowledge/AGENTS.md 未硬编码上限数字，未引入自然语言解析或复合条件
- [ ] 根级状态符合契约：有命中 success 扣 1 点；合法词全部未命中（含夹非法元素）empty；无合法元素 invalid_params
- [ ] 元素级非法只记为该项 invalid 并继续其余合法词；上限按原数组长度检查
- [ ] 新 queries 数组接受；旧 query 两种形态、双字段、非数组、空数组、全非法及原长度超限均按契约拒绝，并覆盖错误示例迁移
- [ ] 逐项结构化记录（原索引、规范化词条、状态、命中路径、canonical 列表）可供统计区分全量与部分失败
- [ ] v6 仅以 resolution.items 承载逐项记录；非法项 query=null 且带中文原因；非法项占段，段号为 index+1；参数错误和运行时异常不返回证据元数据
- [ ] 中途 store 抛错为整次 error + fatal，无部分注入、不扣成功额度、占一次获准尝试
- [ ] 逐词分段按输入顺序、卡顺序沿用 store；重复词保留分段；交叉引用用「第 N 段」
- [ ] 去重仅限本次调用，不因之前 RAG/facts 返回过而省略正文；首现完整、后续仅列名
- [ ] `complete` 语义为「合法词条命中的卡已完整送达」；matchedCount/returnedCount 取并集
- [ ] scope 为 `{ queries: [...] }` 对象外壳，值为 trim 后合法词条，逐项经原索引关联
- [ ] FACTS_RESULT_VERSION 与 TOOL_SCHEMA_VERSION 递增，历史结果仍可读，trace/report 消费方同步
- [ ] 混合非法与空结果、中途抛错、重复词与别名重叠、跨调用重返回、非默认上限贯通、旧版本读取用例先红后绿
- [ ] 宽查/低重叠组合的序列化字符量已离线记录，并接受首版完整返回的容量边界
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过

## 关联 ADR

- ADR-015 — facts 多词条数组查询（已决策）：确立 `queries` 数组形态、按调用扣点、跨词仅名去重、动态 maxItems、元素级报错与并集计数等决策。
- ADR-007 — 单词条 facts 统一入口；ADR-015 局部替代其单词条与「不解析多个条件」的决策，其余契约继续有效。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
