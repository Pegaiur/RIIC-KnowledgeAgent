# 正式 facts 输入迁出与 raw 临时材料清理计划

> 创建日期：2026-09-18
> 状态：已完成
> 需求入口：docs/inbox.md「raw 临时定位与语料添加工作流」
> 实施边界：2026-09-18 用户选择先完善规范与迁移计划；迁移与清理已于 2026-09-19 执行，结果与偏离见 docs/plan-facts-storage-and-raw-cleanup-notes.md。
> 前置决策：ADR-024；添加工作流见 skills/corpus-addition/SKILL.md。

## 目标

将正式 facts 输入从 knowledge/raw 迁至 knowledge/facts，接通现有消费者并清理已结束用途的来源稿，使 raw 只保留进行中语料批次的必要临时材料。

## 非目标

- 不重建解包数据派生管道、不改变当前事实格式、值、解锁与替换关系；来源映射评估继续由 docs/plan-knowledge-correctness.md 承载，路径迁移不代替该评估。
- 不迁移 base/guides 存量目录、不新增语料主题；正文只移除失效的临时稿回指并保留持久来源信息。
- 不改变 facts 查询行为、RAG 检索范围或历史结果；不增加散文正确性的机械断言。命中评分分母的口径调整由独立授权的 docs/plan-hitrate-reachable-scope.md 承担，不属于本计划范围。
- 不为 raw 增加永久豁免、镜像副本、哈希台账或新的清理框架。

## 架构分析

当前 raw 有 19 份 Markdown 文档，其中 11 份由 bench/src/facts/references.ts、equivalence.ts 显式读取，并由 corpus.ts 的 gold 定位路径消费。另 8 份为来源材料。facts 输入尚不能删除，也不能只移动文件而遗漏当前 gold 与维护脚本。

迁移映射为 knowledge/raw/<文件名> → knowledge/facts/<同名文件>。明确清单：名册.md、技能等价组.md、技能-办公室.md、技能-发电站.md、技能-会客室.md、技能-加工站.md、技能-控制中枢.md、技能-贸易站.md、技能-宿舍.md、技能-训练室.md、技能-制造站.md。仅这 11 份转为正式位置，来源稿不随迁移进入 facts。11 份已于 2026-09-19 迁出，加载器、维护脚本与 gold 定位同步完成。

| 来源材料 | 已知用途与实施处置 | 实际结果（2026-09-19） |
|---|---|---|
| raw/上游稿-加工站机制.md、上游稿-训练室机制.md、上游稿-减半.md、上游稿-罗德岛基建建设.md | 已用于设施试点；保留来源仓库、提交及原篇目，修正三篇正式正文的 raw 回指后删除 | 三篇正文来源行已移除 raw 留档回指并保留上游仓库、提交与篇目，4 份已删除 |
| raw/upstream/上游稿-怪猎中枢.md | 怪猎内容批次已交付；确认现有采用记录具备来源定位后删除 | 来源定位见 docs/plan-corpus-rebase-and-gaps-notes.md，已删除 |
| raw/心情消耗恢复与工休时间.md | 已用于既有心情与工休正文；核对尚未采用部分有无明确续作，已完成用途的部分清理 | 存在未完成用途（剩余工作时间面板口径【待核验】），暂留；偿还条件见实施笔记 |
| raw/基建工具人汇总表-202605-图片提取.md、raw/PRTS-后勤技能中间产物关系-20260909.md | 旧候选材料；实施时核对是否已确定续作批次。无则删除，有则只保留该批必需部分并记录续作和清理时点；仅有候选登记或笼统的未来待办不构成保留理由 | 均无已确定续作，经用户 2026-09-19 确认删除 |

来源稿清理不要求先把所有未采用内容导入。用户独有材料删除前，核对已保留的来源说明、必要实践结论与明确续作；不能用外部仓库可重取代替对这些材料的处置判断。

## 实施方案

### 1. 先覆盖正式输入与临时区边界

- **输入**：明确的 11 份迁移清单、现有 facts 加载与 corpus 白名单测试。
- **做法**：遵循 TDD，先调整能验证“只有 knowledge/facts 存在时正常加载”“raw 缺失或存在临时稿均不影响正式加载”“正式输入缺失不能回退 raw”“gold 接受声明的 facts 路径并拒绝 raw 临时稿”的用例，运行观察预期失败。沿用既有内容、关系与数量断言，不复制实现算法。
- **输出与验收**：迁移预期由现有测试承载，失败来自未迁移的实现；不创建需要原稿长期存在的测试依赖。

### 2. 迁移 11 份输入并接通消费者

- **输入**：上述失败用例与现有事实文件。
- **做法**：按清单移动文件，保留正文、文件名与格式。同步 facts/references.ts、equivalence.ts 的加载位置及输入清单，相关常量使用正式 facts 命名；同步 corpus.ts 的 gold 定位限制、benchmark-integrity.ts 与 cli.ts 的调用和描述。
- **维护脚本**：同步 knowledge/update-reference-projection、knowledge/external-corpus-scan 及 bench/facts-evidence-observation 的默认输入路径；脚本显式指定历史来源的能力保持原契约。更新直接读取真实文件的测试与必要注释，不把代码中的普通 raw 局部变量误当目录批量替换。
- **输出与验收**：仅正式位置被消费，原 raw 文件无副本或回退；RAG 与模型原文目录仍不包含 facts 或 raw。现有解析内容与关系断言保持通过。

### 3. 同步当前定位与文档

- **输入**：正式 facts 路径与受影响消费者。
- **做法**：同步 bench/gold.json、docs/spec/rag-answer-baseline.md 的事实证据路径及相应目录口径，按 spec 维护规则处理版本与入口。同步根 AGENTS.md、术语规则、scripts/INDEX.md 等实际路径说明；核查 curation 中的来源注释、关联引用与必要定位，不凭目录变化增删事实或检索内容。
- **输出与验收**：当前 gold 全部可解析，题号、判定含义、检索分母与正式事实内容不变；历史 bench/results、运行记录和 docs/archive 保持原貌。目录变更不据此调整模型结果或基线成绩。

### 4. 处理 8 份来源材料并清理

- **输入**：来源材料处置表、对应采用记录与当前依赖。
- **做法**：按表逐项确认，先将仅存在于临时稿中的必要来源定位或采用判断补到原 notes。设施正文移除 raw 回指，保留仓库、提交与来源篇目；这属于来源说明维护，不扩大为机制改写。已结束用途的原稿按明确文件范围删除；有确定续作的必要材料整理到 raw/<批次>/，在原记录标明续作与清理时点。
- **输出与验收**：已完成批次没有原稿残留，正式内容没有失效的 raw 依赖；每份暂留材料对应具体未完成工作。无需为清理创建永久原稿库、额外证明台账或新脚本。已跟踪材料按普通版本控制删除，dev-temp 产物仍按 scripts/INDEX.md 的显式清单流程处置。

### 5. 验证并收束过渡说明

- **做法**：运行现有 typecheck、全套 test、build 与 validate，补术语、公共练度投影、文档及差异检查；检查实际 facts 读取、gold 定位与受影响的关联送达。目录迁移不发真实模型请求。改动类型与最终合并门禁继续遵循根 AGENTS.md 与 scripts/gates.mjs。
- **输出与验收**：验证实际结果写对应实施笔记；更新本计划、根 AGENTS.md 及实际消费者中的旧位置与迁移状态说明，ADR-024 与索引同步为已实施。长期 skill/spec 不维护一次性迁移进度。未完成的语料主题保留在既有入口，不把迁移完成表述为知识正确性已获全面验证。

## 验收清单

- [x] 覆盖正式 facts 位置与 raw 排除边界的用例完成；旧 raw 路径断言在迁移中失败并逐项转绿（未先行构造红态，偏离见实施笔记）
- [x] 11 份正式输入迁至 knowledge/facts，加载器与维护脚本同步，无旧路径回退或重复副本
- [x] 当前 gold/spec 与受影响定位同步；事实内容与 RAG 范围不变，历史记录未改写（命中分母口径的独立调整见 docs/plan-hitrate-reachable-scope.md）
- [x] 8 份来源材料逐项处置：已结束用途的原稿删除，暂留部分有明确续作与清理时点；正式内容不依赖临时稿
- [x] 适用的类型、全套测试、构建、完整性、术语、投影、文档与差异检查完成并记录实际结果
- [x] 过渡说明收束，ADR 与入口状态同步，实施笔记记录迁移和清理结果

## 关联 ADR

- ADR-021 — 现有 facts 输入位置与出口；本计划只替换位置和临时材料职责。
- ADR-024 — 正式 facts 输入与 raw 临时材料分离。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->

## 实施纪要

# 实施笔记：正式 facts 输入迁出与 raw 临时材料清理

> 对应 plan：docs/plan-facts-storage-and-raw-cleanup.md
> 开始日期：2026-09-19

## 决策偏离

### 2026-09-19 — 迁移用例的红态未先行构造

- **背景**：plan 步骤 1 要求先补「正式位置加载」「raw 临时稿不被接受」的预期用例并观察迁移前失败。
- **选项**：
  - A: 严格先写失败用例，再迁移文件与实现；
  - B: 先迁移文件、再按实际失败逐项转绿。
- **决策**：实际为 B。git mv 11 份后同步加载器与脚本，运行用例时观察到 3 个测试文件与 2 个套件因旧 raw 路径失败，再逐项转绿；未先行构造迁移前的红态。
- **影响**：迁移用例的失败证据来自迁移过程中的旧路径断言，不是预先设计的红态；该偏离如实记录，后续批次应严格先红后绿。

### 2026-09-19 — 2 份旧候选材料的处置

- **背景**：plan 表要求核对「基建工具人汇总表-202605-图片提取.md」与「PRTS-后勤技能中间产物关系-20260909.md」是否已确定续作批次。
- **选项**：
  - A: 暂留，待 docs/draft-corpus-rejection-criteria.md 的逐项复核完成后定；
  - B: 按「无明确续作即删除」执行。
- **决策**：用户 2026-09-19 选择只保留心情消耗稿，两份删除。PRTS 摘录已采用的结论见 docs/plan-corpus-candidate-batches-notes.md 的批次二采用与验收记录；来源定位补录如下。图片提取稿未发现正式采用记录，按无明确续作清理。
- **PRTS 来源与采用范围**：PRTS Wiki《后勤技能中间产物一览》，页面 https://prts.wiki/w/后勤技能中间产物一览#tabber-无声共鸣；读取日期 2026-09-09，读取时页脚最后编辑时间为 2026-09-09 14:43。原摘录由页面六个主题区整理为关系表；批次二采用「3.1 提供者」中重岳「知我为我」自身心情额外消耗 +0.5/小时，以及「3.2 转化与输出」中余「与人乐」自身心情额外消耗 +1/小时，与对应设施技能事实共同核对后补入人间烟火相关正文。该记录只保留当时采用依据，不表示本次重新核验网页。
- **图片材料来源**：用户提供的《明日方舟基建工具人汇总表》，署名「@公孙长乐制表」，标注「2026年5月版」；本机图片于 2026-09-09 人工提取，未登记公开页面地址。
- **影响**：PRTS 可按页面地址定位来源；需要当时的完整摘录或图片转录文本时查阅 git 历史，不以网页当前内容代替当时版本。

## 实现调整

### 2026-09-19 — 常量命名与 gold 定位前缀

- **plan 原文**：迁移映射为 knowledge/raw/<文件名> → knowledge/facts/<同名文件>；加载器与维护脚本同步，相关常量使用正式 facts 命名。
- **实际做法**：新增 FACTS_SOURCE_DIRECTORY='facts'；RAW_MACHINE_SOURCE_DOC_IDS → FACTS_SOURCE_DOC_IDS；ROSTER_RAW_FILE → ROSTER_FACTS_FILE；EQUIVALENCE_RAW_FILE → EQUIVALENCE_FACTS_FILE；corpus.ts 的 gold 定位真源校验前缀由 raw/ 改为 facts/，并补「拒绝 raw 临时稿」用例。
- **原因**：plan 要求正式命名与单一维护位置。
- **后果**：bench/src（corpus、benchmark-integrity、cli、facts/references、facts/equivalence）、scripts/tasks（update-reference-projection、external-corpus-scan、facts-evidence-observation）、对应测试与 bench/gold.json 的 24 个键同步。

### 2026-09-19 — 工作区复核后的来源与边界补齐

- **实际做法**：从待删原稿的 git 版本补录 PRTS 页面、读取日期、当时页面时间和已采用段落，以及用户图片的作者、版本与提取日期；正式文件不恢复原稿副本。
- **测试覆盖**：bench/tests/references.test.ts 与 bench/tests/equivalence.test.ts 新增 5 项隔离目录用例，验证 raw 不存在时正常加载、raw 同名临时稿不影响结果，以及名册、技能分片、等价组缺失时即使 raw 有有效副本也失败。夹具分别只复制加载所需的 10 份与 1 份正式输入，用例结束后清理自身临时目录。
- **测试顺序**：这些用例补充已有正确加载行为的覆盖，首次运行即通过，加载实现未改动；不将本次结果记成初次迁移前的红态，前述流程偏离仍保留。

## 债务记录

### 2026-09-19 — 心情消耗恢复与工休时间.md 暂留

- **债务**：该来源稿仍有未完成用途——剩余工作时间面板口径【待核验】尚未落位。
- **未来偿还**：核验完成后评估是否补入 base/设施/机制-制造站.md 或 base/资源/基建物流链.md，随后删除原稿。原始登记见 docs/plan-corpus-candidate-batches-notes.md 的未决与遗留条目。

## 意外发现

### 2026-09-19 — 历史记录中的 raw 路径不影响门禁

- **发现**：docs/archive、docs/exp、bench/results 与各 plan-*-notes.md 中仍有 raw 路径；按文档生命周期规则冻结不改写。
- **影响**：doc-check 与测试均不校验历史文档中的 raw 路径；新消费者只读 facts/。

## 阻塞与解决

### 2026-09-19 — git mv 中文路径失败

- **症状**：`git mv knowledge/raw/名册.md knowledge/facts/名册.md` 报 `renaming 'knowledge/raw/名册.md' failed: No such file or directory`。
- **根因**：目标目录 knowledge/facts 尚不存在，git mv 不创建目标目录。
- **解决方案**：先用 New-Item 建目录，再执行 git mv。
- **预防**：迁移类操作先确认目标目录存在。

## 验证结果

- 初次实施验证：`pnpm run typecheck` 通过；`pnpm run test` 52 文件 811 用例通过。
- 2026-09-19 复核遗漏补齐后：`pnpm run typecheck`、全套 `pnpm run test`（52 文件 / 818 用例）、`pnpm run build`、`pnpm run check:prose-terms`、`pnpm run check:reference-projection`、`node scripts/doc-check.mjs` 与 `git diff HEAD --check` 均通过；构建后再次通过 validate、hitrate --check-gold 与 catalog --check。测试临时目录随用例清理，本轮未产生 dev-temp 产物；未变更原有暂存范围，未提交。
- `node dist/cli.js validate`：20 题／20 gold 题号／20 spec 题号／26 个白名单文档／212 个切块／37 个定位文档（833 个定位切块）通过。
- `node dist/cli.js hitrate --check-gold`：20 题 74 项 golden 全部可解析。
- 迁移前后事实内容、RAG 检索范围与题集不变；命中评分分母的口径变化由独立授权的 ADR-025 承担，不是本迁移的产物。
- 8 份来源材料处置结果：删除 7 份（4 份设施与减半上游稿、怪猎中枢上游稿、基建工具人汇总表、PRTS 后勤技能中间产物关系），暂留 1 份（心情消耗恢复与工休时间.md）；knowledge/raw 现仅存该暂留稿。

> ✅ 已完成于 2026-09-19
