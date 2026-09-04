# R5 事实查询基础设施（facts-first：确定性记录卡 + 查询 tool）

> 创建日期：2026-09-02
> 状态：已完成
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

## 实施纪要

# 实施笔记：R5 事实查询基础设施（facts-first：确定性记录卡 + 查询 tool）

> 对应 spec：docs/plan-hybrid-facts.md
> 开始日期：2026-09-03

## 决策偏离
> spec 中没有提到，但在实施中做出的重要决策

### 2026-09-04 — 本轮交付范围收敛为 facts-first 基础设施
- **用户决策**：不再把评测循环作为本轮合并目标；先合并确定性记录卡、全量核对和 lookup/query 工具，后续通过迭代补齐质量闭环。
- **本轮验收**：记录卡字段与来源口径、确定性 references 解析、程序化 0 差异核对、查询工具、类型检查和测试。
- **后续路由**：P0.4、语义字段人工抽检、12+5 查询/裸查评测、人工判定及 v3 结论登记移入 `docs/draft-facts-quality-iteration.md`，本轮不以这些事项作完成声明。

### 2026-09-04 — 全量记录卡机械事实改用确定性源解析
- **背景**：原计划按全量 LLM 转录 + 程序化核对生成记录卡；实施细化时复核发现，当前 references 已有稳定的机械结构和生成索引。
- **决策**：机械字段、技能事实、持有关系和替换边由 `docs/plan-facts-record-cards.md` 规定的确定性解析生成；技能效果保留原文，表达优化独立维护。选型记录见 ADR-002。
- **影响**：原步骤 2 的“LLM 转录”实现入口由全量记录卡计划承接；LLM 转录不再是本轮机械事实链路的运行时或生成依赖。

### 2026-09-03 — 首切片收敛为「机械字段 + 5 标杆条目」，TDD 先行
- **背景**：plan 步骤 1/2 需「记录卡字段定性」「转录脚本 + references 解析器 + 程序化核对断言 + fixture 单测」。记录卡含机械字段（可程序化断言）与语义字段（需 LLM/人工）两类，后者无法 TDD。
- **选项**：
  - A: 先搭 LLM 转录脚本（含 API 调用）——无法 TDD、依赖密钥、成本不可控；
  - B: 仅做机械字段解析器 + 核对断言 + 首批 5 干员标杆条目（fixture），语义字段由后续 LLM 转录 + 人工抽检接管（推荐）；
  - C: 直接人工转录全量 425 干员卡——工作量越界。
- **决策**：B。用 TDD（先写 fixture 断言）落地 `parseNameRow`（名册行 → 机械字段）与 `verifyMechanicalCard`（0 差异核对），首批 5 个干员作为标杆条目；语义字段（aliases/skillGroups/skills/notes）作为 fixture 基准值一并提供，供 LLM 转录 + 人工抽检对照。符合 plan「记录卡运行时内存生成」「断言单一实现双消费」。
- **影响**：本轮不接入 bench 工具（plan 步骤 5）、不改 `config.corpusDir`（config.ts 的 R5 债务注释仍指向 facts-first 重建）；机制字段类型 `ToolId`/`isRetrievalTool` 未扩展，避免触发 ADR。

### 2026-09-03 — 记录卡字段定稿 + 字段-来源对照表（对应 plan 步骤 1 验收）
- **背景**：plan 步骤 1 要求字段清单 + 字段-来源对照表定稿，作为转录/核对的共同口径。
- **决策**：字段 `canonical / aliases / rarity / class / rooms / factionGroups / skillGroups / skills[]（name / unlockType / target / effectText）/ notes`；机械字段仅 5 项（canonical/rarity/class/rooms/factionGroups）参与 0 差异断言，其余为语义。来源对照如下（只作取数与抽检参考，不落到卡内）：

| 字段 | 来源 | 类别 | 0 差异核对 |
| --- | --- | --- | --- |
| canonical | 名册.md 首列 `- 标准名 | …` | 机械 | 是 |
| rarity | 名册.md 第 2 列（☆N，规范化去 ☆ 为 1~6） | 机械 | 是 |
| class | 名册.md 第 3 列（职业） | 机械 | 是 |
| rooms | 名册.md 第 4 列（`、` 分隔） | 机械 | 是 |
| factionGroups | 名册.md 第 5 列（`、` 分隔，可为空） | 机械 | 是 |
| aliases | 歧义.md（子串对/简称合称/含称）+ 俗称（2026-09-03 废弃散文注释） | 语义 | 否（人工抽检） |
| skillGroups | 类别.md「技能组」 | 语义 | 否 |
| skills[].name / unlockType | 技能-*.md `### 干员` 下 `- **解锁方式**「名称」:…` | 机械（可程序化预填） | 本轮 fixture 基准值提供 |
| skills[].target / effectText | 技能分片原文（`〔标签/作用产物〕` 与 `：`后效果句） | 语义（LLM 转录） | 否 |
| notes | 歧义.md + 代偿备注（人工） | 语义 | 否（人工抽检） |

## 实现调整
> spec 中有描述，但实际实现方式不同

### 2026-09-03 — skills[].target 保留原文而非结构化拆分
- **spec 原文**：卡字段 `skills[]（name / unlockType / target / effectText）`，未定义 target 粒度。
- **实际做法**：target 取技能分片行内「〔标签…/作用产物…〕」原文串（如 `通用生产；作用产物：赤金/作战记录/源石碎片`），不拆成结构化键值。
- **原因**：plan 非目标「不做效果字段数值化」；标签与作用产物保原文，避免为 5 个标杆预先设计超过现状的解析。
- **后果**：v3 若做 minEff 数值化再拆分；本轮无下游影响。

### 2026-09-03 — 记录卡条目去除 source 字段，0 差异核对改读真源名册（逐字段精确比对）
- **spec 原文**：plan 非目标「不做来源标注（每条记录卡 `source` …）」，来源维度保留在评测判定表；步骤 2「程序化核对断言（机械字段与 references 逐字 0 差异）」。
- **实际做法**：fixture 条目本体即 `RecordCard`，不再携带 `source`；出处行由调用方按 canonical 从真源 `knowledge/references/名册.md` 解析（`mechanical.findNameRow`，行首精确匹配防「能天使」误配「新约能天使」）。核对断言由「子串包含」升级为「`parseNameRow` 拆分后逐字段精确相等」，更严格兑现防幻觉。
- **原因**：用户指出 source 不应为条目字段——条目自带出处会造成「以对照源为源的对照」自证；且子串包含弱于「逐字 0 差异」。
- **后果**：无公共接口/配置变更；测试新增 `findNameRow` 精确匹配/未命中用例并读取真源名册；独立审查观察项 A（子串比对弱）就此消解。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项

### 2026-09-03 — 技能字段未程序化解析（fixture 基准值承载）
- **债务**：5 标杆条目的 `skills[].name/unlockType` 为人工从 references 转录的基准值，未实现从技能分片程序化提取与核对；`target/effectText` 属语义本应 LLM 转录，未覆盖。
- **未来偿还**：plan 步骤 2 落地全量转录前，补 `parseSkillRow`（技能分片 → name/unlockType）并纳入机械核对（0 差异），代码处 `TODO(tech-debt) R5-1` 登记，清偿后 fixture 仅留语义基准。

### 2026-09-04 — R5-1 已清偿，fixture 保留兼容基准
- **债务状态**：`parseSkillFragment` 已从技能分片确定性解析技能名、解锁文本/类型、技能事实和持有关系，运行时全量投影不再依赖 fixture 提供这些事实；原 `R5-1` 代码标记已移除。
- **剩余边界**：fixture 仍有意保留人工语义字段作为历史兼容回归基准，不作为运行时事实源；别名、合称与消歧另登记为 `R5-2`。
- **未来偿还**：R5-1 无；R5-2 按独立别名/合称真源与消歧方案推进。

### 2026-09-03 — 合称查询方案与查询工具 MUST 前置项（评审记录，本轮未实现）
- **背景**：独立审查子代理核实记录卡「搜索字段充分性」：query_operators 分类过滤（room/faction/rarity/profession）sufficient；lookup 对别名/合称/技能族检索 partial。用户裁定：合称另设方案、技能族维持现状，本轮仅记录设计。
- **决策（口径已定）**：
  - 合称索引 `comboIndex`：`term → { canonicals[], default?, disambiguate?, note? }`，数据源 歧义.md 第二节 + 官方同名组；与单卡 `aliases`（仅单目标简称）分离。`lookup` 返回命中卡列表；合称命中多卡；子串歧义（歧义.md 一节）按「设施重叠→反问，否则按设施判断」落 lookup。
  - 技能族/等价组检索口径：维持仅类别.md「技能组」(5 条)；「技能等价组」昵称与「规则说明」联动组（如自动化·α/β）检索后置 v3。
- **查询工具 MUST 前置项（plan 步骤 5 接入时实现）**：`canonical` 作 `excludeIds` 稳定 id；`lookup` 返回 `card[]`（承载多卡/合称）；运行时检索索引（canonical/简称/技能名/技能组 → canonical[]）；`termQuery` 固定扫描 name/target/effectText/notes/aliases（字面子串，非语义）；子串消歧规则。
- **未来偿还**：plan 步骤 5（lookup/query_operators 最简接入）落地 comboIndex 与检索索引；等价组/联动组检索与 `aliases` 转录（现 5 卡全空）后置 v3/人工抽检。本轮未写该代码，无代码 TODO。

## 意外发现
> 实施中发现的 spec 未覆盖的依赖/边界/风险

### 2026-09-03 — skillGroups 口径存在歧义：「技能组」vs「规则说明」
- **发现**：类别.md 中「自动化·α/·β」只列入「规则说明（25 条）」，不在「技能组（5 条）」；技能联动信息散落两处。
- **影响**：若 `skillGroups` 仅按「技能组」归集会漏掉自动化这类跨干员联动。本轮 fixture 未含此类（森蚺 skillGroups=[]），不影响断言。**处置（2026-09-03 已定口径）**：检索维持仅类别.md「技能组」，等价组昵称/规则说明联动组后置 v3（见债务记录）。值得回馈 spec。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

- 暂无。

## 进度快照
- 已落地：`bench/src/facts/{card,mechanical,fixtures,store}.ts`（记录卡类型 + 解析/0 差异核对/findNameRow/运行时卡 store 与 lookup/query_operators）、`bench/tests/{facts,facts-tools}.test.ts`（TDD）、`agent.ts`（lookup/query_operators 工具 + facts 派发 + 系统提示）、`config.ts`（RetrieverId 'facts'）、`provider.ts`（dry facts 工具映射）、`runner.ts`/`cli.ts`（facts 语料旁路 + 守卫时序 + --retriever facts）。
- 步骤 2（全量确定性解析与核对）及步骤 5（lookup + query_operators 最简接入）均已完成；全量 425 张卡由同一 store 承载，详细计数与验证见 `docs/plan-facts-record-cards-notes.md` P6。
- 验证：`pnpm run typecheck` 通过；`pnpm run test` 10 文件 103 用例全通过（含 facts 23、facts-tools 20）；`pnpm run bench:dry`（已指向 `--retriever facts`）跑通，报告统计到 `lookup/query_operators`（toolTrace=lookup→query_operators，3 轮/题）。
- 评审处理：独立审查（步骤 5 接入）无阻塞；已按评审补强 report 工具统计纳入 facts（`isFactTool`）、`bench:dry` 改指向 facts、facts 下跳过 minRag 引导原文、serializeCard 单卡 ≤1KB、并补「已达上限」分支测试。
- 评审：独立审查子代理核实搜索字段充分性（分类过滤 sufficient；别名/合称/技能族 partial），结论已按用户裁定记录（合称另设方案、技能族维持现状、本轮仅记设计）。
- 后置：P0.4 参考要点重制、人工抽检、评测 12+5、结论落盘；这些事项已从本轮验收清单移出并转入 `docs/draft-facts-quality-iteration.md`。早期记录中的“步骤 2 未做”仅反映当时快照，已由后续 P6 实施收束。

> ✅ 已完成于 2026-09-04
