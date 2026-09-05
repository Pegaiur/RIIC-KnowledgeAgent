# Agent 单题执行记录计划

> 创建日期：2026-09-05
> 状态：施工中

## 目标

在不改变 Agent 路由、提示词、预算、工具参数和回答行为的前提下，为每道基准题生成一行可人工复盘的 `trace.jsonl`，保存逐轮 LLM 响应、工具原始与实际参数、命中及注入结果、控制提示和失败位置。

## 非目标

- 不调整检索算法、工具 schema、fallback、预算、prompt 或 provider 接口语义。
- 不引入事件总线、通用追踪 API、数据库、replay、新第三方依赖或自动诊断报告。
- 不在首版记录隐藏推理、请求 headers、完整 config、BM25/grep 评分明细或 gold 快照。
- 不承诺进程被强杀时保留当前尚未完成题目的记录；真实模型复跑只用于确认记录的复盘价值。

## 架构分析

当前 `records.jsonl` 只保存 token、成本和工具名，`answers.md` 只保存最终答案，`injected.json` 只保存每题累计去重后的 RAG/grep chunk ID。`runQuery` 内部已有 LLM 调用、工具参数解析、检索命中、facts store 查询和 tool message 回写等局部事实，但结束时没有统一保留，因此无法解释参数回退、facts 返回内容、截断注入、预算拒绝或被丢弃的提前回答。

trace 采用每题一个 JSON 对象、运行目录内逐行追加的协议。采集通过可选的 `AgentOptions.trace` 传入 `runQuery`，未传入时保持现有调用行为；`runQuery` 在现有分支就地登记事件，避免导出完整 `messages` 或重构工具执行边界。落盘副本只对已知 API Key 和错误摘要做定向遮蔽，不改变传给模型的消息。

## 实施方案

1. **固定现有行为并定义记录模型**：在现有 `agent.test.ts`、`facts-tools.test.ts` provider mock 基础上，明确 LLM、tool、control 三类事件的字段和事件顺序；记录公开 assistant content、工具调用、usage、`truncated`，不记录 reasoning。验收：改造前已有断言继续通过，`runQuery` 不传 trace 时 `AgentResult` 形状和消息序列不变。
2. **补充 Agent 采集**：在 LLM 调用前后、工具执行前后及最少检索约束分支增加记录点。RAG/grep 保存实际 query、按返回顺序的 chunk ID 和本次真正进入上下文的 ID；lookup/query_operators 保存实际传给 store 的参数及 canonical 命中/注入 ID；每次调用独立记录重复 ID，写回文本取实际追加的 tool message content。异常沿用现有传播方式，同时标记 `llm` 或 `tool` 阶段、轮次和调用 ID。
3. **由 runner 逐题落盘**：runner 为每题创建 `schemaVersion: 1` 的 trace 记录并经 `AgentOptions` 传入；在成功或失败后立即向 `trace.jsonl` 追加一行，失败题保留已有事件并附错误摘要与位置，继续既有单题失败不中断批次的流程。同步扩展 `RunOutput` 与 CLI 输出 trace 路径，其他 `records.jsonl`、`answers.md`、`injected.json` 协议保持不变。
4. **补充回归与安全断言**：覆盖正常单/多工具、参数回退与拒绝、空结果、未知工具、预算拒绝、强制检索、LLM/工具异常、RAG 截断、facts canonical 命中和 API Key/错误摘要遮蔽；断言事件顺序、实际写回文本、失败前事件和行为中立。运行固定 mock 的 `agent.test.ts`、`facts-tools.test.ts`，再运行全量 typecheck/test/build 与 dry benchmark。
5. **人工复盘验证**：用代表性题目检查 dry 或真实运行产物的可读性，优先覆盖 F05/S08、提前作答的 F10 和曾使用 facts 的题目；记录能定位的证据缺口。若需要新统计或公共契约，再另行追加 inbox/ADR，不扩张本计划。

## 验收清单

- [x] trace 类型与脱敏边界完成，未记录 hidden reasoning、headers 或完整 config。
- [x] `runQuery` 记录 `llm_call`、`tool_call`、`control`，并保持原有 AgentResult、消息和异常语义。
- [x] runner 为每题成功/失败追加一行 `trace.jsonl`，失败保留已发生事件并写出阶段位置。
- [x] CLI 和 `RunOutput` 暴露 trace 路径，原有四类产物协议不变。
- [x] 固定 mock 覆盖正常、回退、拒绝、空结果、预算、未知工具、截断及异常场景。
- [x] API Key 及错误摘要中的已知敏感值在 trace 副本中被遮蔽。
- [x] 代表性运行产物完成一次人工阅读并记录复盘结论。
- [x] `pnpm run typecheck` 全通过。
- [x] `pnpm run test` 全通过。
- [x] `pnpm run build` 全通过。
- [x] `pnpm run bench:dry` 全通过。

## 关联 ADR

- 无：当前属于 bench 内部兼容性记录扩展，不改变跨模块公共接口或依赖方向。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
