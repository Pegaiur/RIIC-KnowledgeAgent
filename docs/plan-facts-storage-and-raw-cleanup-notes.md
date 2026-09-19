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
