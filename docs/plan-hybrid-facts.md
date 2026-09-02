# R5 混合查询（hybrid-facts：结构化事实层 + 查询 tool + 散文兜底）

> 创建日期：2026-09-02
> 状态：施工中（待 schema 定稿 + 实施 + 实测收敛）
> 上游：`docs/archive/plan-rules-prefix.md`（R4 检索词引导，已记录「语料缺 index 层 → RAG 代偿」根因）；skill-test 强化语料实证（2026-09-02，三组 A/B/C 核查）；2026-09-02 混合查询方向评估纪要

## 背景

- **R 系列结论链**：R1 注入收敛矩阵（瓶颈在模型整合）→ R2/R3 词元层闭环（bigram 胜 jieba，recall@5 33.5%）→ R4 检索词引导（recall@5 58.8%、nDCG 0.676，但成本 +63%、平均轮次未降 → 暂缓）。三个阶段的共同根因已记录：**语料缺 index 层，RAG 被迫代偿去干 index 的活**（docs/archive/plan-rules-prefix.md）。
- **skill-test 实证（2026-09-02，qwen3.7-flash，20 题 × 3 组，OpenCode 宿主）**：
  - baseline（无方针，散文 + references 索引寻址）**15/20 = 75%**；skill（全文前置）14/20 + **0 编造**；progressive（AGENTS.md 入口）7/20 = 35%。
  - 关键归因：**质量主力是语料组织度（references 索引层），不是写作方针**；skill 方针净贡献 = 编造防护（2→0）+ 个别题修复；progressive 35% 证明「指令引导 agent 自我发现索引」不可靠——索引必须在结构本身。
  - 工具行为：全部本地 read/grep/glob 寻址；**read 大文件是 input 成本大头**；glob 不带 path 是失败分水岭；无 web_search。
- **数据前提（决定性）**：上游数据源即结构化 JSON（RhodeLogisticsSteward：`buffs_infrastructure.json` / `character_identity.json` / `buffs_non_production.json`，本机可用；RIIC-Web 主源：技能目录/官方术语表）。references/ 即由 `build_refs.py` 从该数据层生成。**JSON 化 = 回到源头而非从散文提取**：零抽取成本、零失信、上游更新自动新鲜——规避 GraphRAG 系「LLM 从散文抽取图谱」的昂贵与不可靠。

## 目标

在 rag-test 基准落地**混合查询架构**，量化对 20 题（正确/编造/轮次/成本/行为）的净效应，产出是否取代 R4 检索词引导的决策：

1. **事实层**：干员/技能/派系/等价组/歧义 → 结构化 JSON + 查询 tool（精确 lookup / 条件组合 query）
2. **论证层**：`docs/**/*.md` 散文保留（机制论证、体系评价、缺人降级路径）——检索/read 兜底
3. 与 R 系列基线可比：20 题、同模型（qwen3.7-flash）、同核查口径（docs/spec/rag-answer-baseline.md）

## 非目标

- **不做全量 JSON 化**：判断/论证文字（为什么、何时开、路径论证）留在散文——JSON 化会丢论证链，S 类推理题塌方（skill-test 核查：S 类 8 题对 7 题是散文层贡献；schema 红线见「风险」）
- 不做 GraphRAG / LLM 抽取知识图谱（昂贵、不可靠、维护难；本方案源头直出无此问题）
- 不做效果字段全解析：条件表达式（如 `4% × (上限−当前订单数)`）保留原文 + 关键属性，解析层渐进演进
- 不做免检索门控（SR-RAG 式）——与 R4 非目标一致，minRag=1 护栏保留
- judgments（判断层）不做自动生成：人工标注 + 校验（「定位/体系归属」是公孙的判断，非游戏数据）

## 待验证假设

| # | 假设 | 判定指标 |
|---|---|---|
| H1 | 事实查询消灭散件/事实类编造（G01/G02 类 0 编造） | 编造数（人工核查） |
| H2 | 查询 tool 的 input 成本显著低于 read 散文寻址（目标 ≤ 基线 50%） | 每题 input tokens（records 口径） |
| H3 | 混合查询正确率 ≥ 散文寻址基线（75%）且 S 类不塌方（≥ 6/8） | 正确数（人工核查，判定表） |
| H4 | E 组（查询 + skill 方针）达成 0 编造且正确率最高 | 正确/编造 |
| H5 | 条件组合查询覆盖当前盲区（faction+room+eff 类「谢拉格+制造效率>80%」） | 新增盲区题正确率 |

## 设计

### 架构

```
┌─ tool 1：lookup_operator(name) / lookup_skill(name) / lookup_entity(term)
│          — 别名/俗称归一（歧义表 + 等价组 + 术语表）→ canonical → 返回记录卡
├─ tool 2：query_operators({ faction, room, minEff, tags, excludeIds })
│          — 条件组合过滤（StructuredRAG 式 SQL 聚合对应）
└─ tool 3：search_corpus(text) — 散文关键词兜底（复用 bigram/BM25 索引，hitrate 口径不变）

数据：facts.json（机器生成，上游直出）+ judgments.json（人工判断层）
论证层：docs/**/*.md 散文保留（search_corpus / read 兜底）
```

- 实现载体：bench 侧先以本地函数工具验证（agent.ts 工具注册），结论成立后再接 MCP（宿主可复用）
- **查询契约**：每条查询结果回指来源（data id + 显示名；判断层回指 judgments 版本戳）；事实查询 = 游戏客观数据，论证仍需散文——「事实层直查、论证层检索、答案须标来源」
- **D 组关闭 read**：干净对比「查询寻址 vs read 寻址」，否则增量无法归因

### Schema 草案

```jsonc
// facts.json（机器生成）
{
  "operators": [{
    "id": "wuyan", "name": "巫恋", "altNames": [], "rarity": 5,
    "room": "贸易站", "skills": [{
      "name": "裁缝·α", "unlockType": "初始解锁", "efficiency": "...",
      "targets": "同房间", "condition": "...", "rawText": "（原文保留）"
    }]
  }],
  "skillGroups": [{ "groupId": "caifeng-b", "displayNames": ["裁缝·β","手工艺品·β","鉴定师的手段"], "holders": [...] }],
  "factions": [{ "name": "谢拉格", "members": [...], "rule": "..." }],
  "aliases": { "推王": "推进之王", ... }
}

// judgments.json（人工维护；只放可判定断言，不放论证文字）
{
  "operatorTags": { "巫恋": ["体系核心","裁缝核"], ... },   // 未标注 = null，禁止猜测补全
  "systemPriorities": [...], "metaChain": ["但书叙拉古链","灵孑银崖喀兰","推王龙门","怪猎中枢"]
}
```

**字段-上游对照**（schema 定稿时逐项列出，实施前核对）：
- 干员身份/星级/职业/技能名/解锁条件 ← RIIC-Web（主源）
- roomType / efficiency / targets / 派系归属 / buffId ← RhodeLogisticsSteward（补源）
- 等价组/歧义/俗称表 ← 现有 references 生成逻辑 + SKILL.md 术语表人工补
- 定位/体系归属/优先级 ← judgments.json（人工，从散件速查与体系文档粗标；来源标注到 file#小节）

### 与 R4 的关系

- R4 检索词引导（QUERY_GUIDES）在事实层落地后**退役**：查询 tool 的 schema 即检索指导（别名→canonical 由工具完成，不再靠引导词）；散文层保留少量引导
- R4 的「成本 +63%、轮次未降」在本架构的预期解法：查询返回 compact 记录卡（几百字节）替代 read 20k 散文 + glob/grep 探索

## 实施步骤

1. schema 定稿 + 字段-上游对照表（facts.json / judgments.json）
2. `build_json.py`（复用 build_refs 数据管线，双输出：references 呈现层 + facts 事实层；check 与 references 一致性）
3. judgments.json 粗标（425 干员定位/体系归属，未标注 = null）+ check_corpus 校验扩展
4. bench 侧集成：agent.ts 工具注册（三 tool）+ D/E 组变体（D=查询无方针禁 read；E=查询+skill 方针）
5. 评测：20 题 ×（A1 散文寻址基线 / B R4 引导 / D / E）→ 人工核查（沿用 skill-test evals 五维判定表，适配查询行为）
6. 结论落盘 `docs/plan-hybrid-facts-notes.md` 新增「R5」节；gold 命中率口径扩展（事实层查询命中 = gold 键或 data id）

## 评测判据

- **通过标准**：H1-H5 全部量化；正确 ≥ 75%（A1 基线）**且** 编造 < 2 **且** 单题 input ≤ 基线 50% **且** S 类 ≥ 6/8
- 任一不满足 → 按风险表逐项排查（schema 缺字段 / judgments 标注缺失 / 工具描述误导），复测一次
- 盲区题（H5）：新增 3-5 题组合查询题，gold 与判定表同步扩展，不破坏 20 题可比性

## 风险与对策

| 风险 | 对策 |
|---|---|
| 判断文字误入 JSON → 丢论证链、S 类塌方 | judgments 红线：只放可判定断言，论证一律留散文；schema 评审把关 |
| 「查询即真相」空谈（引用仅 data id 无出处） | 查询契约强制来源标注（id + 显示名 + 版本戳），人工核查「来源合规」维度 |
| 判断标注主观性/缺失 | judgments 版本化 + check_corpus 校验 + 缺失 null；从语料抽取处带 file#小节 溯源 |
| 效果字段解析失真 | rawText 原文保留 + 关键属性渐进解析；schema 变更即校验 |
| 与宿主耦合限制（MCP 仅 OpenCode） | bench 侧先本地工具验证（宿主无关），结论成立后 MCP；rag-test 与 skill-test 共用 server |
| progressive 教训重演（索引藏指令里） | 查询 tool 的 schema 与描述即索引（结构性可见），不做「让 agent 自己发现」 |
| 20 题覆盖局限 | 结论不得外推到截图/多问题拆包场景（skill-test 同款局限） |

## 验收清单

- [ ] facts.json / judgments.json schema 定稿 + 字段-上游对照表
- [ ] build_json.py 生成 + 与 references 一致性校验通过
- [ ] judgments.json 粗标完成（缺失 = null）+ 校验通过
- [ ] agent.ts 三 tool 注册 + D/E 变体 + 单测（别名命中、组合过滤、来源标注）
- [ ] A1/B/D/E 四组评测跑通 + 人工核查落盘（判定表全维度）
- [ ] 结论与推荐（采纳/精简/暂缓）；若采纳，确认 R4 引导退役与 R5 基线版本

## 关联

- skill-test：`evals/`（A/B/C 三组核查报告，2026-09-02）、references/ 索引层、散文层强化 H1（路由索引进语料）/H2（TL;DR 摘要块）方向——若 R5 事实层落地，H1 必要性下降，H2 保留（论证层阅读成本）
- rag-test 上游：`docs/archive/plan-retrieval-experiment.md`（P1-P5）、`docs/archive/plan-retrieval-tuning.md`（R2/R3）、`docs/archive/plan-rules-prefix.md`（R4）
- 依据调研：StructuredRAG（schema compliance + SQL 聚合）、RAG vs GraphRAG 系统评测（arXiv 2502.11371）、KAG 局限批判（事实题精确性优势 + 编码知识受限）
