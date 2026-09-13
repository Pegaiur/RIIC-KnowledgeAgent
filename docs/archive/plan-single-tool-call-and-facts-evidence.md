# 单工具调用准入与具名取证提示计划

> 创建日期：2026-09-12
> 状态：已完成

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

facts_search 已采用 queries 数组（TOOL_SCHEMA_VERSION=12、FACTS_RESULT_VERSION=6）；本计划依赖该通道完成多对象一次查询。流程策略放在唯一人工指令源 knowledge/AGENTS.md；工具参数形状不变，接口与送达/分页说明由工具 description 承载，不重复到指令（本条 2026-09-12 经授权修订，原「优先保持原职责描述」的措辞已替代）。

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

本步骤不改 TOOL_SCHEMA_VERSION 与 FACTS_RESULT_VERSION（后续 2026-09-12 授权的提示层归位把 TOOL_SCHEMA_VERSION 升至 12，见同名实施笔记与 ADR-015 修订）。历史协议依据已有 packageVersion、gitHead/gitDirty 及可复核代码判断，无法确定时说明「协议未知」，不据 agentInstructions、parallelToolCalls=false 或 requested>1 判新旧；提示已先行变化，这些值均不是宿主协议标志。不新增自动分类器，不改旧台账，跨协议拒绝数不直接做同口径趋势比较。

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

- [x] 新 ADR 建立并登记，准确局部替代 ADR-012 的整批执行策略，保留仍有效决策
- [x] executeStep 及所有调用点迁移完成，工具 schema 与传输参数保持既定口径
- [x] 整步 ID 校验、首项准入、首项失败不递补及超量拒绝符合约定
- [x] 正常继续对话保留全部 call ID 并完整回写，fatal/取消/截断沿用终止边界
- [x] 拒绝提示随余额选择补查或作答，无额度耗尽仍要求重试的冲突
- [x] requested/denied、granted/attempts、执行与错误计数、resultChars 符合口径
- [x] trace 保留超量拒绝证据，toolTrace 与 ragDelivery 仅排除新增拒绝且保留旧语义
- [x] report/answers.md 标签与历史读取一致，不新增分类聚合或协议识别设施
- [x] AGENTS.md、运行时能力块与相关注释同步，无允许同批执行的旧表述
- [x] 具名事实取证按对象缺口补查，附带卡须实际送达，无工具或无预算时可说明缺口
- [x] 离线正式名送达统计完成，部分覆盖、重复送达、省略及不可判定边界有测试
- [x] 新行为先红后绿，相关原用例迁移保留等价覆盖，历史记录不改写不伪填
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] `node scripts/doc-check.mjs` 通过

## 关联 ADR

- ADR-016 — 单工具调用准入与超量拒绝，局部替代 ADR-012 的整批执行策略。
- ADR-012 — 双预算、执行状态与终止边界。
- ADR-015 — 多完整词条一次 facts 查询的既有通道。
- ADR-013 — RAG 附带事实卡及送达观测。
- ADR-014 — 测试先行与覆盖边界。
- ADR-011 — 各模式可用工具与降级边界。

---

<!-- 冻结说明：发版归档时替换此行，标记完成日期 -->

## 实施纪要

# 实施笔记：单工具调用准入与具名取证提示计划

> 对应 plan：docs/plan-single-tool-call-and-facts-evidence.md
> 开始日期：2026-09-12

## 决策偏离
> plan 中没有提到，但在实施中做出的重要决策

### 2026-09-12 — 提示层先行落地，宿主与能力块留待同批同步
- **背景**：方案定案为「提示引导 + 宿主保留首个、其余回写 protocol_rejected」。编码前先按用户要求把禁止并行的语义写入 knowledge/AGENTS.md，用于观察模型服从性；宿主实现尚未开始。
- **选项**：
  - A: 等宿主实现完成后与提示同批一次提交；
  - B: 提示层先行提交，宿主随后与能力块、测试同批同步。
- **决策**：采用 B。已提交 65d4588（knowledge/AGENTS.md 第 4 条与当时的草案）。
- **影响**：形成过渡态——同一 system prompt 内 knowledge/AGENTS.md 禁止同批，而 agent.ts 运行时能力块仍写「同批调用逐项结算」，宿主仍整批逐项执行。须在计划步骤 1–5 的同一变更内同步，不留长期不一致；偿还前不得以该提示断言宿主行为。

### 2026-09-12 — 探针观察从草案迁出为 exp
- **背景**：草案内嵌 GLM 端点探针（参数接受性与指令服从性）观察结果；转为实施计划后，plan 不应承载观察结果。
- **选项**：
  - A: 观察结果留在 plan；
  - B: 迁入独立 exp，按 ADR-009 归口，plan 只引用结论。
- **决策**：采用 B，迁入 docs/exp/exp-single-tool-call-probe.md（状态：已结束）。
- **影响**：plan 第 36 行据此把「参数无效」收窄为「该配置下观察未阻止多调用，不推断其他模型或端点」；单次小样本、脚本未入库等局限随 exp 保留。

### 2026-09-12 — L34 语义收口为按对象与事实缺口查证
- **背景**：inbox 原口径要求具名干员至少显式调用一次 facts_search；但 hybrid 下 rag_search 会自动附带事实卡，强制显式调用会重复取证，并与单调用约束叠加消耗预算。
- **选项**：
  - A: 严格按原口径要求显式调用一次；
  - B: 实际送达且覆盖对象的附带卡可替代，其余用 facts_search 补查；
  - C: 要求每个对象分别调用一次。
- **决策**：采用 B。不要求逐对象分别调用，不把一次成功视为全部对象覆盖，无对应工具或无预算时说明缺口。
- **影响**：plan 目标与验收第 10 项按此措辞；离线统计只度量「正式名命中对象的事实卡送达」，不称完整服从率，也不判断事实卡是否足以支撑最终结论。

## 实现调整
> plan 中有描述，但实际实现方式不同

### 2026-09-12 — 用户授权重写指令结构并归位工具契约
- **plan 原文**：取证提示融入现有条款，工具 schema 保持既定口径。
- **实际做法**：按用户本轮补充授权，将单调用规则独立前置，取证整理为有继续与停止条件的流程；完整词条、分页字段等接口说明归工具 schema，运行时能力块移除重复单调用文案。schema 只调整描述，不改参数形状、上限或执行协议。
- **原因**：原指令把硬约束、工具接口与决策步骤混写，且接口说明与 schema 重复；此次调整替代原计划的排版安排，保留既定证据与准入语义。
- **验证**：先修改契约测试，定向运行观察到 4 项预期失败（接口归属、独立硬约束、集中流程、schema 结果说明），其余 60 项通过；实现后定向 64 项通过。首次全套运行 532 项通过、1 项失败：agent-auto-loop 的旧断言仍要求能力块重复单调用规则；按本次职责归位同步该提示断言，保留宿主首项准入及超量回写的行为测试。最终 typecheck、全套 42 文件 533 项测试及 doc-check 通过。未调用真实模型，提示组织改善不等同于回答质量已获验证；本轮无新增需交接的临时产物。

### 2026-09-12 — 随附文档同步，TOOL_SCHEMA_VERSION 升至 12
- **plan 原文**：工具 schema 保持既定口径；`TOOL_SCHEMA_VERSION` 与 `FACTS_RESULT_VERSION` 均不变。
- **实际做法**：工具描述在本轮归位中改为承载接口与送达/分页说明，schema 指纹随之变化，故 `TOOL_SCHEMA_VERSION` 11→12（`FACTS_RESULT_VERSION` 保持 6，参数形状、minItems/maxItems 与执行协议不变）；同步修订 ADR-015（数组语义只在 tool description 声明、指令委派接口说明，原「双处声明」后果条目收敛），并更新本 plan 中过时的版本号与「工具 description 优先保持原职责描述」措辞（已回馈 plan）。
- **原因**：描述变更会改变 `toolSchemaSha256`，仅凭指纹无法再按版本分组；ADR-015 原要求「指令与 tool description 双处声明」，与归位后的单一声明位置冲突，须同步决策记录。
- **验证**：先改 tool-executor/runner 的版本断言观察到 2 项失败，再递增常量转绿；typecheck、全套 533 项测试、doc-check 通过。未调用真实模型。

### 2026-09-12 — 步骤 1 与步骤 2 在 agent.ts 上交叠，先交付宿主侧计量口径
- **plan 原文**：步骤 1 只做单调用准入与异常边界；requested/denied、granted/attempts、resultChars、toolTrace/ragDelivery 口径与报告标签列在步骤 2。
- **实际做法**：步骤 1 的提交同时改了 agent.ts 的 toolBatch 计数（denied 含 protocol_rejected、granted/attempts 排除它）、toolTrace 与 ragDelivery 过滤；报告/answers.md/快照等消费者留待步骤 2。
- **原因**：宿主计数与 executor 返回状态属于同一可观测行为；若步骤 1 只改 executor，agent 层会把 protocol_rejected 计成获准/执行，中间提交出现与 ADR-016 决策 4 冲突的过渡态，新用例无法转绿。
- **后果**：步骤 2 收敛为报告、answers.md、历史读取与文档标签的消费者改动，无重复实现。

### 2026-09-12 — executeBatch 调用点实际多于初次统计
- **plan 原文**：迁移 executeBatch 调用点，正常先后查询改多次 executeStep，同批用例断言首项准入。
- **实际做法**：除 tool-executor/agent-auto-loop/facts-attach/facts-resolution-executor/inputs 外，facts-tools、section-navigation、fulltext-expansion 也含调用点；同批语义用例（facts 双空查、read_section 空/正文、非法参数多项、rag+facts 混合）改为逐步调用，单调用用例仅改方法名。
- **原因**：初次全仓替换点检索被输出截断遗漏，typecheck 暴露后补齐。
- **后果**：全仓 `executeBatch` 已无残留（文档中的历史说明不受影响）。

### 2026-09-12 — answers.md 逐题行新增拒绝标签，快照解析兼容旧行
- **plan 原文**：report、answers.md 的 denied 标签注明「预算/同批超量拒绝」；核对 snapshot 字段白名单，保持旧记录可读。
- **实际做法**：report 的「拒绝 N」改为「拒绝（预算/同批超量拒绝） N」；answers.md 逐题元数据行在「获准尝试」与「工具序列」之间新增「拒绝（预算/同批超量拒绝）：N」，N 取该题已落盘批次 denied 之和（含 budget_exhausted 与 protocol_rejected）；`parseAnswers` 的 dual 正则把该段设为可选，旧双预算行与单预算历史行仍按原位置解析，工具序列捕获组顺延为第 8 组。
- **原因**：answers.md 原先没有任何拒绝标签，仅核对无法满足「同类标签」要求；不新增预算/超量分类汇总，也不给 SnapshotQuery 增加字段，保持旧记录可读。
- **后果**：快照导入新运行目录时仅解析并忽略该拒绝段、不落库；历史 answers.md 无该段时保持原行为。

### 2026-09-12 — trace.summary / inputs / meta / snapshot 白名单核对后无需改动
- **plan 原文**：核对 trace.summary、inputs/meta、snapshot 的枚举与字段白名单，新状态正常透传、旧记录可读。
- **实际做法**：核对后不改动。`trace.summary.toolCallsDenied` 已由 agent.ts 按批次 denied 汇总（步骤 1 已覆盖）；`ToolBatchStats.denied`、`TOOL_BATCH_KEYS`、`META_SUMMARY_KEYS.toolCallsDenied`、`META_ALLOWED_KEYS` 与 `TERMINATION_REASONS`（含 protocol_error）已含所需字段与枚举；新增的 `protocol_rejected` 只是 ToolResultStatus 取值扩展，不进入快照字段白名单。
- **原因**：plan 明确不新增分类聚合、协议版本或自动分类器；现状已满足透传与旧记录可读。
- **后果**：无新增字段与协议识别设施；旧快照与旧运行目录读取语义不变。

### 2026-09-12 — 离线送达统计的数据来源落到 trace 与 records 两个现有台账
- **plan 原文**：显式 facts 用成功结果中实际返回的卡及现有 canonical 信息；RAG 用 delivered；缺 trace、结果或名册版本无法确认时标不可判定。
- **实际做法**：`scripts/tasks/bench/facts-evidence-observation.mjs` 只读运行目录——显式 facts 送达取 trace.jsonl 中 `tool=facts_search` 且 `status=success` 的事件 `hitIds`（canonical）；RAG 附带送达取 records.jsonl 的 `ragDelivery[].attachedFacts[].delivered`；分母名册正式名从 `knowledge/references/名册.md` 表格行首字段解析；核心逻辑接受注入的 runDir/rosterPath/root，隔离夹具测试在 scripts/tests/tasks/bench/ 下用合成记录覆盖。
- **原因**：records 不保存 facts 实际返回卡，trace 的 `hitIds` 是该事实的唯一现有落点；RAG 附带送达按 report 既有口径取 `ragDelivery.delivered`。
- **后果**：无 runner 逐题持久化字段变化；缺 trace 行、结果记录、问题原文或名册时整题标不可判定；有工具批次却缺 ragDelivery、或某次 rag_search 的 attachedFacts 不可用且仍有未被显式 facts 覆盖的对象时按「RAG 附带台账不可用」标不可判定，不当作零送达；名册版本对应仅当运行 meta.source.gitHead 与当前 HEAD 一致且非脏树（或 `--assume-roster-matches`/显式 `--roster`）才成立，否则整题不可判定，不拿当前名册无条件解释旧运行。多对象部分送达、附带省略、重复送达、不适用、缺 trace、RAG 台账不可用与名册版本不对应均有隔离合成用例。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项（纯权衡取舍、无遗留债务的决策记入「决策偏离」）
> 可定位到代码的债务须在代码处写 `TODO(tech-debt) <编号>：` 注释（AGENTS.md 编码核心约束 #5），此处只记编号、结论与未来偿还条件

### 2026-09-13 — 本轮技术债治理（R5-10）
- **R5-10（有代码锚点）**：离线脚本 facts-evidence-observation.mjs 按运行目录文件契约只读取数，与 bench/src 的 JSONL、题集、名册解析存在同构样板，RAG 台账不可用判定口径与 report.ts 已有意分叉；因 scripts 不 import bench/src（分层与构建约定）暂不共享。偿还条件：出现可共享的纯协议包方案，或运行目录文件契约变更需两侧同步时再评估。锚点：scripts/tasks/bench/facts-evidence-observation.mjs 头部注释。
- 本轮治理的其余债项（R5-7 至 R5-9、R5-11 至 R5-16）登记于 docs/plan-facts-multi-term-query-notes.md「债务记录」。

### 2026-09-12 — 新 ADR 未建（计划前置阻塞项）
- **债务**：局部替代 ADR-012「同次响应按顺序执行整批」及其备选方案条目的新 ADR 尚未建立，也未登记 docs/adr/INDEX.md。
- **未来偿还**：无。2026-09-12 已建立 ADR-016 并登记 docs/adr/INDEX.md；步骤 5 已将 ADR-016 状态置「已实施」。

### 2026-09-12 — 提示层与宿主、能力块不一致的过渡态
- **债务**：knowledge/AGENTS.md 已声明「同批额外调用不会被执行、只会被拒绝并回写」，宿主仍整批逐项执行；agent.ts 能力块与 bench/tests/agent-auto-loop.test.ts 的「同批调用逐项结算」断言未同步。
- **未来偿还**：无。2026-09-12 步骤 1 在同一变更内同步了 executor 准入、agent.ts 能力块与计数、provider/inputs/runner 注释及 agent-auto-loop 断言；全仓 `executeBatch` 调用点已迁移为 `executeStep`。

## 意外发现
> 实施中发现的 plan 未覆盖的依赖/边界/风险

### 2026-09-12 — 既有测试断言与提示层新口径直接冲突
- **发现**：bench/tests/agent-auto-loop.test.ts 断言系统提示包含「同批调用逐项结算」；同步能力块文案时若不改该断言会红。plan 步骤 5 只写了「口径一致」，未逐字点名该测试。
- **影响**：实施步骤 1/5 需一并迁移该断言；属已知耦合点，不涉及架构决策，无需新建 ADR。

### 2026-09-12 — doc-check D1 对施工中 plan 的未勾选门禁
- **发现**：doc-check D1 把 docs/ 下的 plan-*.md 一律视为活动计划，存在未勾选验收项即报 error；本计划定稿时验收项必然全未勾选。
- **影响**：文档校验会如实报 D1 error，属计划预期（plan 步骤 5 已写明不为文档检查提前打勾或修改门禁）。合并前按合并门槛处理，不在本笔记或提示层绕过。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

暂无计划相关的实现阻塞。2026-09-12 已完成 ADR-016 与全部五个步骤（单调用准入；计量与 trace/报告/answers.md 口径；knowledge/AGENTS.md 具名取证提示；离线正式名送达统计；验证与文档收束），验收清单已勾选、ADR-016 与索引置「已实施」。

> ✅ 已完成于 2026-09-13
