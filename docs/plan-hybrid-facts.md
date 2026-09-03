# R5 事实查询（facts-first：LLM 转录记录卡 + 查询 tool）

> 创建日期：2026-09-02
> 状态：施工中
> 上游：`docs/archive/plan-facts-source-purge.md`（语料事实源清理，已归档）；`docs/archive/plan-rules-prefix.md`（R4 检索词引导，根因「语料缺 index 层 → RAG 代偿」）；`docs/archive/plan-retrieval-tuning.md`（R2/R3）；`docs/spec/rag-answer-baseline.md`（F/G 批参考要点待重制，P0.4）
> 本 plan 由 `docs/draft-hybrid-facts.md`（v5）定稿转来。来源草案承载了完整演进与评审记录，此处为已定稿施工蓝图（新增字段/问题见验收清单）。

## 目标

构建**事实查询工具**（零散文依赖）：以 `knowledge/references/`（14 个 md，唯一真源）为源，经 **LLM 转录 + 程序化核对** 生成记录卡（名称 / 别名 / 可用设施 / 相关组合 / 技能效果原文 / 代偿备注）；bench 查询工具（lookup / query_operators）基于记录卡作答，在真源数据上量化事实类题（F/G）的命中率、编造率、成本，为「散文重写 + 判断层补充」之后的完整方案（v3）奠定数据地基。

## 非目标

- 不做散文层任何工作：不修补、不索引（search_corpus/read 接口保留但不启用）
- 不做 S 类体系题评测：体系关系（互斥/核心双人/缺人降级）是公孙判断——随判断层/散文重写后置（v3）
- 不做 judgments 层粗标（SKILL.md S3 转录）——判断层后置（如提前转录，仅作 v3 素材）
- 不做 GraphRAG / 免检索门控（沿用 R4 立场）
- 不做效果字段数值化（minEff）——记录卡只存效果原文，效率数值不参与机器比较
- 不做任何上游接入（Steward JSON / RIIC-Web）——references 为唯一真源，数据缺口以 `数据源.md` 记录为准
- 不做落盘资产治理（分层落盘 / meta / 版本 / CRUD）——v0 记录卡运行时内存生成
- 不做来源标注（每条记录卡 `source` / 归一链路 / gold 口径「file#小节」）——来源维度保留在评测判定表、v0 不考核，供散文 RAG 加回时启用
- 不做 bench 重构（tool registry / ToolContext / 系统提示参数化）——只需最简接入两 tool
- 不重建 references 再生脚本（与上游接入解耦，登记 v3）
- 不考虑 SQLite / 类 DB 存储选型——记录卡为纯内存 JSON 对象，不落盘、不建表、不引入 DB 依赖

## 架构分析

- **痛点根源**：语料缺 index 层 → RAG 代偿（R4 已实证「检索词引导 +63% 成本、未带来质量收益」，暂不采纳）。散文层（`arknights-base-vault/docs/`）已整体删除（劣质 AI 总结、与数据层冲突），数据层 `knowledge/references/` 为唯一真源；F/G 类题须在真源上直接作答。
- **选型逻辑**：references 为半结构化文本（名册 / 技能分片×9 / 类别 / 技能等价组 / 歧义 / 数据源），字段句式稳定但自由文本语义（效果描述、条件、档位）不适合程序化硬编码解析。故用 **LLM 转录 + 程序化核对**（机械字段逐字断言 0 差异）生成记录卡，兼顾语义理解与防幻觉。
- **规模现实**：全部卡约 425 干员 + 747 技能，全量内存毫秒级——运行时生成不落盘即可，无需持久化层。
- **已否决备选**：
  - v2 程序直出 facts.json——references 无结构化 schema + `数据源.md` 缺口（20 技能/10 干员）致解析不可行；
  - v3 程序化内存解析——格式硬编码脆弱、终审工作流无载体；
  - v4.1/v4.2 落盘资产 + 分层 + CRUD + 版本/来源标注治理——用户判定过度防御，v0 全部砍掉，回归最小可行。

## 实施方案

> 按实际依赖顺序；仅真实前置关系处说明依赖。记录卡为运行时内存生成（进程内生成并跨题复用），不做落盘资产治理。

1. **记录卡字段定性**：字段 `canonical / aliases / rarity / class / rooms / groups / skillGroups / skills[]（name / unlockType / target / effectText）/ notes`；附「字段-来源对照表」（字段 | references 文件#小节，仅取数来源与抽检参考，不落到卡内）。验收：字段清单 + 对照表定稿。
2. **转录脚本**：LLM 转录 + 机械字段程序预填 + 程序化核对断言（机械字段与 references 逐字 0 差异，未过即打回）。转录脚本 / references 解析器 / 核对断言为一等入库 TS 组件（与 bench 同栈，禁 scratch-only）；断言单一实现双消费（转录核对 + 后续复用）；含小型 fixture 单测。验收：程序化核对 0 差异。
3. **P0.4 参考要点重制**（H1 判定前提，勿低估工作量）：`docs/spec/rag-answer-baseline.md` 中事实类 12 题（F01-F10/G01/G02）以 references 真源重制要点（能定位 references 出处即可，不强制 file#小节），人工终审，spec 版本递进；S 类 8 题暂缓。
4. **人工抽检**：语义字段（代偿备注 / 俗称归一 / 相关组合）抽检 → 按条修正，而非全量终审。
5. **bench 最简接入**：lookup + query_operators 两 tool（读运行时记录卡；复用现有 runQuery 检索预算），工具单测（别名命中、分类过滤）。验收：两 tool 接入 + 单测通过。
6. **评测**：事实 12 题（P0.4 要点判定）+ 新增 5 题组合题（非数值字段组合，样例「谢拉格派系 + 制造站」；落点 questions.json 扩展或独立文件——Phase 3 定稿增量项）——对照组：无工具裸查（同模型同题，对照 H1 归因）。
7. **结论落盘**：量化结论写入实施笔记；转录模型/评测模型分别记录；评测 provider ≠ 项目目标 provider Hy3，结论不外推。

### 查询工具

```
┌─ lookup(term)：别名归一（歧义 + 等价组 + 俗称）→ canonical → 返回记录卡（≤1KB）
├─ query_operators({ room, faction, rarity, profession, excludeIds, termQuery })：分类过滤（不含数值 minEff / 效率排序）
└─ （预留，v0 不启用）search_corpus(text) / read —— 散文重写后接入
```

### 与 R4 关系

R4 检索词引导（QUERY_GUIDES）在事实层落地后**退役**（工具 schema 即检索指导）；R4 的「成本 +63%」预期由 compact 记录卡（几百字节）替代 read 20k 散文 + glob/grep 解决。

## 验收清单

- [ ] 记录卡字段 + 字段-来源对照表定稿
- [ ] 转录脚本 + references 解析器 + 程序化核对入库（TS，含 fixture 单测）+ 程序化核对 0 差异
- [ ] P0.4 参考要点重制（F/G 批）经人工终审，spec 版本递进
- [ ] 人工抽检完成（语义字段：代偿备注 / 俗称归一 / 相关组合）
- [ ] lookup + query_operators 两 tool 最简接入 + 单测通过
- [ ] 评测 12+5 题 ×（查询/裸查）完成 + 人工核查落盘（判定表）
- [ ] 结论与推荐；S 类/散文重写/数值效率（minEff）/references 再生脚本重建 作为 v3 计划登记
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过

## 关联 ADR

- 无新增 ADR：本计划引入新工具但无架构级第三方依赖、无跨模块接口/依赖方向变更；存储走纯内存 JSON，不触发 ADR（ADR-001 jieba 分词仍为现状）。
- 若实施中引入 DB / 新第三方依赖 / 改动 bench 公共调用接口，需先补 ADR（见 `docs/rules/document-lifecycle.md` 判定）。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan docs/plan-hybrid-facts.md --apply）时替换此行，标记完成日期 -->
