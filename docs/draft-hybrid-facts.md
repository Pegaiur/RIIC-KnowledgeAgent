# R5 事实查询（facts-first：结构化事实层 + 查询 tool，零散文依赖）—— 草案

> 创建日期：2026-09-02
> **v2 重写：2026-09-03**——弃「混合架构」版（v1），改为事实查询先行、散文后补
> 状态：草案（draft）——Phase 2/3 启动时转 plan 并进入实施
> 上游：`docs/archive/plan-facts-source-purge.md`（语料事实源清理，已归档完成）；`docs/archive/plan-rules-prefix.md`（R4 检索词引导，根因「语料缺 index 层 → RAG 代偿」）；skill-test 语料实证（2026-09-02 A/B/C 核查）；`docs/spec/rag-answer-baseline.md`（F/G 批参考要点待重制，P0.4）

## 背景

- **语料勘验（本草案 v2 决策基础）**：散文层（`arknights-base-vault/docs/`，已整体删除）为早期劣质 AI 总结、与数据层冲突；结论：**散文层整体废弃，数据层（`knowledge/references/`）为唯一真源**；散文（论证层）后续重写补充。清理过程见 `docs/archive/plan-facts-source-purge.md`。
- **2026-09-03 结构重构**：知识库从 `arknights-base-vault/` 迁至 `knowledge/`（数据层 + SKILL.md + 基建物流链.md），散文 / `meta/` / README / TODO 全删除，`bench` 查询工具临时停用（P0.7）。
- **数据前提**：上游 JSON 本地可达（RhodeLogisticsSteward：`character_identity.json` / `buffs_infrastructure.json` / `buffs_non_production.json`）；RIIC-Web 原始仓库不在本地，但其解包产物（`knowledge/references/` 14 个 md）已完整落盘——读呈现层即可闭环，RIIC-Web 就位后切上游直出。

## 目标

构建**事实查询工具**（零散文依赖）：`facts.json`（数据层直出）+ 查询 tool（精确 lookup / 条件组合 query），在真源数据上量化对事实类题（F/G）的命中率、编造率、成本，为「散文重写 + 判断层补充」之后的完整方案（v3）奠定数据地基。

## 非目标

- 不做散文层任何工作：不修补、不索引（search_corpus/read 接口保留但不启用）
- 不做 S 类体系题评测：体系关系（互斥/核心双人/缺人降级）是公孙判断，不在上游数据中——随判断层/散文重写后置（v3）
- 不做 judgments 层粗标（SKILL.md S3 转录）——判断层后置（如提前转录，仅作 v3 素材）
- 不做 GraphRAG / 免检索门控（沿用 R4 立场）
- 不做效果字段全解析（表达式保留原文 + 关键属性）

## 待验证假设

| # | 假设 | 判定指标 |
|---|---|---|
| H1 | 事实查询在事实类题（F01-F10 + G01-G02）正确 ≥ 10/12 且编造 = 0 | 正确数/编造数（真源参考要点判定，P0.4） |
| H2 | 查询返回紧凑记录卡（单次 ≤ 1KB 量级），input 成本可控 | 单题 input tokens / tool 调用次数 / 平均返回字节 |
| H3 | 条件组合查询（faction+room+minEff 等）正确覆盖盲区题 | 新增 5 题组合题正确率 ≥ 4/5 |
| H4 | 查询结果 100% 标注来源（data id + 显示名） | 来源合规率（人工核查） |
| H5 | facts.json 数值与 `knowledge/references/` 名册.md 及上游 JSON 全量一致 | 生成校验（脚本断言）0 差异 |

## 设计

### 数据管线（Phase 2 产物：facts.json）

```
生成源（合并直出，散文永不作为事实来源）：
├─ RhodeLogisticsSteward（本地，仓库根 3 个 JSON）
│   ├─ character_identity.json      → id/名/星级/职业
│   ├─ buffs_infrastructure.json    → 生产设施技能（buffId/efficiency/targets/roomType）
│   └─ buffs_non_production.json    → 非生产技能
├─ knowledge/references/（解包直出 md，补齐 RIIC-Web 缺口）
│   ├─ 名册.md                      → 设施归属/所属组（星级以名册为准！）
│   ├─ 技能-<设施>.md ×9            → 技能文案/解锁条件（解锁 vs 提升标注）
│   └─ 类别.md / 技能等价组.md / 歧义.md → 派系/等价组/别名归一
└─ ⚠️ RIIC-Web 原始仓库不在本地：v0 读 references 呈现层即可闭环；
     待就位后切换「上游直出」+ 一致性校验（校验脚本兼容双路径）
```

### Schema 草案（v0 事实层，不含判断层）

```jsonc
{
  "operators": [{
    "id": "wuyan", "name": "巫恋", "altNames": [], "rarity": 5,
    "class": "...", "rooms": ["贸易站"], "groups": ["裁缝核相关"],
    "skills": [{ "name": "裁缝·α", "unlockType": "初始解锁",
                 "efficiency": "...", "targets": "...", "condition": "...",
                 "rawText": "（原文保留）" }]
  }],
  "skillGroups": [{ "groupId": "caifeng-b", "displayNames": [...], "holders": [...] }],
  "factions": [{ "name": "谢拉格", "members": [...], "rule": "..." }],
  "aliases": { "推王": "推进之王", ... },
  "meta": { "generatedAt": "...", "sources": {...}, "version": "..." }
}
```

- **生成规则（硬性）**：星级 / 解锁条件 / 效率 / 派系归属 / 等价组只从数据源取；散文/速查表数值一律不采信（散件速查星级错误即为判例）。
- **来源标注**：每条记录带 data id + 显示名；aliases 带归一链路。

### 查询 tool（Phase 3）

```
┌─ lookup_operator(name) / lookup_skill(name) / lookup_entity(term)
│  别名归一（歧义表 + 等价组 + 俗称表）→ canonical → 返回记录卡（≤1KB 量级）
├─ query_operators({ faction, room, minEff, rarity, excludeIds })
│  条件组合过滤（StructuredRAG 式聚合）
└─ （预留，v0 不启用）search_corpus(text) / read —— 散文重写后接入
```

- 载体：bench 侧本地函数工具验证（agent.ts 注册）→ 结论成立后 MCP 化（宿主复用）。
- v0 评测 agent 工具集 = lookup + query；对照组：无工具裸查（同模型同题，对照 H1 归因）。
- **与 R4 关系**：R4 检索词引导（QUERY_GUIDES）在事实层落地后**退役**（工具 schema 即检索指导）；R4 的「成本 +63%」预期由 compact 记录卡（几百字节）替代 read 20k 散文 + glob/grep 解决。

### P0.4（暂缓）：参考要点重制（F/G 批）

`docs/spec/rag-answer-baseline.md` 中事实类 12 题（F01-F10/G01/G02）以真源重制（名册 + 技能分片可判定）；S 类 8 题暂缓（待散文重写）。**P0.4 是 H1 判定前提**。

## 实施步骤

1. schema 定稿 + 字段-上游对照表（v0 事实层）
2. `build_json.py`（Steward JSON + references 合并直出；校验：与名册/分片全量一致性，H5）
3. bench 集成：agent.ts 注册 lookup/query 两 tool + 工具单测（别名命中、组合过滤、来源标注）
4. 评测：事实 12 题（真源要点判定）+ 新增 5 题组合题（样例：「谢拉格派系 + 制造站 + 效率 > 30% 的干员」）——对照组：无工具裸查
5. 结论落盘；gold 口径扩展（事实层查询命中 = data id）

## 评测判据

- **通过标准**：H1-H5 全部满足；具体为 事实题 ≥ 10/12、编造 = 0、组合题 ≥ 4/5、来源合规 100%、生成校验 0 差异。
- 任一不满足 → 按风险表逐项排查（schema 缺字段 / 别名缺失 / 工具描述误导），复测一次。
- 成本预期：12+5 × 2 组（查询/裸查）≈ ¥0.05-0.1（qwen3.7-flash）。
- 工具行为记录沿用 skill-test evals 五维判定表（正确性/编造/来源/效率/数据使用），S 类指标栏标注「暂缓」。

## 风险与对策

| 风险 | 对策 |
|---|---|
| v0 无体系关系数据 → S 类题全部不可答（覆盖率骤降） | 明确范围：v0 只评事实层成色；S 类随判断层/散文重写（v3）——**不把 v0 成绩当全场景结论** |
| RIIC-Web 原始数据缺失 | v0 读 `knowledge/references/` 呈现层闭环；校验脚本兼容双路径；`knowledge/` 记录缺口，就位后切换并重跑校验 |
| references 直出土与上游出现漂移（未来升级） | facts.json 带 version/sources meta；重建即校验（H5 断言） |
| 别名/俗称覆盖不全 → lookup 脱靶 | v0 用 歧义.md + 等价组.md + 俗称表（SKILL.md 术语表转录可选）；H1 失分项定位到具体缺词，补词表复测 |
| 查询结果被当「真理」不标来源 | 来源标注字段强制 + H4 人工核查 |
| 散文重写与数据层脱节（重写后仍需校正） | 散文重写侧规则：数据引用一律以 facts.json 为准 |

## 验收清单（Phase 2/3，待启动）

- [ ] facts.json schema + 字段-上游对照表定稿
- [ ] build_json.py 生成 + H5 一致性校验 0 差异
- [ ] agent.ts 两 tool 注册 + 单测通过
- [ ] P0.4 参考要点重制（F/G 批）经人工终审
- [ ] 评测 12+5 题 ×（查询/裸查）完成 + 人工核查落盘（判定表）
- [ ] 结论与推荐；S 类/散文重写作为 v3 计划登记

## 关联

- 上游：`docs/archive/plan-facts-source-purge.md`（语料事实源清理，已归档）、`docs/archive/plan-rules-prefix.md`（R4）、`docs/archive/plan-retrieval-experiment.md`（P1-P5）、`docs/archive/plan-retrieval-tuning.md`（R2/R3）
- 参考要点判定：`docs/spec/rag-answer-baseline.md`（F/G 批待 P0.4 重制）
- 数据层：`knowledge/references/` 直出层；skill-test evals 判定表可复用
- 依据调研：StructuredRAG（聚合查询）、上游 JSON 数据层（RhodeLogisticsSteward）、RIIC-Web 解包管线（build_refs.py）
- v3 预登记：判断层（SKILL.md S3 转录 + 公孙判断结构化）+ 散文重写（数据引用以 facts.json 为准）+ S 类评测 + 组合查询扩展
