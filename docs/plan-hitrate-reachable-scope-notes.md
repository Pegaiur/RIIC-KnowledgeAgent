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
