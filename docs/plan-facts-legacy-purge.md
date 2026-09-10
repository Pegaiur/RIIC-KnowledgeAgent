# facts legacy 实现清理计划

> 创建日期：2026-09-10
> 状态：施工中（方案已收窄，尚未编码）

## 目标

删除 `facts_search` 的旧称兼容实现：移除 `legacyNames`（redirect / reject）、`ResolutionPath` 的 `legacy` / `rejected` 两类路径及其专用索引、校验和渲染代码。保留 exact / alias / substring / combo 四类路径与既有同名全部返回行为，依据 [ADR-010](adr/ADR-010-facts-alias-disambiguation.md) §7 实施。

## 非目标

- 组合／搭配名称结构标准、正式组合准入、成员关系表达及推荐边界统一；相关需求仅登记于 [inbox](inbox.md)，本轮暂缓，不另启动实施计划。
- 语料旧名净化、搭配改名、`ComboEntry.conditions` 文案改写；不修改 `knowledge/base`、`knowledge/guides`、`knowledge/references`、`knowledge/raw` 或检索白名单。
- `ENTITY_WORDS` 清理、分词、RAG 检索策略、术语规则与旧词黑名单门禁；不承诺旧词从正文或 RAG 结果中消失。
- 别名、31 组子串对、搭配成员与条件、同名全部返回的语义调整；不改历史 `lookup` / `queryOperators` 数据接口。
- 历史试验、评测 spec 与 S04/S06 原答核查记录的修改；不新增参数、哈希字段或兼容映射，不修改 Agent 决策契约，不启动付费运行。

## 架构分析

当前 `legacyNames` 仅登记三个 redirect：迷迭香感知链、巫恋裁缝核、龙门中枢制造组；生产 reject 条目为零，拒绝分支仅由合成数据覆盖。用户于 2026-09-10 收窄范围为仅清理该兼容实现，组合命名与语料治理后置。

旧称路径删除后，这三个当前仅由 redirect 命中的词按未收录返回。取消兼容不等于禁止词语：同一文本若合法命中 exact / alias / substring / combo，仍返回对应结果；例如“拉特兰”仍可命中阵营。语料、搭配条件与 RAG 中已有旧名说明允许继续存在，本计划不根据字符串是否曾为旧称屏蔽结果。

代码修改集中于 [terms.ts](../bench/src/facts/terms.ts)、[curation/terms.ts](../bench/src/facts/curation/terms.ts)、[store.ts](../bench/src/facts/store.ts) 和 [tool-executor.ts](../bench/src/tool-executor.ts)。旧称专用 ID 索引随消费者一起删除，搭配本身的 `ComboRef`、ID 唯一性与成员校验继续保留。

## 实施方案

按依赖顺序完成；类型删除与直接消费者迁移同批处理，保持可编译。开始编码时按仓库规则创建实施笔记。

### 步骤1：删除登记、校验与查询分支

- `terms.ts`：删除 `LegacyEntry`、`TermCurations.legacyNames`、`EMPTY_TERM_CURATIONS.legacyNames`、对应数组存在性判断和校验；删除仅为旧称目标查验服务的 `comboById` 及填充代码，保留搭配名称和 ID 校验。
- `curation/terms.ts`：删除三条 `legacyNames` 登记；别名、子串对、搭配及其条件保持原样。
- `store.ts`：删除 `LegacyEntry` 导入、`legacyByTerm`、`combosById` 及填充代码；删除 legacy / rejected 路径收集、联合类型成员和渲染分支；清理仅服务旧称的助手、参数与说明，不保留兼容壳。
- substring 覆盖判定仍先收集全部其他路径，覆盖集合收窄为 exact / alias / combo；部分覆盖保留完整目标，全部覆盖才省略。最终路径顺序为 exact → alias → substring → combo，卡片顺序与去重规则不变。
- 同步迁移测试中 `TermCurations` 字面量，删除旧称专用用例；混合用例只改写被删除路径部分，保留其他行为的回归。

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
| L1 | 真实三个原 redirect 词：迷迭香感知链、巫恋裁缝核、龙门中枢制造组 | 无其他合法命中，empty、executed:true、paths:[]、hitIds/injectedIds:[]、matchedCount/returnedCount:0、complete:true；无重定向或拒绝理由 |
| L2 | 上述词分别带首尾空白；未知合成词 | 沿用 trim 与未收录处理，不新增拆词、猜测成员或拒绝表 |
| L3 | 合成数据让原旧称文本命中 exact 或 combo；真实“拉特兰” | 返回合法路径与成员，不因文本曾为旧称而屏蔽；真实阵营仍正常命中 |
| R1 | 维娜、临光、龙舌兰组、叙拉古与既有31组子串回归 | 别名、子串、搭配及同名多身份行为保持，类别与去重计数不变 |
| R2 | 一短多长，alias 部分覆盖、combo 全部覆盖，以及 alias / combo 联合覆盖 | 部分覆盖保留完整 substring 目标；全部覆盖省略 substring；路径按四类固定顺序输出 |
| P1 | L1 空结果与 R1 成功结果经 executor、tool message、trace 与落盘序列化 | FACTS_RESULT_VERSION=5、TOOL_SCHEMA_VERSION=8；计数和 ID 一致，resolution 仅含四类合法路径 |
| P2 | 无效参数、运行错误、预算耗尽的既有测试 | 原有状态与计量保持，不把工具错误与被删除的 rejected 路径混淆 |

## 验收清单

- [ ] 旧称登记类型、三条数据、专用索引与校验删除，消费者迁移完成
- [ ] legacy / rejected 路径与渲染删除，四类路径及子串覆盖规则保持
- [ ] FACTS_RESULT_VERSION 升为 5，序列化、trace 与版本断言同步
- [ ] 旧称未收录、同词合法命中、别名／子串／搭配及工具错误回归通过
- [ ] 改动范围核对完成：语料、搭配名称与条件、ENTITY_WORDS、命名规则和历史评测未改写
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过
- [ ] ADR、INDEX 与 inbox 状态据实际完成情况同步，`node scripts/doc-check.mjs` 全通过

## 关联 ADR

- [ADR-010](adr/ADR-010-facts-alias-disambiguation.md) — §7 仅清理 facts legacy 实现，待实施

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
