# 单工具调用准入与具名取证提示计划

> 创建日期：2026-09-12
> 状态：施工中

## 目标

每个模型步骤最多准入首个工具调用，其余调用明确拒绝并按 call ID 回写；通过 knowledge/AGENTS.md 要求具名干员或技能的事实取证，允许已实际送达且覆盖相关对象的 RAG 附带事实卡替代显式 facts_search，缺口按对象补查。以可验证的协议、计量与提示一致性为交付标准，不承诺答案质量、token、费用或耗时收益。

需求入口：docs/inbox.md「单工具调用准入」与「具名干员或技能的事实取证提示」。原「必须显式调用一次 facts」收口为「必须查证相关事实」：不是每题调用过一次就视为全部对象已覆盖，也不要求每个对象分别调用。本文由对应草案定稿而来，本次仅形成计划，宿主收紧、L34 提示与统计尚未实施。

## 非目标

- 不新增运行时实体识别、强制取证回馈循环、自动追问、失败熔断或调度队列；不为被拒绝调用做自动补发。
- 不新增 parallel_tool_calls 参数，tool_choice 保持 auto；不改变 provider 默认值、注册表或首检回馈机制。
- 不调整成功额度、获准尝试上限、超时与工具参数 schema；多词查询沿用 ADR-015 与 docs/plan-facts-multi-term-query.md，不另设批量工具或按词计费。
- 不新增协议版本、哈希/指纹、独立 protocolRejected 聚合字段、统计数据库或仪表盘；不全面重构已有 trace 与 report。
- 不启动付费探针、质量对照或重跑历史评测，不以当前题集追分；不改写历史运行记录，不新增历史协议适配器。

## 架构分析

### 当前实现与依赖

provider.ts 不发送 parallel_tool_calls；agent.ts 将整批 tool_calls 写入 assistant 消息后交给 executor.executeBatch，执行器按返回顺序逐项准入与结算。这已是执行层串行，但模型无法利用批内上一项结果决定下一项，不能满足「每次模型决策只准入一项」的要求。

knowledge/AGENTS.md 第 4 条已提前声明单调用及超量拒绝，宿主和 agent.ts 运行时能力块仍是整批逐项结算，存在现实不一致。实施单调用时同一变更同步这两处以及 provider.ts、inputs.ts、runner.ts 相关注释，不通过继续修改提示来代替宿主约束。

facts_search 已采用 queries 数组（TOOL_SCHEMA_VERSION=11、FACTS_RESULT_VERSION=6）；本计划依赖该通道完成多对象一次查询。除 schema 不变外，工具 description 也优先保持原职责描述，流程策略放在唯一人工指令源 knowledge/AGENTS.md，不复制到多处。

### 决策依据与替代范围

选用「提示引导 + 宿主保留首个、其余回写 protocol_rejected」。整题报错会放大模型偶发多调用的影响，静默丢弃会破坏后续对话的 call ID 对应；仅提示或传输参数不作为确定性保证。宿主能够保证最多准入一个，仍不能保证模型每步只生成一个调用。

实施前新建 ADR 并登记 docs/adr/INDEX.md，编号届时自增。局部替代 ADR-012 的「同次响应按顺序执行整批」及拒绝首项以外调用的放弃理由；保留双预算、执行状态、超时、首检回馈等其余决策。不把 ADR-012 中「不能保证模型每轮只生成一个调用」当作已被解决，也不将整份 ADR-012 标为废弃。L34 提示层不单独建 ADR。

既有 GLM 探针观察迁入 docs/exp/exp-single-tool-call-probe.md。本计划只据其说明：该配置的样本中 false 没有阻止多调用，提示也未被稳定遵守；不推断参数普遍无效，不外推其他 provider，不用合成天气任务估计真实知识库服从率。维持不发参数不要求新增付费实测。

## 实施方案

### 1. 单调用准入与异常边界（L38）

先为以下行为补测试并观察失败，再修改 tool-executor.ts 与 agent.ts。executeBatch 更名 executeStep，KnowledgeToolExecutor 接口与消费者同步；保留 ToolBatchResult、ToolBatchStats、toolBatch、toolRounds 等已有类型与持久化名称，避免无行为收益的全量重命名。

准入按固定顺序执行：

1. 整步校验 call ID。缺失或重复 ID 沿用 protocol_error：整步不执行、不扣额度、不拼造 ID，也不改成超量拒绝。
2. 仅索引 0 进入现有预算检查、获准尝试记账、工具名/参数校验、执行与结算。预算用尽则返回 budget_exhausted；未知工具、参数错误、empty 与执行错误沿用现有语义。
3. 索引大于 0 的项统一返回 protocol_rejected、executed=false。不得解析或执行其工具参数，不增加获准尝试或成功用量。首项无效、为空、失败或因预算拒绝时均不递补第二项。
4. 非中断且能正常形成结果的步骤按原顺序保留所有结果；assistant 保留原始完整 tool_calls，下一次模型请求前每个 ID 均有对应 tool 消息。

预算和超量同时发生时：首项预算拒绝，后续项仍记 protocol_rejected，以其在本步的位置为稳定分类，不随余额切换拒绝状态。后续项的 budgetRemaining 使用首项结算后的余额。

拒绝文案说明该项未执行及单调用规则；只有仍有成功额度和获准尝试余额时才提示「若仍缺这项证据，在下一步重新提出」，任一上限用尽则提示依据已有证据作答。首项耗尽额度时尤其不能同时要求下一步重试。

fatal 仍按既有路径终止整题，首项之后不得执行；截断响应仍在准入前终止，取消或超时沿用已有中断路径。不为这些终止情况新增补回写、恢复或等待协议；保留已有可得错误与计量，不将未完成结果伪记为已送达。「每个 ID 均有 tool 回复」约束正常继续对话的步骤，不能声称终止时待写入的消息已经发给模型。

### 2. 计量、trace 与历史解释

先补正常步骤及预算耗尽边界的聚合与对话回写测试，再同步现有消费者，不新增一套账本。

| 观测 | 新口径与保留边界 |
|---|---|
| requested / denied | requested 含所有提出项；denied 含 budget_exhausted 与 protocol_rejected |
| granted / attempts | 只计获准首项；正常结果完整的步骤满足 requested = granted + denied、attempts = granted |
| successes / executed / errors | 沿用现有成功、执行和工具错误定义；protocol_rejected 不计入三者，不按拒绝数推算执行数 |
| ToolBudgetState | requested、denied 与步骤结果一致；超量项不增加 attemptUsed、successUsed、executed |
| resultChars | 沿用 serializeToolResult 后字符串长度（UTF-16 字符），包括拒绝与预算提示；它不是 token 数或实际费用，不因没有下一轮请求而补造计费记录 |
| trace tool_call | 超量项仍逐项记录原 call ID、工具名、原参数、拒绝状态、原因及 writtenContent；不伪填命中、耗时或执行证据 |
| toolTrace | 仅排除新增 protocol_rejected；保留旧参数错误、预算拒绝等已知工具的记录语义及原步骤结构，不改成仅实际执行工具列表 |
| ragDelivery | 仅排除 protocol_rejected；保留现有 budget_exhausted、参数错误的零送达与执行异常的不可用语义 |

上述计数恒等式不覆盖既有 protocol_error 或未完成执行的中断步骤，其错误与未知值沿用原定义。resultChars 记录已序列化的工具消息文字，实际 HTTP 用量仍由 provider/ledger 记录；fatal 或取消时不能用该字符数证明文字已被后续请求计费。

report、answers.md 的 denied 标签注明「预算/同批超量拒绝」，具体原因查 trace；不新增分类汇总数。核对 trace.summary、inputs/meta、snapshot 的枚举与字段白名单，新状态按需要正常透传，保持旧记录可读与缺失值不可用。

TOOL_SCHEMA_VERSION 与 FACTS_RESULT_VERSION 均不变。历史协议依据已有 packageVersion、gitHead/gitDirty 及可复核代码判断，无法确定时说明「协议未知」，不据 agentInstructions、parallelToolCalls=false 或 requested>1 判新旧；提示已先行变化，这些值均不是宿主协议标志。不新增自动分类器，不改旧台账，跨协议拒绝数不直接做同口径趋势比较。

### 3. 具名事实取证提示（L34）

在单调用宿主规则可用且 ADR-015 多词通道就绪后，同步 knowledge/AGENTS.md 第 3、4 条。单调用宿主与能力文案同一变更交付，L34 提示可同批落地；离线统计不阻塞协议与提示的一致性。

提示采用以下语义，落地时融入现有取证条款，不新增重复检查清单或在人工指令中维护工具参数定义：

> 问题涉及具名干员或技能时，逐项核对本题所需的事实。rag_search 已实际返回、且对象和相关事实均覆盖的附带事实卡可直接作为依据；尚未覆盖的对象或事实使用 facts_search 补查，可一次提交多个完整词条。仅命中、提到名称或提示未附带不算已取得事实卡；一次调用成功不代表所有对象或关系均已覆盖。没有对应工具、预算已用尽或查无所需证据时，按已有证据作答并说明缺口。

保留现有「不重复完全相同的查询」「证据足够即作答」和无对应工具时的降级规则。facts 返回 empty/error/invalid 或仅有无关对象不满足事实送达，但不因此强制无限重试；组合关系与取舍仍用适用的 RAG/原文证据，不把有卡等同于结论充分。

每步最多一个工具调用，facts 的多词数组仍是一个调用；超过现有词数上限时按缺口分步查询，不扩大 schema。文案验收检查无「允许同批执行」的旧表述，拒绝说明中的「同批」一词可保留。

### 4. 最小事后观测

新增一个离线只读任务 scripts/tasks/bench/facts-evidence-observation.mjs，通过既有 tooling 入口运行；先为它编写隔离夹具测试，再实现。直接读取选定运行的现有问题、facts 送达结果、RAG attachedFacts 与对应名册真源，结果只输出终端表格，不增加 runner 的逐题持久化字段、扫描所有历史目录或另建统计框架。

统计名为「正式名命中对象的事实卡送达统计」：

- 分母仅取问题原文中出现的名册正式名，以字面包含匹配并按规范对象去重，不加入别名扩展、分词、模糊匹配或技能名识别；名称嵌套或歧义保留匹配并说明这只是字面命中，不代表真实意图识别。
- 每题列出命中对象、显式 facts 已送达对象、RAG 附带已送达对象、二者并集与尚未送达对象；同一卡重复出现只按对象计一次。显式 facts 用成功结果中实际返回的卡及现有 canonical 信息，不能只看查询词或根级 success；RAG 用 delivered，不能用 matched/paths/触发词替代送达。
- 数据完整且无送达才能判为未送达；缺 trace、结果或对应名册/版本无法确认时标不可判定，不填零，不拿当前名册无条件解释旧运行。无正式名命中的题记不适用，不计为合规。
- 字面命中、事实卡送达和答案证据充分是不同层次；该输出不称 L34 完整服从率，不判断事实卡是否足以支撑问题的技能、关系或最终结论。

实现仅需支持当前结果契约与缺失输入说明，不建设旧版数据转换。用最小合成记录验证多对象部分送达、附带省略、重复送达和缺失观测；本轮不以执行真实模型跑测作为验收条件。后续真实观察另行 exp，未参与调优的问题用于获授权的质量验证，不把本计划变成自动追分任务。

### 5. 验证与交付

每项可观测行为先红后绿，按 docs/rules/testing.md 执行。迁移 executeBatch 调用点时区分：测试正常先后查询的用例改成多次 executeStep；专门测试同次多调用的用例断言首项准入及后续拒绝。不能仅机械改名后删除失败断言，或顺带改写无关行为。

必要测试覆盖首项无效不递补、两类预算耗尽与超量同时出现、每个 ID 正常回写、超量不执行及不计额度、统计与 trace 边界、提示在无 facts 工具模式下可降级、历史最小记录可读。复用既有缺失/重复 ID、fatal、取消和截断测试核对无回归，有覆盖即不重复增设；prompt 测试检查关键契约而非全文快照。

provider 保持请求形状，用既有 buildChatBody 测试和 mock fetch 请求路径核对不发送 parallel_tool_calls；不以真实 API 或浏览器 E2E 作门槛。运行 pnpm run typecheck、全套 pnpm run test、node scripts/doc-check.mjs；合并前执行 node scripts/verify.mjs merge -- --base main。

计划成立时验收项保持未完成，doc-check 的活动 plan 未勾选门禁如实报告，不为文档检查提前打勾或修改门禁。开始编码时按模板建立本计划 notes，记录实际偏离；临时产物按 scripts/INDEX.md 收尾。现有探针记录与遗留脚本处理边界见对应 exp，不新增附件或共享快照。

## 验收清单

- [ ] 新 ADR 建立并登记，准确局部替代 ADR-012 的整批执行策略，保留仍有效决策
- [ ] executeStep 及所有调用点迁移完成，工具 schema 与传输参数保持既定口径
- [ ] 整步 ID 校验、首项准入、首项失败不递补及超量拒绝符合约定
- [ ] 正常继续对话保留全部 call ID 并完整回写，fatal/取消/截断沿用终止边界
- [ ] 拒绝提示随余额选择补查或作答，无额度耗尽仍要求重试的冲突
- [ ] requested/denied、granted/attempts、执行与错误计数、resultChars 符合口径
- [ ] trace 保留超量拒绝证据，toolTrace 与 ragDelivery 仅排除新增拒绝且保留旧语义
- [ ] report/answers.md 标签与历史读取一致，不新增分类聚合或协议识别设施
- [ ] AGENTS.md、运行时能力块与相关注释同步，无允许同批执行的旧表述
- [ ] 具名事实取证按对象缺口补查，附带卡须实际送达，无工具或无预算时可说明缺口
- [ ] 离线正式名送达统计完成，部分覆盖、重复送达、省略及不可判定边界有测试
- [ ] 新行为先红后绿，相关原用例迁移保留等价覆盖，历史记录不改写不伪填
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过
- [ ] `node scripts/doc-check.mjs` 通过

## 关联 ADR

- 待建 ADR（实施前编号自增）— 单工具调用准入与超量拒绝，局部替代 ADR-012。
- ADR-012 — 双预算、执行状态与终止边界。
- ADR-015 — 多完整词条一次 facts 查询的既有通道。
- ADR-013 — RAG 附带事实卡及送达观测。
- ADR-014 — 测试先行与覆盖边界。
- ADR-011 — 各模式可用工具与降级边界。

---

<!-- 冻结说明：发版归档时替换此行，标记完成日期 -->
