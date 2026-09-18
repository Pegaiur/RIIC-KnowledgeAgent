# 渐进披露新默认配置的真实模型观测：GLM-5.3-Flash low / hybrid / 20 题（单轮）

> 创建日期：2026-09-16
> 状态：已结束
> 结束日期：2026-09-16
> 需求入口：docs/inbox.md

## 过程

### 目的与范围

执行 docs/archive/plan-progressive-disclosure.md 第 8 步要求的真实模型观测：在新默认配置（默认关闭全文扩展与关键词目录注入）下跑一轮 GLM-5.3-Flash / thinking low / hybrid / 20 题。本轮只登记实际工具与 schema 版本、检索与送达范围、token 与费用、工具分布、非法 ID、空结果、额度耗尽及内容级新增/复读等观测事实；单轮不主张因果或质量提升，不设质量达标线，不针对当前题集追分，不登记 bench/results 快照，不修改质量基线表。

### 运行前登记：输入与配置

- 起点：分支 feature/index-and-tags，HEAD `753222b`；运行元信息 `source.gitHead=753222bc92a4d4590a0a943ffaa6fd876e41e429`、`gitDirty=true`（唯一未跟踪文件为本记录的运行前登记版本，运行时代码与提交一致）。
- 题集：bench/questions.json（20 题，F01–F10 / S01–S08 / G01–G02）；未增删、未改问法。
- 语料与检索范围：knowledge/ 中 manifest 登记的 base/guides，`chunks=121`；`retrievalScope=base-guides`；raw 不进检索白名单。
- 生效配置（meta 实测捕获）：provider glm（glm-5.3-flash）｜thinking low｜temperature null（服务端默认）｜retriever hybrid｜topK 5｜maxContextChars 12000｜expandFulltext false｜injectKeywordCatalog false｜attachFacts true｜toolBudget 5｜toolAttemptLimit 10｜factsQueryListLimit 3｜sessionTimeoutMs 300000｜maxTokens 4096｜tokenizer bigram｜entityBoost 0。
- 协议版本：toolSchemaVersion 15（工具面 rag_search、facts_search、read）｜agentInstructionsSha256 `df6a358b3f3eb0a155fd9746c5a23395b7e56d0fd58024d5a079d917e18ee46f`｜toolSchemaSha256 `c0af142589a6363207d193120e724fa49ff49be73175e08580560bce7e8b048a`。
- 密钥：仓库根 secret.yaml 的 zai-api-key（不入库、不回显）；本轮为真实付费请求。
- 产物落位：运行目录 `bench-runs/2026-09-16T13-56-21-467Z-glm-low-default/`（records.jsonl、meta.json、trace.jsonl、inputs.json、injected.json、answers.md，不入库）；未导出共享快照、未登记 bench/results。

### 费用预算与停止边界

- 授权：用户于 2026-09-16 明确授权执行一轮 20 题，未设金额上限；历史同类单轮参考区间为 ¥0.16–0.27（用户提供的量级参考），bench-runs 内 GLM 20 题单轮实测更宽（约 ¥0.11–0.27），二者仅作量级参考，不作门槛或达标线。
- 停止边界：只跑一次完整 20 题；个别失败、空结果或额度耗尽按真实状态记录，不自动重跑、不压缩题集、不追加轮次追分。
- 不做的事：不用 dry 冒充真实观测；不因答错修改提示词、检索、工具策略或预算；不为通过题集添加特判。

### 执行步骤

1. `pnpm run build`。
2. `node dist/cli.js run --provider glm`（默认 thinking low / hybrid / 20 题）。
3. `node dist/cli.js report <runDir>` 输出费用、工具分布与送达台账。
4. 一次性只读统计脚本（dev-temp/work/pd-real-run/observe.mjs）按题汇总工具序列、正文范围、事实分页与送达对象。

实际执行：单轮 20 题一次跑完，无中断、无重试、无参数偏离。

## 结果

### 1. 运行标识与完成度

- 运行目录：`bench-runs/2026-09-16T13-56-21-467Z-glm-low-default/`；meta：schemaVersion 2、traceSchemaVersion 3、inputsSchemaVersion 1。
- 20/20 题均以 answer 终止（`terminationReasons.answer=20`）；`failed=0`；`elapsedMs=512969`（约 8.5 分钟）；`feedbackUsed=0`（未出现未调用工具的空答回馈）。

### 2. 计量与费用

- LLM 调用 55＝HTTP 尝试 55，重试 0，截断调用 0；records 55 条。
- 输入 tokens 263,454｜输出 tokens 12,402（其中思考 1,110）；`costComplete=true`、用量不完整调用 0、完全无用量调用 0。
- 费用 ¥0.1827（输入 ¥0.1479 + 输出 ¥0.0347），落在历史同类单轮参考区间内；单价按 meta.prices（输入 ¥0.8/M、输出 ¥2.8/M、缓存命中 ¥0.23/M），本轮缓存命中 110,208 tokens 按缓存档计价。
- 逐题输出 384–1,159 tokens（均值 620.1；P95 1,159 为 report 的既有口径，20 题样本下等于该题集最大值），单题总费用 ¥0.0044–0.0280。

### 3. 工具分布与额度

- 工具批次 35；提出 35＝准入 35＝执行 35；拒绝（预算/同批超量）0；工具错误 0；获准尝试 35＝证据送达 35；有命中（旧 chunk 口径，不含 facts-only 送达）27；命中未知 0。
- 调用分布：rag_search 20、read 13、facts_search 2。

| 题目 | 轮数 | 工具序列 | 题目 | 轮数 | 工具序列 |
|---|---|---|---|---|---|
| F01 | 2 | rag_search | S01 | 4 | rag_search→read→read |
| F02 | 2 | rag_search | S02 | 2 | facts_search |
| F03 | 4 | rag_search→read→read | S03 | 2 | rag_search |
| F04 | 2 | rag_search | S04 | 3 | rag_search→read |
| F05 | 2 | rag_search | S05 | 2 | rag_search |
| F06 | 5 | rag_search→read→read→read | S06 | 2 | rag_search |
| F07 | 5 | rag_search→read→read→rag_search | S07 | 3 | rag_search→read |
| F08 | 3 | rag_search→read | S08 | 3 | rag_search→facts_search |
| F09 | 2 | rag_search | G01 | 3 | rag_search→read |
| F10 | 2 | rag_search | G02 | 2 | rag_search |

- 额度：每题成功额度 5，最低剩余 1（F06、F07）；无题耗尽额度，获准尝试上限 10 未触及（单题最多 4 次工具调用）。
- 工具面使用分布：19/20 题调用过 rag_search（S02 只调用 facts_search 后作答）；read 落在 8 题（F03、F06、F07、F08、S01、S04、S07、G01），其中 S01 两次使用文档范围入口 doc:<file>；独立 facts_search 仅 S02、S08 各 1 次。

### 4. RAG 与 read 送达

- RAG：20 次调用；`fragmentRanges` 合计 151 段＝命中块（kind=hit）100 + 父级引导（kind=parent_lead）51，与 report 的「命中片段 151」同口径；`expandedRanges=0`（默认不扩展整篇）；关联事实入口提示 79 条，全部实际写入 data；query 附带 facts 触发 6 次调用（`internalFactsQueries=6`、`attachedCalls=6`、`omittedTerms=0`），附带送达卡 32 次。
- read：13 次调用，成功 13、空 0、错误 0；`bodyChars=10277`；送达记录卡 58、送达概念 7。
- 正文分页：13 次调用均为 `body_complete`，无 `next_offset` 非空；与「单页上限 6000 > 当前 base/guides 各小节正文长度」的既有观测一致。
- 事实分页：11 次调用一次读完（`next_facts_offset=null`）；S01 两次读到未完成页——`doc:guides/贸易站组合.md` total 32／returned 26／next 26，`doc:guides/制造站组合.md` total 45／returned 24／next 24——模型未按 `next_facts_offset` 续读即作答，两页对象无重复。
- 逐次 read 台账（sectionId｜正文行范围｜事实页 offset/next/total/returned｜送达对象数）：

| 题目 | sectionId | 正文行范围 | 事实分页 | 送达对象 |
|---|---|---|---|---|
| F03 | sec-ca6b845c27299935 | 7-15 | 0/null/0/0 | 0 |
| F03 | sec-0781b2e9b0a7de73 | 47-53 | 0/null/0/0 | 0 |
| F06 | sec-9ae7e1154bf1bd61 | 36-42 | 0/null/3/3 | 3 卡 |
| F06 | sec-4fd5eaa46e2f1188 | 28-32 | 0/null/0/0 | 0 |
| F06 | sec-ef1c6950f1eb5af1 | 62-64 | 0/null/0/0 | 0 |
| F07 | sec-e74ba996e0557f8c | 3-33 | 0/null/0/0 | 0 |
| F07 | sec-301db5f4a00ad71a | 5-24 | 0/null/0/0 | 0 |
| F08 | sec-e74ba996e0557f8c | 3-33 | 0/null/0/0 | 0 |
| S01 | doc:guides/贸易站组合.md | 1-72 | 0/26/32/26 | 26（22 卡+4 概念） |
| S01 | doc:guides/制造站组合.md | 1-90 | 0/24/45/24 | 24（22 卡+2 概念） |
| S04 | sec-b865b92534872f78 | 15-18 | 0/null/6/6 | 6 卡 |
| S07 | sec-6dc10e6a34546772 | 45-48 | 0/null/6/6 | 6（5 卡+1 概念） |
| G01 | sec-6999c9825204c69c | 14-24 | 0/null/0/0 | 0 |

（表中对象数为对应 readDelivery.deliveredObjects 长度；S01 的两次读取使用文档范围入口 doc:<file>，13 次 read 中题内未出现重复读取同一小节。）

### 5. 内容级新增与复读

- 同题内已送达正文（RAG 连续片段 + read 原文范围）按 doc 偏移半开区间合并：累加 48,556 字符，题内合并后 28,845 字符，重复 19,711 字符（40.6%）；该合并**不区分文件**，不同文件的相同偏移会被视为重叠，故 40.6% 含跨文件同偏移的伪重复。同一方法改为题内按文件分组合并，则去重后 42,438 字符、重复 6,118 字符（12.6%），更接近同文件内的真实重复；两口径并列，不合并为一个指标。
- 主要来源是同一正文先由 rag_search 命中块送达、再被 read 重复读入：F07 7,111→1,249（重复 5,862）、S01 5,168→2,603（2,565）、F08 3,679→1,249（2,430）、F01 2,315→1,237（1,078）、F04 2,140→1,244（896）。
- 事实对象计数分属两条通道：read 送达记录卡 58（S01 44 + S04 6 + S07 5 + F06 3）、概念 7 全部来自 read；另有 RAG query 附带送达卡 32 次，与 read 通道分别计次，不合并为同一批对象；13 次 read 的 sectionId 去重为 12 个：题内未重复读取同一小节，跨题有 1 处同小节（F07 与 F08 均读取 sec-e74ba996e0557f8c）。

### 6. 非法 ID、空结果与错误

- read 空 0、read 错误 0、非法参数 0；无未知 section_id 提示，未出现 `unknown_operation`（旧工具名）或 `invalid_params`。
- 工具拒绝 0、工具错误 0、命中未知 0；20 题全部产出 answer，无失败、无会话超时。
- 产物密钥扫描（meta/records/trace/inputs/injected/answers）：未命中密钥样式串。

### 7. 未做的核查

- 必答口径：本轮未按 docs/spec/rag-answer-baseline.md 做逐题答案核查，故不给必答满足/遗漏计数，也不做质量判断；单轮结果不主张质量提升或退化。
- 对照：本轮不与其他配置或已登记基线做同口径横比（两份已登记快照只适用迁移前来源与检索范围）。

## 结论

- **支持**：新默认配置下，20 题单轮真实运行可完整跑通，计量与台账路径自洽——55 次模型调用 0 截断、35 次工具调用提出＝准入＝执行且 0 拒绝 0 错误、13 次 read 全部成功并给出正文与事实两部分的完整台账、无非法 ID 与无命中未知、费用完整可算（¥0.1827）。read 在 8/20 题被使用，独立 facts_search 只在 2 题被使用；额度未耗尽。
- **不支持**：本轮不能支持质量、因果或改进结论。单轮无对照，未做逐题答案核查，也未验证送达证据是否被答案采用；不得将本轮费用或工具分布与迁移前口径或其它配置直接横比。
- **观察（非结论）**：正文内容级重复 19,711/48,556 字符（40.6%）主要来自 RAG 命中块与 read 原文的重复送达；S01 两次文档范围读取均在事实分页未完成（next 26、next 24）时即作答；12/20 题未使用 read，其正文来源仅为 rag_search。
- **局限**：单 provider、单配置、单轮，无对照与重复采样；未做质量核查；未经独立复核，本记录不构成最终结论，也未指定为任何基线；未修改 gold、spec、语料、质量基线表，未登记 bench/results 快照。
- **后续入口**：如需质量口径，按 docs/spec/rag-answer-baseline.md 另立核查任务；本记录作为 docs/archive/plan-progressive-disclosure.md 第 8 步真实观测的输入，已随验收清单第 13 项闭合。
- **清理**：运行目录保留在 `bench-runs/2026-09-16T13-56-21-467Z-glm-low-default/`（不入库）；一次性统计脚本与汇总 JSON（observe.mjs、summary.json，位于 dev-temp/work/pd-real-run/）已按 scripts/INDEX.md 用显式清单预览并删除，清理后不承诺重放统计中间产物。
