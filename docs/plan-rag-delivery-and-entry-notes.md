# 实施笔记：RAG 送达范围与入口优化计划

> 对应 plan：docs/plan-rag-delivery-and-entry.md
> 开始日期：2026-09-11

## 决策偏离

### 2026-09-11 — 需求复核与工程/试验验收分开

- **背景**：用户将草案转为计划后要求检查、修正和细化需求；当前尚未开始运行时实现。
- **决策**：保留 plan 作为工程入口，首版按小节命中文件扩展；施工前收口容量与 ADR。实体标记和付费对照保留承接设计，实际运行另行 exp，工程验收不要求先跑出试验结果。
- **影响**：已回馈 plan 的目标、步骤顺序、步骤 0/4/5/6 与验收清单；不启动代码改造或付费调用。旧实体标记设计未执行，按已取消迁入 docs/exp/exp-entity-marking-probe.md，保留历史设计与收束说明。

### 2026-09-11 — facts 附带开关采用三态（undefined = 随模式默认）
- **背景**：plan 要求「显式在 bm25 请求附带应报中文参数错误」，同时 bm25 默认不得附带。
- **选项**：
  - A: `attachFacts: boolean` 必填，bm25 默认写 false；CLI 需同时改两处，所有构造配置处都要补字段。
  - B: `attachFacts?: boolean` 三态，undefined 表示随模式默认（hybrid 开、bm25 关），仅显式 true 在 bm25 报错。
- **决策**：B。新增 `effectiveAttachFacts()` 统一解析有效值；默认组合与对照组合共用同一配置装配。
- **影响**：inputs/meta 记录有效值（布尔）而非三态；历史缺字段表示不可用。

## 实现调整

### 2026-09-11 — 步骤 0：契约与三开关配置落地
- **plan 原文**：为步骤 6 提供可读、相互独立的「是否含技能表 / 是否扩展原文 / 是否附带 facts」开关，由统一配置装配供 runner/CLI 使用并写入 inputs/meta。
- **实际做法**：ExperimentConfig/BenchConfig 增加 includeSkillTables（默认 false）、expandFulltext（默认 true）、attachFacts（可选三态）；inputs.config 与 meta.json 写入有效值；快照 META_ALLOWED_KEYS 放行三个键。步骤 0 只登记配置，不改变检索行为，范围/扩展/附带分别在步骤 1/2/3 接入。
- **原因**：步骤 0 定位为施工前契约收口；行为接线按步骤顺序推进，保持每次提交可回归。
- **后果**：步骤 1/2/3 各自消费对应开关；`inputsSchemaVersion` 与 meta `schemaVersion` 维持现值（字段为向后兼容追加，旧运行缺字段表示不可用）。

## 债务记录

本轮未新增或修改代码技术债；施工前待决事项直接列于 plan 步骤 0。

## 意外发现

### 2026-09-11 — 证据归因与协议引用校正

- **发现**：S08 原始 facts 返回完整阵营名单，支持 plan 的 13/7 归因并修正旧 exp 的 14/6 引用；六个单小节目标中五个所属文件已命中，F08.3 需按复合要求单列。词条检测也不能把 S07 阵营查询说成不触发。
- **影响**：已回馈 plan 的证据表与归因说明；未重评整轮答案、未回改已结束 exp 正文。旧 query_operators 路由及笼统 schema v5 表述改为当前工具定义 v9、facts 结果 v5，已验证表述更正为待验证。

### 2026-09-11 — 快照键白名单会静默丢弃新 meta 字段
- **发现**：bench/src/snapshot.ts 的 sanitizeMeta 只保留 META_ALLOWED_KEYS 内的键；未登记的 meta 新字段在导出共享快照时被静默丢弃。
- **影响**：新增 meta 字段必须同步登记白名单，否则对照快照缺配置且无报错；步骤 0 已一并登记 includeSkillTables/expandFulltext/attachFacts。

## 阻塞与解决

ADR-013 已登记，契约收口完成；容量沿用总上限 12,000，RAG 预留与 facts 附带额度按 ADR 要求待最终 renderer 离线复算后定稿。步骤 1–3 的运行时行为接线尚未开始。原始轨迹仅只读核对，本轮未新增临时产物。

### 2026-09-11 — 本轮验证

- 离线使用当前 corpus/retriever/sections/facts store 实现复算六个目标小节排名、词条命中卡与序列化长度；结果见 plan，未调用模型，未生成一次性文件。
- git diff --check 通过；新增文档另检查空白、冲突标记与末尾换行。
- doc-check 当前只报告本计划尚未完成的工程验收项（D1），其余检查无错误或警告；未运行 typecheck/test，文档修订不冒充代码验证。
- 本轮仅勾选已完成的设计承接、登记范围判定及评测影响评估三项，其他实现与验证条目继续未勾选。

### 2026-09-11 — 步骤 0 验证

- `pnpm run typecheck` 通过；`pnpm run test` 全量 439 项通过（含新增 ADR-013 三开关配置用例）。
- `node scripts/doc-check.mjs` 仅剩本计划未完成验收项的 D1，ADR D2/D5 无错误；D1 属合并门禁、施工期预期。
- 本轮勾选「跨模块契约 ADR 登记」一项（ADR-013）；行为接线与其余验收项继续未勾选。
