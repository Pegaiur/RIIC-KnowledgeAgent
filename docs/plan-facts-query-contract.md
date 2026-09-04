# facts query_operators 高 ROI 契约收缩计划

> 创建日期：2026-09-04
> 状态：施工中
> 上游：`docs/plan-facts-record-cards.md`（全量记录卡已完成）；2026-09-04 全量录入验收发现

## 目标

以最小改动收紧 facts 模式 `query_operators` 的查询契约：移除低选择性的稀有度枚举，拒绝空查询、空白查询、仅排除条件和非法 JSON，避免工具静默退化为全库 425 张卡输出。

## 非目标

- 本轮不增加最大卡数、最大字符数、分页、游标或自动截断。
- 不建立宽泛关键词黑名单，不尝试判断用户关键词是否“足够具体”。
- 不修改 `RecordCard.rarity`；星级继续作为干员事实展示。
- 不改 `lookup`、记录卡拼装、人工优化、等价组索引或 B/C 散文接入。
- 不改变 `runQuery` 公共签名和 `query_operators` 工具名。

## 架构分析

当前 `query_operators` 的所有过滤字段均可选，派发层又把 JSON 解析失败回退为 `{}`。因此 `{}`、非法 JSON、仅 `excludeIds`、空白 `termQuery` 都可能执行全库查询。`rarity=5` 单条件当前返回 195 张卡、约 2.7 万字符，但事实题集没有枚举某星级全部干员的需求；具体干员卡仍会展示星级。

本轮按高 ROI 原则只修复已证实的入口缺陷：

1. 工具允许的正向选择条件为 `room / faction / profession / termQuery`。
2. 至少一个正向选择条件经 `trim()` 后非空，查询才有效。
3. `excludeIds` 只修饰有效查询，不能单独构成查询。
4. `rarity` 从工具 schema、内部过滤类型和解析路径移除；传入旧字段且没有其他有效条件时按无效查询处理。
5. 非法参数返回中文工具结果，不抛出导致 agent loop 中断，也不执行 store 查询或序列化。

自由文本仍可能很宽，例如 `termQuery=进驻`。本轮接受该残余风险；先观察真实模型调用，再以实际记录决定是否增加“结果过宽”门禁，避免为假设场景引入分页或截断机制。

## 实施方案

### 1. 收缩过滤类型与工具 schema

- 从 `OperatorFilters` 删除 `rarity`。
- 从 `queryOperatorsTool()` schema 删除 `rarity`，同步工具描述与 facts 系统提示。
- 从 store 过滤逻辑删除稀有度分支；`RecordCard.rarity` 和卡片序列化保持不变。

验收：模型不可再发现或调用稀有度过滤；按具体干员查询时仍显示星级。

### 2. 统一解析并校验有效选择条件

- `safeParseFilters` 对字符串字段先 `trim()`，只保留非空值。
- 非法 JSON 返回无效结果，不得使用 `?? {}` 回退为空过滤。
- 仅当 `room / faction / profession / termQuery` 至少一项存在时返回有效过滤器。
- `excludeIds` 只接受非空字符串并执行 trim；没有正向条件时即使存在排除项也返回无效。
- agent 派发遇到无效参数时返回：`查询参数无效：请至少提供非空的设施、阵营、职业或关键词。`
- 无效调用沿用现有工具调用/轮次预算，不另设重试或豁免机制。

验收：无效参数不会调用 `queryOperators`，不会序列化任何记录卡，agent loop 能收到中文纠错结果并继续。

### 3. 测试与回归

删除原稀有度过滤用例，新增：

- schema 不包含 `rarity`；过滤类型和 store 不支持稀有度查询。
- `{}`、非法 JSON、空白 `termQuery`、仅 `excludeIds` 均返回参数错误。
- 仅传旧 `rarity` 字段按无有效条件拒绝。
- `room=制造站`、`faction=萨尔贡`、`profession=近卫`、`termQuery=木天蓼` 正常返回。
- 有正向条件时 `excludeIds` 继续生效。
- 无效查询结果不含任何干员卡文本。

完成后运行 typecheck、全量测试、build 和完整 20 题 facts dry。若出现真实超宽输出，只记录证据，不在本计划中临时扩张为分页或输出预算机制。

## 验收清单

- [x] `OperatorFilters`、store、工具 schema 和提示中移除 `rarity` 查询能力
- [x] 参数解析统一 trim，并拒绝空查询、空白查询、仅排除条件和非法 JSON
- [x] 无效参数返回中文工具错误，且不查询、不序列化记录卡
- [x] 有效 room/faction/profession/termQuery 与 excludeIds 回归通过
- [x] 实施结果与验证证据追加到 `docs/plan-facts-query-contract-notes.md`
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] `pnpm run build` 全通过
- [x] `node dist/cli.js run --dry --retriever facts` 完整 20 题通过

## 关联 ADR

- 无新增 ADR：本计划只收缩 facts 单模块内部工具参数，不引入依赖，不改变工具名或跨模块调用签名。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan docs/plan-facts-query-contract.md --apply）时替换此行，标记完成日期 -->
