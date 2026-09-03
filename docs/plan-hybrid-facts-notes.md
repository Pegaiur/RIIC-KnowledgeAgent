# 实施笔记：R5 事实查询（facts-first：LLM 转录记录卡 + 查询 tool）

> 对应 spec：docs/plan-hybrid-facts.md
> 开始日期：2026-09-03

## 决策偏离
> spec 中没有提到，但在实施中做出的重要决策

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
- 步骤 5（lookup + query_operators 最简接入，16 卡）已完成并纳入 plan 验收清单 `[x]`；全量 425 转录后由同一 store 承载（步骤 2 未做）。
- 验证：`pnpm run typecheck` 通过；`pnpm run test` 10 文件 103 用例全通过（含 facts 23、facts-tools 20）；`pnpm run bench:dry`（已指向 `--retriever facts`）跑通，报告统计到 `lookup/query_operators`（toolTrace=lookup→query_operators，3 轮/题）。
- 评审处理：独立审查（步骤 5 接入）无阻塞；已按评审补强 report 工具统计纳入 facts（`isFactTool`）、`bench:dry` 改指向 facts、facts 下跳过 minRag 引导原文、serializeCard 单卡 ≤1KB、并补「已达上限」分支测试。
- 评审：独立审查子代理核实搜索字段充分性（分类过滤 sufficient；别名/合称/技能族 partial），结论已按用户裁定记录（合称另设方案、技能族维持现状、本轮仅记设计）。
- 未做：转录脚本 LLM 调用（全量 425 卡）、P0.4 参考要点重制、人工抽检、评测 12+5、结论落盘；steps 2/3/4/6/7 及对应验收清单 checkbox 未勾选。
