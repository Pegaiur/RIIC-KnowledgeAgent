# 单工具调用准入与具名取证提示草案

> 创建日期：2026-09-12
> 状态：未定稿，协议口径与提示措辞讨论中
> 需求入口：docs/inbox.md「强制性串行工具调用实现」与「AGENTS.md 流程指引：具名干员必须调用一次 facts 工具」

## 目标

把查询 Agent 的工具协议从「一次模型响应内可提出多个 tool_calls、宿主逐项串行执行与结算」收紧为「每个模型步骤只执行一个工具调用」，并明确同一步超量调用的处理、计量与 trace 口径；同时在查询契约中以提示层规定：问题涉及具名干员或技能时必须至少完成一次 facts 取证。为两项变更提供可讨论的工程方案，定稿后转 plan 并按判据建立 ADR。

本文承载待讨论的工程方案，机制与措辞尚未定稿。以下代码依据来自 bench/src 与 knowledge/AGENTS.md 阅读，尚未实施协议收紧、发送 parallel_tool_calls、执行兼容性实测或付费对照。

## 非目标

- 不引入玩家问题中的实体识别与宿主强制取证循环。本轮「具名干员必须调用一次 facts」只落在知识库指令层（knowledge/AGENTS.md），不新增「识别具名 → 未调用即回馈」的运行时判定。
- 不改变工具的参数 schema、成功额度（toolBudget，默认 5）与获准尝试上限（toolAttemptLimit，默认 10）的数值与语义；不改 tool_choice 的固定 auto。
- 不使用传输层参数控制并行：provider 请求体不新增 parallel_tool_calls（已实测该字段在 GLM 上被接受但不改变行为）；并行约束只由 knowledge/AGENTS.md 语义强化与宿主单调用准入承担。
- 不强制首检：首检仍由指令与「未调用工具直接作答」的一次宿主回馈兜底，不宣称 API 层保证。
- 不重写历史运行记录、不改写旧 trace/快照口径，不为兼容而并存两套协议表示；不新增哈希或指纹字段。
- 不追求答案质量、token 或费用收益，不以评测分数作为依据；L34 的取证要求不用于事后追分。
- 不把 facts 附带（rag_search 内部 buildFactsAttachment）扩展为独立工具或改变其结果版本；多具名一次取证的返回契约由 docs/plan-facts-multi-term-query.md 与 ADR-015 承载，本草案只引用。
- 本草案不修改 EXPERIMENT.provider 默认值或 provider 注册表；「GLM 端点优先」在本草案内仅作为协议的实测与验证端点，默认 provider 是否切换另行评估。

## 背景与依据

### 现状

- provider.ts 的 buildChatBody **不发送** parallel_tool_calls（第 71 行注释「不发送 parallel_tool_calls：宿主按返回顺序逐项串行执行与结算」）。本轮决议继续不引入该参数：并行约束只由提示层与宿主承担，不依赖传输层开关。
- agent.ts 在检测到 resp.toolCalls.length > 0 时，把**整批**调用写入 assistant 消息，并整批交给 executor.executeBatch（第 239-338 行）。
- tool-executor.ts 的 executeBatch（第 276-300 行）对同批逐项执行「检查上限 → 获准 → 执行 → 结算」，后一项使用前一项结算后的状态；batch.results 逐项回写为 tool 消息。
- knowledge/AGENTS.md 第 3 条只把 facts_search 列为「完整词条事实」的按需选项；第 4 条原有「独立证据需求可同批查询」。作为本次协议收紧的前置声明，第 4 条已改为「工具调用必须逐步进行，禁止并行或同批调用：每次模型步骤只能提出一个工具调用；同批提出的额外调用不会被执行，只会被拒绝并回写」（2026-09-12 随指令服从性探针一并落地，见下）；agent.ts 运行时能力块的「同批调用逐项结算」尚未同步。
- hybrid 模式下 rag_search 会自动附带触发词事实卡（ADR-013 决策 3；trace 的 attachedFacts 观测），因此具名干员问题不必然触发显式 facts 调用。

### 与既有决策的冲突

- ADR-012 的备选方案已把「仅执行批内第一个调用，其余回写拒绝」列为**放弃方案**（理由：会使模型本可一次完成的取证作废，且拒绝理由需新协议表达）；其决策正文亦写明「请求不再发送 parallel_tool_calls: true…这不保证模型每轮仅生成一个调用」。本次收紧等于重新采纳该被放弃方案，属于对 ADR-012 的局部替代，须以新 ADR 记录替代理由，不能只在 plan 内处理。
- AGENTS.md 第 4 条的「可同批查询」与本次协议收紧直接矛盾，已先行改写为禁止并行；但指令层能否被模型稳定遵守尚需实测，不能只改提示而不做宿主约束。

### 协议约束（决定超量处理形态）

OpenAI 兼容 Chat 协议要求：assistant 消息中出现的每个 tool_call id，都必须在后续消息中有对应的 tool 回复。因此「保留首个执行、其余丢弃不回写」会使消息历史不完整，可观测性也丢失；「拒绝并回写」既满足协议，又能保留每个越量调用的 trace 证据。

### 版本与依赖口径

- docs/plan-facts-multi-term-query.md（ADR-015）已在当前分支 feature/facts-multi-term-query 施工，把 facts_search 入参改为 queries 字符串数组（TOOL_SCHEMA_VERSION 10→11，FACTS_RESULT_VERSION 5→6）。多具名一次取证依赖该通道，本草案不重复定义其结果契约。
- 传输层不再涉及 parallel_tool_calls：GLM 已完成接受性与行为实测（结果见下），qwen 与 hy3 不再需要该项实测。

### GLM 端点实测（2026-09-12）

项目改以 GLM 端点优先，故先以 glm-5.3-flash（open.bigmodel.cn/api/paas/v4）做最小探针，测试请求体携带 parallel_tool_calls 的接受性与实际行为：

| 请求形态 | HTTP | 返回 tool_calls | finish_reason |
|---|---|---|---|
| parallel_tool_calls:false | 200 | 2 个（get_weather×2） | tool_calls |
| 不带 parallel_tool_calls | 200 | 2 个（get_weather×2） | tool_calls |
| parallel_tool_calls:true | 200 | 2 个（get_weather×2） | tool_calls |

结论：字段被端点**接受**（无 4xx），但显式 false **不改变行为**，三种形态都在一次响应中返回多个 tool_calls。官方文档复核（2026-09-12，docs.bigmodel.cn 工具调用能力页与对话补全 API 参考）与此一致：核心参数只有 tools 与 tool_choice（且明确「默认且仅支持 auto」），响应侧只列 tool_calls、function.name、function.arguments 与 id，请求参数表未列 parallel_tool_calls，也没有 strict 开关。该字段既无文档依据，也无实测行为效果。因此传输层关闭在 GLM 上不构成强制，宿主准入（每步最多执行首个）是唯一可保证的手段；既有固定 tool_choice=auto 的用法与官方口径一致，无需调整。据此决议不使用该参数做控制，改由提示层语义强化与宿主单调用准入共同约束。该结论为单次样本，未做多次重复、流式对照或与其它模型对照；原始探针脚本未入库（dev-temp/glm-parallel-probe/probe.mjs）。

#### 指令服从性复测（2026-09-12）

在第 4 条声明「不可并行调用工具」后，用同一探针把 knowledge/AGENTS.md 全文作为 system 注入，与无声明基线各测 3 次；问题措辞分别用平行诱导问法（「请同时查询北京和上海…两个城市都要查」）与中性问法（「北京和上海的天气怎么样？」）。

| 变体 | 问题措辞 | 3 次返回的 tool_calls 数 | 出现多次调用 |
|---|---|---|---|
| 无 system（基线） | 中性 | 2、2、2 | 3/3 |
| 注入 AGENTS.md | 中性 | 1、1、1 | 0/3 |
| 注入 AGENTS.md | 平行诱导 | 2、2、1 | 2/3 |

结论：中性问法下，AGENTS.md 的声明 3/3 次使 GLM 只返回一个 tool_call；但同一指令遇到平行诱导措辞时 2/3 次仍返回两个，说明提示层能降低超量调用概率、却随问题措辞波动，不构成硬保证。宿主准入仍是唯一确定性手段。样本量小（每组 3 次）、工具为合成 weather 工具、未覆盖真实知识库工具与多轮轨迹；原始脚本未入库（dev-temp/glm-parallel-probe/probe.mjs）。

## 候选方案与评估

### L38：单工具调用准入

| 方案 | 说明 | 收益 | 新增负担 | 判断 |
|---|---|---|---|---|
| A. 提示强化 + 宿主保留首个、其余回写拒绝（选定） | 不改传输层参数；knowledge/AGENTS.md 语义强化禁止并行；executor 每步只放行首个，其余构造 protocol_rejected 结果并回写 | 协议完整、计量可区分、不引入无效参数、对模型最温和（一次决策只作废其余项，不作废整题） | 新增 status、计量与 trace 口径、测试面 | 选定 |
| B. 宿主整批判为 protocol_error | 同一步出现多调用即整题失败，复用重复 call ID 的失败路径 | 实现最少、语义最硬 | 放大失败率；模型偶发同批即作废整题；与 ADR-012「拒绝理由需新协议表达」的顾虑相同 | 不采纳 |
| C. 仅发传输层 false，不改宿主 | 只做传输层约束 | 改动最小 | GLM 实测该字段被接受但不改变行为，模型仍返回多个调用 | 已实测不成立，不采纳 |
| D. 维持 ADR-012 现状 | 不改 | 无回归 | 不满足需求 | 不采纳 |

本轮不使用任何传输层参数：GLM 实测表明 parallel_tool_calls 被接受但不改变行为，参数控制无效。约束由两点共同承担——AGENTS.md 语义强化（提示层，中性问法下 3/3 被遵守，但平行诱导下仍 2/3 并行，只能降低概率）与宿主只放行首个（确定性保证）。

### L34：具名取证要求

| 方案 | 说明 | 收益 | 新增负担 | 判断 |
|---|---|---|---|---|
| A. 仅提示层（选定） | 在 knowledge/AGENTS.md 规定：问题涉及具名干员或技能时必须至少完成一次 facts 取证；若 rag_search 已附带覆盖本次问题的事实卡，视为已取证，不重复调用；多具名可用 queries 数组一次传入 | 零运行时分支与误判风险；与单调用约束相容 | 无机械保证，依赖模型服从 | 选定 |
| B. 宿主识别 + 回馈兜底 | 识别问题中的具名干员/技能，未调用 facts 时回馈一次（仿 feedbackOnNoToolAnswer） | 有机械约束 | 需实体识别口径（别名、矩阵、误判）、新终止原因与 trace 口径、大批用例 | 本轮不做，留待观测后再议 |
| C. 要求每个具名对象各调用一次 | 逐对象强制 | 覆盖更细 | 与单调用约束叠加会快速消耗预算，且与「附带卡已覆盖」重复 | 不采纳 |

## 实施方案（候选）

按依赖顺序实施；每步给出输入、输出与验收口径。协议口径以新建 ADR 定稿为准。

1. **新建 ADR（前置，阻塞项；编号自增，登记 docs/adr/INDEX.md）** — 输入：ADR-012 的放弃记录与本次需求。输出：新 ADR，记录宿主单调用准入（只放行首个）、超量 protocol_rejected 拒绝、不使用传输层参数控制的决定与 GLM 实测依据、计量与 trace 口径，并声明局部替代 ADR-012 中「不保证每轮一个调用」与备选方案条目。验收：ADR 索引追加一行；plan 引用该 ADR。
2. **provider.ts 不引入参数** — 输入：buildChatBody 现状。输出：维持不发送 parallel_tool_calls，不新增该字段；依据为该字段在 GLM 上被接受但不改变行为。验收：dry 与真实请求体均不含 parallel_tool_calls。
3. **tool-executor.ts 单调用准入** — 输入：现有 executeBatch 逐项循环。输出：每步只放行首个调用；index>0 的调用不占获准尝试、不扣成功额度，构造 status='protocol_rejected'、executed=false、message 为中文拒绝说明的结果；ToolResultStatus 新增 'protocol_rejected'；validateCallIds 保留。方法改名为 executeStep，反映「每步最多执行一个」的新语义，KnowledgeToolExecutor 接口同步更名。
4. **计量、trace 与回写文案口径** — 输入：agent.ts 的 ToolBatchStats 聚合与 trace 事件。输出：requested 含超量项，granted 不含 protocol_rejected（现有 `status !== 'budget_exhausted'` 判据须同步），denied 含超量拒绝且**不新增独立聚合字段**，attempts 只计获准；**回写文案必须与额度耗尽区分**——超量拒绝明确说明「每个模型步骤只执行一个工具调用，本次调用因并行/同批未执行，请在下一步重新提出该工具」，引导模型重新调用，额度耗尽沿用既有提示；回写文字全部计入 resultChars（所有实际送达的计费文字都计入）；超量项不进入 ragDelivery（未执行、无送达观测）。trace 对每个超量项记 tool_call 事件（status=protocol_rejected），toolTrace 只记实际执行的调用。验收：题内调用数、拒绝原因与余额在 trace 与 tool 消息中可区分，report 的 denied 含义在 ADR 说明。
5. **文案同步** — 输入：agent.ts 运行时能力块与 knowledge/AGENTS.md。输出：AGENTS.md 第 4 条已强化为「工具调用必须逐步进行，禁止并行或同批调用；同批额外调用不会被执行、只会被拒绝并回写」（提示层已落地）；能力块的「同批调用逐项结算」改为「每个模型步骤只执行一个工具调用，同批额外调用被拒绝并回写」。验收：两处口径一致；宿主改动落地前，AGENTS.md 已声明的「额外调用被拒绝并回写」属先行声明，须与宿主改动同批收口，不留长期不一致。
6. **L34 提示层** — 输入：knowledge/AGENTS.md 第 3、4 条。输出：问题涉及具名干员或技能时必须至少完成一次 facts 取证；rag_search 已附带覆盖本次问题的事实卡时视为已取证，不重复调用；多具名用 queries 一次传入（引用 ADR-015）。验收：指令与工具 description 口径一致，无「同批」残留。
7. **L34 事后统计（干员名单口径）** — 输入：facts store 的干员名册真源。输出：对每题问题做「是否出现名册中的干员名」的机械统计，作为 L34 取证要求的事后观测；只查名册得到名单，不做自定义实体识别，暂不纳入技能名（需要时再扩展），不改运行时判定、不写入提示。验收：统计可由既有名册查询复算，不新增哈希/指纹字段。
8. **测试（TDD 先行）** — 先写表达预期行为的失败用例，再实现使其转绿。优先覆盖：单调用准入与超量拒绝回写、assistant 消息保留全部 tool_calls 且每个 callId 均有 tool 回复、超量项不扣成功额度也不占获准尝试、回写文案与额度耗尽可区分且引导重新调用、ToolBatchStats/trace 口径、prompt 措辞断言、历史记录仍可读。
9. **消费方同步** — report.ts 的批次统计与 answers.md 工具行、trace.summary 字段、snapshot 字段白名单核对（新增 status 值为取值扩展，预期不新增字段，仍需核对）。
10. **验证** — pnpm run typecheck 与全套 pnpm run test 通过；node scripts/doc-check.mjs 通过；合并前 node scripts/verify.mjs merge -- --base main。

## 待定事项

以下为仍需收口的问题；已决议项直接记入「已定口径」，不再留在待定。

已定口径：

- 超量拒绝**并入 denied**，不新增 protocolRejected 聚合字段；与额度耗尽拒绝的区分只在 trace 的 status 与 ADR 文本中体现。
- 方法改名为 **executeStep**，KnowledgeToolExecutor 接口同步更名。
- TOOL_SCHEMA_VERSION **不动**（工具 schema 形状未变；systemPrompt 变化已由 agentInstructions 捕获）。
- 先不转 plan，本草案保持 draft；L38 定稿时建新建 ADR，L34 提示层不单独建 ADR。
- GLM 已实测：parallel_tool_calls 被接受但不改变行为；**不使用该参数做控制**，provider 维持不发送该字段。
- 并行约束由两项共同承担：AGENTS.md 语义强化（提示层，已落地）+ 宿主只放行首个（待实施）；前者降低概率、后者确定性保证。
- 超量拒绝的回写文案与额度耗尽**区分**：明确说明每步只执行一个调用、本次因并行/同批未执行，并提示模型在下一步重新提出该工具；回写文字全部计入 resultChars；超量项不进入 ragDelivery。
- L34 事后统计纳入本轮：以干员名册查询得到的名单为唯一识别口径，不做自定义实体识别，暂不含技能名。
- 「GLM 端点优先」不单独立项，本草案不改 EXPERIMENT.provider 默认值。

待定：

- L34 与 L38 的实施顺序：宿主单调用准入为前置，L34 提示层与事后统计可后置；是否同批提交以缩短措辞不一致窗口。
- report/answers.md 的汇总展示是否需要在文字上区分两类拒绝（工具消息已区分，汇总字段仍并入 denied）。
- 历史兼容：旧运行记录中 requested>1 的批次按原口径解读，不与新账本直接比较；不改写旧记录。

## 验收清单

以下为首版候选验收项，随草案讨论调整；转 plan 时确定为最终清单。

- [ ] 新建 ADR 建立并局部替代 ADR-012 相关决策，ADR 索引同步
- [ ] provider 不新增 parallel_tool_calls，dry 与真实请求体均不含该字段
- [ ] 宿主每个模型步骤只放行首个 tool_call；assistant 保留全部 tool_calls，每个 callId 均有 tool 回复
- [ ] 超量项 status=protocol_rejected、executed=false、不扣成功额度、不占获准尝试，并入 denied
- [ ] 超量拒绝文案与额度耗尽可区分，并在 tool 消息中提示模型下一步重新提出被拒绝的工具；拒绝文字计入 resultChars；超量项不进入 ragDelivery
- [ ] executeBatch 更名 executeStep，KnowledgeToolExecutor 接口同步，无旧名残留
- [ ] ToolBatchStats、trace.summary、report 与 answers.md 口径与 ADR 一致
- [ ] knowledge/AGENTS.md 第 4 条禁止并行语义与运行时能力块口径一致，无「同批查询」残留
- [ ] 具名干员或技能问题要求至少一次 facts 取证；rag_search 附带事实卡覆盖时视为已取证、不重复调用；多具名可用 queries 一次传入
- [ ] L34 事后统计以干员名册查询得到的名单为唯一口径，可从既有真源复算，不新增哈希/指纹字段
- [ ] 新增/修改用例先红后绿；历史运行记录仍可读、不伪填
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过
- [ ] `node scripts/doc-check.mjs` 通过

## 关联 ADR

- 待建 ADR（编号自增，登记 docs/adr/INDEX.md）— 每个模型步骤单工具调用准入与超量拒绝。
- ADR-012 — 局部替代其「不保证模型每轮仅生成一个调用」的决策与该条放弃方案。
- ADR-015 — 多具名一次取证的 queries 数组通道。
- ADR-013 — rag_search 自动附带事实卡的观测依据，用于 L34 的「已取证」判定。
- ADR-014 — 测试约定（规则文本先行，测试先行）。
- ADR-011 — 检索模式与工具集合收敛，超量拒绝不改变各模式的可用工具集合。
