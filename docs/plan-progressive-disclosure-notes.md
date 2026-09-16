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

## 债务记录

### 2026-09-15 — 关键词目录文本压缩（IDX-1）
- **债务**：关键词目录约 1.75 万字符的重复说明文本压缩未纳入本计划；本计划只交付注入开关（默认关闭）并把压缩 stash 排除在外。代码锚点：bench/src/catalog.ts 顶部 `TODO(tech-debt) IDX-1`。
- **未来偿还**：成本或质量试验表明不划算时评估压缩呈现，须保持覆盖与入口如实；入口见 docs/inbox.md 对应条目。

## 意外发现

### 2026-09-15 — 「16 个超 6,000 字符小节」的归属经复算确认
- **发现**：用当前 `buildSectionDirectory` 复算，正文超 6,000 字符的小节共 16 个、最大 17,898 字符，全部位于 references（技能-\*×2×7 份＋技能等价组 1＋名册 1），与 plan 架构分析的表述一致；迁移后这些小节不再属于模型原文阅读目录，故 read 的容量测试不能沿用该分布。
- **影响**：无需更新 plan；实施时按迁移后的实际分布重测容量，不把旧盘点当作迁移后基线。

## 阻塞与解决

（暂无）
