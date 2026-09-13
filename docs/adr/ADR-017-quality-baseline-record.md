# ADR-017：正式质量基线记录移出 spec，由 AGENTS.md 承载并入门禁校验

- 日期：2026-09-12
- 状态：已实施

## 背景

此前做法（见已归档计划 plan-benchmark-snapshot-lifecycle）是「在对应 spec 用普通 Markdown 声明当前基线 run 路径及用途」，spec 第 15 行因此长期写着「当前正式质量基线：未指定」。这带来两个问题：

1. spec 是答案核查口径的长期复用资产，自身有版本（当前 v4）；把基线版本记录写进 spec，使口径版本与基线版本纠缠，spec 不再只管理自身版本。
2. 基线记录与 `bench/results/` 的实际内容之间没有机械校验，容易静默漂移。

## 决策

1. **记录位置**：正式质量基线由仓库根 `AGENTS.md` 的「质量基线」段承载，用普通 Markdown 表格登记 `bench/results/` 的结果（列：结果文件名 / SHA-256 / 简短说明），并人工标注至少一份为基线。表中除正式基线外，也可登记人工指定的对照基线（如跨 provider 对照样本）；登记即表示其具备非 exp 工程用途。`docs/spec/rag-answer-baseline.md` 只承载核查口径与自身版本，不再记录基线。
2. **校验范围（从简）**：机械校验只做单向登记检查——`bench/results/` 下每份 `*.json` 都必须在表中出现；表至少登记 1 条结果。不做 spec 版本一致性、verdict 字段、哈希比对、登记项反向存在性等检查。SHA-256 仅供人工核对变更，不参与校验。
3. **校验挂载**：由 `bench validate`（`bench/src/benchmark-integrity.ts`）承担，并以 `build` + `bench-validate` 两步纳入合并门禁 `scripts/gates.mjs` 的 `BASE_STEPS`；`PROFILE_VERSION` 由 1.2.0 升至 1.3.0。
4. **撤销既有「允许空快照集合」口径**：基线记录存在即要求 `bench/results/` 内结果全部登记，且至少 1 条，因此空集合不再是合法状态。

## 理由

- 基线是「哪份结果被人工指定」的版本事实，与核查口径职责不同；两者分离后 spec 只管自身版本，基线版本由 AGENTS.md 承载。
- 表格比机读 JSON 块更易人工维护，符合「当前基线手填或由代理填入」的使用方式。
- 校验只覆盖最容易出错的漂移点（结果目录新增但漏登记），成本低、无误判面；哈希与说明留人工判断。

## 备选方案

- 方案 A：spec 内嵌 JSON 机读块 + 版本/verdict/哈希全套校验 — 放弃原因：复杂度过高，spec 仍承担基线记录，且维护成本大于收益。
- 方案 B：新增独立 `bench/baseline.json` 注册表 — 放弃原因：新增文件类型与校验面；与「兜底放 AGENTS.md」的取向不符。
- 方案 C：不做机械校验，仅人工维护 — 放弃原因：`bench/results` 与记录的漂移无法被发现。

## 后果

- 合并门禁新增 `build` 与 `bench-validate` 两步，`verify merge` 变慢；`PROFILE_VERSION` 需随命令构成变化递增。
- 根 `AGENTS.md` 常驻上下文新增一段基线表；每次增删 `bench/results/` 结果或改基线时，须同步表格与 SHA-256，否则门禁失败。
- 本 ADR 局部替代既归档计划中「在 spec 声明当前基线」的做法；`docs/rules/document-lifecycle.md` 的「共享基准快照生命周期」段同步指向新落点。
- 结果快照的「严进宽出」与用途核对原则不变；登记表成为快照用途的机械可见处。

## 关联

- 前置计划：docs/archive/plan-benchmark-snapshot-lifecycle.md（其「在 spec 声明当前基线」条目由本 ADR 替代）
- 实施：bench/src/quality-baseline.ts、bench/src/benchmark-integrity.ts、scripts/gates.mjs
