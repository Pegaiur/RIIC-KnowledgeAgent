# ADR-006：按检索模式暴露独立函数工具与扁平参数

- 日期：2026-09-07
- 状态：已实施
- 替代：局部替代 ADR-005 中的统一 `knowledge(operation, params)` 工具暴露决策；ADR-005 的 auto 循环、预算、取消和原生正文契约继续有效

## 背景

2026-09-07 的 hybrid 运行中，工具调用有 58 次提出、57 次准入、45 次执行；12 次参数错误均来自模型遗漏统一外壳所需的 `params`，其中 11 次为 `lookup`。统一工具还使 `operation` 与 `params.oneOf` 缺少清晰判别关联，并使 `query_operators` 的声明与本地过滤行为不一致。

当前固定配置仍要求 `tool_choice=auto`、Qwen 并行工具调用、每题 5 点预算、错误尝试扣点、第五次准入继续校验、超额拒绝、整题超时/取消、失败费用台账和原生 `assistant.content` 结束。本决策只替换工具暴露与参数协议，不把真实模型结果预先当作质量结论。

## 决策

按检索模式直接暴露以下函数工具，函数名完成路由，参数只保留业务字段：

- `bm25`：`rag_search({query})`
- `grep`：`grep_search({query})`
- `both`：`rag_search({query})`、`grep_search({query})`
- `facts`：`lookup({term})`、`query_operators({...})`
- `hybrid`：`rag_search({query})`、`lookup({term})`、`query_operators({...})`

所有工具使用普通 object、明确 required/properties、`additionalProperties: false`。`query`/`term` 必须为 trim 后非空字符串；`query_operators` 允许多个正向字段取交集，至少有一个正向字段，`excludeIds` 必须为字符串数组且不能单独成请求。lookup 只承诺当前 canonical、技能名、技能组和等价组精确索引，不扩展别名或合称索引。

工具 schema、模式白名单、派发名称和 dry fixture 由同一份定义表生成或引用。执行器仍保留统一预算门面，但直接按 `call.name` 校验与派发，不自动解包旧 `knowledge` 调用。

保留 ADR-005 的其余契约：auto、并行、5 点预算、顺序预占、错误扣点、第五次准入校验、超额拒绝、缺失/重复 call ID 整批 protocol error、取消、费用台账、trace 和原生正文结束。运行 meta 记录工具 schema 版本、稳定 SHA-256 和实际工具名；trace 记录实际 offered tools；旧快照字段缺失时按未知处理并继续可读。

## 理由

函数名直接表达模型要调用的能力，去掉无业务价值的嵌套层，能针对已观测的结构错误提供通用修正；`additionalProperties` 与本地严格校验又能避免错误字段被静默改写后伪装成成功。独立定义表使 agent、provider dry、executor、报告和快照的能力集合保持一致，并允许真实对照按 schema 指纹复核协议包。

真实对照评估的是“拆分 + schema 内容修正 + 本地校验/错误反馈”的协议包整体效果，不能把结果归因于纯拆壳。回答正确率仍是观测指标，不设本轮固定达标线，也不针对题集做特判。

## 备选方案

- 继续使用统一 `knowledge(operation, params)` — 保留已观测的嵌套结构错误和不清晰的 schema 判别关系，放弃。
- 仅增加嵌套示例或自动解包 — 会保留两种协议或掩盖调用错误，不能形成可复核的单一契约，放弃。
- 恢复 `tool_choice=required` 或切换 API 协议 — 改变已验证的 auto/正文结束契约，超出本次范围，放弃。

## 后果

工具描述会从一个大 schema 变为每模式多个函数，输入 schema 总长度和工具选择空间可能变化；工具选择错误、空查和回答事实错误仍可能发生。报告必须区分提出、准入、执行、参数错误、拒绝和命中；`hitIds` 缺失或执行中断显示为未知，不能用 success 或 data 非空替代命中。

正式真实对照应冻结代码、指令、语料和题集，保留实施前/后独立副本及全部结果；不复制密钥，不重复已完成基线。后续若要隔离纯拆壳因果，另设保持其余校验和反馈一致的受控实验。

## 关联

- 规划文档：[独立函数工具与扁平参数实施计划](../archive/plan-independent-tools-schema.md)
- 前置决策：[ADR-005](ADR-005-chat-auto-tool-budget.md)
