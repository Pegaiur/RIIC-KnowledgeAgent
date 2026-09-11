# ADR-011：检索模式与工具集合收敛

- 日期：2026-09-10
- 状态：已实施
- 替代：局部替代 ADR-003（`hybrid` 工具组成与 `both` 组合语义）、ADR-006（工具清单中的 `grep_search` 行）、ADR-007（`facts` 模式只暴露 `facts_search`）、ADR-008（暴露 `read_section` 的模式范围）

## 背景

当前 `RetrieverId` 有五个取值：`bm25`、`grep`、`both`、`facts`、`hybrid`。默认 `bm25` 只暴露 `rag_search` + `read_section`，其中 `read_section` 的入参 `section_id` 必须取自检索结果的小节标识，未知 ID 返回空且不模糊回退，因此补证能力完全依赖首次召回。

实测（`node dist/cli.js hitrate --topk 3,5,10`，749 切块、bigram、`entityBoost=0`）recall@3 49.7%、recall@5 58.7%；用原题原文顺序查询时，多个必答真源位居 90–210 名（`类别.md#干员组（28 条）` 第 90 位、`技能-贸易站#巫恋` 第 155 位、`技能-控制中枢#薇薇安娜` 第 162 位）。归档试验记录的「必要证据未送达」7 项中有 6 项与此对应。`facts_search` 已能精确命中干员、技能、类别词条，但默认模式下不可用，缺少独立的第二条取证通路。

同时：`grep_search` 自设计即为 P3 受控对照实验组（字面命中计数，无 IDF 加权与长度归一），对照价值已由既有试验消耗完毕；`facts` 模式只暴露 `facts_search`，工具集是 `hybrid` 的真子集且无 RAG 侧；`both` 是 `rag_search` + `grep_search` + `read_section` 的组合，随 grep 一并失去意义。

## 决策

`RetrieverId` 收敛为 `bm25` 与 `hybrid` 两个取值，默认值改为 `hybrid`：

- `bm25`：`rag_search` + `read_section`，保留为纯 RAG 对照模式。
- `hybrid`：`rag_search` + `read_section` + `facts_search`，作为默认模式。

删除 `grep_search` 工具与 `grep`/`both`/`facts` 三个模式，删除 `bench/src/grep-retriever.ts`。`ToolId` 保留 `grep_search` 作为历史名，仅用于读取既有快照与报告的聚合计数，不再出现在任何下发工具数组中。工具集合与模式协议收敛，`TOOL_SCHEMA_VERSION` 由 8 升至 9。

运行配置入口仅接受 bm25/hybrid，旧模式与未知值报中文错误，不静默回落；CLI 区分未传 retriever（使用默认值）与选项缺值（报错）。历史记录的 retriever 字段继续只读识别，不套用当前运行配置白名单。

## 理由

默认模式应同时具备「机制与组合取证」与「精确词条取证」两条通路，`hybrid` 已是现成实现，无需新增协议；`read_section` 继续作为已召回小节的深读能力，与两条检索通路共享同一份小节目录，不改变既有阅读语义。

保留 `bm25` 而不是只留默认一种，是为了在后续对照中仍能以单变量方式回答「facts 通路带来了什么」，避免一次删除后无法回退比较。`facts` 模式的能力完全被 `hybrid` 覆盖，`both` 与 `grep` 随对照实现退场，继续保留只会增加模式矩阵、测试夹具与文档维护成本。

历史名保留为只读识别，使已归档试验的工具计数仍可复算，不因协议收敛而使旧证据不可读。

## 备选方案

- 只改默认值为 `hybrid`，保留五个模式 — 放弃原因：`facts` 与 `hybrid` 工具集重复、`both` 随 grep 失去意义，保留即长期维护成本。
- 新增 `rag-facts` 作为新 id，保留 `hybrid` 语义不变 — 放弃原因：`hybrid` 的既有语义本就是「BM25 RAG + facts 混合工具」，新增 id 会造成两个同义模式，并需为旧快照的 `retriever=hybrid` 增加兼容读取。
- 只保留默认一种模式，`RetrieverId` 收缩为单值 — 放弃原因：同时废弃 `bm25` 这一已生效对照模式，替代范围超出本次必要程度，也失去单变量对照能力。
- 给 `read_section` 增加模糊回退或名单型入口 — 放弃原因：改变工具语义与协议，属另一项决策，不在本次收敛范围内。

## 后果

- 默认模式的每题 token 用量、费用与工具调用结构都会变化（新增 facts 惰性加载与卡片注入），与既有 `bm25` 单轮结果不再可比；需要对照时必须显式指定 `--retriever bm25`。
- `TOOL_SCHEMA_VERSION` 递增不保证工具指纹变化：既有指纹只计算实际下发的工具数组，保留模式的数组不变时指纹也可以不变。历史快照仍可读；比较须结合模式、协议版本与预算配置，不仅按指纹分组。
- `read_section` 的暴露范围由「`bm25`/`hybrid`/`both`」变为「`bm25`/`hybrid`」，`runner` 的小节目录构建条件随之简化。
- `facts` 模式退场后，`package.json` 的 `bench:dry` 与 CLI help/示例中的相关取值必须同步更新，否则脚本失效。
- 本次只改模式集合与工具清单，不改检索算法、语料与判定口径，因此不产生新的质量结论，也不指定正式基线。

## 关联

- 规划文档：docs/plan-hybrid-default-tool-budget.md。
- 替代范围：ADR-003、ADR-006、ADR-007、ADR-008 中与模式取值、工具清单（含 `hybrid` 工具组成）和 `read_section` 暴露范围相关的部分。
