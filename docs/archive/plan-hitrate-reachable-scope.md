# 命中主口径改为检索范围内可达键计划

> 创建日期：2026-09-19
> 状态：已完成

## 目标

按 ADR-025 把 hitrate 的 recall 分母限定为可达 golden 键数，nDCG 理想集合限定为可达相关块；precision 分母仍为实际填充槽位。三指标宏平均仅统计有可达键的题，同时保持不可达键逐题与汇总可见。

## 非目标

- 不修改 gold.json 内容、题号或题目事实要求（ADR-013：事实要求不因技能表退出而删减）。
- 不改变检索范围（继续 base/guides）、不把 raw 纳入检索，也不改排序与分词。
- 不删除或改写历史 hitrate 记录、exp 记录与归档计划；不为新口径登记基线或修改质量基线表。
- 不因新数值改善而宣称检索质量提升；引用处必须同时说明分母口径。
- 不处理 facts 输入迁移与 raw 清理，那两项由 docs/plan-facts-storage-and-raw-cleanup.md 承接。

## 架构分析

hitrate.ts 实施前按 ADR-021 决策 7 保留完整 recall 分母：golden 键在完整定位目录解析后，无论是否落在检索范围都计入 total，被排除者恒为未命中。20 题共 74 项 golden 标注中，24 项正式 facts 输入键恒不可达（按题累计，迁移前路径为 raw），宏平均 recall 上限被压到约 74.7%。分母与排除计数已分别由 total 与 excludedKeys/scope.excludedGoldenKeys 承载；本次调整 total 与 nDCG 理想集合，保留 precision 槽位分母，并明确排除项的可见性契约。

## 实施方案

### 1. 口径用例先行

- 输入：bench/tests/hitrate.test.ts 现有「范围口径」用例组。
- 做法：改写为新口径断言——可达键数成为 total，不可达键不参与 recall/nDCG 分母但仍以 excluded 逐题列出、scope 汇总计数；补充「一题全部 golden 键不可达时不计入宏平均并单独计数」与「真源不存在的键仍抛错」两条边界。
- 输出与验收：运行 `pnpm run test -- bench/tests/hitrate.test.ts`，观察预期失败来自未改动的实现。

### 2. 实现口径替换

- 输入：上一步失败用例。
- 做法：runHitrate 以可达键集合定义 total、nDCG 的 IDCG 与 precision 的相关集合；宏平均跳过无可达键的题并在 scope 记录其数量；同步 hitrate.ts 顶部口径注释、renderHitrate 表头与 cli.ts 的上下文行，保留排除计数输出。
- 输出与验收：上一步用例转绿；`pnpm run test` 全套通过，无其它用例因分母语义变化而静默失效。

### 3. 复测与留档

- 输入：迁移后语料与现有 gold。
- 做法：运行 `node dist/cli.js hitrate --topk 3,5,10`，记录新口径下的宏平均与排除计数，写入实施笔记，并显式标注与历史数值不可横比。
- 输出与验收：数值可复算（命令与配置列明），旧数值旁注明口径差异。

## 验收清单

- [x] 新口径用例先失败，再由实现转绿
- [x] 不可达键在新口径下仍逐题标注并计入 scope 汇总，未被静默丢弃
- [x] 全部 golden 键不可达的题不计入宏平均且单独计数
- [x] hitrate.ts 注释、渲染表头与 CLI 说明与新口径一致
- [x] `pnpm run test` 全通过
- [x] 复测数值落实施记录，并标注与历史口径不可横比

## 关联 ADR

- ADR-025 — 命中率主口径限定为检索范围内可达的 golden 键
- ADR-021 — 被替代的决策 7 出处
- ADR-013 — golden 事实要求不随检索范围删减

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->

## 实施纪要

# 实施笔记：命中主口径改为检索范围内可达键

> 对应 plan：docs/plan-hitrate-reachable-scope.md
> 开始日期：2026-09-19

## 决策偏离

无。用户 2026-09-19 明确选择替换主口径而非并列第二指标，理由与备选见 ADR-025。

## 实现调整

### 2026-09-19 — 不可达键的可见性细节

- **plan 原文**：runHitrate 以可达键集合定义 total、nDCG 的 IDCG 与 precision 的相关集合；宏平均跳过无可达键的题并在 scope 记录其数量。
- **实际做法**：不可达键继续进入逐题 misses 列表（标 excluded）并计入 scope.excludedGoldenKeys；新增 scope.questionsWithoutReachableKeys；precision 的槽位分母不变，其相关集合改用可达块。
- **原因**：plan 未写死「不可达键是否仍逐题列出」，按 ADR-025 决策 3 的可见性要求保留。
- **后果**：渲染表头「golden 数」改为「可达 golden 数」，范围计数行新增「无可达键题 N 题」；bench/tests/hitrate.test.ts 断言同步，benchmark-integrity.ts 与 cli.ts 的口径注释同步。

### 2026-09-19 — 工作区复核后的指标断言与说明补齐

- **测试覆盖**：bench/tests/hitrate.test.ts 补充「不可达块退出 nDCG 理想集合、precision 保留实际槽位分母」和「全部题目不可达」两项用例；整题不可达用例同时断言 recall、precision、nDCG 的宏平均均跳过该题。计算实现保持不变，补充断言首次运行通过。
- **输出说明**：报告文字先新增明确区分 recall 分母、precision 槽位分母与 nDCG 理想集合的断言，定向测试出现 1 项预期失败；随后同步报告、CLI 上下文与代码注释，22 项 hitrate 用例通过。未改检索排序或计量算法。
- **文档同步**：ADR-025 与 plan 明确三个指标各自的分母及相关集合，按当前 gold 的逐题累计口径登记 74 项标注、其中 24 项不可达；plan 状态同步为已实施。上述口径说明已回馈 plan，历史成绩保持原貌。

## 债务记录

无新增债务。

## 意外发现

### 2026-09-19 — nDCG 随口径上升，precision 不变

- **发现**：precision 未变（不可达块本就不会占 topK 槽位），但 nDCG 上升，因 IDCG 的理想相关集合改为可达块。@3/@5/@10 为 0.574→0.701、0.524→0.676、0.561→0.715。
- **影响**：与历史 nDCG 数值不可横比；已在渲染表头与 ADR-025 后果段注明。

## 验证结果

复测命令 `node dist/cli.js hitrate --topk 3,5,10`；参数 bigram／实体加权关／检索范围 base/guides／maxContextChars 12000。范围计数：定位目录 833 块｜检索范围 212 块｜排除 621 块｜被排除 gold 键 24 项｜无可达键题 0 题。

| topK | 新口径 recall | 新口径 precision | 新口径 nDCG | 旧口径 recall（同日实测） |
|---|---|---|---|---|
| 3 | 67.2% | 48.3% | 0.701 | 46.7% |
| 5 | 69.7% | 31.0% | 0.676 | 49.2% |
| 10 | 80.0% | 19.0% | 0.715 | 59.5% |

新旧口径不可横比：24 项 facts 正式输入键不再计入 recall 分母，其解析块不再计入 nDCG 理想集合；precision 的槽位分母不变，本次无整题不可达，因此 precision 宏平均也不变。检索排序未变，数值变化不构成检索质量提升。

初次实施的其余验证：`pnpm run typecheck` 通过；`pnpm run test` 52 文件 811 用例通过；`node dist/cli.js validate` 通过。

2026-09-19 复核遗漏补齐后：全套测试 52 文件 / 818 用例、类型检查、构建及文档检查通过；构建后重新执行上表复测命令，三项指标及范围计数均与上表一致。更新只涉及测试覆盖和说明文字，未改变数值计算；临时夹具由用例清理，未提交。

## 关联

- 口径决策：ADR-025；被替代的分母约定见 ADR-021 决策 7。
- 迁移实施与清理见 docs/plan-facts-storage-and-raw-cleanup-notes.md。

> ✅ 已完成于 2026-09-19
