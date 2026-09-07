# ADR-005：Chat auto 工具循环与每题积分预算

- 日期：2026-09-05
- 状态：已实施

## 背景

当前查询 Agent 使用 Chat Completions、本地 function tools 和 auto，但通过固定模型轮次、末轮移除工具和程序化 user 催询推动对话。用户要求一次真实提问内由 Agent 自主完成多批工具往返并以原生 content 作答，支持并行工具调用，以每题积分限制实际工具尝试。

本次决策废弃固定轮次推进方案，并调整 agent/provider/runner 间的预算、终止和费用记录契约，因此以 ADR 保存决策依据，施工细节统一进入计划。此前四份评估草案在定稿时删除。

## 决策

保留 Chat Completions 和本地检索实现，全程使用 `tool_choice=auto`。工具统一为 `knowledge(operation, params)`，一次调用对应一个原检索操作；Qwen 显式开启同次响应内的并行调用，模型可根据前一批结果继续决策。最终回答直接取有效的 `assistant.content`。

每次真实用户提问建立独立 session，默认 5 点，所有工具共享，每个获准尝试消耗 1 点。批次先按顺序预占再执行，第五个获准尝试仍返回结果，超额请求只返回预算耗尽及作答提示。正常过程不按模型步骤数撤回工具，也不强制用满积分。

原程序化 user 消息仅作为“此前没有任何工具调用，却直接输出答案”的回馈兜底，每题最多一次。回馈不重置预算，不成为第二个用户问题，也不修改 auto；再次无工具作答标记未完成。错误、无命中和额度不足通过工具结果表达。

保留独立整题超时和取消作为异常终止机制，失败也保留已知费用与部分轨迹。人工查询规则继续遵守 ADR-004，从 `knowledge/AGENTS.md` 唯一维护。

## 理由

2026-09-05 的 Qwen3.7-Flash 非思考探针已验证：固定 auto 配合统一 schema 可完成同批三个独立调用、依赖前一结果的后续调用及最终正文。另一次十请求对照中，Chat required 和百炼 Anthropic 兼容 Messages any 各连续三个生成步骤均重复调用工具，没有回答文本；相同历史的四个 auto 对照全部正确返回工具中的核验码。切换协议没有解决持续强制调用与原生正文结束的冲突。

工具预算按调用而非批次数扣除，使并行与顺序执行遵守相同额度。用户确定的是固定 auto，并仅在未调用工具直接作答时保留回馈；“每题最多一次，仍未调用则记未完成”是本计划为避免重复催询所选择的实施取舍，并非用户原始要求中的明确次数。该取舍不限制正常工具循环，也无需增加作答工具或请求阶段切换。原接口与本地实现可复用，协议迁移也没有单独降低 token 的实测依据。

接口参数依据：[百炼 Function Calling](https://help.aliyun.com/zh/model-studio/qwen-function-calling)、[百炼 Anthropic Messages](https://help.aliyun.com/zh/model-studio/anthropic-api-messages)。结论限于已测模型及配置，不外推原生 Claude。

## 备选方案

- 每次生成都 required/any — 持续要求工具调用，本次实测未自主结束为正文。
- 首次 required，后续 auto — 技术上仍属一个用户 session，但用户最终选择固定 auto 与异常回馈。
- 预算耗尽切 none 或清空工具 — 会由宿主切换作答阶段，未采用。
- 用作答工具提交答案 — 改变原生 content 输出契约，未采用。
- Responses、Messages 或 MCP 迁移 — 当前目标可由现有 Chat 和本地工具满足，额外适配不构成本计划前提。

## 后果

auto 不保证首检，回馈也不保证后续一定查询；应显式记录未完成结果。五点限制的是工具准入次数，模型仍可能继续提出被拒绝的调用，所以整题异常终止和失败费用保留必须一起实现。

统一 schema 不自动减少 token，五点额度还可能扩大证据量；实施后用旧实现、新两点和新五点分组评估质量、费用及完成率。已有真实知识样例出现订单条件误读，不能把协议链路通过当作答案质量通过。

原始探针保存在忽略的 `dev-temp/unified-required-session/2026-09-05T09-07-24-708Z/` 与 `dev-temp/unified-required-session/protocol-comparison-2026-09-05T09-17-14-610Z/`。这些是本机验证产物；实施契约及必要结论已落在正式文档中，不依赖草案继续维护。

## 关联

- 规划文档：[Chat auto 工具循环与每题积分预算实施计划](../archive/plan-agent-auto-tool-budget.md)。
- 需求入口：[需求收件箱](../inbox.md)。
- 既有约束：[ADR-004](ADR-004-query-agent-knowledge-layering.md)。
