# 检索策略实测框架草案（RAG 检索优化对比实验）

> 创建日期：2026-08-31
> 状态：未定稿草案（待实测数据驱动收敛）
> 上游：`docs/draft-qwen37-flash-bench.md`（qwen 首轮对比结论）

## 背景

- qwen3.7-flash 首轮对比（11:30 基线）：便宜 ~80%（输出 0.8 vs 4 元/M）但**检索更少**（平均 2.10 轮 vs hy3 2.50 轮，F04 一轮 0 检索直接作答）、**编造倾向更强**（20 题中 13 题有疑、4 题明显编造：S07 数值 +1200%/-900%、干员"灰喉"错认；S02 虚构干员/药名；S05 虚构"叙拉古书呆子"；S08 机制误归）。
- 强制检索实测（12:37，minRag=3）：S07 编造消失（答案基于真实来源：灰毫/远牙/野鬃 +25%、126% 满配、薇薇安娜必要性），但代价——全部题轮次拉满 4 轮（F01 成本 ~3 倍）、**F05/F09 轮次耗尽无最终答案**、qwen-off 档运行中断（目录空）。
- 预判：**qwen 的表现瓶颈在"检索意愿/策略"而非"检索器精度"**；但 minRag=3 过粗（轮次/成本代价大），**minRag=1（强制首检）**为更优候选——效果需实测确认。
- 用户决策：minRag=1 纳入备选；本框架以**受控实验数据**驱动，验证各检索策略对 qwen3.7-flash 的（质量 × 成本）净效应。

## 目标

用同题集、同档位的受控实验，量化 4 种检索策略对 qwen3.7-flash 的影响，产出**决策表**：强制策略选型（minRag=0/1/3）+ 是否引入专名 boost / grep 式检索。

## 非目标

- 不做检索算法工程化（新分词器、BM25 参数调优、向量检索）
- 不引入外部依赖（grep 对照用 Node 原生实现，不引 ripgrep）
- 不改 hy3 基线与问题集（hy3 仅作参照组，数据已有）

## 待验证假设

| # | 假设 | 判定指标 |
|---|---|---|
| H1 | minRag=1 能消除「0 检索作答」，编造数显著下降（≤1 处） | 编造数、0 检索题数 |
| H2 | 专名 boost（干员/机制名精确加权）提升来源相关性，成本不显著上升 | 命中块含答案比率、每题成本 |
| H3 | grep 式检索（字面+计数）在质量上**不优于** BM25 | P3 vs P1 编造数/正确率对比 |

> H3 预判依据：Concliude 会话检索选型实测（trigram 字面子串召回 0.78 < jieba 分词 1.00，见其会话检索 ADR 记录，不在本仓库）；本实验用 rag-test 数据验证或推翻该预判。

## 方案矩阵

| 方案 | 检索器 | 强制首检 | 数据来源 | 说明 |
|---|---|---|---|---|
| **P0 基线** | BM25 | 否 | **已有**：11:30 qwen-low（42 条记录） | 2.10 轮、4 编造 |
| **P1 minRag=1** | BM25 | 1 次 | 需新跑 | 工作区已实现（`BENCH_MIN_RAG_CALLS=1` / `--min-rag 1`） |
| **P2 专名 boost** | BM25 + 实体词表加权 | 1 次 | 需实现 + 新跑 | 实体词表：语料干员名/机制名（~50 词，硬编码小表） |
| **P3 grep 对照** | 字面命中计数 | 1 次 | 需实现 + 新跑 | 唯一目的是验证 H3，详见「P3 详细设计」 |
| **P4 minRag=3 参照** | BM25 | 3 次 | **已有**：12:37 qwen-low（77 条记录） | 4 编造→改善但轮次耗尽 |

## P3 grep 对照检索器详细设计

### 设计立场

P3 不是"实现一个生产用 grep 检索器"，而是**验证 H3 的受控实验组**：把检索器换成「字面命中计数」（无 IDF 加权、无长度归一），其余一切（Agent 循环、工具接口、强制首检、输出格式、MAX_RAG_CALLS=2）与 P1 完全一致——这样 P3 vs P1 的质量差异**只由检索器**解释。

参照 Concliude grep（`packages/platform/core/src/ripgrep.ts` + `packages/tools/file/src/grep.ts` + `regex-patterns.ts`），但**不引入 `@vscode/ripgrep` 二进制依赖**（零运行时依赖承诺）——Concliude 的机制作为设计参照，实现用 Node 原生（语料仅 267 chunks，线性扫描成本可忽略）。

### 机制映射（Concliude → P3）

| Concliude grep 机制 | P3 的映射 | 说明 |
|---|---|---|
| `safePattern` 双重防护（长度 ≤500 + `new RegExp` 编译校验捕获 SyntaxError） | 同样的校验：长度 ≤200、编译 try/catch、控制字符拒绝 | rag-test 的查询来自 **LLM 工具调用参数**，校验必要性等同 Concliude（防 LLM 注入 ReDoS 向量） |
| `fixed_strings`（`-F` 字面量模式，不解析正则元字符） | **默认字面匹配**：本设计不要求 LLM 写正则，查询词一律转义后匹配 | LLM 不是可靠的正则工程师，P3 只有字面模式一种口径 |
| 多词 OR（`a\|b` 正则） | 多模式 OR：`模式数组 → 任一命中即计数` | 对应 grep 的 pattern 合并语义 |
| `--json` 行解析（match/context 类型 + 行号） | 逐 chunk 扫描时记录命中行号 | chunk 行号范围已有（startLine/endLine），命中行标注到具体行 |
| 单行截断 200 字符 + `CONTROL_CHARS` 清理 | 沿用：命中行展示截断 200 字符 + 控制字符清理 | 防污染输出 / 上下文膨胀 |
| content 模式输出「`文件 (N 处匹配)` + `行号:文本`」 | chunk 结果输出「`【file \| heading \| Lstart-end】命中 N 处`」+ 命中行明细 | 复用现有 buildRagResult 格式，追加命中数 |
| count 模式「共找到 N 处匹配（模式: /x/）」 | 无命中时错误提示：「未找到匹配（模式: /query/），请改述后重试」 | 工具侧语义一致：模型可改查询再试 |
| `offset / head_limit` 分页（默认 20）| 不做分页——`topK` 截断已够（topK=5） | rag_search 无分页需求 |
| spawn + AbortSignal（超时 kill / taskkill 防孤儿） | 不需要子进程；同步/异步线性扫描 | 无进程粒度问题 |

### 查询构造（P3 的核心决策）

自然查询（LLM 传入的 `rag_search` 参数）→ 字面模式集的构造顺序：

1. **实体词表优先**：干员名/机制名词表（与 P2 共享，~50 词）中出现在 query 的 → 独立模式（专名精确性）
2. **中文连续段短语**：query 中连续 CJK 段（如「无人机充能机制」）→ 整段字面模式
3. **2 字滑窗回退**：若前两阶段总体命中数 < topK → 中文段切 2 字滑窗（与 BM25 bigram 同词元集，但**只计数不加权**）补充

> 注：阶段 3 与 BM25 的 token 集相同——差异仅在打分（计数 vs IDF×TF 加权）。这正是 H3 要测量的东西：**去掉信息论加权后，同一词袋的检索质量是否显著下降**。

### 打分与输出

- **打分**：`chunk 命中数`（heading 与正文统一计数；同一模式重复命中不叠加）；降序 → topK；同分按 chunk 原序稳定
- **输出**：复用 `buildRagResult`（`【file | heading | Lstart-end】` + 正文截断 maxContextChars），追加命中行明细 `L<行号>: <行文本>`（每行截断 200 字符）与命中计数
- **无命中**：返回「未找到匹配（模式: /query/），请改述查询后重试」——符合工具语义（提示模型换查询），不自动回退 BM25（保持对照纯粹）

### 实现与测试

- 新文件：`bench/src/grep-retriever.ts`（`grepSearch(chunks, query, topK): number[]` + `buildGrepResult`）；`retriever.ts` 不动
- `agent.ts`：检索器按方案参数切换（P3 用 grepSearch，其余 BM25）——方案参数 `retriever: 'bm25' | 'grep'`（env `BENCH_RETRIEVER`）
- 单测：命中排序（专名 > 泛词）、无命中错误、正则元字符转义（`"红松林(+)"` 不炸）、长度超限拒绝、控制字符清理

## 实验协议

**固定项**（每方案一致）：qwen3.7-flash ｜ low 档 ｜ 20 题 ｜ topK=5 ｜ maxContextChars=12000 ｜ maxRounds=3 ｜ 语料快照（chunks=267）｜ 检索上限 MAX_RAG_CALLS=2（所有方案一致，P3 不例外）。

**输入收集**（每 run 自动产出）：
- `records.jsonl`：逐轮 token/成本/思考量
- `answers.md`：最终答案 + 检索来源（文件#标题#行号，行号溯源已实现）
- `meta.json`：provider/模型/记录数/failed/耗时

**质量核查协议（新增，人工）**：
1. 全量 20 题对照语料核查，每题判定：`正确 / 编造 / 漏检 / 存疑`（编造=语料无依据的输出；漏检=语料有但未答出）
2. 重点题必查：F04（原 0 检索）、S02 / S05 / S07 / S08（原 4 编造）
3. **来源相关性**：检索来源列表是否涵盖答案要点（抽查 5 题，记录命中块含答案比率）

**输出对比表**（`node dist/cli.js compare` 已有能力 + 人工核查表）：
- 质量行：编造数 ｜ 漏检数 ｜ 正确数 ｜ 来源相关率
- 成本行：总成本 ｜ 每题均成本 ｜ 输出 token/题 ｜ 平均轮次
- 行为行：平均检索次数 ｜ 0 检索题数

**判定规则**：
- H1：P1 编造数 < P0 且 ≤1 处 → 采纳 minRag=1
- H2：P2 来源相关率 ↑ 且成本增幅 <10% → 采纳
- H3：P3 质量 ≤ P1 → 维持 BM25（grep 不引入）；反之记录反转（更新评估）

## 实施步骤

1. P1 直接跑：`node dist/cli.js run --provider qwen --thinking low --min-rag 1`
2. P2 实现：`retriever.ts` 加实体词表（干员/机制名）+ BM25 分数 boost（精确命中词元 ×1.5）× 单测
3. P3 实现：`bench/src/grep-retriever.ts`（`grepSearch` + 查询构造：实体词表优先 → 中文段短语 → 2 字滑窗回退；safePattern 式校验/字面转义/命中行明细）+ `retriever: 'bm25'|'grep'` 方案参数 + 单测
4. 跑 P1 / P2 / P3（各 ~13 分钟，用 secret.yaml 双密钥）
5. 质量核查：20 题 × 3 方案（复用 11:30 / 12:37 核查结论）
6. 输出决策表 → 结论落盘 `docs/notes-qwen37-flash-bench.md`

## 验收清单

- [ ] P1 运行完成 + 20 题质量核查（对比 P0 基线）
- [ ] P2 专名 boost 实现（单测通过）+ 运行 + 核查
- [ ] P3 grep 对照实现（单测通过）+ 运行 + 核查
- [ ] H1 / H2 / H3 判定完成，决策表产出
- [ ] 结论写入 qwen 实施笔记；若选定 minRag=1 或专名 boost → 更新 qwen 草案与验收

## 关联

- 上游草案：[`docs/draft-qwen37-flash-bench.md`](draft-qwen37-flash-bench.md)（编造发现、接入口径）
- 基础架构：[`docs/draft-hy3-rag-bench.md`](draft-hy3-rag-bench.md)「简单 RAG 架构」
- 参照实现：Concliude 会话检索选型实测（trigram 0.78 < jieba 1.00，H3 预判）与 grep 工具箱——`packages/platform/core/src/ripgrep.ts`（spawn + --json 行解析、content/count 多模式输出、offset/head_limit 分页元数据 totalMatches/hasMore、AbortSignal 超时 kill）、`packages/tools/file/src/grep.ts`（safePattern 预校验、路径上下文守护、单行截断 200 字符、中文错误提示）、`packages/platform/core/src/regex-patterns.ts`（safePattern 长度上限 500 + 编译校验、CONTROL_CHARS 清理）——均不引入依赖，机制映射见「P3 详细设计」表
- 技术债：质量评估依赖人工核查——若本实验证明检索策略是长期变量，再考虑自动化评估（LLM-as-judge / 答案关键词核对），另行登记
