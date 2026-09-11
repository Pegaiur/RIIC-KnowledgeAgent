# 实施笔记：查询工具链收敛与预算语义调整

> 对应 plan：docs/plan-hybrid-default-tool-budget.md
> 开始日期：2026-09-11

## 决策偏离
> plan 中没有提到，但在实施中做出的重要决策

### 2026-09-11 — bm25 干跑保留首轮 rag_search 占位调用
- **背景**：步骤 2 要求 provider dry 模式删除 `facts`/`grep`/`both` 三个占位分支。若连 `bm25` 的首轮工具调用占位一并删除，`--dry --retriever bm25` 首轮即返回正文，会触发未调用工具回馈并在第二次直接作答时以 `no_tool_after_feedback` 失败。
- **选项**：
  - A: 只保留 `hybrid` 分支，bm25 直接作答（干跑会失败）。
  - B: 保留 hybrid 分支 + 通用默认分支（首轮返回 `rag_search` 占位调用，第二轮起作答）。
- **决策**：B。默认分支用固定 `rag_search` 占位，既满足「删除 facts/grep/both 占位分支」，又保持 bm25 干跑可跑通。
- **影响**：`provider.test.ts` 的 dry 矩阵按模式断言各自的占位查询文本。

### 2026-09-11 — 尝试上限经 config 透传，不新增执行器构造参数
- **背景**：plan 要求执行器同时受「成功额度（构造参数 limit）」与「获准尝试上限（新增配置）」约束。可把两者都作为 `createKnowledgeToolExecutor` 参数，或让执行器从 `context.config` 读取尝试上限。
- **选项**：
  - A: 构造签名改为 `(context, budget: { successLimit, attemptLimit })`——需改动全部测试夹具。
  - B: 保留第二参数为成功额度，执行器从 `config.toolAttemptLimit` 读取尝试上限——调用点不变。
- **决策**：B。`config` 已在 `context` 中且为唯一运行配置来源，避免为新增一个上限改写所有 `createKnowledgeToolExecutor(..., N)` 调用；测试需要自定义尝试上限时直接改 `config.toolAttemptLimit`。
- **影响**：执行器对 `config.toolAttemptLimit` 做正整数校验；`snapshot()` 的 `remaining` 定义为成功额度余额。

## 实现调整
> plan 中有描述，但实际实现方式不同

### 2026-09-11 — 步骤 1 与步骤 2 合并为同一提交
- **plan 原文**：步骤 1 收缩 `RetrieverId` 与工具集合；步骤 2 单独做默认值切换、失效分支清理、配置校验与 CLI 缺值处理。
- **实际做法**：`RetrieverId` 收缩后，`provider.ts`/`runner.ts`/`cli.ts` 对已删除字面量（`'facts'`/`'grep'`/`'both'`）的比较会触发 TS2367（无可重叠类型），测试中也大量出现 `config.retriever = 'facts'` 赋值，无法单独编译；默认值继续停在 `bm25` 会让测试夹具先改成 `'hybrid'` 又在下一步回归默认，形成双份改动。因此把步骤 1、2 合并为一笔提交：模式枚举收缩、工具集合收敛、失效分支清理、默认值改 `hybrid`、配置校验与 CLI 缺值处理一并完成。
- **原因**：模式枚举与默认值/分支在类型与测试层强耦合，拆开无法得到两笔各自通过 typecheck 与 test 的提交。
- **后果**：plan 验收项不变，仅提交粒度调整；后续步骤 3-6 仍各自独立提交。

### 2026-09-11 — 步骤 3 至步骤 4 之间 budgetUsed 口径为过渡态
- **plan 原文**：步骤 3 只改预算结算与串行执行；步骤 4 再统一 answers/meta/inputs/trace/snapshot 的双预算观测字段。
- **实际做法**：步骤 3 先让 `AgentResult.budget` 暴露 `successUsed`，runner 的 `budgetUsed` 暂取 `successUsed`（成功额度口径）；`ToolBatchStats`、snapshot 解析与 answers 展示仍沿用旧字段名，待步骤 4 一次性贯通 `attempts`/`successes` 与双预算行。
- **原因**：`ToolBudgetState` 字段改名属步骤 3 必要项，而观测格式变更集中在步骤 4；两步之间保持可编译与可测，避免在步骤 3 提前引入尚未定稿的观测字段。
- **后果**：此中间态的运行目录不应被当作最终口径解读；步骤 4 提交后 `toolBudget` 语义与展示同步更新，历史记录按原口径读取。

### 2026-09-11 — 观测字段以「缺失即可用性未知」区分新旧口径
- **plan 原文**：新运行始终写入 `attempts`/`successes`，历史记录允许缺失，缺失表示不可用，不伪填零或由 executed 推算。
- **实际做法**：`ToolBatchStats.attempts/successes` 与 `SnapshotQuery.attemptUsed/attemptLimit` 均为可选；`report.toolStats.attempts/successes` 用 `number | null` 表示，任一批次缺字段即整体为 `null` 并在报告渲染为「不可用」；`snapshot` 的 `TOOL_BATCH_KEYS` 把两项列入 `OPTIONAL_TOOL_BATCH_KEYS`，旧快照与旧运行目录仍可读。
- **原因**：把「历史没有该统计」与「真实为 0」区分开，避免下游把伪零当作真实计数。
- **后果**：`meta.json` 新增 `toolAttempts`/`toolSuccesses`（归入 `META_SUMMARY_KEYS`，快照不保留）；`META_ALLOWED_KEYS` 新增保留配置字段 `toolAttemptLimit`。

### 2026-09-11 — answers.md 预算行兼容新旧两种格式
- **plan 原文**：回答解析同时支持旧预算行和新双预算行，不以替换旧正则的方式丢弃历史格式。
- **实际做法**：`parseAnswers` 先匹配新行「成功额度：a/b｜获准尝试：c/d」，再回退旧行「预算：a/b」，最后回退「轮数/检索次数」；新行的 `budgetUsed/Remaining` 表示成功额度，旧行保留原「获准即扣」口径，旧行缺 attempt 字段时保持缺失。
- **原因**：历史 `bench-runs` 与已导出快照仍按旧行读取，替换正则会使其解析为空。
- **后果**：runner 的 `answers.md` 改为输出新行；`SnapshotQuery` 增加可选 attempt 字段贯通运行目录导出与快照往返。

### 2026-09-11 — 步骤 5「两条提示构建路径」按 runner 预构建与 runQuery 默认构建落地
- **plan 原文**：「验证自定义尝试上限进入两条提示构建路径及 inputs/meta」。
- **实际做法**：把「两条路径」解释为 runner 在首个请求前预构建的 system prompt（runner.ts 的 `buildSystemPrompt(config.retriever, agentInstructions, config.toolBudget, config.toolAttemptLimit)`）与 runQuery 未提供 `systemPrompt` 时的默认构建路径；在 agent.test.ts 覆盖后者，在 inputs.test.ts 以自定义 `toolBudget=3`、`toolAttemptLimit=4` 运行并断言预构建提示、`inputs.systemPrompt.text`、`inputs.config` 与 `meta` 均带实际双上限。agent-auto-loop.test.ts 补「获准尝试上限耗尽后只拒绝、不新增执行」用例。
- **原因**：独立审查指出仅覆盖默认构建路径时，runner 预构建漏传 `config.toolAttemptLimit` 不会被测试捕获。
- **后果**：两条路径与 inputs/meta 均有回归覆盖；测试夹具沿用 `hybrid`，不新增对已删除模式的引用。

### 2026-09-11 — 步骤 6 收束范围收窄为文档同步与门禁
- **plan 原文**：「全部交付并完成发布元数据收束、计划归档后执行合并门禁」。
- **实际做法**：经用户确认，本轮只做文档状态同步（勾选 plan 验收清单、ADR-011/012 与 ADR 索引置「已实施」、inbox 条目标记完成）并跑通 typecheck / test / doc-check / verify merge；不执行 release/prepare 归档、不改版本号与 CHANGELOG、不打 tag、不合并 main。
- **原因**：plan 步骤 6 的验收项只列四条命令，未含版本与发版产物；发布元数据收束与计划归档属 release 流程，须由用户显式授权后再执行。
- **后果**：plan 保持活动状态（全勾选、未冻结、未归档），inbox 的 `[x]` 条目与 plan 归档留待发布收束时经 `node scripts/tooling.mjs run release/prepare -- --plan docs/plan-hybrid-default-tool-budget.md --apply` 一并处理，届时在最终提交上重跑合并门禁。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项（纯权衡取舍、无遗留债务的决策记入「决策偏离」）
> 可定位到代码的债务须在代码处写 `TODO(tech-debt) <编号>：` 注释（AGENTS.md 编码核心约束 #6），此处只记编号、结论与未来偿还条件

## 意外发现
> 实施中发现的 plan 未覆盖的依赖/边界/风险

### 2026-09-11 — 旧测试大量依赖「整批预占」断言
- **发现**：`tool-executor.test.ts`、`agent-auto-loop.test.ts` 的旧用例以「剩余 N 点则只执行前 N 个」为前提；改为逐项结算后，空结果/参数错误不再消耗成功额度，同批后续有效调用会被继续准入，原断言（如 3 调用只执行前 2 个）不再成立。
- **影响**：按新契约重写这些用例为「按结算后状态逐项判定」，并新增尝试上限、双限同时用尽、批内顺序、read_section 空页免扣等边界用例；plan 步骤 3 验收项未变。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

### 2026-09-11 — 验收发现两处 P2 契约遗漏（提交 a413dff 后返工）
- **症状**：① `maxContextChars=1` 时 `rag_search` 只送达截断头部（如「【」）仍判 `success`、扣 1 点并拒绝后续调用；② 历史记录含 `tools: ['grep_search']` 且缺整个 `toolBatch` 时，报告把获准尝试/成功数显示为 0，而非「不可用」。
- **根因**：① rag_search 状态按序列化后的 `data` 是否非空判定，`buildRagData` 也按块起始偏移是否进入预算记录 `injectedIds`，头部占位文字被当成证据；② `sumOptionalField` 在 `batches.length === 0` 时直接返回 0，未区分「确实没有工具调用」与「有工具调用却缺 toolBatch」。
- **解决方案**：① `buildRagData` 改为按「块正文（头部之后的文本）是否进入送达前缀」记录 `injectedIds` 并返回 `delivered`，`rag_search` 以 `delivered` 决定 `success`/`empty`；② `sumOptionalField` 增加 `records` 入参，存在 `tools` 非空却无 `toolBatch` 的记录时返回 `null`（渲染为「不可用」），无工具调用仍为 0。
- **预防**：补 `tool-executor.test.ts`（头部截断判空、免扣成功额度、不拒绝后续调用）与 `report.test.ts`（有工具调用缺 toolBatch → 不可用；完全无工具调用 → 0）回归用例；两处均为 plan 状态表与历史兼容契约的既有要求，未扩大范围、未新增 ADR。
