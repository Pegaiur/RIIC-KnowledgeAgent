# 命中主口径改为检索范围内可达键计划

> 创建日期：2026-09-19
> 状态：已实施，待发版归档

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
