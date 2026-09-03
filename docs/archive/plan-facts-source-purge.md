# R5 语料事实源清理（facts-source purge：废弃劣质散文，数据层为唯一真源）

> 创建日期：2026-09-03
> 状态：已完成
> 上游：`docs/archive/plan-rules-prefix.md`（R4 检索词引导，根因「语料缺 index 层 → RAG 代偿」）；2026-09-03 语料勘验结论（决定性）

## 目标

废弃并整体删除劣质散文知识库，将解包数据层迁至 `knowledge/` 作为唯一真源，临时停用依赖散文的 RAG 查询工具，为 R5 facts-first（见 `docs/draft-hybrid-facts.md`）奠定真源地基。

## 非目标

- 不做散文层任何工作：不修补、不索引（散文层整体废弃，论证层待后续重写，归 R5 facts-first v3）
- 不做 S 类体系题评测、judgments 判断层、GraphRAG/免检索门控（归 R5 facts-first / v3）

## 架构分析

- 散文层（`arknights-base-vault/docs/`）为早期劣质 AI 总结，与数据层冲突：散件速查星级多处错误（名册为正确值）、推王龙门把维娜·维多利亚误归格拉斯哥帮等（勘验见本计划实施纪要）。
- R 系列共同根因「语料缺 index 层，RAG 代偿」；数据源头即结构化（RIIC-Web + RhodeLogisticsSteward 解包），应工具直查代替概率检索。
- 数据前提：解包产物 `knowledge/references/`（14 文件）完整落盘；上游 JSON（RhodeLogisticsSteward）本地可达；RIIC-Web 原始仓库不在本地，读呈现层即可闭环。

## 实施方案（Phase 0，已完成）

| # | 动作 | 说明 | 验收 |
|---|---|---|---|
| P0.1 | **散文语料废弃** | 全量加废弃标记 + 随 2026-09-03 结构重构整体删除（`arknights-base-vault/docs/` 已移除） | 散文目录已移除；「管线不引用」为部分达成（运行时由 P0.7 守卫拦截，`config/corpus/terms` 静态路径待 facts-first 清理） |
| P0.2 | **数据层角色固化** | 知识库更名 `knowledge/`，散文整体删除、仅余数据层 | 数据源对照表写入 facts-first schema 文档 |
| P0.3 | **R 系列旧基准标注** | `docs/archive/plan-*.md` 头部加「⚠️ 基于已废弃语料，结论仅供参考」 | 标注逐条落地 |
| P0.4 | （归 facts-first，见 `docs/draft-hybrid-facts.md`） | F/G 参考要点/gold 以真源重制 | 暂缓 |
| P0.5 | **历史数据快照** | 散件速查星级错误等勘验记录（本计划实施纪要） | 记录落盘 |
| P0.6 | **meta/ 模板删除** | 废弃散文的写作模板/系统提示词随结构重构删除 | `meta/` 已移除；仓库无 `meta/` 引用 |
| P0.7 | **RAG 查询工具临时停用** | `bench` CLI 的 `run`/`hitrate` 加停用守卫；`report`/`compare` 保留 | `pnpm run bench`（run）报停用错误；`report`/`compare` 正常 |

## 验收清单

- [x] P0.1 散文语料废弃并整体删除
- [x] P0.2 数据层角色固化（knowledge/）
- [x] P0.3 R 系列旧基准标注（docs/archive/plan-*）
- [x] P0.5 历史数据快照（本计划实施纪要落盘）
- [x] P0.6 meta/ 模板删除
- [x] P0.7 RAG 查询工具临时停用
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过

## 关联 ADR

- 无（配置默认值调整 / 注释同步，不触发 ADR）

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->

## 实施纪要

# 语料勘验与废弃快照（P0.5）

> 对应计划：`docs/plan-facts-source-purge.md`（R5 语料事实源清理）；后续 facts-first 见 `docs/draft-hybrid-facts.md`
> 勘验日期：2026-09-03
> 目的：记录「散文层整体废弃」的勘验证据（含数据层正确值对照），作为 P0.1 的依据，并供后续散文重写参照。
> 结论：散文层（`arknights-base-vault/docs/`）为早期劣质 AI 总结，含与数据层（`knowledge/references/`）冲突的事实性错误；决定整体废弃，**数据层（knowledge/references/ + 上游 JSON）为唯一真源**。
> 结构变更：2026-09-03 知识库整体由 `arknights-base-vault/` 迁至 `knowledge/`，散文 / `meta/` / README / TODO 已删除；本笔记所引「废弃散文」文件均已不在仓库。

## P0.1 执行记录

- 2026-09-03 对 `arknights-base-vault/docs/` 下 24 个 `.md` 头部（frontmatter 之后）写入：
  `> ⚠️ 已废弃（2026-09-03）：早期 AI 总结，数据以 knowledge/references/ 与上游 JSON 为准`
- 随后并入 2026-09-03 结构重构：`arknights-base-vault/` 整体删除（含上述已标记散文 / `meta/` / README / TODO），数据层迁至 `knowledge/`——「散文废弃」由**标记**升级为**删除**。
- 「构建管线不加载/不索引/不引用散文」**部分达成**：`bench/src/config.ts:102` 的 `corpusDir = 'arknights-base-vault/docs'` 现指向已不存在路径，且 `run`/`hitrate` 已由 P0.7 停用守卫拦截；完整达成仍待 facts-first（`build_json.py` + `lookup/query` 工具接入后，语料改读事实层），属 Phase 2/3。

## 勘验发现（均以数据层为准）

### A. 散件干员速查.md 星级错误（7 处）

`knowledge/references/名册.md` 为机器生成、星级「已核对全量零例外」，故以其为正确值。

| 干员 | 散件速查.md 写法 | 数据层（名册.md）正确值 | 速查所在行 |
|---|---|---|---|
| 引星棘刺 | ☆5 | **☆6**（特种/制造站） | L37 |
| 清流 | ☆5 | **☆4**（医疗/制造站·发电站） | L36 |
| 断罪者 | ☆5 | **☆4**（近卫/制造站·宿舍） | L47 |
| 酒神 | ☆5 | **☆6**（辅助/制造站） | L47 |
| 铅踝 | ☆5 | **☆4**（狙击/制造站） | L66 |
| 锡兰 | ☆4 | **☆5**（医疗/制造站·加工站） | L73 |
| 格雷伊 | ☆5 | **☆4**（术师/发电站·加工站；☆5 为异格承曦格雷伊） | L81 |

### B. 推王龙门.md 派系归属错误（维娜·维多利亚 ≠ 格拉斯哥帮）

- `knowledge/references/类别.md` 官方术语表「格拉斯哥帮」= 推进之王、摩根、达格达、因陀罗；**无维娜·维多利亚**。
- `推王龙门.md` 误把维娜当作格拉斯哥帮：L32「维娜和摩根都是格拉斯哥帮 → +20%」——按数据同站仅摩根 1 名格拉斯哥帮，**应为 +10%**；连带「满配 1.35」「维娜单走 0.40」数值存疑。
- 技能数据：
  - 维娜精2「外贸决议·β」（`knowledge/references/技能-贸易站.md` L62）：+30% 基础，**「当前贸易站内存在格拉斯哥帮干员时」**额外 +10%——是条件判定，**并非**维娜自身归属。
  - 戴菲恩精2「运筹好手」（`knowledge/references/技能-控制中枢.md` L216）：同一贸易站中每 1 名格拉斯哥帮干员 +10%。
- 此错误踩中 `knowledge/SKILL.md` S3-8「异格干员经常不在本体派系里，须查 `类别.md` 官方成员表，不许凭印象」。

### C. 备注

- `制造站机制.md` 的温蒂「仿生海龙」清零 + 自动化升级链（α/β/仿生海龙互不叠加）在**历史工作区已具备**（`制造站机制.md` L88、L111；该散文已随结构重构删除）。plan 背景所述「缺温蒂清零语义」在删除前已补，不再缺失；散文重写时以数据层为准。
- `灵孑银崖喀兰.md` 的琳琅诗怀雅：精2「招商引资」为**解锁**（与其精0「订单分发·α」并存不替换，见 `knowledge/references/技能-贸易站.md` L46-47）。满配 129% 的计算口径需复核是否计入「订单分发·α」（+20%）这一档。

## 供散文重写的参照原则

- 数据引用一律以 `facts.json` / `knowledge/references/` 为准；星级、派系归属、练度门槛、技能描述、等价组以数据层为唯一权威。
- 散文仅承载「为什么、何时开、路径论证」等判断/论证文字，不承载客观数值。
- P0.4 重制后的 F/G 批参考要点（`docs/spec/rag-answer-baseline.md`）可作为判定口径。

> ✅ 已完成于 2026-09-03
