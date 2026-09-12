# 查询提示词与工具集临时优化试验（1/1/1 隐藏 read_section）

> 创建日期：2026-09-12
> 状态：已结束
> 结束日期：2026-09-12
> 需求入口：docs/inbox.md

## 过程

### 目的与范围

验证两项临时优化在 1/1/1 配置（含技能表 / 扩展原文 / 附带 facts）下的机械与契约表现：

1. 工具集不暴露 `read_section`——新增独立开关 `exposeReadSection`，使同一 1/1/1 配置可对照「暴露 / 不暴露」两臂。
2. 临时修订查询 Agent 提示词（knowledge/AGENTS.md）：
   - `read_section` 相关引导改为「仅当本次运行暴露该工具时」生效；
   - 问题或需引用的证据中出现具名干员时，至少显式调用一次 `facts_search`；
   - 涉及数值、档位、条件或机制时必须给出原文具体值，禁止用模糊描述替代。

只观测与记录，不设达标线，不针对题集特判，不因答错触发修复。属用户明确授权的临时优化任务：提示词与 harness 改动均为试验性，试验后按回退条件还原。

### 授权与边界

- 不改 agent loop、ADR-012 的外部调用双上限与扣点规则、knowledge 事实真源。
- 不改 BM25 参数、分块、语料白名单与 facts store 数据。
- `TOOL_SCHEMA_VERSION` 不变（工具定义本身未变，仅下发子集随配置变化；差异由 meta `toolNames` 与 `toolSchemaSha256` 记录），不新增哈希字段。
- 本轮不付费；付费运行待单独授权。

### 配置与方法

- 新增开关：EXPERIMENT 新增 `exposeReadSection`（默认 `true`），CLI 新增 `--expose-read-section 0|1`；`bm25` 与 `hybrid` 均受该开关影响。1/1/1 + `expose-read-section 0` 即目标臂（工具集为 `rag_search`、`facts_search`）。
- 提示词承载：直接修改 `knowledge/AGENTS.md`（试验期生效），运行由 meta `agentInstructionsSha256` 冻结；试验后 git 还原。
- 机械验证：`pnpm run typecheck`、`pnpm run test`、`node scripts/doc-check.mjs`、`pnpm run bench:dry`（干跑不发请求）。
- 构造/契约验证：断言关闭开关时工具数组与系统提示工具名不含 `read_section`，执行器拒绝 `read_section` 调用；新开关写入 meta 与 inputs。

### 样本与执行步骤

- 已执行：harness 开关接线、提示词临时修订、单测补充、typecheck/test/doc-check/dry。
- 已执行（用户授权付费运行，GLM-5.3-Flash low，1/1/1 + `--expose-read-section 0`，`--thinking low`）：
  1. 冒烟 3 题（`--limit 3`，F01–F03）：bench-runs/2026-09-12T03-30-17-229Z-glm-low-default。
  2. 完整 20 题：bench-runs/2026-09-12T03-31-32-741Z-glm-low-default。
- 回答质量逐编号核查：已于 2026-09-12 补充执行，见结果段「回答覆盖核查与 1/1/1 基线比对」。
- 未做：「暴露 vs 不暴露」两臂对照——2026-09-12 用户裁决不补该对照臂；本轮只有不暴露臂，不作该开关的受控因果结论。

## 结果

### 实施变更（试验版；以下改动均已随回退撤销）

| 文件 | 变更 |
|---|---|
| bench/src/config.ts | 新增 `exposeReadSection`（ExperimentConfig / BenchConfig，EXPERIMENT 默认 true） |
| bench/src/cli-args.ts | 解析 `--expose-read-section`（0\|1；未传为 null） |
| bench/src/cli.ts | 接线开关；用法与运行摘要显示「暴露 read_section」 |
| bench/src/tool-executor.ts | `allowedOperations` / `toolsForRetriever` / `toolNamesForRetriever` / `toolSchemaMetadata` 接受 exposeReadSection；执行器按配置拒绝未开放工具 |
| bench/src/agent.ts | `buildSystemPrompt` 增参并透传；runQuery 的下发工具数组与 trace.offeredTools 按配置 |
| bench/src/runner.ts | 系统提示、schema 元数据、工具定义按配置；meta 新增 exposeReadSection |
| bench/src/inputs.ts | inputs.config 新增 exposeReadSection |
| bench/src/snapshot.ts | META_ALLOWED_KEYS 登记 exposeReadSection |
| knowledge/AGENTS.md | 临时修订三条（见下），试验后回退 |
| bench/tests | tool-executor 2 项、agent 1 项、cli-args 1 项；config / inputs / runner 断言各补 exposeReadSection |

提示词临时修订（knowledge/AGENTS.md）：

- 规则 3 新增：问题或需引用的证据中出现具名干员时，至少显式调用一次 `facts_search`（对其中至少一名具名干员）核对技能原文、数值与档位；不得以检索片段、内部附带卡或记忆替代显式核对。
- 规则 3 删除 `read_section` 相关条目（试验要求所有配置下提示词都不出现 `read_section`，与其专用入口一并移除）。
- 规则 4 删除「证据足够时直接作答」表述，避免与强制 facts 取证互斥。
- 规则 8 增补：涉及数值、档位、条件或机制时必须给出原文具体值，不得用「较高」「显著」「有加成」「大概」等模糊描述替代。

### 机械验证（2026-09-12）

- `pnpm run typecheck`：通过。
- `pnpm run test`：41 个文件 / 497 项通过（新增 4 项开关与提示断言）；纳入独立审查修复后 498 项通过；再按用户裁决实施「隐藏臂抑制」后 501 项通过。
- `node scripts/doc-check.mjs`：全部通过。
- dry（`--retriever hybrid --include-skill-tables 1 --expand-fulltext 1 --attach-facts 1 --expose-read-section 0 --dry --limit 2`）：meta `exposeReadSection=false`、`toolNames=["rag_search","facts_search"]`、`toolSchemaVersion=10`、`toolSchemaSha256=71b9dff2…`；inputs `systemPrompt` 含新规则两条，能力块为「可用工具：rag_search、facts_search」且不含 `read_section`，`toolSchema.names` 同步为两工具。
- `agentInstructionsSha256`：`f320b2d3…`（试验前）→ `07f40b55…`（首版）→ `7b82d52c…`（删除 read_section 条目与「证据足够时直接作答」后，实际用于冒烟与 20 题运行）。
- 实现决策：`TOOL_SCHEMA_VERSION` 保持 10——工具定义本身未变，仅下发子集随配置变化，差异由 `toolNames` 与 `toolSchemaSha256` 记录；不为该开关新增哈希字段。
- 隐藏臂送达抑制（用户裁决后实施）：`exposeReadSection=false` 时 `rag_search` 不再下发【小节上下文】/【小节导航】/【上级范围入口】，分页截断改用中性说明「（原文未完整送达…）」替代「续读：ID…｜next_offset…」；`fulltextRanges` 复核元数据保持不变，仅不下发模型可见文本。新增 3 项 fulltext 断言覆盖分页与整篇放得下两种情形。
- 上述 dry / 单测阶段未产生模型调用与费用；付费运行见下方「运行观测」。

### 运行观测（GLM-5.3-Flash low，1/1/1 + 不暴露 read_section）

两 run 的 meta 一致：`retriever=hybrid`、`includeSkillTables/expandFulltext/attachFacts=true`、`exposeReadSection=false`、`toolSchemaVersion=10`、`toolSchemaSha256=71b9dff2…`、`agentInstructionsSha256=7b82d52c…`、`toolNames=["rag_search","facts_search"]`；`inputs.systemPrompt` 不含 `read_section`，含具名干员强制取证规则，且无「证据足够时直接作答」。

| 运行 | 范围 | 完成/失败 | LLM 调用 | 截断/重试 | rag_search | facts_search | 费用 | run 目录（bench-runs/，gitignore） |
|---|---|---|---|---|---|---|---|---|
| 冒烟 | 3 题（F01–F03） | 3 / 0 | 6 | 0 / 0 | 4 | 0 | ¥0.0149（完整） | 2026-09-12T03-30-17-229Z-glm-low-default |
| 完整 | 20 题 | 20 / 0 | 50 | 0 / 0 | 25 | 17 | ¥0.1328（完整） | 2026-09-12T03-31-32-741Z-glm-low-default |

- 冒烟 3 题均为机制题且无具名干员，`facts_search` 0 次与规则触发条件一致，不构成异常。
- 完整 20 题：显式 `facts_search` 17 次、`rag_search` 25 次；RAG 内部 facts 查询 7 次、实际附带 7 次、送达卡 35 张；原文扩展范围 35 个；工具拒绝 0、工具错误 0。
- 以上仅为机械/计量观测；回答覆盖核查见下方「回答覆盖核查与 1/1/1 基线比对」小节，不据分数评价或触发修复。
- 对照臂（`exposeReadSection=true` 或原版 AGENTS.md）未运行，不做因果比较。

### 回答覆盖核查与 1/1/1 基线比对（2026-09-12 补充）

对完整 20 题 run（bench-runs/2026-09-12T03-31-32-741Z-glm-low-default）按 docs/spec/rag-answer-baseline.md（v4，72 个必答编号）做逐编号覆盖核查；判定口径与既有 1/1/1 审计一致（纯澄清/否定型条件未作相反断言即记 S），由子代理执行、主代理抽查关键编号（F02 / F05.3 / S04.3 / S05 / G02 / S08.4）。逐题明细落于 dev-temp/work/prompt-tool-temp-optimization/coverage-opt-1-1-1-2026-09-12T03-31-32-741Z.md（gitignore，按 scripts/INDEX.md 于收尾时清理）。

核查结果：S 65 / M 6 / C 1 / U 0；完整且有据 16/20。遗漏 M：F02.1、F02.2、F05.3、G02.1、G02.2、G02.3；冲突 C：S08.4（原答称「维娜·维多利亚自身是格拉斯哥帮干员，会提升摩根与戴菲恩计数」，与 references/类别.md 格拉斯哥帮 4 人名单、references/名册.md 维娜阵营字段为空冲突）。除 S08.4 外，其余缺口均可归因于「证据未送达」。该结果口径为单轮子代理核查、主代理部分抽查，未经独立人工复核。

与旧 1/1/1 基线（补测两轮 R1 2026-09-12T01-26-07-249Z、R2 2026-09-12T01-32-41-879Z）比对：

| 指标 | 旧 R1 1/1/1 | 旧 R2 1/1/1 | 本次 opt 1/1/1 |
|---|---|---|---|
| 系统提示 sha / read_section | f320b2d3… / 暴露 | f320b2d3… / 暴露 | 7b82d52c… / 隐藏 |
| 显式 facts_search | 7 | 6 | 17 |
| 模型步骤 / 工具执行 | 43 / 34 | 43 / 30 | 50 / 42 |
| 工具结果字符 | 154584 | 140654 | 128914 |
| 输入 token / 费用 | 167056 / ¥0.1319 | 157280 / ¥0.1264 | 168044 / ¥0.1328 |
| S / M / C / U | 68 / 4 / 0 / 0 | 63 / 9 / 0 / 0 | 65 / 6 / 1 / 0 |
| 完整且有据 | 15/20 | 13/20 | 16/20 |

- 观测：单轮 S 率为 90.3%，与旧两轮合并的 91.0%（131/144）基本持平；完整题数 16/20 名义最高，但旧两轮自身波动较大（分别 4 与 9 个遗漏），单轮不足以外推。
- 稳定补齐：S04.3（旧两轮均为 M，本次因显式 facts_search 送达巫恋卡而覆盖）；另有仅在其中一轮缺失的 F03.3、F07.2、F08.1、G01.2 本次齐备。
- 持续未解决：F05.3、G02.3 在旧两轮均缺；G02.1、G02.2 仅旧 R2 缺（旧 R1 为 S）。本次 6 个遗漏中 4 个属办公室族。
- 新增缺口：F02.1、F02.2。本题 rag_search 仅命中 references/技能-制造站.md 干员卡，base/机制-制造站.md 全程未进入上下文（trace 中该路径 0 次，旧两轮各 8 次），故生产力与心情计量表公式整体缺失。
- 新增冲突：S08.4 由旧 R2 的「遗漏」转为「断言错误」，属证据已送达但模型误读维娜技能文本中的「格拉斯哥帮干员」措辞。

送达机制复核（澄清本轮缺口成因，纠正「隐藏 read_section 导致 F02 缺口」的初步归因）：

- expandFulltext 的作用域是「已命中的 base/guides 小节 → 扩展为该文件整篇」，不是「全库全文注入」（见 bench/src/inputs.ts 中 expandFulltext 的定义与 ADR-013）；文件未被命中时无可扩展对象。
- F02 trace 对照：本次 opt 与旧 R2 的首轮 rag_search 均只命中 references 干员卡、fulltextRanges 为空，旧 R2 第二轮改用机制向关键词重查才命中 base/机制-制造站.md 并整篇扩展 L1-37；旧 R1 首轮即命中该文件（扩展 L1-37）。本次 F02 只检索一次、未再补查。三轮 F02 均未调用 read_section，差别只在模型是否再次检索。
- read_section 只能读取上下文中已暴露 id 的范围（随命中文件下发的【小节上下文】/【小节导航】/【上级范围入口】），无法把未命中文件带入上下文；因此 F02、G02.3 这类文件级未命中，read_section 在或不在都补不了；F05.3、G02.1、G02.2 属 references/技能-办公室.md 已命中、但目标小节（#水灯心、#地灵、#凯尔希、#珊比、#斥罪）未送达，同属检索命中粒度问题。
- 结论：1/1/1 的缺口至少分三类——文件级未命中、命中文件但目标小节未送达、命中但未覆盖；本轮 F02 属第一类，与 read_section 是否暴露无关。

### facts 缺位场景的送达对照（F05 / S04 / G02，2026-09-12 补充）

针对「原先 facts 工具未取回所需卡」的场景，逐题对照三轮的显式 facts_search 调用与返回卡（取自各 run 的 trace.jsonl）：

| 题 | run | 本题 facts_search 调用（返回卡数） | 覆盖 |
|---|---|---|---|
| S04 | 旧 R1 | 无 | S04.3 M（S04.4 S） |
| S04 | 旧 R2 | 龙舌兰(1) | S04.3 M（S04.4 S） |
| S04 | 本次 opt | 龙舌兰(1)、巫恋(1) | S04.3 S（S04.4 S） |
| F05 | 旧 R1 | 无 | F05.3 M |
| F05 | 旧 R2 | 无 | F05.3 M |
| F05 | 本次 opt | 斥罪(1) | F05.3 M |
| G02 | 旧 R1 | 无 | G02.1 S、G02.2 S、G02.3 M |
| G02 | 旧 R2 | 办公室(32，含凯尔希) | G02.1 M、G02.2 M、G02.3 M |
| G02 | 本次 opt | 遥(1) | G02.1 M、G02.2 M、G02.3 M |

- S04 的改善可归因：旧 R2 唯一一次 facts 查询为龙舌兰（guide 已含该技能），缺口对象巫恋未查；本次在 rag 后追加巫恋定向查询，一次命中「低语」原文，S04.3 由 M 转 S（S04.4 三轮均为 S）。
- F05 未改善：本次唯一一次 facts 查询落在斥罪（本可由 guide 覆盖），缺口对象水灯心、地灵、凯尔希均未查询；该题 rag 亦未命中地灵卡，可用信息不多于旧轮。
- G02 反向：旧 R2 以设施词「办公室」一次取回 32 张卡（含凯尔希），本次改用单干员「遥」仅 1 张卡；查询形态由设施/组合宽查询转为单干员窄查询。
- 规则边界：「对其中至少一名具名干员调用一次 facts_search」在单点缺口（巫恋）有效，在多对象清单型缺口（F05.3、G02.1/2）不被覆盖。本次 17 次显式 facts 调用中指向真实缺口的主要为巫恋（S04.3）与伺夜、吉星、空弦（G01.2）。

### 独立审查（2026-09-12）

由独立子代理以只读方式审查改动、提示词与本文档，并复算 typecheck/test/doc-check 与 dry 产物：

- 确认无误：开关接线完整（config / cli-args / cli / tool-executor / agent / runner / inputs / snapshot 无遗漏调用点）；关闭后执行器以 `unknown_operation` 拒绝、不扣成功额度但占一次获准尝试（符合 ADR-012 既有语义）；meta 与 inputs 均记录开关；默认（不传开关）行为与改动前一致；`agentInstructionsSha256` 迁移、`toolSchemaVersion=10`、`toolSchemaSha256=71b9dff2…`、测试规模经复算属实；未违反编码核心约束 #10 与规则 7/8/9。`TOOL_SCHEMA_VERSION` 保持 10 的决定被接受。
- 已按审查修复：陈旧注释（runner / tool-executor / inputs）、hitrate 对 `--expose-read-section` 的静默忽略（纳入忽略提示）、补 1 项 runner 端到端断言（false 臂的 meta / inputs / 能力块）；修复后 typecheck 通过、doc-check 通过、测试 498 项通过。
- 已按用户裁决修复（原审查标为 major）：隐藏 `read_section` 时不再下发仅供该工具使用的小节上下文 / 小节导航 / 上级范围入口与「续读」元数据，分页截断改为中性说明；`fulltextRanges` 复核元数据不变，未扩大其他改动面。
- 提示词张力（审查记录）：新增强制 facts 规则与既有「证据足够时直接作答」并列时可能产生取舍摇摆；建议在付费对照时把「具名干员触发率、额外调用数、预算触顶」列为独立观测项。
- 覆盖核查段独立审查（2026-09-12，两轮）：首轮由独立子代理只读复核，复算三轮计量与 S/M/C/U 无误、`node scripts/doc-check.mjs` 通过，但判定 FAIL——指出两处与旧轮审计冲突的事实（S04.4 在旧两轮实为 S；旧 R1 的 G02.1/G02.2 实为 S）及两处指向含混（F02 trace 对照未区分旧 R1/R2；G02 归因分类混用）；已全部修正，并补 G02 旧 R1 行与 bench-runs 原件清理口径。换新审查者复审判定 PASS，另提示两处非阻塞项（F05.3 的归因分类、清理条目 run 目录名后缀），亦已修正。修订后核对项与既有审计文件一致。

## 结论

- 支持（仅机械/契约层）：新增开关可在不改动工具定义的前提下，使 1/1/1 只下发 `rag_search` + `facts_search`；提示词四处临时修订（强制 facts 取证、删除 `read_section` 条目、移除「证据足够即作答」、数值/机制具体化）已进入实际 systemPrompt。这不代表回答质量提升。
- 已观测（仅机械/计量层）：1/1/1 + 不暴露 `read_section`（GLM-5.3-Flash low）完成冒烟 3 题与完整 20 题，均 0 失败、0 截断/重试、费用完整；真实运行的提示词与工具集确认不含 `read_section`；20 题显式 `facts_search` 17 次、`rag_search` 25 次、RAG 内部 facts 查询与实际附带各 7 次。
- 覆盖层观测（2026-09-12 补充，单轮）：本次 opt 1/1/1 按 spec v4 核查为 S 65 / M 6 / C 1 / U 0、完整且有据 16/20；与旧 1/1/1 两轮（S 131/144、完整 28/40）比较，S 率基本持平（90.3% 对 91.0%）、完整题数名义略高，但旧两轮波动较大且无对照臂，不判定本次优化带来稳定质量增益。显式 facts_search 由 6–7 次增至 17 次，稳定补齐 S04.3 等 references 类缺口；办公室族（F05.3、G02.1/2/3）未解决，并新增 F02.1/F02.2 文件级未命中与 S08.4 事实冲突。
- 机制澄清：1/1/1 的「全文扩展」是命中文件整篇放大、不保证命中；本轮缺口分「文件级未命中」「命中文件但目标小节未送达」与「命中但未覆盖」三类（本轮未出现第三类），F02 缺口非 read_section 缺位所致（见结果段「送达机制复核」）。以上均为只观测结论，不构成优化授权、不触发修复。
- facts 缺位场景对照（补充）：显式 facts_search 增多只在查询落在真实缺口对象时产生覆盖收益——S04.3（巫恋）与 G01.2（伺夜/吉星/空弦）由 M 转 S；F05 的唯一一次查询落在已覆盖的斥罪，G02 由设施宽查询退化为单干员窄查询，故 F05.3、G02.1/2 未改善（G02.3 属文件级未命中）。见结果段「facts 缺位场景的送达对照」。
- 未验证：强制 facts 规则与「移除证据足够即作答」对答案质量的作用无对照证据；不设达标线、不据分数触发修复。
- 局限：仅 GLM-5.3-Flash low 单 provider/档位，冒烟 3 题与 20 题各一次；覆盖核查仅单轮、无对照臂与重复，且「纯澄清/否定型条件」的 S/M 判定存在子代理口径差异、未经独立人工复核；结论不指向任何正式质量基线。
- 回退（2026-09-12 已执行）：按用户裁决，本试验的 harness 与提示词改动一并回滚——`git checkout -- bench/src bench/tests knowledge/AGENTS.md docs/inbox.md`，撤销 `exposeReadSection` 开关、相关测试、临时提示词（`agentInstructionsSha256` 回到 `f320b2d3…`）与 inbox 登记；仅保留本 exp 与四组对照覆盖核查 exp 两份记录。仓库运行时回到试验前基点，本试验不再可重放。
- 独立审查：已完成两轮只读独立子代理审查（见结果段「独立审查」小节）——代码与提示词首轮审查确认接线完整、默认行为不变、机械数字属实、未违反规则 7/8/9 与约束 #10（据此修复陈旧注释与 hitrate 忽略提示、补端到端断言）；覆盖核查段首轮 FAIL 后已修正、换新审查者复审 PASS。
- 契约提示：若 `exposeReadSection` 长期保留，将超出 ADR-011 按 retriever 固定的工具集契约，须新增或修订 ADR；本次已随回滚撤销，不再保留。
- 清理（2026-09-12 已执行）：按用户确认，以显式清单（node scripts/tooling.mjs tmp manifest / tmp clean --apply）删除 dev-temp/work/prompt-tool-temp-optimization/（含 dry 产物与覆盖核查审计 coverage-opt-1-1-1-2026-09-12T03-31-32-741Z.md）及本轮两个付费 run 原件 bench-runs/2026-09-12T03-30-17-229Z-glm-low-default、bench-runs/2026-09-12T03-31-32-741Z-glm-low-default；清理后不承诺完整重放。
- 后续入口：2026-09-12 用户裁决不补「暴露 / 不暴露 `read_section`」对照臂，故不对该开关作受控因果结论；如需判定提示词改动对回答覆盖的作用，须另行授权并另建 exp（同基点与 schema、固定条件、含未参与调优的留出集）。本轮不自动授权策略修改。
