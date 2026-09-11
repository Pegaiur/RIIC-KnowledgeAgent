# 查询工具链收敛与预算语义调整计划

> 创建日期：2026-09-10
> 状态：施工中

## 目标

把默认检索模式收敛为 `hybrid`（`rag_search` + `read_section` + `facts_search`），移除 `grep_search` 工具与 `grep`/`both`/`facts` 三个模式；同时把工具预算改为「仅非空执行成功结果扣额度，默认 5 次成功额度 + 10 次获准尝试硬上限」，并取消工具并行调用。这里的扣额度不改变 provider 的实际 token 费用计量。

## 非目标

- 不改检索算法（BM25 打分、分词器、`topK`、`entityBoost`）。
- 不改知识库语料、`corpus-manifest.json`、`bench/questions.json`、`bench/gold.json` 与 `docs/spec/`。
- 不以提升回答质量为目的修改提示词、检索或 agent loop 策略；本计划只改模式集合、预算计数与并行开关。
- 不为新默认发起正式质量基线或付费采样（需另行授权）。
- 不新增哈希/指纹字段；不改写历史 ADR 正文与 `docs/archive/` 内已归档文档。
- 不保留对已删除模式的运行时兼容分支（历史名的**只读识别**除外，见步骤 1）。
- 不新增模型轮次上限或预算耗尽后的终止策略；保留既有工具异常的 fatal 判定与整题终止行为，不因异常免扣额度自动增加重试。

## 架构分析

当前默认 `bm25` 只暴露 `rag_search` + `read_section`，而 `read_section` 的入参 `section_id` 必须取自检索结果的小节标识，未知 ID 直接返回空且不模糊回退。这形成「召回不到即补证不到」的闭环：关键真源在 BM25 单次 top-5 内普遍不可达（实测 `类别.md#干员组` 第 90 位、`技能-贸易站#巫恋` 第 155 位、`技能-控制中枢#薇薇安娜` 第 162 位），模型补证时只能重读已命中的 guide。`facts_search` 已存在且能精确命中干员/技能/类别词条，但默认模式下不可用。

`grep_search` 是 P3 受控对照实验组，设计立场即「字面命中计数」的对照实现，对照价值已由既有试验消耗完毕；`facts` 模式只暴露 `facts_search`，与 `hybrid` 的工具集重复且缺少 RAG 侧；`both` 是 `rag_search` + `grep_search` 的组合，随 grep 一并失去意义。

预算侧：现行为「获准即扣 1 点」，参数错误、空结果与执行错误同样消耗额度；整批预占额度无法根据前一项结果决定后一项准入。现有逐项结果能区分成败，但预算 used 只代表获准尝试数，不能直接表示非空成功结果数。`executed=true` 也包含空结果和执行错误，必须保留其观测含义并独立判定扣点。

## 实施方案

先按以下状态表确定预算契约，再依次执行模式收敛、默认值与校验、逐项预算结算及串行执行、观测兼容、测试与文档收束。预算结算与宿主串行执行属于同一步，不保留整批预扣的中间实现。

| 调用结果 | 获准尝试数 | 成功额度扣点 | executed 与后续行为 |
|----------|:----------:|:------------:|---------------------|
| 非空执行成功（`executed=true` 且 `status=success`） | +1 | +1 | 保留 true |
| 空结果（`empty`） | +1 | 0 | 保留 true，可继续尝试 |
| 参数错误 / 未知工具（`invalid_params` / `unknown_operation`） | +1 | 0 | 保留 false，可继续尝试 |
| 执行错误（`error`） | +1 | 0 | 保留既有 executed 与 fatal 语义；fatal 结果仍终止整题 |
| 超限拒绝（`budget_exhausted`） | 0 | 0 | false，计入 requested/denied |
| call ID 缺失或重复导致整批协议错误 | 0 | 0 | 保留整批不准入、不执行并终止的契约；批次 requested 仍记录响应中的调用数 |

“非空”按工具实际返回的证据内容判定，不按序列化后的 JSON、提示文字或分页元数据长度判定。`facts_search` 无命中、`rag_search` 未送达非空证据、`read_section` 未返回非空正文页均归为 `empty`；特别覆盖小节正文为空、offset 恰好等于正文长度的末尾读取。不能统一用 `hitIds.length` 判定，因为正常 `read_section` 的 hitIds 也为空。重复返回非空证据仍按每次调用扣点，不新增证据去重收费规则。

### 步骤 1：工具集合与模式枚举收敛

输入：`bench/src/tool-executor.ts`、`bench/src/types.ts`、`bench/src/config.ts`。
输出：`RetrieverId` 收缩为 `'bm25' | 'hybrid'`；`grep_search` 不再出现在任何模式的工具数组中。

- `RetrieverId`：`'bm25' | 'grep' | 'both' | 'facts' | 'hybrid'` → `'bm25' | 'hybrid'`。
- `allowedOperations`：`bm25` → `['rag_search', 'read_section']`；`hybrid` → `['rag_search', 'facts_search', 'read_section']`。
- 删除 `TOOL_DEFINITIONS.grep_search`；`TOOL_SCHEMA_VERSION` 由 8 升至 9。既有指纹只计算实际下发的工具数组；保留模式的数组未变时指纹可以不变，不将版本递增等同于指纹必变。
- `types.ts`：`ToolId` 保留 `grep_search` 作为历史名；拆出「当前可下发工具」类型用于 `TOOL_DEFINITIONS`；`isRetrievalTool` 仅判 `rag_search`，新增 `isHistoricalGrepTool`；`isObservedTool` 继续纳入 `grep_search`，保证历史快照与报告仍可读。
- 删除 `bench/src/grep-retriever.ts` 及其唯一引用点。

验收：`toolsForRetriever('bm25')` 与 `toolsForRetriever('hybrid')` 均不含 `grep_search`；对历史记录中的 `grep_search` 仍可聚合计数。

### 步骤 2：默认模式切换与失效分支清理

输入：`bench/src/config.ts`、`agent.ts`、`runner.ts`、`cli.ts`、`cli-args.ts`、`provider.ts`、`package.json`。
输出：不传 `--retriever` 时运行 `hybrid`；`facts` 专用分支消失。

- `EXPERIMENT.retriever` 改为 `'hybrid'`；`buildSystemPrompt`、`toolsForRetriever`、`toolNamesForRetriever`、`toolSchemaMetadata` 的默认模式同步，显式传入 `bm25` 仍可作为对照。
- `runner.ts`：删除 `config.retriever === 'facts' ? [] : loadCorpus(...)` 的 facts 分支（恒加载语料）；小节目录恒构建（去掉 `supportsReadSection` 条件判断，或保留函数但恒真）。
- `provider.ts`：删除 dry 模式下 `facts`/`grep`/`both` 三个占位分支，只保留 `hybrid` 与默认分支。
- `cli.ts`：删除 `isFacts` 分支与语料统计分支；help 的 `--retriever` 取值列表与 grep 示例行更新。
- `cli-args.ts`：`retriever` 注释更新。
- `package.json`：`bench:dry` 移除已失效的 `--retriever facts`。
- 必做：配置校验入口对 retriever 仅接受 `bm25` / `hybrid`，拒绝已删除模式及未知值；CLI 区分未传选项与 `--retriever` 缺值，缺值报中文错误。运行前完成校验，避免实际工具回落 bm25 而 meta 仍记录失效模式；程序化配置入口同样受校验约束。

验收：`pnpm run bench:dry` 通过；`node dist/cli.js run --dry --limit 2` 的可用工具数组包含 `rag_search`、`read_section`、`facts_search`，不要求 dry 模拟实际调用全部三种工具；显式 bm25 仅下发两种 RAG 工具；旧值、未知值与缺值均被拒绝。

### 步骤 3：逐项结算双上限预算并串行执行

输入：`bench/src/tool-executor.ts`、`config.ts`、`agent.ts`、`provider.ts`、`cli-args.ts`、`cli.ts`。
输出：仅非空执行成功结果扣额度；同批按序逐项准入和结算，保留每个 call ID 对应的结果。

- `ToolBudgetState` 字段调整为：`successLimit`、`successUsed`、`attemptLimit`、`attemptUsed`、`requested`、`denied`、`executed`、`remaining`（= 成功额度余额）。
- `tool-executor.ts` 的 `executeBatch` 删除整批预扣与 `Promise.all`，改为顺序循环；每项执行「检查两项上限 → 获准则 attemptUsed++ → 执行与结果分类 → 非空成功则 successUsed++ → 更新余额与结果」。后一项使用前一项结算后的状态，不能按初始成功余额截取批次。
- 准入判定：`attemptUsed < attemptLimit` 且 `successUsed < successLimit`。仅获准调用增加 attemptUsed；成功、空结果和失败均占一次尝试，拒绝不占。
- 扣点严格遵循状态表：仅 `executed === true && status === 'success'` 扣 1；各工具先按实际证据内容区分 success/empty，保留返回内容与分页元数据，不将占位文字当作成功。`executed` 继续包含已执行的 empty/error，不充当成功计数。
- 超限结果统一 `status: 'budget_exhausted'`，`message` 区分两种原因；两项同时用尽时优先提示成功额度用尽。每项 budgetRemaining 与提示按该项结算后的状态生成；最后一次获准尝试耗尽时，即使成功余额仍大于零，也提示尝试次数已用尽。
- 保留协议错误整批拒绝和既有 fatal 处理，不把 error 自动改成可重试。执行器累计账本 requested = attemptUsed + denied；正常批次 requested = attempts + denied 且 granted = attempts，均以该批增量统计。协议错误按状态表单独记账，不将其批次 requested 加入已准入账本。
- 配置：`EXPERIMENT.toolBudget` 语义明确为成功额度（默认 5）；新增 `EXPERIMENT.toolAttemptLimit`（默认 10）并透传 `BenchConfig`。`validateBenchConfig` 对两者做正整数校验。
- CLI 增加 `--tool-attempt-limit N`（与既有 `--tool-budget` 对称），供干跑与后续试验使用。
- `provider.ts`：删除 `body.parallel_tool_calls = true`（不发送该字段；如需显式表达则发送 `false`）。
- 模型仍一次返回多个 `tool_calls` 时，逐项执行或返回超限拒绝，按原 call ID 完整回写。宿主串行仅保证执行与结算顺序，不保证模型单次只返回一个调用，也不使模型能依据批内前一项结果重新决定后一项；依赖结果的决策仍须跨模型轮次。
- `agent.ts` 系统提示描述「仅非空成功扣点 + 获准尝试上限」；`buildSystemPrompt` 新增尝试上限入参，runner 预构建与 runQuery 默认构建两条路径都传入实际配置。
- 保留预算耗尽后继续提供工具和 auto 的既有循环，后续工具调用只收到拒绝。10 次上限不约束 LLM 请求数、HTTP 重试数或超限请求数；整题仍可能继续至回答或 `sessionTimeoutMs`，不宣称工具上限能阻止所有模型重试。

验收：连续参数错误或空结果不减少成功额度，第 11 次请求拒绝；非空成功 5 次后拒绝。成功余额为 1 时，同批「参数错误/空结果 → 非空成功 → 后续调用」应依次免扣、扣 1、拒绝。检查每项余额、两种耗尽提示、两限同时用尽、批内顺序和完整 call ID 回写；fatal/协议错误仍按既有行为终止，请求体不含 `parallel_tool_calls: true`。

### 步骤 4：观测字段、报告与历史格式兼容

输入：`bench/src/types.ts`（`ToolBatchStats`）、`snapshot.ts`、`report.ts`、`runner.ts`、`inputs.ts`、`trace.ts`。
输出：新运行完整记录两类预算，旧快照与旧运行目录仍按原口径读取。

- `ToolBatchStats` 增加 `attempts`（获准尝试数）与 `successes`（非空成功扣点数），保留既有统计；新运行始终写入两项，历史记录允许缺失，缺失表示不可用，不伪填零或由 executed 推算 successes。
- `snapshot.ts` 同步 `TOOL_BATCH_KEYS`、`OPTIONAL_TOOL_BATCH_KEYS` 与 `META_ALLOWED_KEYS`（新增 `toolAttemptLimit`）。回答解析同时支持旧预算行和新双预算行，不以替换旧正则的方式丢弃历史格式；保留旧格式的轮数、工具序列与原预算值。
- `runner.ts` 的 `answers.md` 展示成功额度已用/上限及获准尝试已用/上限；runner 与 `SnapshotQuery` 的 budgetUsed/budgetRemaining 从 `AgentResult.budget.successUsed/remaining` 取值，对新运行表示成功额度。runner 同步逐题 attemptUsed/attemptLimit，`SnapshotQuery` 增加对应可选字段供历史兼容。新字段须贯通运行目录导出、直接生成快照、校验、读写与失败题路径，旧记录缺失时保持缺失。
- `meta.json` 与 `inputs.json` 均记录实际 `toolAttemptLimit`；`parallelToolCalls=false` 表示宿主未开启并行且逐项串行，不声称模型保证单调用。trace 的 summary.budget 同步新账本，批次计数、报告聚合与逐题总数一致；历史新统计缺失时展示不可用。
- 新旧预算语义以 `toolAttemptLimit` 是否存在结合协议版本识别；历史 toolBudget 保留原口径，不因为名称相同直接混算。核对 trace/input 的版本声明与现有消费者，对字段结构变更明确版本处理；不改写旧快照或新增指纹字段。

验收：旧快照读取、旧运行目录导出、新运行目录导出与新快照往返读取均通过；新运行的 answers/meta/inputs/trace/snapshot 账本一致。历史缺失字段不回填零；覆盖无工具调用、失败题、空结果与混合批次。

### 步骤 5：测试更新

输入：`bench/tests/**`。
输出：新契约与历史兼容均有回归覆盖。

- 删除 `bench/tests/grep-retriever.test.ts`。
- 更新模式矩阵与工具集断言：`tool-executor.test.ts`、`agent.test.ts`、`agent-auto-loop.test.ts`、`provider.test.ts`。
- `facts` 模式夹具（约 40 处 `config.retriever = 'facts'`）替换为 `hybrid`，并调整「工具集恰为 `['facts_search']`」类断言；涉及 `facts-tools.test.ts`、`agent-provider-ledger.test.ts`、`facts-resolution-executor.test.ts`、`inputs.test.ts`、`runner.test.ts`、`tool-executor.test.ts`。
- `report.test.ts` 保留历史名 `grep_search` 可聚合的用例；`section-navigation.test.ts`、`section-navigation-runner.test.ts` 删除 grep/both/facts 用例。
- 新增状态表与步骤 3 的边界测试，覆盖 read_section 正常正文页、空正文、末尾读取、未知小节、越界参数、普通 error 与 fatal error；不以序列化字符串非空或 hitIds 判定所有工具成功。
- 在 `config.test.ts` / `cli-args.test.ts` 覆盖非法模式、缺值、未传默认值、两项预算的正整数校验和 CLI 透传；验证自定义尝试上限进入两条提示构建路径及 inputs/meta。
- 在 `snapshot.test.ts` / `runner.test.ts` / `report.test.ts` 覆盖步骤 4 的新旧格式矩阵，不修改旧夹具来规避兼容断言；保留预算耗尽后继续提供工具的循环测试，并补获准尝试上限耗尽后只拒绝、不新增执行的用例。

验收：`pnpm run typecheck`、`pnpm run test`、`pnpm run bench:dry` 全通过。正确率仅作观测指标，不以本轮问题答案作为新增通过线。

### 步骤 6：文档与门禁收束

输入：本计划、ADR-011、ADR-012、`docs/adr/INDEX.md`、`docs/inbox.md`。
输出：文档与实际交付一致，工程完成后执行合并门禁。

- 开始实施代码时创建本计划的 notes，按文档生命周期规则记录实施决策；当前仅修订计划，不标记代码已完成。
- 复用已存在的 ADR-011、ADR-012 与 inbox 条目，实施完成后同步状态与索引，不重复新增 ADR。
- 实施中按真实进度勾选；全部交付并完成发布元数据收束、计划归档后执行合并门禁。规划阶段运行 doc-check 时，未实施 checklist 触发 D1 属于尚未满足的交付门槛，不虚勾条目换取通过。

验收：`pnpm run typecheck`、`pnpm run test`、`node scripts/doc-check.mjs`、`node scripts/verify.mjs merge -- --base main` 全通过。

## 验收清单

- [ ] `RetrieverId` 收缩为 `bm25 | hybrid`，`grep_search` 不再下发且历史名仍可读
- [ ] 默认检索模式为 `hybrid`，`facts`/`grep`/`both` 分支与 `grep-retriever.ts` 已清除
- [ ] CLI 与程序化配置拒绝失效/未知模式，CLI 缺值报错，未传时沿用 hybrid
- [ ] `TOOL_SCHEMA_VERSION` 升至 9，工具指纹与本轮输入快照一致
- [ ] 仅非空执行成功扣 1 点、默认上限 5；empty/invalid_params/unknown_operation/error 不扣，获准尝试默认上限 10
- [ ] 批内逐项准入与结算，无整批预扣；混合批次、每项余额、两种超限和完整结果回写均正确
- [ ] 请求不再开启并行工具调用，批内多调用按序串行执行；既有 fatal/协议终止与耗尽后循环行为保留
- [ ] `answers.md` / `meta.json` / `inputs.json` / trace / snapshot 与批次统计同步新账本及实际尝试上限
- [ ] 旧快照和旧运行目录可读，历史新增字段缺失保持不可用，新格式导出与往返读取不丢计数
- [ ] `bench:dry` 只暴露 `rag_search`、`read_section`、`facts_search`
- [ ] ADR-011、ADR-012 与 ADR 索引、inbox 条目已落位
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过
- [ ] `node scripts/doc-check.mjs` 全通过
- [ ] `node scripts/verify.mjs merge -- --base main` 全通过

## 关联 ADR

- ADR-011 — 检索模式与工具集合收敛（局部替代 ADR-003、ADR-006、ADR-007、ADR-008 的模式与工具清单部分）
- ADR-012 — 工具预算改为失败不消耗与双上限、取消并行调用（局部替代 ADR-005）

---
