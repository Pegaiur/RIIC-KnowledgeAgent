# 实施笔记：渐进披露

> 对应 plan：docs/plan-progressive-disclosure.md
> 开始日期：2026-09-15

## 决策偏离

### 2026-09-15 — ADR 先行落盘（第 0 步部分先于实施完成）
- **背景**：plan 第 0 步要求「ADR-021、ADR-022 及实施笔记在运行时代码修改前完成」。定稿阶段已先建两份 ADR 并同步 docs/adr/INDEX.md（状态「已决策」），实施笔记随本次定稿审查一并创建。
- **决策**：ADR 先行落盘并保持「已决策」状态，不提前记为「已实施」；第 0 步其余内容（记录实际递增值、授权例外边界、实施批次划分）在实施开始后补记于本笔记。
- **影响**：计划状态为「施工中」但尚未改任何运行时代码或语料；版本号（facts 7→8、工具 14→15、prose-links 1→2）仍是待实施约定，实施基点若被其他工作更新则在本笔记登记实际值与原因。

### 2026-09-15 — ADR-018／ADR-020 部分条款被替代但仍保持「已实施」
- **背景**：ADR-022 替代 ADR-018 的「恒定目录注入」与 ADR-020 的「格式 v1、提示与 linked 展开」，ADR-021 替代 ADR-013 的技能表检索范围与 includeSkillTables 选择。document-lifecycle 的 ADR 表写有「被替代时标『已废弃』」，可被读作要求整体改状态。
- **选项**：
  - A：把 ADR-013／018／020 整体标为「已废弃」。
  - B：保留原状态与原文，由新 ADR 逐条写明替代范围（仅部分条款被替代）。
- **决策**：选 B。三份旧 ADR 仍有大量继续生效的条款（ADR-013 的 query facts 附带与独立容量、ADR-018／019 的标签反查与目录生成、ADR-020 的旁挂位置与明确引用原则），整体废弃会误示这些条款失效；ADR-021／022 的「替代」行逐条点名被替代的决策。
- **影响**：新决策不写入旧 ADR 作前向引用；历史记录与冻结文档保持原貌。如后续认为需要「部分废弃」状态语义，另从 inbox 起步。

### 2026-09-15 — 定稿审查与修缮记录（自 plan 第 9 节迁入）
- **背景**：plan 定稿阶段做过一轮独立审查与修缮，原先作为「第 9 节」写在 plan 内；按文档生命周期，plan 只承载蓝图与验收信号，决策／变更日志归本笔记，故迁入此处，实施期新增偏离继续按五段追加。
- **内容**：

| 审查点 | 定稿处理 |
|---|---|
| 草案「本步仅前置清理」与「整份计划」范围冲突 | 按用户本轮答复纳入 A–E、目录注入及最终观测；目录压缩独立保留 |
| 两个独立翻页维度容易导致重复正文或跳卡 | 明确 UTF-16 offset、对象 facts_offset、结束位置及可复制 next_call |
| scope、父子阅读与隐式继承混淆 | scope 仅作用于关联，原文仍为子树，列明父/子/doc 范围与去重规则 |
| 同描述关系容易被表述为完整效果等价 | 同时显示原始依据与限定，保留解锁、作用对象及 curated 差异 |
| raw 迁移、术语规则和失效生成命令冲突 | 精确两文件例外，保留真实格式；移除失实重建承诺，来源记录进入实施笔记 |
| 延后白名单被误读为延后 manifest 与运行装配 | manifest/路径/新行为测试当批闭合，仅指定旧门禁延后，全套照跑 |
| gold、历史快照与运行时目录混用 | 单列完整定位目录，分母保持，历史记录不改写，不自动指定新基线 |
| 目录注入效果与共同遗漏的归因过强 | 缩为实测事实与有限推断，不把配置差异或现有哈希变化当成比较失效的充分条件 |
| 原文复读统计使用小节偏移，无法跨小节比较；父级引导易漏算 | 新增统一文档正文坐标的 fragmentRanges/readDelivery 范围，覆盖父级引导并避免全文重复登记 |
| 文档根不在既有 parentId 树内，scope 继承会漏 | [] 统一对应 doc 范围，在关联层补逻辑祖先，ID 算法不变 |
| 把 inputs 现有摘要当作完整正文快照 | 明确新增仅为关联登记和配置，运行内复用快照，实际正文以 trace 留存 |
| 最后一项要求先归档/过门禁再勾选，与归档前全勾选形成循环 | 验收项只确认交付和收束准备，归档/合并门禁随后按现有生命周期执行 |

- **影响**：plan 不再保留该节；后续同类审查继续记入本笔记，不写回 plan 正文。

### 2026-09-15 — 提交前审查修缮（plan 两处措辞与 exp 引用同步）
- **背景**：工作区提交前的独立审查指出 plan 两处表述与实际动作或证据不符：非目标的「不执行…提交」字面上与本次文档定稿提交冲突；架构分析「必答计数与费用没有稳定改善方向」比两份 exp 的数值更保守（扩展侧必答满足数两轮均略高，仅费用方向相反）。同时 exp-no-expand-read-section-glm-low 的「完整且有据」名单漏列 S07，与同一表格的逐题判定不一致。
- **处理**：plan 非目标限定为「实现批次提交……文档与决策本身的定稿提交不受此限」，架构分析改为分维度表述（plan 第 23、42 行，已回馈 plan）；exp 记录按自身口径就地更正为 10/20（含 S07）并留更正注记，exp-expand-fulltext-glm-low 的汇总、配对差表与跨文件说明随之同步。
- **影响**：plan 正文在定稿后仅作措辞与事实一致性更正，未改需求、契约、版本号或验收项；两份 exp 只更正计数与引用，逐题判定与其余数字未变。

### 2026-09-15 — 授权回执（用户确认）
- **背景**：ADR-021 决策 8、ADR-022 背景与 plan「已授权的门禁延后例外」记载了 2026-09-15 的用户裁决，但审查指出仓库内没有可核对来源；主代理据此在提交前向用户确认。
- **回执**：用户确认全部四项：①整份渐进披露定稿范围；②授权补齐 read、scope 等具体契约；③目录迁移裁决（11 份移 raw、类别/歧义移 guides、数据源移除、撤销 references）；④限定门禁延后例外——仅第 3–6 步指定旧断言可暂红，红态不合并、不发版、不登记新基线、不执行付费试验。
- **影响**：四项授权在实施期可据此执行，例外范围不变，仍以本 plan「已授权的门禁延后例外」节为边界；本条只补回执来源，未改需求、契约或验收项。

### 2026-09-16 — 用户允许目录迁移先于事实出口

- **背景**：本批已实施第 2–3 步，但 plan 原定前置的第 1 步事实出口尚未补齐；原有门禁延后授权不包含这一顺序偏离。
- **选项**：迁移先行并保留缺口、先补齐事实出口、或暂缓迁移批次提交。
- **决策**：用户在本次验收中确认：「允许迁移先行，明确保留事实出口缺口；其余检查通过后提交该批」。据此仅调整本批执行顺序，不删除第 1 步验收要求。
- **影响**：技能注记、同描述依据与名册边界出口继续保持未完成，facts 卡仍为 v7；迁移验收不代表这些信息已可经模型工具完整送达。旧 gold／白名单／基准完整性断言仍按既有例外留待第 6 步，其他新行为及受影响检查须通过；红态期间不合并、不发版、不登记新基线、不执行付费试验。

### 2026-09-16 — 验收清单第 12 项暂不随第 6 步勾选

- **背景**：第 6 步完成后，验收清单第 12 项列出的命令（typecheck、全套 test、reference-projection、prose-terms、catalog --check、validate、gold 校验与 dry）当前全部通过，但该项在清单中位于第 11 项（散文试点与关联标注）之后；plan 第 6 步的验收只列到 `hitrate --check-gold`。
- **选项**：
  - A：验证既已通过，随第 6 步一并勾选。
  - B：保留未勾选，留待第 7 步内容拆分落地后按同一批命令重新验证时勾选。
- **决策**：选 B。第 7 步会再次改动语料小节、gold、spec 与目录，验证结论应以拆分批次的实际结果为准；提前勾选会让「全部通过」早于它要验证的变更生效。
- **影响**：doc-check D1 仍保留该活动 plan 的未勾选条目（第 11–14 项）；第 6 步的实际验证结果已逐条记入本笔记「实现调整」，不因未勾选而缺失。

### 2026-09-16 — 两份迁移前基线继续保留的用户裁决

- **背景**：第 6 步要求核对当前用途；只引用登记表、通用 report/compare 入口或「至少一份基线」要求，不能证明两份快照应继续保留。
- **决策**：用户在本轮验收中明确授权：「明确保留两份作为迁移前基线，本次授权其继续保留」。按该裁决保留现有 GLM 正式基线与 Qwen 对照基线，适用范围限定为迁移前来源与检索配置；不据此把旧成绩用于迁移后同口径比较。
- **影响**：此次明确授权闭合两份快照的保留处置；快照内容、历史计数、基线登记要求及机械校验均不改写。目录注入历史按 docs/plan-index-and-tags-notes.md 核对：两份均产生于关键词目录引入前。

## 实现调整

### 2026-09-15 — CLI 参数错误退出码由 2 统一为 1
- **plan 原文**：第 3 步「CLI 对显式 --include-skill-tables（包括 0、1、缺值及非法值）在执行前报参数错误、退出码 2」；第 5 步「--inject-keyword-catalog 缺值/非法值报中文参数错误，退出码 2」；ADR-021 决策 5 同。
- **实际做法**：统一为退出码 1。bench CLI 当前所有失败路径（含参数错误）都由 bench/src/cli.ts 顶层 catch 设为 1，只有 scripts/ 侧（tooling.mjs、verify.mjs、release 任务）才有「0 成功／1 一般错误／2 参数错误」的约定。
- **原因**：避免同一 CLI 内出现两套退出码口径（仅退役参数用 2、其余参数错误用 1），也不在本计划内顺带改写全 CLI 的退出码契约。
- **后果**：plan 第 3、5 步与 ADR-021 决策 5 的退出码描述已同步为 1；若将来要在 bench CLI 引入「2＝参数错误」的统一口径，属独立议题，从 inbox 起步。

### 2026-09-15 — 数据源.md 移除前的来源与缺口留档
- **背景**：第 3 步移除 knowledge/references/数据源.md（开发来源说明不再作为语料文件）。按该步要求，删除前把最小来源依据与限制记入本笔记，不在 knowledge 下新建副本。
- **来源依据**：主源仓库 `arkntools/arknights-toolbox-data`，commit `4d474755461300c5c5a0414937191412162f620e`（经 RIIC-Web/src/generated/arkntools/ 落地），计数为干员 425／上游基建技能条目 747／术语 81；补源 RhodeLogisticsSteward/（派生自 ArknightsGameData）提供主源缺失的 efficiency、targets（产物／职业）与 nationId/groupId/teamId，计数略旧（干员 415、技能 727），均为主源子集。
- **已核对的口径差异**：①星级——主源 rarity 即实际星数，补源 0 起算（+1），全量零例外；②buffId——补源 `xxx[000]`、主源 `xxx_000`，归一化后 727/747 命中；③roomType——主源无该字段，由 id 前缀推出，与补源标注全量一致。
- **限制**：747 是上游条目数，不是规范化技能事实数；生成器缺位——本仓库没有 scripts/build_refs.py，不能承诺重跑即可重建，本次也不新增该脚本。
- **仍需定位的缺口原标识**：补源缺 targets/efficiency 的技能 20 条——`control_hire_spd_all_000`、`dorm_rec_oneself_002`、`dorm_rec_single&tag_000`、`hire_spd_013`、`manu_formula_spd_011`、`manu_formula_spd_214`、`manu_prod_cost_min_001`、`meet_spd&cost_condChar_002`、`meet_spd_023`、`meet_spd_notOwned_004`、`meet_spd_notOwned_P_000`、`power_rec_spd_027`、`trade_ord_spd&limit_tag_000`、`trade_ord_spd_022`、`trade_ord_wt&cost_004`、`train_spd&profession3_190`、`train_spd&profession3_191`、`train_spd_doubleProf3_000`、`train_spd_doubleProf3_100`、`workshop_formula_probability_301`；补源缺派系字段的干员 10 名——予愿安洁莉娜、佩德洛、嘉辛塔、时隙、机械师、焰狐龙梓兰、珊比、罗德岛隐秘队、谬因、雷狼龙S空爆。无法判定设施的技能 0 条。原文档未给玩家侧定位提示，缺口以本标识清单为准。
- **影响**：未来真源刷新需单独更新上述真实来源证据；本记录随计划归档进入实施纪要。

### 2026-09-15 — 第 2–3 步：目录迁移与消费者闭合的实施范围

- **范围**：本批只实施第 2–3 步（目录迁移与消费者闭合）。第 1 步事实出口（卡 v8）与第 4 步起的关联格式 v2、read、检索默认与目录注入开关均未实施，相关版本号（facts 7→8、工具 14→15、prose-links 1→2）仍是待实施约定，不记成已交付。
- **迁移落位**：11 份移入 knowledge/raw/——技能-会客室.md、技能-发电站.md、技能-办公室.md、技能-加工站.md、技能-控制中枢.md、技能-贸易站.md、技能-宿舍.md、技能-训练室.md、技能-制造站.md、名册.md、技能等价组.md；类别.md、歧义.md 移入 knowledge/guides/；数据源.md 删除，来源与缺口留档见上条。knowledge/references/ 目录撤销，文件保持原名，未在 raw 下重建 references 子目录。
- **manifest**：knowledge/corpus-manifest.json 登记由 31 条改为 19 条（base 12 + guides 7）；raw 不进检索白名单。
- **旧参数退役**：includeSkillTables 与 `--include-skill-tables` 退役；显式传入（含 0、1、缺值及非法值）一律在执行前报中文迁移错误、按 bench CLI 现有口径以退出码 1 结束，无开关时正常运行。新 inputs/meta 写可选 retrievalScope: "base-guides"；历史 includeSkillTables 字段与旧快照/元数据保持可读，不据 false 推断为新范围。
- **文档同步**：docs/spec/rag-answer-baseline.md 版本 v4 → v5，仅同步证据块路径与白名单范围表述（原 references/ 改记 raw/ 与 guides/）；题号、必答项、判定含义及历史运行记录均未改动。
- **说明**：本批验证的实际数字由主代理在收齐各批次后统一补记，此处不预写测试通过/失败数。

### 2026-09-15 — 目录迁移批次验证结果与红态归属
- **验证环境**：分支 feature/index-and-tags 工作区（含本批全部改动），命令均在仓库根执行。
- **验证结果**：`pnpm run typecheck` 通过；全套 `pnpm run test` 625 通过 / 2 失败（49 个测试文件 48 个通过）；`pnpm run check:prose-terms` 通过；`pnpm run check:reference-projection` 通过（9 分片一致）；重算后的 knowledge/关键词目录.md 与 `node dist/cli.js catalog --check` 一致；`node scripts/doc-check.mjs` 21 个错误全为 D1「活动 plan 存在未勾选条目」（plan-corpus-supplement 8、plan-progressive-disclosure 11、plan-index-and-tags 1、plan-prose-linked-knowledge 1），无 D2/D3/D4/D5/S 错误。
- **红态与归属**：bench/tests/benchmark-integrity.test.ts 两条用例失败（「questions、gold、spec 与 manifest/实际切块完全对齐」「在隔离快照集合中统计新增和移除后的数量与字节，并拒绝无效 JSON」），原因是 bench/gold.json 的 26 条 references 锚点尚未重定位；`node dist/cli.js validate` 与 `pnpm run bench:dry`（run 分支未指定 --questions 时先做基准完整性校验）因同一原因失败。以上均属 plan「已授权的门禁延后例外」列明的「旧 gold／白名单／基准完整性断言」，解除条件为第 6 步的「gold 定位分离与 26 键迁移、白名单/完整性断言、目录一致性和两份基线口径处置」；红态期间不合并、不发版、不登记新基线、不执行付费试验。
- **退役参数实测**：`node dist/cli.js run --include-skill-tables 0 --dry` 输出「错误：--include-skill-tables 已退役；RAG 仅检索 base/guides，精确事实请使用 facts 能力」并以退出码 1 结束。
- **新增行为覆盖**：manifest 拒绝 raw／references 条目、检索块与模型原文阅读目录不含 raw、CLI 退役参数四形态与退出码 1、facts 从 raw 正常加载、snapshot 历史字段与新 retrievalScope 并存、prose-terms 两文件精确例外未被放宽（新增 scripts/tests/prose-terms-check.test.mjs 与 facts-evidence-observation 默认名册路径用例）。
- **语料侧非路径改动**：13 份真源的生成头注改为真实维护信息（历史由上游生成、当前以版本控制内文本为输入、本仓库无该生成脚本）；base 35 行＋guides 3 行 references 回指改为能力表述；knowledge/guides/歧义.md 的「推王」条按本 plan 第 2 步与 ADR-010 的全部返回契约修订说明文字（不设默认目标、登记条目与成员未改）。
- **未闭合的已知遗留**：①bench/gold.json 26 条锚点与 validate/bench:dry 的解除属第 6 步；②docs/spec 证据块现引用白名单外的 raw 真源，「可定位不可检索」的完整口径同样待第 6 步闭合；③knowledge/base/机制-心情与工休.md 首部仍有一处指向 knowledge/raw/ 的既有来源标注（本批只把同行的 references 子句改为能力表述，raw 那半句与「等 raw 案例」措辞未改，属预先存在、非 references 回指）；④历史试验、归档计划、基线表与本机 bench-runs 保持原貌；⑤docs/adr/ADR-020 正文仍写 canonical 出自 knowledge/references/名册.md（ADR 正文按维护口径不在迁移批改写，留待后续文档清理或第 6 步一并处理）。
- **清理批验证**：补覆盖与注释同步后 `pnpm run typecheck` 通过、定向 fulltext-expansion 16/16、全套 `pnpm run test` 632 通过 / 2 失败——2 条仍为上述 gold 锚点用例，无新增失败；`node scripts/doc-check.mjs` 仍为 21 条 D1（8＋11＋1＋1），无 D2/D3/D4/D5/S。

### 2026-09-16 — 验收审查修复与复测

- **审查发现**：首次独立审查为 FAIL，阻塞项为 manifest 使用未归一化前缀校验导致目录穿越、CLI 入口测试缺少副作用隔离与完成等待，以及 inputs 测试共享清理未恢复原值；既有 gold 红态与已授权的事实出口延期不计为新增缺陷。
- **目录边界修复**：先在 bench/tests/corpus.test.ts 新增 4 种路径穿越、1 种目录链接和 1 种合法归一化路径用例，定向运行观察到 5 失败／13 通过；随后校验归一化 docId 与 realpath 的实际目标均属于 base/guides，18 条用例转绿。所有夹具及目录链接均位于测试持有的临时目录并自动清理。
- **测试隔离修复**：CLI 用例在导入前用依赖替身阻断配置读取、基准运行、完整性读取、目录生成和文件写入，断言这些边界均未调用、标准输出为空、中文错误及退出码正确；先运行 6 条入口用例确认缺少完成信号导致失败，再导出已有入口 Promise（cliCompletion，包含错误处理）并等待它收束。此导出只提供入口完成信号，不更改工具协议、默认配置或 CLI 退出语义。inputs 的 beforeEach 捕获 EXPERIMENT 前值，afterEach 恢复原值；属测试装配修复，由原有行为用例覆盖，11 条 inputs 用例通过。
- **复测结果**：`pnpm run typecheck`、`pnpm run build` 通过；全套 `pnpm run test` 为 631 通过／2 失败（49 个文件，48 个通过），新增 6 条目录边界用例均通过；剩余 2 条仍为上述旧 gold 完整性用例。此前 625／2 是修复前记录，保留作本轮验收过程证据。文档校验的未勾选计数按 8＋11＋1＋1＝21 更正，没有勾选未实施条目。

### 2026-09-16 — 第 1 步：事实出口（卡 v8）实施范围与验证

- **范围**：本批只实施第 1 步——接通技能注记 products/professions/referencedTerms 的投影与显示、保留 target 原始注记、显示等价组技能名与共同效果原文，并把 FACTS_RESULT_VERSION 由 7 升至 8。TOOL_SCHEMA_VERSION 保持 14（按 plan 第 0 步，read 切换时再升至 15）；prose-links 仍为 v1。
- **卡字段**：RecordSkill 新增可选 products/professions/referencedTerms/equivalenceEffectText。前三个在真实投影中恒存在（空注记保持 []，不推断缺项），raw 与 curated 两种模式同源；equivalenceEffectText 复制 SkillEquivalenceGroup.effectText，仅命中等价组时投影，curated 的 effectText 覆盖不改写它。旧 fixture/旧卡缺省这些字段仍合法（final.ts 的 fixture 兼容比较只覆盖 name/unlockType/target/effectText，未随之收紧）。
- **卡面渲染**：serializeCard 在技能行既有「效果／替换／备注」之后追加注记片段，固定顺序为作用产物、作用职业、引用术语、原始注记、同描述说明。旧卡缺省新增字段仍合法，空注记与缺省字段不产生占位片段；已有的非空 target 等字段按 v8 规则显示。同描述说明采用「同描述技能：甲、乙（设施：贸易站）」「共同描述（原文）：…」「仅描述相同；解锁、替换、作用对象与完整效果须分别核对」——设施放在技能名之后的括号内，以保留 plan 要求的固定前缀。facts_search、RAG 附带与 read_section 关联三个出口继续共用同一 serializeCard，未新增第二套渲染。
- **指令**：knowledge/AGENTS.md「证据边界」新增名册身份边界：规范名及现有别名、同名解析都未找到时说明知识库未收录、不凭记忆补全；一次空检索不能证明名册外或游戏中不存在，也不提出读取知识库原始文件的建议。
- **TDD 与验证**：先补测试并观察失败（8 条：projection 3、facts-tools 卡面 2、facts-tools 版本 2、trace 版本 1），再实现转绿。定向验证 projection／facts-tools／facts-resolution-executor／facts-tag-lookup／tool-executor 151 通过；全套 `pnpm run test` 640 项中 638 通过、2 失败，两条仍为旧的 gold 锚点完整性用例（第 6 步延后项），本批无新增失败；`pnpm run typecheck`、`pnpm run build`、`catalog --check`、`check:reference-projection`（9 分片一致）、`check:prose-terms` 均通过。计数门禁未变：425 卡／913 grant／167 替换边／82 等价组（final-gate 用例继续通过）。
- **新增覆盖**：projection 两条（注记数组同源、全量数组恒存在与等价组共同原文）＋训练室 professions 一条；facts-tools 新增「卡 v8 注记与同描述依据渲染」三条（固定顺序与空数组、同描述三句式、旧卡不补占位）及真实卡面一条（多萝西注记、巫恋同描述组）。版本断言随协议在 facts-tools／facts-resolution-executor／facts-tag-lookup／tool-executor 同步为 8。
- **未闭合**：第 4 步关联格式 v2＋read、第 5 步检索默认与目录注入开关、第 6 步 gold 定位分离与门禁转绿、第 7–8 步均未实施；旧 gold／白名单／基准完整性断言与 validate、bench:dry 的红态依旧，红态期间不合并、不发版、不登记新基线、不执行付费试验。

### 2026-09-16 — 第 4 步（分批之一）：关联格式 v2、scope 与概念引用

- **范围**：本批只交付第 4 步的关联层——prose-links 格式 v2（必填 scope、概念引用、文档根定位、路径与未知字段校验）、当前两条标注的显式迁移，以及 read 关联范围的合并算法。read 工具本体与 readDelivery 观测（plan 4.4–4.6）仍在下一批，工具定义版本保持 14，运行时的原文读取入口暂仍是 read_section（其 linked 展开复用同一批对象渲染）。
- **格式 v2**：顶层仅 version=2 与 links；每条为 file、headingPath、可选 occurrence、必填 scope（section｜subtree）、objects。file 校验语料根相对路径（拒绝绝对路径、反斜杠、空段、. 与 ..），并以当前 manifest 文件集合为准（raw 与开发文档不可定位）；headingPath 不含 #，空数组统一按文档范围 doc:<file> 定位且出现序号只能为 1；顶层、条目与各 kind 引用的未知字段一律报中文错误。运行拒绝 v1 文件并提示逐条补 scope 迁移，历史 inputs 中的 v1 记录原样可读。
- **对象模型**：解析结果统一为 { kind: 'card' | 'concept' } 的登记顺序数组，卡片保留原 ref/canonical/grantId/skillId 并新增 kind；概念携带 name、精确来源位置（file、headingPath、occurrence、term、termOccurrence）与定义原文行范围。概念引用只在当前原文快照中读取，不建第二份定义，不递归展开正文名字（ADR-022 决策 5）。
- **概念定位规则**：未填 term 时目标必须是有非空正文且无子标题的单概念小节；填 term 时在该小节直接正文（子标题之前）按行首「- **名称**」匹配，连续内容取至下一条同级条目，同名条目必须显式 termOccurrence，越界、未命中、宽章节、空正文与白名单外来源都进入 issues 与 unresolved，不静默跳过。缺 term 填 termOccurrence 属格式错误，加载即报错。
- **错误传播**：解析层保留 issues/unresolved 供诊断，重复引用记错误并只保留首项；装配入口按 plan 4.3 拒绝任何解析问题，不能仅靠真实语料测试把关。readObjectsFor 同样拒绝损坏索引；现有 linked 展开遇到索引错误返回 error，手工构造的失效对象保留 requested/omitted 明细并返回 error，不将其记为成功或空关联。缺文件及合法空标注仍表示无关联。
- **读取范围合并**（plan 4.2）：新增 readObjectsFor(sectionId, directory, index)，按「S 子树中的全部登记 + S 严格祖先中 scope=subtree 的登记」计算；文档根作为所有标题的逻辑祖先参与 subtree 继承（不改 sectionId 算法与 parentId 树）；读取子节点不继承祖先的 section 作用域；来源按节点原文顺序与 objects 内顺序稳定合并，卡按 canonical 去重（operator 完整卡覆盖同卡技能投影，explicitGrantIds 累加），概念按精确来源位置去重，每个对象保留全部 { sectionId, objectIndex } 来源。
- **当前标注迁移**：knowledge/prose-links.json 升为 v2，两条原有标注逐条补 scope=section，对象与顺序未改；未新增概念标注（标注相关性审核属第 7 步）。
- **概念卡渲染**：新增 serializeConceptCard，固定输出「【概念：名称】」「来源：file#标题路径（条目序号）｜L行范围」「定义：原文」；当前 read_section 的 linked 展开已复用该格式并在观测中新增 deliveredConcepts，未返回对象仍逐条报告。
- **TDD 与验证**：先改/补测试并观察失败（prose-links 套件 27 项中概念、格式、合并用例与三处观测断言转红），再实现转绿。定向：prose-links／prose-links-read／prose-links-hint／inputs 55 通过；全套 `pnpm run test` 656 项中 654 通过、2 失败（仍为第 6 步延后的旧 gold 锚点用例，本批无新增失败）；`pnpm run typecheck` 通过。
- **新增覆盖**：prose-links 增补格式校验 5 条（v1 拒绝、scope 必填与取值、未知字段三级、路径与 # 校验、缺 term 的 termOccurrence）、概念引用 4 条、读取范围合并 4 条（子树与祖先继承、文档根、同卡合并与来源、概念按位置去重）；prose-links-read 增补概念卡送达 1 条。
- **未闭合**：read 工具与双偏移分页（plan 4.4、4.5）、readDelivery 与 trace/records/meta/report/inputs/snapshot 接通（4.6）未实施，工具版本仍为 14，RAG 关联入口提示仍引导 linked 展开；第 5–8 步未开始。

### 2026-09-16 — 事实出口与关联 v2 批次验收修缮

- **事实出口验收**：独立审查放行第 1 步，亲自运行相关 7 个文件共 176 项测试通过；其全量比对覆盖 raw/curated 各 425 卡、913 grant、167 替换边、82 等价组，排除四个新增字段后旧字段一致，两模式共 2,380 次登记词查询的解析路径、成员与类别一致。按审查意见将代码注释及本笔记中的「旧卡逐字一致」改为缺字段可读、无占位片段；纯措辞修正未改变实现。该批提交为 94c68b8（10 文件）。这些全量比对为独立审查记录，主代理未重复执行。
- **关联层初审**：独立审查为 FAIL，确认真实解析问题未阻断装配、concept 文档根越过标题边界且未校验出现序号、linked 去重漏掉标题 occurrence。自查补充同级普通列表条目截断问题。以上均违反本批既定契约，不属于延期门禁；原笔记将装配失败称为后续独立收紧的说法已更正。
- **修复先红**：主代理先新增 12 条回归用例并将 3 条损坏快照用例的状态断言改为 error，定向运行 prose-links/prose-links-read 得到 15 失败／35 通过。覆盖真实装配入口的失效定位、失效对象、重复引用，根概念范围与序号，普通同级列表边界，损坏索引读取，以及重复标题概念分别送达。
- **修复与复测**：装配与范围合并拒绝错误索引，linked 显式报错；文档根按同一目录快照的首个真实标题划定直接正文，空名称概念拒绝；列表定义在下一同级条目前结束；概念身份计算统一包含标题 occurrence。定向 50 项全部通过；全套 `pnpm run test` 为 666 通过／2 失败（共 668 项、49 文件），剩余两项仍是 benchmark-integrity 的 26 个旧 gold 锚点。`pnpm run typecheck`、`pnpm run build`、`git diff --check` 通过。
- **复审补充**：独立复审发现，无子标题但包含多个术语条目的叶小节仍可被整段包装为概念。先补不带 term 引用术语表的回归用例，观察 1 失败／37 通过，再要求这类小节显式填写 term。随后全套 `pnpm run test` 为 667 通过／2 条旧 gold 失败（共 669 项），`pnpm run typecheck`、`pnpm run build` 与差异空白检查通过。
- **格式与标识修缮**：复审另确认空字符串字段名绕过未知字段校验，并建议保持 injectedIds 的既有标识口径。新增顶层/条目/对象的 3 条空键回归，更新两个概念送达用例验证概念名不进入 injectedIds，定向先观察 5 失败／49 通过；随后使用显式 undefined 判断未知键，injectedIds 仅保留 canonical。最终全套为 670 通过／2 条旧 gold 失败（共 672 项），类型检查、构建与差异空白检查通过；概念送达仍单独记录于 linkedFacts.deliveredConcepts，完整位置观测待后续 readDelivery。
- **其余核对**：本轮 `catalog --check`、`check:reference-projection`（9 分片）、`check:prose-terms` 通过；文档检查仍只报告活动计划未勾选的 20 个 D1（8＋10＋1＋1）。旧 gold、validator 与 benchmark-integrity 断言未修改；未执行付费试验、合并或发版。事实出口已补齐，精确技能投影、read 本体/双偏移分页/观测及第 5–8 步仍待后续实施，本轮不勾选关联层整项。

### 2026-09-16 — 第 4 步（分批之二）：read 本体、精确技能投影与 readDelivery

- **范围**：本批实施 plan 4.2 剩余的精确技能投影、4.4 read 参数与旧工具退役、4.5 双偏移分页与容量契约、4.6 实际送达观测接通 trace/records/meta/report/inputs/snapshot。TOOL_SCHEMA_VERSION 14 → 15（facts 结果仍为 8、prose-links 仍为 2、小节目录结构与 ID 算法未改）；第 5 步（expandFulltext 默认、injectKeywordCatalog、RAG fragmentRanges）与第 6–8 步未实施。
- **工具切换**：模型侧只暴露 `read`（bm25 与 hybrid 都保留），参数固定为 section_id、offset、facts_offset；`read_section`、`linked`、`offset` 与 linked 互斥等旧契约整体移除，`LinkedFactsObservation`、`linkedFacts` 字段一并删除。运行时收到 `read_section` 时按未知工具拒绝（status=unknown_operation、executed=false），文案为「read_section 已退役；请改用 read（参数：section_id、offset、facts_offset），原文与关联事实在同一次读取中返回；本次调用未执行。」，不静默改译；ToolId 与 isObservedTool 仍识别旧名，供历史记录与聚合读取。
- **输出格式**：read 的 data 固定为「【阅读范围】→【分页】→【原文】→【关联事实】→【导航】」五个分区；【阅读范围】给出 file、标题路径、section_id 与本页原文行范围（无正文时写「无」）；【分页】为单行合法 JSON，字段与顺序固定为 section_id、offset、next_offset、body_complete、body_total_chars、facts_offset、next_facts_offset、facts_complete、facts_total、facts_returned、facts_result_version、complete、next_call；空分区显式写「（无本页内容）」。【导航】为可选分区，含直接父级范围入口与同级/子小节导航（最多 8 项），只用余量、整行保留 ID 并按行裁减后附「（省略 N 项）」。
- **容量与偏移**：正文页不超过 6000 UTF-16 字符，优先完整行、超长单行按字符切且不拆代理对；offset 落在代理对中间、超出正文长度、facts_offset 超出对象数都按 invalid_params 拒绝（不计 executed）；未知 ID 返回 empty 并提示使用本次返回的 ID。事实按完整对象分页，容量不足时按顺序停止、不跳过前面的对象挑短卡；单个对象超过整页可用额度时报 error「关联对象超过阅读容量」，不给半张卡也不给不前进的 next_call。已读完的一侧在 next_call 中用总长度/总对象数（不传 null），两侧都读完时 next_call=null。
- **readDelivery 口径**（plan 4.6 两种说法的落地）：`bodyRange`/`factsPage` 在无法取得时省略（参数级非法、容量错误、索引损坏等送达前失败），在已构成页面但无证据时写 null（bodyRange）或写实际分页计数（factsPage），`deliveredObjects` 在送达前失败时省略、已观察无证据时为 []；容量失败不写成空关联。`grantIds` 为实际展示的 grant：投影卡含明确引用与被替换链、完整卡列出卡内全部 grant；概念沿用文件+标题路径+条目序号定位，不新增散列 ID。
- **旧运行不混用**：report 的 `readDeliveryStats` 在「任意记录使用过 read_section」或「请求过 read 却缺台账」时整体为 null（不可用），只在明确没有 read 调用的新运行记 0；`errors` 计未取得证据的非空结果（含容量错误与参数错误），`bodyChars` 取送达区间长度、跨调用重复计卡次。
- **接口与留档**：`CostRecord.readDelivery` 为按 callId 的数组（与 ragDelivery 同形），trace 单个 tool_call 事件保存对应单条，snapshot 新增逐层类型白名单（未知字段被过滤，不保存正文），meta 增加 `readDeliveryStats`，inputs 新增顶层 `factsResultVersion` 与 `links.entries`（每条登记保留 sectionId/file/headingPath/occurrence/scope 与可读引用，概念带精确来源位置；定义原文与正文仍只在 trace/readDelivery 中按引用关联）。
- **指令与示例**：knowledge/AGENTS.md 的阅读入口改为 `read`；rag_search 关联事实入口提示改为「用 read 读取该小节即可同时取得原文与登记事实」；全文扩展续读行改为可直接复制的 `续读：read(section_id="…", offset=…)｜complete false｜正文 N 字符`。
- **容量预留的偏离说明**：plan 4.5 要求「先预留必要元数据、来源及完整 next_call」。实现按当前范围与最大数字位数预留含 next_call 的额度，并在「整段可能一次读完」时另算一份不含 next_call 的额度作为回退（该额度仍经页后序列化验证，若实际需要续读就回落收紧或报容量错误）。未预留 next_call 的额度只在页内没有续读调用时成立，因此不产生「预留不足却宣称成功」的页；这样可避免单页读完的短范围被无谓判为容量不足。
- **TDD 与验证**：先写/改测试并观察失败：新增 bench/tests/read.test.ts 22 项（工具定义与旧名退役、参数校验、分区格式与分页元数据、双偏移与容量、精确投影、送达观测），迁移 11 个既有测试文件（prose-links-read、section-navigation、section-navigation-runner、tool-executor、facts-tools、agent、agent-auto-loop、fulltext-expansion、retrieval-range、runner、report）并新增 snapshot/inputs/report 的 read 台账用例；首轮定向运行读到 21 项失败，实现后全部转绿。全套 `pnpm run test` 为 690 通过／2 失败（共 692 项、50 文件），两条失败仍是第 6 步延后的 benchmark-integrity 旧 gold 锚点用例，本批无新增失败。`pnpm run typecheck`、`pnpm run build`、`check:reference-projection`（9 分片一致）、`check:prose-terms`、`catalog --check`、`git diff --check` 通过；`node dist/cli.js validate` 与 `bench:dry` 仍因同一批旧 gold 锚点失败（属已授权延后项）；`node scripts/doc-check.mjs` 报 18 条 D1（plan-corpus-supplement 8、plan-progressive-disclosure 8、plan-index-and-tags 1、plan-prose-linked-knowledge 1），无 D2–D5 与结构类错误，其中本计划由 10 条减为 8 条对应当前批次勾选的两项。
- **新增覆盖要点**：read 参数四类非法与代理对边界；分区顺序与 13 个分页字段；长正文连续分页无中段丢失且每页不超过 maxContextChars；小预算下多页拼回原文（含非 BMP 字符）；事实按完整对象分页并在续读时不重复；两侧完成状态与 next_call 的两种形态；元数据放不下与单对象超容量两种容量错误；skill 引用只投影指定 grant 与被替换链并标注明确引用/替换依据、同卡合并与 operator 覆盖；概念只按精确位置去重且不进 injectedIds；首次/续读的 attempt 与 success 计量；runner 端 trace、records 的 read 台账与 inputs.links.entries/factsResultVersion。
- **未闭合**：第 5 步的 expandFulltext 默认关闭与 injectKeywordCatalog 开关、RAG 的 fragmentRanges 与必要 ID 优先；第 6 步 gold 定位分离与 26 键迁移、白名单/完整性断言与两份基线处置；第 7–8 步散文试点与真实模型观测。上述两项验收条目（关联层格式与精确投影、read 替代旧工具）在本批完成，已在 plan 验收清单勾选；「read/RAG 实际范围与对象送达接通」因 RAG 片段范围属第 5 步，仍未勾选。
- **观测脚本核对**：scripts/tasks/bench/facts-evidence-observation.mjs 只读 trace 的 facts_search 事件与 records.ragDelivery，两者字段形状未变，无需机械改动；其口径（显式 facts_search + RAG 附带）本就未包含阅读路径送达的卡片，本批 read 的送达另由 readDeliveryStats 观测。是否把 read 送达的卡片计入该脚本的正式名送达统计属口径变更，未自行修改，留待需要时另行决定。

### 2026-09-16 — inputs.links.entries 用解析后可读引用而非登记原文

- **背景**：plan 4.6 要求 inputs 保存「每条 v2 登记的 sectionId/file/headingPath/occurrence/scope/objects」，并「概念精确位置通过引用与送达记录关联」。
- **实际做法**：`ProseLinkIndex` 只保留解析结果（可读 ref、canonical/grantId、概念精确位置），登记原文只存在于 knowledge/prose-links.json。为避免为留档再读一次旁挂文件或让索引携带原文，entries 记录解析后可读引用：卡片写 {kind, ref, canonical[, grantId]}，概念写 {kind, ref, name, file, headingPath, occurrence, term?, termOccurrence?, startLine, endLine}，解析失败引用写 {kind:'unresolved', ref, reason}；不含定义原文与正文。
- **影响**：entries 与登记条目一一对应（真实语料中重复引用与失效引用都在装配期被拒绝，故不丢条），足以把 readDelivery 的送达对象按 ref/精确位置回溯到登记；若将来需要在留档中逐字保存登记原文，应改为直接留档 prose-links.json 内容，属独立议题。

### 2026-09-16 — 第 4 步交付的验收审查修复（分页前进、来源送达与台账口径）

- **审查发现**：独立审查对本批 read 交付提出 7 项阻塞与 3 项整理：①窄容量下可能返回「无证据且偏移不前进」的页，未知 ID 提示不受 maxContextChars 约束；②report 把缺失观测（历史/字段不完整台账）记为零送达，预算拒绝的 read 没有台账；③运行快照未统一（目录、关联解析、事实卡各自加载）；④参数含空字符串键时绕过未知字段校验；⑤明确引用标签受登记顺序影响；⑥登记来源只留在后台台账，没有随对象送入模型也未计入分页容量；⑦容量失败丢弃已取得的事实页信息；另加导航省略数量不完整、死代码与进度文档不一致。这些均属 plan 4.4–4.6 既定契约内的缺陷，不计入第 6 步的延后例外。
- **分页前进（bench/src/read.ts）**：容量收缩循环内重新校验首个待送对象是否仍放得下（放不下即按「关联对象超过阅读容量」报错），成功页返回前再兜底拒绝「未完成且两侧偏移原地不动」的页。修复前复现：甲节＋5 张卡、maxChars=770 时原实现返回 empty、complete=false、两侧偏移仍为 0；对应用例已固化为窄容量扫描断言。
- **来源送达（bench/src/read.ts）**：renderReadObject 为每个送达对象追加「登记来源：<file>#<标题路径>」（多来源按「；」连接，节点取不到时回退 section_id），来源文本位于【关联事实】分区并计入同一分页预算；此前 notes「容量预留的偏离说明」只预留元数据与 next_call，来源未预留，本批按 plan 4.5 补齐。
- **失败台账（bench/src/read.ts）**：容量错误、记录卡缺失等送达前失败改为登记 factsPage（offset=factsOffset、nextOffset=null、returned=0、complete=false），仍不写实际范围与 deliveredObjects；预算拒绝的 read 也留下 status=budget_exhausted、sectionId=null 的台账（未解析参数，不上报范围，tool-executor.ts 的 exhaustedResult）。
- **台账汇总（bench/src/report.ts）**：readDeliveryStats 改为逐字段判定可用性——任一调用缺 bodyRange 或 deliveredObjects 时对应字段为 null，只把已观察到的空值记 0；calls/successes/empty/errors 口径不变。此前的记录（「整体为 null 或 0」两档）随之细化为按字段不可用。
- **未知字段校验（bench/src/tool-executor.ts）**：rag_search、facts_search、read 三处未知键判断由真值改为 `!== undefined`，空字符串字段名不再绕过校验，返回 invalid_params。
- **技能投影（bench/src/facts/store.ts）**：skillProjection 改为两遍处理，先登记全部明确引用、再沿 replacesGrantId 补替换依据；先引用升级技能再引用其被替换技能时，后者仍标「明确引用」。
- **导航与死代码（bench/src/read.ts）**：省略数量改为「导航上限截断数（navigationFor 的 omitted）＋预算裁减数」，尾部数字按实际保留条数计算；删除未被调用的 assemblePage。
- **运行快照（bench/src/runner.ts、prose-links.ts、tool-executor.ts、agent.ts）**：buildProseLinkIndex 改为可选对象入参，可注入运行级小节目录与 raw facts；runner 只装配一次小节目录并注入关联解析，另以运行级惰性提供者（factsStore）注入 facts 卡片快照，供 facts 工具与 read 共用同一实例；模块级单例仍是缺省回退，无 runner 的调用方与测试替身路径不变。
- **未知 ID 提示（bench/src/tool-executor.ts）**：新增 boundIdMessage，未知小节与无目录提示按 maxContextChars 截断回显的 ID（不拆代理对），empty 结果的 data 同样守住预算。
- **进度文档**：docs/inbox.md 的渐进披露条目由「第 4 步部分实施」更正为「read 本体、精确技能投影与 readDelivery 已实施，第 5–8 步待实施」；sections.ts、delivery.ts、agent.ts、prose-links.ts 中指向已退役 read_section / linked 展开的过期注释同步更新。
- **TDD 与验证**：先补/改用例并观察失败——read 8 条（未知 ID 预算、空键拒绝、导航省略数量、窄容量分页前进扫描、来源入预算、超容量 factsPage、投影顺序、预算拒绝台账）、report 2 条、tool-executor 1 条、prose-links 1 条（快照注入）；修复后定向 4 个文件 137 项全绿，全套 `pnpm run test` 为 701 通过／2 失败（共 703 项、50 文件），两条失败仍是第 6 步延后的 benchmark-integrity 旧 gold 锚点，本批无新增失败；`pnpm run typecheck` 通过。
- **未闭合**：第 5 步（expandFulltext 默认、injectKeywordCatalog、RAG fragmentRanges 与必要 ID 优先）与第 6–8 步未开始；plan 验收清单第 7 项因 RAG 片段范围属第 5 步保持未勾选，read 侧范围与对象送达（含本批修复）已接通。

### 2026-09-16 — 第 4 步遗漏项修复（复审）

- **背景**：前一条「第 4 步交付的验收审查修复」声称已修的三项经复审仍不完整：report 只在记录里出现旧工具名 read_section 时判不可用，正式旧快照（下发过 read_section 但未调用）仍返回七项全零；运行快照只统一了小节目录，关联解析与卡片投影仍各自加载 facts，卡片继续走跨运行单例；skillProjection 对卡上不存在的 grant 仍静默跳过，read 会返回「成功但技能数为 0」的投影卡。另有三项边界与契约遗漏（快照边界、失败页完成状态、重复标题来源显示）。以下均属 plan 4.2–4.6 既定契约与冻结契约内的缺陷，不属第 6 步延后例外。
- **report 汇总（bench/src/report.ts、cli.ts、runner.ts）**：新增 ReportRunDeclaration（toolNames）与 runDeclarationFromMeta；readDeliveryStats 只在运行明确下发 read 时才把「零次调用」记 0，未声明（无 meta 的裸 records、toolSchemaVersion 12 的旧快照）保持 null，不再把未调用与未观测混同；新增台账覆盖检查——请求过 read 却缺台账数组、或台账条目数与单调用规则下实际准入的调用不符（含未请求 read 却出现台账）都判整体不可用，同批超量拒绝的 read 仍不计。runner 以工具 schema 的 toolNames 声明，cli 的 run/report 从运行目录 meta.json 读取同一声明。
- **运行级 facts 快照（bench/src/facts/final.ts、facts/store.ts、prose-links.ts、runner.ts）**：final.ts 拆出 loadValidatedFacts 与 projectValidatedRecordCards（loadValidatedRecordCards 保留为组合入口，行为不变）；buildProseLinkIndex 的 facts 入参支持惰性提供者；runner 只加载一次 raw facts，同时注入关联解析与卡片投影，并以新增的 createRunCardStore 从运行级卡片构建 store，不再回落模块级单例（单例仍是缺省回退，供无 runner 的调用方与测试替身使用）。
- **技能投影（bench/src/facts/store.ts）**：skillProjection 对卡上不存在的明确引用、以及替换链中缺失的被替换 grant 直接报中文错误，read 由此得到 error 结果而不是静默丢弃该引用；环状关系与已入选项的稳定跳过保持。
- **快照边界（bench/src/snapshot.ts）**：数值统一要求非负安全整数；factsPage 校验 offset 与 offset+returned 不越 total，并要求完成状态与 nextOffset 一致（complete 时为 null，未完成时等于本页结束偏移）；概念 occurrence/termOccurrence 必须从 1 起；概念条目与原文范围的倒置行范围（endLine < startLine）拒绝。
- **read（bench/src/read.ts）**：送达前失败页的 factsPage 恒为 returned=0、complete=false（无事实或 facts_offset 已耗尽时不再标成完成）；登记来源在同文件同标题路径重复标题时附「（出现序号 N）」，按 sectionId 去重，显示不再把两处来源合并成一条。
- **TDD 与验证**：先补/改用例并观察失败——report 4 项、snapshot 2 项、read 4 项、prose-links 1 项、runner 1 项、inputs 1 项（vi.doMock 改为在卡片投影阶段抛错，raw facts 快照仍正常加载），首轮定向读到 10 项失败（含 4 条既有断言的改造）；实现后定向 5 个文件 122 项全绿。全套 `pnpm run test` 为 711 通过／2 失败（共 713 项、50 文件），两条失败仍是第 6 步延后的 benchmark-integrity 旧 gold 锚点，本批无新增失败；`pnpm run typecheck`、`pnpm run build`、`check:reference-projection`（9 分片一致）、`check:prose-terms`、`catalog --check` 通过。
- **实测复核**：`node dist/cli.js report` 两份已登记快照的 read 行由七项 0 改为七项「不可用」；本轮 dry 端到端（run → export 共享快照 → report）在明确下发 read 的运行下得到调用 0／成功 0，临时运行目录与快照已删除，未新增入库产物。
- **未闭合**：第 5 步（expandFulltext 默认、injectKeywordCatalog、RAG fragmentRanges 与必要 ID 优先）与第 6–8 步未开始；旧 gold 及依赖它的 validate／bench:dry 红态不变。

### 2026-09-16 — 提交验收中的失败记录衔接修缮

- **范围**：按用户要求，只核对第 4 步冻结契约并使用现有测试入口；本轮未新增探针、基准、诊断框架或留档产物。独立审查指出失败事实页被快照校验拒绝、取得对象序列后的加载/投影异常丢失 factsPage，以及概念 termOccurrence 缺少 term 的校验遗漏。
- **修缮**：快照按 error 状态接受 returned=0、complete=false、nextOffset=null 的失败页，正常续读校验保持；补齐概念字段依赖。读取层在已知对象序列与有效事实偏移时保留失败 factsPage，原有 fatal 语义保持，不写实际范围或送达对象；清除未使用的正文页常量导入。
- **TDD**：在原有 snapshot 测试中补充失败页与字段依赖回归，先观察 2 失败／12 通过；测试夹具补齐对应 queries 条目。随后扩展原有缺失 grant 用例，观察 1 失败／47 通过；实现后 read/snapshot 两个文件共 48 项通过。未修改旧 gold、benchmark-integrity 或门禁脚本。
- **复测**：全套 `pnpm run test` 为 712 通过／2 条旧 gold 失败（714 项、50 文件）；类型检查、构建与差异空白检查通过。文档检查仍仅 18 条活动计划 D1；本轮既有 reference-projection、prose-terms、catalog --check 通过。第 5–8 步及旧门禁延后范围保持。

### 2026-09-16 — 第 5 步：检索默认送达与关键词目录注入开关

- **范围**：本批实施 plan 第 5 步——默认 `expandFulltext=false` 的命中块送达与 `fragmentRanges` 观测、默认 `injectKeywordCatalog=false` 的目录注入开关（含 CLI、指令装配与三处留档）。既有协议契约未变：TOOL_SCHEMA_VERSION 仍为 15、FACTS_RESULT_VERSION 仍为 8、prose-links 仍为 2、小节目录结构与 ID 算法未改。第 6–8 步未实施。
- **RAG 默认送达**：默认（未显式 `--expand-fulltext 1`）只送达命中的 H2/H3 块。块头为 `【<file> | <标题> | L<起>-<止> | <section_id>】`，正文取该块在**同一次装配的原文快照**中的行范围（止于下一个 H2/H3 边界），不再使用 `SectionEntry.body`，命中 `##` 小节时不会混入未命中的 `###` 子节；BM25 的索引输入（`chunk.text`）保持不变。必要元数据（小节 ID、来源、行范围）优先于正文：额度连元数据加一单位正文都放不下时不发送该块（继续尝试后续更小的块，不重新检索补满 topK），全部块都放不下时返回明确容量错误。块超预算时按行边界连续截取（超长单行按字符切且不拆代理对），并追加可复制的 `续读：read(section_id="…", offset=N)｜complete false｜正文 M 字符`；`offset` 为块首行在所属小节 body 中的偏移加本页长度，续读返回的正是该块后续原文。
- **片段范围观测**：`RagDeliveryRecord` 新增可选 `fragmentRanges`，每项为 `{kind:"hit"|"parent_lead", file, sectionId, chunkId?, docOffset, docEndOffset, startLine, endLine}`，偏移相对同运行 `documentRange.body`，与 readDelivery 的 `docOffset` 同坐标。只登记实际返回的连续正文（不含来源头、导航与分页元数据）；父级引导按实际写入登记。字段接通 trace 的单条 tool_call、records 的 ragDelivery、snapshot 白名单（逐层过滤未知字段，只接受 hit/parent_lead）与 meta/report 的 `ragDeliveryStats.fragmentRanges`（任一调用缺该字段即判不可用，全文扩展模式为已观察的 0）。全文扩展模式继续只用 `fulltextRanges`，不重复登记相同正文。
- **关联提示改向**：`rag_search` 的【关联事实入口】改为面向**实际显示的命中节点与导航项**，按 ADR-022 决策 4 的读取范围合并规则逐节点计算是否有可展开关联，只列确实有登记对象的小节，行内给出对象数与可直接复制的 read 示例（`｜示例：read(section_id="…")`）；不再按命中文件列出全部登记。提示仍是导航，`linkedEntries.written` 只表示该行确实写入本次 data。
- **目录注入开关**：`ExperimentConfig`/`BenchConfig` 新增 `injectKeywordCatalog`（默认 false）；`loadKnowledgeAgentInstructions(root, injectKeywordCatalog)` 关闭时只读取并返回 `knowledge/AGENTS.md`（目录缺失不报错），开启时按原格式追加目录正文，缺失/读取失败/为空仍按中文错误失败。CLI 新增 `--inject-keyword-catalog 0|1`（缺值与非法值按 `readBinarySwitch` 报中文错误、退出码 1），未显式传入沿用默认；run 的回显行新增「目录注入：开/关」；hitrate 显式传入时提示忽略；catalog 子命令列为不支持参数且不写文件。runner 与 `runQuery` 的提示兜底都按有效配置装配指令，`buildSystemPrompt` 的缺省入参等于默认配置（关闭），不保留暗中恒定注入的旁路。inputs/meta 记录 `injectKeywordCatalog`，snapshot 的 meta 白名单放行该键（历史缺字段不推定当时关闭）。
- **实施决策**：①命中块无对应小节时（标题前首部等「（未分段）」块）以同文件文档范围 `doc:<file>` 作为可调用 ID 与续读基准，不新增 chunk ID 冒充 read 目标；②关联提示不含上级范围入口与文档范围块，后者等价于「列出命中文件全部登记」；③父级引导取最多 300 UTF-16 字符的连续前缀，行范围与字符范围均按该前缀登记，展示单元放不下则整条省略；④默认路径缺少目录或原文映射失败时报错，停止发送无阅读 ID 的正文；显式全文回退保留既有无目录兼容行为。
- **契约变更**：RAG 极小额度下的失败语义由「硬截断产生截断头部 → empty」改为「不发送该块 → 明确容量错误（`无法在 maxContextChars=N 内返回命中块…`）」，与 ADR-022 的 read 容量口径及既有全文扩展分支一致，仍不扣成功额度；tool-executor 原用例随之更名并改断言。
- **TDD 与验证**：先写/改测试并观察失败——配置与目录注入一批（config/catalog/cli-args/inputs 4 文件）在把 `bench/src` 改动暂存回旧实现后运行，得到 11 失败／60 通过；RAG 送达与片段范围一批（新增 bench/tests/rag-delivery.test.ts 6 项，另改 prose-links-hint、section-navigation、report、snapshot、facts-attach、tool-executor）首轮定向 13 失败／101 通过，修正夹具与契约后 4 失败／118 通过，实现完成后相关 5 文件 89 项全绿。最终全套 `pnpm run test` 为 727 通过／2 失败（729 项、51 文件），两条失败仍是第 6 步延后的 benchmark-integrity 旧 gold 锚点用例，本批无新增失败；`pnpm run typecheck`、`pnpm run build`、`catalog --check`、`check:reference-projection`（9 分片一致）、`check:prose-terms` 通过；`node scripts/doc-check.mjs` 由 18 条 D1 减为 15 条（本计划勾选 3 项），无 D2–D5 与结构类错误。
- **新增覆盖要点**：默认 `expandFulltext`/`injectKeywordCatalog` 为 false 且可显式回退；四组 expand/inject 组合下的 systemPrompt、inputs.config 与 meta 一致性；目录关闭时缺失不报错、开启时缺失与空目录报中文错误；`--inject-keyword-catalog` 解析、hitrate 忽略提示与 catalog 拒绝；命中块头含 ID/来源/行范围且止于下一个 H2/H3 边界；末尾上下文装不下时 ID 仍随块送达；容量不足不发送该块、不出现被截断 ID；连续截取页与 read 续读拼接覆盖整块；父级引导片段坐标与原文一致；全文扩展模式 `fragmentRanges` 为空且不重复登记；提示只覆盖命中节点与导航项、未被显示与其它文件的登记不再列出；report 的 `fragmentRanges` 计数与不可用口径；snapshot 片段的往返、未知字段过滤与非法类型拒绝；真实 runner 下默认无全文扩展范围、片段范围非空并与 meta 汇总一致。
- **连带更新**：`bench/src/catalog.ts` 的 `TODO(tech-debt) IDX-1` 注释改为「显式开启注入时才随 prompt 送达」（债务对象不变）；docs/inbox.md 的渐进披露条目与本条目录压缩条目的实施状态同步；plan 验收清单勾选「read/RAG 实际范围与对象送达接通」「expandFulltext 默认关闭」「injectKeywordCatalog 默认关闭」三项。
- **未闭合**：第 6 步（gold 定位分离与 26 键迁移、白名单/完整性断言转绿、关键词目录全文重生成与一致性门禁、两份基线用途与口径处置）、第 7 步（散文试点与标注）与第 8 步（零费用端到端契约、分阶段 hitrate、真实模型观测）均未开始；旧 gold 及依赖它的 `validate`／`bench:dry` 红态不变，红态期间不合并、不发版、不登记新基线、不执行付费试验。

### 2026-09-16 — 第 5 步验收修缮

- **审查处置**：独立审查发现父级引导范围高报／漏记、小预算下实际附带 facts 却未计成功、默认无目录入口送达无阅读 ID 正文及未使用导入。按既定契约修复：引导展示与登记共用连续切片，余量不足整条省略；RAG 或 facts 任一实际送达即计成功；默认缺少有效阅读范围明确失败；删除失去消费者的导入和中间字段。
- **TDD**：在 rag-delivery 与 section-navigation 的现有测试入口先观察 3 失败／25 通过，修复后 28 项通过。全套复测暴露 21 项旧无目录夹具的前置条件变化；循环、预算与 facts 边界用例显式选择原有全文回退，保持原断言；默认容量用例改用真实白名单目录。默认行为仍由真实目录的送达、续读、范围与缺目录回归覆盖，无独立探针或新诊断框架。
- **验证**：修缮后全套 pnpm run test 为 729 通过／2 条旧 gold 失败（731 项、51 文件），pnpm run typecheck 通过。旧 gold、benchmark-integrity 断言与门禁脚本均未修改。目录开关的新增测试覆盖解析、分流辅助函数、四组合 prompt 与留档；真实 CLI 退出处理及 runQuery 缺省装配由静态审查核对，未宣称新增入口回归覆盖。

### 2026-09-16 — 第 6 步：gold 定位分离、26 键迁移与门禁转绿

- **范围**：本批实施 plan 第 6 步——gold 的 26 条 references 锚点按真源路径迁移；hitrate／benchmark-integrity 的完整定位目录改为「manifest 原文分块 + facts 声明的 11 份 raw 真源」并与检索范围分离；白名单/完整性断言按新职责调整并转绿；关键词目录重算与一致性检查；两份已登记快照的逐份用途核对与口径标注。TOOL_SCHEMA_VERSION 15、FACTS_RESULT_VERSION 8、prose-links v2、小节目录结构与 ID 算法均未变；第 7–8 步未实施。
- **gold 迁移**：bench/gold.json 保留原结构 `{题号: {golden: [file#标题]}}`，20 题与 69 条 golden 未增删、未替换；26 条 references 锚点按迁移清单改路径——`references/类别.md` → `guides/类别.md`（S02、S03 共 2 条），`references/技能-*.md` 与 `references/技能等价组.md` → `raw/` 同名文件（24 条）；标题文本逐条保持原样，未按长度或难度调整。数据源.md 无 gold 键，未补替代证据。
- **定位目录**：corpus.ts 新增 `loadGoldAnchorChunks(corpusRoot, rawDocIds)`＝`loadCorpus(manifest)` + 指定 raw 真源分块，复用同一 `splitChunks`；raw 清单由 facts/references.ts 新增的 `RAW_MACHINE_SOURCE_DOC_IDS` 单点声明（名册、技能等价组、9 个设施分片，共 11 份），references.ts 与 equivalence.ts 的加载器改用同一批文件常量，避免第二份人工名单。`resolveRawSourceFiles` 只接受 raw/ 下的普通 Markdown 文件：越界路径、非 raw 前缀、符号链接、非普通文件与缺失都直接报中文错误，不递归扫描 raw、不静默返回空库。
- **消费者**：cli.ts 的 hitrate 与 `--check-gold` 改用定位目录（上下文行标注「manifest + raw 机械真源 11 份」）；benchmark-integrity.ts 的 gold 文档/锚点校验与 checkGold 改在定位目录解析，summary 新增 anchorFileCount／anchorChunkCount，`validate` 输出同步；RAG 检索、模型 sections 目录与 inputs 模型目录仍只用 manifest，两个目录不互相传错。
- **完整性断言**：白名单断言维持「manifest 文件集合＝真实加载集合＝模型阅读集合、均不含 raw」与精确计数（19 份：base 12、guides 7）；「gold 来源有效」不再等价于属于 manifest，改由定位目录判定，raw 真源可定位但被检索范围排除。
- **实测计数**：`node dist/cli.js validate` 通过并输出 20 题 / 20 个 gold 题号 / 20 个 spec 题号 / 19 个白名单文档 / 121 个切块 / 30 个定位文档（742 个定位切块）/ 2 个共享快照；`hitrate --check-gold` 通过（20 题 69 项 golden 全部可解析）；零费用 `hitrate --topk 3,5,10` 的范围计数为定位目录 742 块｜检索范围 121 块｜排除 621 块｜被排除 gold 键 24 项（@3 R 51.1%／P 48.3%／nDCG 0.623，@5 60.7%／36.0%／0.638，@10 66.7%／20.0%／0.664）。这是纯迁移时点观测，与迁移前（定位 749／检索 145／排除 23）口径不同，不直接横比；试点时点的分阶段对照仍按第 7 步口径另行记录。
- **关键词目录**：`node dist/cli.js catalog --check` 通过，重算写回后无差异；纯迁移时点计数为 18 张表／178 条数据行／17,727 字符（含换行），后续内容拆分批次另行记录同一口径，避免把迁移与拆分两类变化混为一个改进。
- **基线口径处置**：逐份核对两份已登记快照的真实消费者与用途——`2026-09-12T15-38-28-892Z-glm-low-default.json` 是正式质量基线的来源运行（消费者为根 AGENTS.md 质量基线表登记、`node dist/cli.js validate` 的「至少一条且全部登记」机械校验、report/compare 的快照入口），`2026-09-13T01-14-52-980Z-qwen-off-t0.json` 是 ADR-017 允许登记的跨 provider 对照基线；两者生成于 `references/` 目录、默认全文展开、尚未注入关键词目录时期，其迁移后同口径成绩对照不再适用。2026-09-16 用户在本轮验收中明确回复：「明确保留两份作为迁移前基线，本次授权其继续保留」。据此保留两份迁移前基线；保留依据为本次用户授权，非历史 exp 引用或机械校验要求。现有「至少一份基线」要求不变，只在根 AGENTS.md 说明列与段首标注「适用迁移前来源与检索范围」，快照内容与历史计数未改。
- **TDD 与验证**：先改/补测试并观察失败——benchmark-integrity 更新 corpusFileCount 并新增定位目录精确计数与「gold 的 raw 来源可定位、不进检索」关系断言，corpus-allowlist 新增定位目录 2 条（真实语料组成＝manifest+11 raw、真源缺失/越界/非 raw 即失败），首轮定向读到 5 失败／2 通过；实现后 benchmark-integrity、corpus-allowlist、hitrate 共 26 项通过。全套 `pnpm run test` 为 734 通过／0 失败（51 文件），持续多批的 2 条旧 gold 锚点失败全部转绿。`pnpm run typecheck`、`pnpm run build`、`check:reference-projection`（9 分片一致）、`check:prose-terms`、`catalog --check`、`validate`、`hitrate --check-gold`、`pnpm run bench:dry` 均通过；`node scripts/doc-check.mjs` 由 15 条 D1 减为 14 条（本计划勾选第 10 项），无 D2–D5 与结构类错误。
- **临时产物**：`bench-runs/2026-09-16T06-59-46-775Z-glm-low-default`（bench:dry 的 2 题假数据运行目录）已删除；hitrate 只输出终端、未落盘；未新增入库产物。
- **未闭合**：验收清单第 12 项列出的命令在本批均已通过，但按步骤归属保留未勾选（见「决策偏离」）；第 11、13、14 项分别属第 7 步散文试点与第 8 步端到端/真实模型观测，均未开始。docs/adr/ADR-020、ADR-010 正文仍写 `knowledge/references/` 旧路径，历史 ADR 正文按维护口径未回改，迁移事实由 ADR-021 承载；knowledge/base/机制-心情与工休.md 首部的既有 raw 来源标注同样保持原样。

### 2026-09-16 — 第 6 步验收记录

- **复验**：全套 pnpm run test 为 734 通过／0 失败（51 文件）；typecheck、build、reference-projection、prose-terms、catalog --check、validate、hitrate --check-gold、bench:dry 全部通过。hitrate 仍为 69 个 gold 键，其中 24 个被检索范围排除，分母未删减；未设答对或命中率门槛。doc-check 仅 14 条活动计划 D1。
- **修缮与清理**：纠正旧快照的目录注入历史，按本轮用户明确裁决登记保留范围；本轮 dry 产物 dev-temp/work/step6-acceptance 已经 tooling 清单预览和执行删除，清单同步移除。未新增探针、诊断框架或入库运行产物。

## 债务记录

### 2026-09-16 — PLK-1 关联载荷体积（已关闭）

- **原债务**：bench/src/tool-executor.ts 的 `readLinkedFactsOperation` 首版不设分页或截断，一次展开全部登记对象，体积可能超过 maxContextChars（记录见 docs/plan-prose-linked-knowledge-notes.md「债务记录」）。
- **关闭依据**：本批以 read 取代该入口，关联事实按完整对象分页（facts_offset/next_facts_offset），单对象放不下整页时显式报容量错误；`readLinkedFactsOperation` 与代码锚点 `TODO(tech-debt) PLK-1` 一并删除，不再存在无分页的关联展开路径。对应契约与用例见本笔记「第 4 步（分批之二）」。
- **关闭记录**：同步记入 docs/plan-prose-linked-knowledge-notes.md 债务记录（该计划为债务原属记录）。

### 2026-09-15 — 关键词目录文本压缩（IDX-1）
- **债务**：关键词目录约 1.75 万字符的重复说明文本压缩未纳入本计划；本计划只交付注入开关（默认关闭）并把压缩 stash 排除在外。代码锚点：bench/src/catalog.ts 顶部 `TODO(tech-debt) IDX-1`。
- **未来偿还**：成本或质量试验表明不划算时评估压缩呈现，须保持覆盖与入口如实；入口见 docs/inbox.md 对应条目。

## 意外发现

### 2026-09-15 — 「16 个超 6,000 字符小节」的归属经复算确认
- **发现**：用当前 `buildSectionDirectory` 复算，正文超 6,000 字符的小节共 16 个、最大 17,898 字符，全部位于 references（技能-\*×2×7 份＋技能等价组 1＋名册 1），与 plan 架构分析的表述一致；迁移后这些小节不再属于模型原文阅读目录，故 read 的容量测试不能沿用该分布。
- **影响**：无需更新 plan；实施时按迁移后的实际分布重测容量，不把旧盘点当作迁移后基线。

## 阻塞与解决

（暂无）
