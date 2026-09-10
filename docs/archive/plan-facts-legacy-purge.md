# facts legacy 实现清理计划

> 创建日期：2026-09-10
> 状态：已完成
> 修订：2026-09-10，按用户要求同步后续旧称说明清理，并删除旧称专项验收要求。

## 目标

删除 `facts_search` 的旧称兼容实现：移除 `legacyNames`（redirect / reject）、`ResolutionPath` 的 `legacy` / `rejected` 两类路径及其专用索引、校验和渲染代码。后续清理三个旧组合名的语料说明与词表登记，保留 exact / alias / substring / combo 四类路径与既有同名全部返回行为，依据 [ADR-010](../adr/ADR-010-facts-alias-disambiguation.md) §7 实施。

## 非目标

- 组合／搭配名称结构标准、正式组合准入、成员关系表达及推荐边界统一；相关需求仅登记于 [inbox](../inbox.md)，本轮暂缓，不另启动实施计划。
- 三个旧组合名之外的语料命名迁移；不修改 `knowledge/base`、`knowledge/references` 或检索白名单。
- 分词与 RAG 检索算法、术语规则、旧词黑名单或旧词专项回归；不要求历史文档和 RAG 结果中的所有旧词消失。
- 别名、31 组子串对、搭配规范名、成员与实际使用条件、同名全部返回的语义调整；不改历史 `lookup` / `queryOperators` 数据接口。
- 历史试验、评测 spec 与 S04/S06 原答核查记录的修改；不新增参数、哈希字段或兼容映射，不修改 Agent 决策契约，不启动付费运行。

## 架构分析

清理前 `legacyNames` 登记三个 redirect：迷迭香感知链、巫恋裁缝核、龙门中枢制造组；生产 reject 条目为零。兼容实现删除后，提交 `dd2f23e` 进一步清理这些名称在 guides、raw 工作稿、ENTITY_WORDS、fixtures 注释与搭配条件中的说明，现使用感知信息组、龙舌兰组、龙门中枢组。组合／搭配名称结构标准继续暂缓。

查询统一按现有登记处理：合法命中返回对应路径，没有合法命中则按未收录返回。2026-09-10 用户要求删除过时描述和要求，取消三个旧词的专项验收，不维护历史名称测试清单；通用未收录、trim、合法命中和协议回归继续保留。

兼容实现修改集中于 [terms.ts](../../bench/src/facts/terms.ts)、[curation/terms.ts](../../bench/src/facts/curation/terms.ts)、[store.ts](../../bench/src/facts/store.ts) 和 [tool-executor.ts](../../bench/src/tool-executor.ts)。旧称专用 ID 索引随消费者一起删除，搭配本身的 `ComboRef`、ID 唯一性与成员校验继续保留。后续语料与词表清理会影响检索输入和输出文字，不能视为零行为变化的代码重构。

## 实施方案

按依赖顺序完成；类型删除与直接消费者迁移同批处理，保持可编译。开始编码时按仓库规则创建实施笔记。

### 步骤1：删除登记、校验与查询分支

- `terms.ts`：删除 `LegacyEntry`、`TermCurations.legacyNames`、`EMPTY_TERM_CURATIONS.legacyNames`、对应数组存在性判断和校验；删除仅为旧称目标查验服务的 `comboById` 及填充代码，保留搭配名称和 ID 校验。
- `curation/terms.ts`：删除三条 `legacyNames` 登记及龙门中枢组条件中的旧名说明；别名、子串对、搭配成员与实际使用条件保持。
- 后续名称清理：guides 与 raw 删除三个旧组合名的过渡说明；ENTITY_WORDS 使用现有规范组合名，fixtures 注释及检索测试同步名称。词表仍由现有检索消费者读取，不另加旧词映射。
- `store.ts`：删除 `LegacyEntry` 导入、`legacyByTerm`、`combosById` 及填充代码；删除 legacy / rejected 路径收集、联合类型成员和渲染分支；清理仅服务旧称的助手、参数与说明，不保留兼容壳。
- substring 覆盖判定仍先收集全部其他路径，覆盖集合收窄为 exact / alias / combo；部分覆盖保留完整目标，全部覆盖才省略。最终路径顺序为 exact → alias → substring → combo，卡片顺序与去重规则不变。
- 同步迁移测试中 `TermCurations` 字面量，删除旧称专用用例及固定旧词未收录用例；混合用例只改写被删除路径部分，保留其他行为的回归。

### 步骤2：协议、序列化与调用链

- `FACTS_RESULT_VERSION` 4→5，表示路径种类集合变化；`TOOL_SCHEMA_VERSION` 保持 8，工具参数与描述不变。
- 同步全部结果版本断言；`renderResolutionPath` 保留 switch + never 穷尽检查，最终仅处理四类路径。
- 无合法路径时返回 `empty`、`executed:true`、`paths:[]`、空 `hitIds` / `injectedIds`、计数 0、`complete:true`，使用现有未收录正文，不输出旧称重定向或拒绝理由。
- executor 的协议／参数／运行错误与预算提示继续保留；不得把删除 `rejected` 解析路径扩大为删除工具错误处理。
- 正文、resolution 元数据、计数、trace 与落盘序列化沿用同一结果，完整卡片返回语义不变。

### 步骤3：回归与文档状态同步

- 修改 `facts-curation.test.ts`、`facts-terms.test.ts`、`facts-search-resolution.test.ts`、`facts-resolution-executor.test.ts` 及其他受版本变更影响的用例；来源核验迭代移除 legacyNames，仍覆盖其余登记。
- 保留别名多目标、同名跨类别并集、子串单向展开及 alias / combo 覆盖回归；删除原子串 S8 中依赖 legacy 的用例，保留 combo 覆盖并补足其余合法路径的覆盖检查。
- 执行 `pnpm run typecheck`、`pnpm run test`；完成实际验收后再勾选本计划，并同步 ADR-010 §7、ADR INDEX 与 inbox 的完成状态。
- `node scripts/doc-check.mjs` 在实施项完成后通过；合并前执行 `node scripts/verify.mjs merge -- --base main`。文档方案提交阶段保留未完成项，不宣称已通过实施验收。
- 历史计划与核查记录保留原有事实；本计划与 ADR §7 标明后续契约变化，不回写旧测试结果或旧评测结论。

## 验证矩阵

| 用例 | 输入及数据 | 必须观察到的结果 |
|---|---|---|
| L1 | 未登记合成词、尚未支持的简写合称 | empty、executed:true、paths:[]、hitIds/injectedIds:[]、matchedCount/returnedCount:0、complete:true，使用现有未收录正文 |
| L2 | 合法“共享词”带首尾空白；未登记的多人连写 | 沿用 trim 与未收录处理，不拆词或猜测成员 |
| L3 | 合成“共享词”同时命中干员、阵营与搭配 | 全部合法路径及成员返回，按输入卡序去重 |
| R1 | 维娜、临光、龙舌兰组、叙拉古与既有31组子串回归 | 别名、子串、搭配及同名多身份行为保持，类别与去重计数不变 |
| R2 | 一短多长，alias 部分覆盖、combo 全部覆盖，以及 alias / combo 联合覆盖 | 部分覆盖保留完整 substring 目标；全部覆盖省略 substring；路径按四类固定顺序输出 |
| P1 | L1 空结果与 R1 成功结果经 executor、tool message、trace 与落盘序列化 | FACTS_RESULT_VERSION=5、TOOL_SCHEMA_VERSION=8；计数和 ID 一致，resolution 仅含四类合法路径 |
| P2 | 无效参数、运行错误、预算耗尽的既有测试 | 原有状态与计量保持，不把工具错误与被删除的 rejected 路径混淆 |

## 验收清单

- [x] 旧称登记类型、三条数据、专用索引与校验删除，消费者迁移完成
- [x] legacy / rejected 路径与渲染删除，四类路径及子串覆盖规则保持
- [x] FACTS_RESULT_VERSION 升为 5，序列化、trace 与版本断言同步
- [x] 通用未收录、同词合法命中、别名／子串／搭配及工具错误回归通过
- [x] 三个旧组合名的说明与词表清理完成，搭配成员及实际使用条件、命名标准和历史评测未改写
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] ADR、INDEX 与 inbox 状态据实际完成情况同步，`node scripts/doc-check.mjs` 全通过

## 关联 ADR

- [ADR-010](../adr/ADR-010-facts-alias-disambiguation.md) — §7 facts legacy 与旧称说明清理，已实施

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->

## 实施纪要

# 实施笔记：facts legacy 实现清理

> 对应 spec：docs/plan-facts-legacy-purge.md
> 开始日期：2026-09-10

## 决策偏离
> spec 中没有提到，但在实施中做出的重要决策

### 2026-09-10 — 后续旧称说明清理与验收要求收束
- **背景**：初始实施仅删除兼容路径；后续提交 `dd2f23e` 已清理三个旧组合名在 guides、raw、ENTITY_WORDS、fixtures 注释和搭配条件中的说明，并删除三个固定旧词的未收录测试。
- **决策**：完成度检查发现原计划仍要求这些专项测试且描述语料、词表未改。用户随后要求“修正删除过时描述和要求后提交”，因此取消固定旧词的专项验收，保留既有通用未收录、trim、同名合法命中、别名／子串／搭配及错误协议回归。
- **影响**：词表修改会影响 grep 模式与排序、jieba 字典及实体加权集合；guides 内容与搭配条件的输出文字也已改变，不能作为零行为重构记账。组合命名标准继续暂缓，历史评测不改写。
- **验证**：在 `b7add40` 上完成五项 merge 门禁，39 个文件、426 项测试通过；此前 429 项与当前差额来自已删除的三个专项用例。内存对比实际 grep 实现：查询“龙舌兰组搭配”，两个片段依次为“龙舌兰”“龙舌兰组”，topK=1，词表更新前返回首个片段，更新后返回第二个片段，确认存在名称数据带来的排序变化。
- **后果**：已回馈计划、ADR-010 与 inbox，决策正文删除过时兼容条款，历史测试结果不回写。

## 实现调整
> spec 中有描述，但实际实现方式不同

### 2026-09-10 — 旧称专用测试用例改写而非整体删除
- **spec 原文**：步骤1「删除旧称专用用例；混合用例只改写被删除路径部分，保留其他行为的回归」。
- **实际做法**：`facts-search-resolution.test.ts` 的 trim 用例查询词由 `旧共享词` 换为仍合法的 `共享词`（断言改为 exact/exact/combo）；序列化用例移除纯拒绝断言并补 `未收录精确词条` 断言；S8 旧称覆盖用例改写为「alias 与 combo 联合覆盖全部长名时省略子串路径」；`facts-resolution-executor.test.ts` 删除 reject 用例并移除随之不再使用的 `RecordCard` 导入。
- **原因**：这些用例的主体词仅由 legacy 登记命中，删除实现后断言失去对象；改用仍合法的路径保留覆盖意图。
- **后果**：无下游文档需更新。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项（纯权衡取舍、无遗留债务的决策记入「决策偏离」）
> 可定位到代码的债务须在代码处写 `TODO(tech-debt) <编号>：` 注释（AGENTS.md 编码核心约束 #6），此处只记编号、结论与未来偿还条件

## 意外发现
> 实施中发现的 spec 未覆盖的依赖/边界/风险

## 阻塞与解决
> 遇到的阻塞问题及解决方案

> ✅ 已完成于 2026-09-10
