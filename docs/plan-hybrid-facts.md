# R5 事实查询基础设施（facts-first：确定性记录卡 + 查询 tool）

> 创建日期：2026-09-02
> 状态：待归档
> 上游：`docs/archive/plan-facts-source-purge.md`（语料事实源清理，已归档）；`docs/archive/plan-rules-prefix.md`（R4 检索词引导，根因「语料缺 index 层 → RAG 代偿」）；`docs/archive/plan-retrieval-tuning.md`（R2/R3）；`docs/draft-facts-quality-iteration.md`（后续质量闭环草案）
> 本 plan 由 `docs/draft-hybrid-facts.md`（v5）定稿转来。本轮范围收敛为 facts-first 基础设施；来源草案承载的评测循环与质量结论后置到后续迭代。

## 目标

构建**事实查询工具基础设施**（零散文依赖）：以 `knowledge/references/`（14 个 md，唯一真源）为源，经 `docs/plan-facts-record-cards.md` 规定的**确定性源解析 + 程序化核对**生成记录卡（名称 / 可用设施 / 技能效果原文 / 代偿备注），并让 bench 的 lookup / query_operators 基于全量记录卡稳定运行；别名、简称、合称、人工语义抽检和质量评测留待后续迭代。

## 非目标

- 不做散文层任何工作：不修补、不索引（search_corpus/read 接口保留但不启用）
- 不以评测循环或答案质量结论作为本轮验收目标；P0.4、人工抽检、12+5 查询/裸查评测与结论落盘后置到 `docs/draft-facts-quality-iteration.md`
- 不做 S 类体系题评测：体系关系（互斥/核心双人/缺人降级）是公孙判断——随判断层/散文重写后置（v3）
- 不做 judgments 层粗标（SKILL.md S3 转录）——判断层后置（如提前转录，仅作 v3 素材）
- 不做 GraphRAG / 免检索门控（沿用 R4 立场）
- 不做效果字段数值化（minEff）——记录卡只存效果原文，效率数值不参与机器比较
- 不做任何上游接入（Steward JSON / RIIC-Web）——references 为唯一真源，数据缺口以 `数据源.md` 记录为准
- 不做落盘资产治理（分层落盘 / meta / 版本 / CRUD）——v0 记录卡运行时内存生成
- 不做来源标注（每条记录卡 `source` / 归一链路 / gold 口径「file#小节」）——来源维度保留在评测判定表、v0 不考核，供散文 RAG 加回时启用
- 不做 bench 重构（tool registry / ToolContext / 系统提示参数化）——只需最简接入两 tool
- 不重建 references 再生脚本（与上游接入解耦，后续 v3 迭代再登记）
- 不考虑 SQLite / 类 DB 存储选型——记录卡为纯内存 JSON 对象，不落盘、不建表、不引入 DB 依赖

## 架构分析

- **痛点根源**：语料缺 index 层 → RAG 代偿（R4 已实证「检索词引导 +63% 成本、未带来质量收益」，暂不采纳）。散文层（`arknights-base-vault/docs/`）已整体删除（劣质 AI 总结、与数据层冲突），数据层 `knowledge/references/` 为唯一真源；F/G 类题须在真源上直接作答。
- **选型逻辑（已由 ADR-002 修订）**：references 为半结构化文本，但当前 9 个技能分片的干员标题、技能 bullet、解锁/替换文法及生成索引已稳定且可逐项核对；本轮对机械字段和关系采用确定性解析，技能效果/方括号注记保留原文，需表达改善时通过独立人工优化层处理，不引入全量 LLM 转录链路。
- **规模现实**：全部卡约 425 干员 + 747 技能，全量内存毫秒级——运行时生成不落盘即可，无需持久化层。
- **已否决备选**：
  - v2 程序直出 facts.json——references 无结构化 schema + `数据源.md` 缺口（20 技能/10 干员）致解析不可行；
  - 旧 v3 程序化内存解析——当时格式和终审工作流未定，直接拼接旧卡缺乏规范化中间层；本轮基于已稳定的 references 结构改为 ADR-002 规定的分层确定性解析；
  - v4.1/v4.2 落盘资产 + 分层 + CRUD + 版本/来源标注治理——用户判定过度防御，v0 全部砍掉，回归最小可行。

## 实施方案

> 按实际依赖顺序；仅真实前置关系处说明依赖。记录卡为运行时内存生成（进程内生成并跨题复用），不做落盘资产治理。

1. **记录卡字段定性**：字段 `canonical / aliases / rarity / class / rooms / factionGroups / skillGroups / skills[]（name / unlockType / target / effectText）/ notes`；附「字段-来源对照表」（字段 | references 文件#小节，仅取数来源与抽检参考，不落到卡内）。验收：字段清单 + 对照表定稿。
2. **全量记录卡解析与核对**：详见 `docs/plan-facts-record-cards.md`。该计划将上游原“LLM 转录”细化为确定性源解析、类别/等价关系拼装与独立人工优化；程序化核对仍要求机械字段与关系 0 差异，语义表达不扩张为机器判定。
3. **bench 最简接入**：lookup + query_operators 两 tool（读运行时记录卡；复用现有 runQuery 检索预算），工具单测（精确技能命中、分类过滤）。验收：两 tool 接入 + 单测通过。
   - **运行时卡数据源（本轮）**：全量 425 张 RecordCard 内存单例（`getCardStore()`，模块级惰性，首次调用执行全量门禁；`FACTS_FIXTURES` 仅作兼容回归基线）。
   - **索引/存储**：`bench/src/facts/store.ts`——`byCanonical` / `byTerm`（canonical / skills[].name / skillGroups → canonical[]；`byAlias` 保留兼容结构但本轮为空）；`lookup(term): RecordCard[]`（解析顺序 canonical→技能名→skillGroups，返回卡列表；合称/子串消歧后置）、`queryOperators({ room, faction, profession, excludeIds, termQuery }): RecordCard[]`（termQuery 对 name/target/effectText/notes 字面子串；excludeIds 按 canonical；不含数值 minEff / 效率排序）。`
   - **工具 schema + 派发**：`agent.ts` 增 `lookupTool()` / `queryOperatorsTool()`；`retrieverTools('facts')` 返回两工具；`runQuery` 循环内派发并套用 `MAX_RAG_CALLS` 预算（超出提示「已达检索上限」）；`buildSystemPrompt('facts')` 描述两 tool 职能并改契约（答案须基于 lookup/query 返回记录卡；片段未覆盖→明确「知识库未查到」，禁凭记忆补全/编造数值机制）。
   - **配置**：`RetrieverId` 增 `'facts'`（bm25/grep/both 不变，向后兼容）；`EXPERIMENT.retriever` 可切换 `'facts'`。
   - **CLI**：`RAG_TOOL_SUSPENDED` 守卫仅拦截非 facts 模式（facts 不依赖已废弃散文语料）；`pnpm run bench:dry`（dry 不发真实请求）验证工具链路。
   - **单测**：`bench/tests/facts-tools.test.ts`——lookup 命中与解析顺序、query_operators 分类过滤/termQuery/excludeIds、runQuery(facts) 工具暴露/派发/预算/末位兜底。
   - **边界**：不改 `runQuery` 公共签名（避免触发 ADR）；若后续改签名或 bench CLI 公共契约需先补 ADR（见「关联 ADR」）。`buildSystemPrompt` 改动会影响缓存前缀（`rules` 段不受影响）。
   - **facts 模式语料旁路（评审补强）**：`runner.ts` / `cli.ts` 在 `retriever==='facts'` 时跳过 `loadCorpus`/`buildIndex`/`corpusStats`（语料目录 `arknights-base-vault/docs` 已整体删除，否则 `readdirSync` 抛 ENOENT），以空 `DocChunk[]` / `IndexEntry` 占位传入 `runQuery`（签名不变）。
   - **dry 工具名映射（评审补强）**：`provider.ts` 的 dry 结果按 `retriever` 映射 facts → `lookup` / `query_operators`，使 `bench:dry` 能走 facts 派发分支（当前 dry 硬编码 facts 会落到 `rag_search`，无法验证两 tool 接入）。
   - **守卫时序（评审补强）**：`assertRagToolAvailable` 移至 `loadConfig` 之后、或改为仅拦 `run`/`hitrate` 等非 facts 命令；`bench:dry` 默认 `retriever='bm25'`，facts 流程需显式 `--retriever facts`（或改默认）。
   - **工具统计口径（评审补强）**：`ToolId` / `isRetrievalTool` 扩 `lookup` / `query_operators`（或新增 `isFactTool` 谓词），否则 `records.tools`/`toolTrace`/`report` 在 facts 模式下无法统计工具调用。
### 查询工具

```
┌─ lookup(term)：canonical / 技能名 / 技能组精确查询 → 返回命中记录卡列表（单指标签命中 1 卡 ≤1KB；别名、合称/子串消歧后置）
├─ query_operators({ room, faction, profession, excludeIds, termQuery })：分类过滤（不含数值 minEff / 效率排序）
└─ （预留，v0 不启用）search_corpus(text) / read —— 后续散文迭代再接入
```

### 与 R4 关系

R4 检索词引导（QUERY_GUIDES）在事实层落地后**退役**（工具 schema 即检索指导）；R4 的「成本 +63%」预期由 compact 记录卡（几百字节）替代 read 20k 散文 + glob/grep 解决。

## 后续迭代（不属于本轮验收）

以下事项保留为后续质量闭环草案，不影响本轮基础设施合并：

- P0.4：以当前真源重制 F/G 参考要点并完成 spec 版本递进与人工终审。
- 语义字段人工抽检：原文效果、代偿备注、相关组合，按条修正并保留核查记录。
- 12+5 题查询/裸查对照、人工答案核查及判定表落盘。
- 根据后续结果登记 v3 的 S 类、散文重写、`minEff` 数值效率与 references 再生脚本工作。

详细入口：`docs/draft-facts-quality-iteration.md`。

## 验收清单

- [x] 记录卡字段 + 字段-来源对照表定稿
- [x] 确定性 references 解析器 + 程序化核对入库（TS，含 fixture 单测）+ 程序化核对 0 差异
- [x] lookup + query_operators 两 tool 最简接入 + 单测通过
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过

## 关联 ADR

- 选型修订见 `docs/adr/ADR-002-facts-record-card-source.md`；不引入第三方依赖、不改变 `lookup` / `query_operators` 工具名或 `runQuery` 公共签名。
- 若实施中引入 DB / 新第三方依赖 / 改动 bench 公共调用接口，需先补 ADR（见 `docs/rules/document-lifecycle.md` 判定）。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan docs/plan-hybrid-facts.md --apply）时替换此行，标记完成日期 -->
