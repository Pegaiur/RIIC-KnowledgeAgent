# 零费用端到端契约观测：RAG 命中 → read 原文与关联分页 → 记录/报告/快照（GLM 默认配置 + 隔离替身）

> 创建日期：2026-09-16
> 状态：已结束
> 结束日期：2026-09-16
> 需求入口：docs/inbox.md

## 过程

### 目的与范围

实现 docs/archive/plan-progressive-disclosure.md 第 8 步要求的零费用端到端契约观测：在真实装配路径上跑通「RAG 命中 → 复制 read → 原文与关联分页 → 记录/报告/快照」，provider 用隔离替身，不使用真实密钥或网络。本轮不改任何运行时代码、语料、gold、spec 或配置默认值，只新增一次性观测脚本；不评估回答质量、不设达标线。

### 运行环境与配置

- 分支 feature/index-and-tags，基点 `18c68e0`（工作区干净，`sourceAtStart.gitDirty=false`），`pnpm run build` 后由 dist 产物驱动。
- 生效配置即 EXPERIMENT 默认值（inputs.config 实测捕获）：provider glm（GLM-5.3-Flash）｜thinking low｜retriever hybrid｜topK 5｜maxContextChars 12000｜expandFulltext false｜injectKeywordCatalog false｜attachFacts true（随 hybrid 默认）｜toolBudget 5｜toolAttemptLimit 10｜factsQueryListLimit 3｜sessionTimeoutMs 300000｜tokenizer bigram｜entityBoost 0｜retrievalScope base-guides｜FACTS_RESULT_VERSION 8｜TOOL_SCHEMA_VERSION 15（工具面 rag_search、facts_search、read）。
- 与真实运行唯一的差别是模型决策来源：全局 fetch 被替换为脚本化替身，按 OpenAI 兼容响应推进；`config.apiKey` 置为占位值 `stub-isolated-no-network`，全程无真实网络请求。

### 替身决策规则与样本

- 替身规则（确定性，非质量断言）：首轮 `rag_search(问题)`；随后从检索结果里选「关联对象数最多」的关联事实入口读取（`read(section_id, offset 0, facts_offset 0)`）；若返回的【分页】显示本页未完成，用 next_offset／next_facts_offset 续读；本范围读完则改读【导航】给出的父级范围入口；最多 5 次工具调用（真实默认成功额度 5）后作答。
- 合成问题两个，均不在 bench/questions.json 中，也不参与第 7 步散文试点的质量断言：E2E-SYN-1（后勤技能结算的容量／差值／他人效率与招商引资、摊贩经济、配合意识）；E2E-SYN-2（制造站与贸易站的组合构成、收益与适用条件）。第二题面向该轮检索返回的关联入口中对象数最多的范围，用于触发关联事实的多页续读。

### 执行步骤

1. `node dev-temp/work/e2e-contract/observe.mjs`（一次性脚本）→ 运行目录 `dev-temp/work/e2e-contract/runs/2026-09-16T13-23-33-742Z-glm-low-default/`。
2. `node dist/cli.js report <runDir>`（运行目录消费者）。
3. `node dist/cli.js export <runDir> --out <临时路径>/snapshot.json --topic e2e-contract`（快照消费者；输出到临时区，不落 bench/results、不登记基线）。
4. `node dist/cli.js report <snapshot.json>`（快照重算路径）。

## 结果

### 1. 链路推进（2 题 / 9 次模型步骤 / 7 次工具调用）

| 题目 | 轮数 | 工具序列 | 结果 |
|---|---|---|---|
| E2E-SYN-1 | 4 | rag_search → read(sec-9ae7e1154bf1bd61) → read(sec-1e9066aaf4887dfb) | completed，终止 answer，工具错误 0，拒绝 0 |
| E2E-SYN-2 | 5 | rag_search → read(sec-5516bc51586569bd) → read(sec-92aca86b21897286) → read(sec-92aca86b21897286, facts_offset 26) | completed，终止 answer，工具错误 0，拒绝 0 |

工具调用全部来自检索结果给出的入口 ID（未出现非法 ID、未出现重复查询）；一次关联事实续读按返回的【分页】`next_facts_offset` 构造，两处父级范围读取按【导航】给出的父级入口构造，均未自行猜测偏移。

### 2. RAG 送达与 read 逐次范围

- RAG：2 次 `rag_search`，`fragmentRanges` 合计 15 段，每段含文件、sectionId、doc 坐标与行范围；该聚合同时计入命中块（kind=hit）与父级引导（kind=parent_lead），2 次调用各至多 5 个命中块，逐段构成因运行台账已清理不可回查；`expandedRanges` 为 0（默认不扩展整篇）；`linkedHints` 11（关联事实入口行只作导航）。
- read 逐次（trace 单条 readDelivery）：

| 次序 | sectionId | 正文范围（complete） | 关联事实分页 | 送达对象 |
|---|---|---|---|---|
| SYN-1 第 1 次 | sec-9ae7e1154bf1bd61 | base/机制-后勤技能结算.md L36-42（true） | offset 0／total 3／returned 3（complete） | 琳琅诗怀雅、孑、槐琥 |
| SYN-1 第 2 次 | sec-1e9066aaf4887dfb | 同文件 L3-70（true） | offset 0／total 5／returned 5（complete） | 上述 3 张 + 巫恋、令 |
| SYN-2 第 1 次 | sec-5516bc51586569bd | guides/贸易站组合.md L13-54（true） | offset 0／total 29／returned 29（complete） | 24 张卡 + 5 个概念 |
| SYN-2 第 2 次 | sec-92aca86b21897286 | 同文件 L3-72（true） | offset 0／**total 32／returned 26（未完成，nextOffset 26）** | 22 张卡 + 4 个概念 |
| SYN-2 第 3 次 | sec-92aca86b21897286 | bodyRange 为 null（正文已读完不重复送达） | offset 26／returned 6／nextOffset null（complete） | 夕、桑葚、人间烟火、德克萨斯、拉普兰德、深巡 |

- 合并去重与来源保留：SYN-1 第 2 次读到该文件 2 条登记共 6 个对象，投影为 5 张卡（槐琥 由两处登记合并为一张），`origins` 保留多来源（槐琥×2）；SYN-2 出现孑×2、鸿雪×2、能天使×2 的多来源合并。
- 事实分页续读的两页对象无重复（第 1 页末项为 令，第 2 页为 夕、桑葚、人间烟火、德克萨斯、拉普兰德、深巡），26+6 与 total 32 吻合。

### 3. 原文分页未在真实语料下触发（观测事实）

- 4 次有正文范围的 read（第 5 次正文已读完，`bodyRange` 为 null）的 `bodyRange.complete` 全为 true，未出现 `next_offset` 非空。
- 复算依据：以当前小节目录统计 base/guides 全部小节范围，正文最长为 3326 字符（guides/类别.md 的 H1），其余依次为 2910（guides/高效率散件.md）、2594（guides/制造站组合.md）、2478（base/机制-后勤技能结算.md），均小于单页上限 6000。迁移撤销 references 后，docs/archive/plan-progressive-disclosure.md 实施纪要「意外发现」中的 16 个超 6000 字符小节已不在模型阅读目录，故默认配置下原文多页只会在更长的范围出现，本轮真实语料不可达；该分支由既有工程测试覆盖，本记录不据测试替代观测。

### 4. 计量、台账与汇总

- 计量：9 轮模型步骤 → HTTP 尝试 9、重试 0、截断 0；工具批次 7、提出 7＝准入 7＝执行 7、拒绝 0、错误 0；每题成功额度用 3 与 4（上限 5），获准尝试与成功扣点一一对应。
- 台账分层一致：trace 的每次 read tool_call 保存单条 readDelivery（非 read 调用省略该字段）；records 按 callId 保存 5 条 readDelivery（对应 5 次 read 调用，另有 2 条 ragDelivery）；meta.readDeliveryStats 为 `{calls 5, successes 5, empty 0, errors 0, bodyChars 5736, deliveredCards 59, deliveredConcepts 10}`，与逐条累加一致（5 次调用的送达对象合计 69＝59 卡 + 10 概念，跨调用重复计次；原文字符同样含重复，read1 的正文范围被 read2 涵盖、read3 被 read4 涵盖）。
- 未观测项：`internalFactsQueries`、`attachedCalls`、`omittedTerms` 均为 0（替身未使用 `facts_search`，query 精确匹配亦未触发 RAG 附带），因此 facts_search 与 read 的混合路径不在本轮覆盖内。

### 5. 报告与快照

- `report <runDir>` 与 `report <snapshot.json>` 输出相同的送达行：`read 送达：调用 5｜成功 5｜空 0｜错误 0｜原文字符 5,736｜送达记录卡 59｜送达概念 10`；RAG 送达行（摘录，省略中间字段）：原文范围 0｜命中片段 15｜…｜关联入口 11。
- 快照（33,633 字节）保留有类型字段：records 内 `readDelivery` 5 条、`ragDelivery[].fragmentRanges` 15 条、`meta.toolSchemaVersion` 15、`retrievalScope` base-guides、`expandFulltext` false、`injectKeywordCatalog` false；全文检索未发现正文分区标记（【原文】／【关联事实】）与密钥样式串。
- 快照 meta 不含 `readDeliveryStats`／`ragDeliveryStats` 聚合字段，与既有基线快照一致：聚合由 report 从 records 重算，本轮两条路径数值相同即为其证据。
- 费用：报告账面成本 ¥0.0122 由替身返回的 usage 计算而来，属确定性假值；真实支出为 0，本轮不使用真实密钥、未发起任何真实请求。

## 结论

- **支持**：默认 GLM 配置下，「RAG 命中拿 ID → read 读原文与登记事实 → 按【分页】续读 → trace/records/meta 台账 → report 报告 → export 快照 → report 从快照重算」全链路在真实装配路径上闭环，且四处口径一致（逐条台账、meta 汇总、运行目录报告、快照重算报告）。关联事实的多页分页与续读经真实语料触发：未完成页给出 nextOffset，续读页不重复正文与已送对象，`origins` 保留多来源登记，跨登记重复对象按 canonical 合并。
- **不支持**：本轮不能支持任何质量或费用结论。替身不是模型，未产生真实 token 与真实费用，也未验证模型是否遵守单工具约束、是否理解指令或是否采用送达证据；账面费用只为管线计量路径的自洽性证据。
- **未覆盖**：原文多页（`next_offset`）在默认配置与当前语料下不可达，仅由工程测试覆盖；`facts_search`、RAG query 精确匹配附带 facts、容量错误与未知 ID 等分支未在本轮出现。
- **局限**：两个合成问题不在 20 题内，不作答质量断言；替身规则为观测用途，非模型行为样本；未经独立复核，本记录不构成最终结论，也未指定为任何基线；未修改 gold、spec、质量基线表，未登记 bench/results 快照。
- **后续入口**：真实模型观测按 docs/archive/plan-progressive-disclosure.md 第 8 步执行，须先登记输入与费用预算并取得费用授权；本轮结果可作其工程前置。
- **清理**：一次性脚本（observe.mjs、summarize.mjs、measure.mjs、snapshot-check.mjs）与对话记录（transcript.json）、运行目录与临时快照均曾位于 `dev-temp/work/e2e-contract/`，已按 scripts/INDEX.md 用显式清单预览后删除，现状核实该目录已不存在；`bench-runs/` 与 `bench/results/` 未新增产物，清理后不承诺完整重放。
