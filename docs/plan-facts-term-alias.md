# facts 别名与集合词条真源计划

> 创建日期：2026-09-09
> 状态：待启动

## 目标

让 `facts_search` 对干员别名、简称、子串歧义与组合名集合词条做确定性解析并给出明确标注，承接 `TODO(tech-debt) R5-2`，不引入自然语言解析或模糊兜底。

## 非目标

- 阶段 2 内容：`equivalenceGroup` / `resource` / `rule` / `facilityGroup` 类别，表 C/D/E 关系边与条件词表，任何数值化（比例/百分比/上限）。
- 技能、设施、阵营、职业的别名（阶段 1 别名与集合词条只指向干员）。
- 检索排序、切块、预算、RAG 侧改动。
- 运行时用 LLM 生成别名/组合名，或为评测题、问法、预期答案添加特判。

## 架构分析

`factsSearch` 当前只查 `byFactTerm`（规范词条精确索引），`RecordCard.aliases` 恒空，别名查不到。`歧义.md` 是生成文件、无解析器且不含运行时数据；`SkillFact` 存在 8 组重名，`termId` 不能只用 `canonical`。工具为单词条精确入口（ADR-007），没有"反问"能力，消歧只能靠返回内容标注 + Agent 决策契约。

语料盘点（2026-09-09）：`guides/` 与 `raw/组合知识库.md` 各有 19 个带成员表的组合名（贸易 9 / 制造 8 / 跨设施 2），成员按核心/重要/次级分层；`歧义.md` 仅明确标注 5 个合称，其中 4 个可映射到组合名。需先处理三处冲突：龙门中枢组合称（2 人）与组合（3 人）不一致、`红松林骑士组`/`红松骑士团组` 命名不一致、组合名与阵营/干员/技能/资源同名约 14 组。

## 实施方案

### 步骤 1：规范化前置

- 输入：`歧义.md`、`guides/*组合.md`、`raw/组合知识库.md` §9。
- 产出：统一口径——① 「龙门中枢组」取组合成员表（核心斩业星熊、重要诗怀雅、次级陈）；② 规范名「红松骑士团组」，`红松林骑士组`/`红松林经验体系` 作旧称；③ 18 个旧称/废弃名建立「归一为规范名」或「明确拒绝」映射；④ 组合名与阵营/干员/技能/资源同名按现有"同名跨类别并集 + 命中标注"处理。
- 验收：四类口径写入 curation 数据与测试断言；不存在同一词条两种成员集。

### 步骤 2：别名与集合词条数据表

- 输入：步骤 1 口径、`facts/curation/types.ts` 现有结构。
- 产出：新增独立文件 `facts/curation/terms.ts`（不并入九设施 room 级 `CurationBatch`，不新增哈希/指纹字段），定义别名条目（`aliasText`、`targets`、`aliasKind`、`disambiguation`、`evidence`）与集合词条（`comboName`、`members` 带分层、`aliases`、`legacyNames`、`evidence`）；31 组子串对 + 简称/合称/俗称/旧称全部登记，19 个组合名登记，5 个合称映射到集合词条；`targets` 用 `operator:<canonical>`。
- 验收：解析/校验通过；子串对计数断言 31、组合名计数断言 19；`targets`/`members` 全部存在于名册；每条子串对带设施线索；旧称映射无悬空。

### 步骤 3：store 索引与查询解析

- 输入：步骤 2 的数据表、`buildCardStore`。
- 产出：别名索引与集合词条索引，`factsSearch` 增加别名/集合/旧称解析分支；`RecordCard.aliases` 保持不回写。
- 验收：唯一目标别名返回单卡；集合词条返回成员卡并按 canonical 稳定去重、保留分层；子串对返回候选卡；旧称归一或拒绝；未收录词条行为不变。

### 步骤 4：输出标注与结果版本

- 输入：步骤 3、`serializeFactsMatches`。
- 产出：输出标注（精确/别名/组合/可能指/需消歧/旧称/未收录）；`FACTS_RESULT_VERSION` → 3。
- 验收：输出含对应标注；`factsResult` 的 `matchedCount`/`returnedCount`/`complete` 与实际返回一致。

### 步骤 5：工具描述与 schema 版本

- 输入：`tool-executor.ts` 的 `facts_search` 定义。
- 产出：描述提及别名与组合名支持；`TOOL_SCHEMA_VERSION` → 7。
- 验收：`toolsForRetriever('facts')` 只暴露 `facts_search`；schema 元数据版本为 7。

### 步骤 6：决策契约补充

- 输入：`knowledge/AGENTS.md`。
- 产出：消歧反问口径（设施重叠或未点明时反问；合称/组合名不静默挑一个）。
- 验收：契约文字与 ADR-010 查询契约一致，不新增工具参数。

### 步骤 7：测试与门禁

- 输入：上述改动。
- 产出：别名解析、集合词条分层返回、旧称归一/拒绝、子串对（设施不重叠/重叠）、未收录、预算与协议错误的回归；计数断言。
- 验收：`pnpm run typecheck`、`pnpm run test`、`node scripts/doc-check.mjs` 全通过。

## 验收清单

- [ ] 规范化口径落地（龙门中枢组、红松命名、18 个旧称、同名碰撞）
- [ ] 31 组子串对 + 简称/合称/俗称/旧称全部登记并通过计数断言
- [ ] 19 个组合名登记为集合词条，成员带核心/重要/次级分层
- [ ] `facts_search` 输出契约实现，别名/组合/歧义/旧称标注可见
- [ ] `RecordCard.aliases` 仍为空（不回写）
- [ ] `TOOL_SCHEMA_VERSION = 7`、`FACTS_RESULT_VERSION = 3`
- [ ] `knowledge/AGENTS.md` 消歧反问口径补充
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过
- [ ] `node scripts/doc-check.mjs` 全通过

## 关联 ADR

- [ADR-010](../adr/ADR-010-facts-alias-disambiguation.md) — facts 别名、集合词条与消歧真源及查询契约

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
