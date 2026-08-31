# 实施笔记：Qwen3.7-Flash 候选模型接入

> 对应草案：docs/draft-qwen37-flash-bench.md
> 开始日期：2026-08-31

## 决策偏离
> plan 中没有提到，但在实施中做出的重要决策

### 2026-08-31 — Provider 参数化采用注册表而非抽象接口
- **背景**：草案要接入 qwen，需多 provider 共存；方案是"参数化"。
- **选项**：
  - A: 抽象 `Provider` 接口 + 多实现类（面向未来扩展，但增加文件/抽象）
  - B: `config.ts` 内 `PROVIDERS` 注册表 + `provider.ts` 单一 `callLLM` 按 `config.provider` 分支（最小侵入，贴合"简单架构"）
- **决策**：B。当前仅 2 个 provider，接口抽象是过度设计；注册表把端点/模型/定价/密钥 env 集中，`callLLM` 内只分支 thinking 参数与 chat 路径。
- **影响**：新增 provider 只需在注册表加一行 + provider.ts 加参数分支，不重构循环/检索/报告。

### 2026-08-31 — qwen 的 thinking 档位映射先不细分
- **背景**：Hy3 有 `reasoning_effort: low/medium/high` 细档；Qwen3.7 用 `enable_thinking` 布尔控制，草案注明"是否支持 reasoning_effort 细档待探针确认"。
- **决策**：qwen 侧 `enable_thinking = thinking !== 'off'`（off 显式 false，low/high 均 true），暂不细分 `reasoning_effort`。探针确认服务端接受该布尔字段；细档留待全量 120 次前再核。
- **影响**：qwen 的 low/high 目前等价（同为开启思考），跨模型"档位对比"需注意此差异。

### 2026-08-31 — qwen 缓存字段缺失按 0 处理
- **背景**：草案注明 qwen 的 `prompt_tokens_details.cached_tokens` 可能不支持，需确认。
- **决策**：探针实测 qwen 返回 `cached=0`（隐式缓存字段未走 `prompt_tokens_details.cached_tokens` 口径），`parseUsage` 读不到则按 0，计费保守（不享受缓存折扣）。
- **影响**：qwen 侧成本按"全量输入计费"，无缓存折扣；与 Hy3 的缓存命中计价口径不同，跨模型对比需知悉。

## 实现调整
> plan 中有描述，但实际实现方式不同

### 2026-08-31 — 报告标题与跨模型聚合的通用化
- **plan 原文**：报告仍写"Hy3 查询输出成本基准报告"。
- **实际做法**：改为"LLM 查询输出成本基准报告"；`aggregate` 增 `byProvider` 分组，`renderCrossProvider` 渲染对比表；新增 CLI `compare <runDir1> <runDir2>` 子命令。
- **原因**：单一模型报告标题在 qwen 接入后失准；跨模型对比需要合并多个 runDir。
- **兼容**：早期 hy3 运行记录无 `provider` 字段，`aggregate` 用 `r.provider ?? r.model` 回退标识。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项

### 2026-08-31 — qwen 的 low/high 档未细分
- **债务**：qwen 侧 `enable_thinking` 布尔控制，low/high 当前等价；无法与 Hy3 的 reasoning_effort 细档完全对齐。
- **未来偿还**：确认 qwen 是否支持 `reasoning_effort`/思考预算参数后再映射，或接受"档位对齐不完整"作为已知局限。

## 意外发现
> 实施中发现的 plan 未覆盖的依赖/边界/风险

### 2026-08-31 — qwen 检索更少、编造倾向更强（成本-可靠性权衡）
- **发现**：同问题集，hy3 平均 2.50 轮，qwen 2.10 轮（F04 甚至 1 轮 0 次检索即作答）。逐条核查（对比 hy3）显示：
  - hy3：仅 3 处"漏检类"疑点，且倾向诚实标注"无法确认/片段未提供"。
  - qwen：13 题有疑、4 题明显编造（S07 数值编造 +1200%/-900%、干员"灰喉"实为灰毫；S02 虚构"苍角/调香师/挂票"；S05 编造"叙拉古书呆子"；S08 把可露希尔机制误归推王、干员 Lappland/德克萨斯无据）。
- **影响**：qwen 便宜 80%（输出单价 4→0.8 元/M）的代价是检索更少、编造倾向更强。"成本基准"之外，若后续看重答案可靠性，需权衡是否提高 qwen 的检索上限或强制至少 1 次检索。
- **风险**：qwen 跳过检索直接作答，若用于生产会输出与知识库冲突的内容。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

### 2026-08-31 — secret.yaml 双密钥管理
- **症状**：hy3 与 qwen 各需一个 key，`secret.yaml` 内已有 `hy3-api-key` 与 `qwen-api-key`。
- **解决**：config 注册表按 `apiKeyEnv` 读取（hy3→`TOKENHUB_API_KEY`，qwen→`DASHSCOPE_API_KEY`），运行前从 `secret.yaml` 导入到对应环境变量。密钥仍不入库（gitignore 已忽略 secret.yaml）。

### 2026-08-31 — 跨模型对比中旧运行无 provider 字段
- **症状**：hy3 早期运行记录无 `provider` 字段，`aggregate` 按 `r.provider` 分组会得到 undefined。
- **解决**：`aggregate` 用 `r.provider ?? r.model` 回退，旧记录以 model（hy3）标识。

## 检索策略实测记录（2026-08-31，P3 grep 对照）

> 对应草案：docs/draft-retrieval-experiment.md；运行产物在 `bench/runs/`（gitignore，不入库）。

### 决策偏离
- **minRag=3 回滚**：仅保留其运行数据作参照（12:37 基线），`minRag=3` 的代码实现已回滚；当前行为路径为通用 `minRagCalls`（本次=1）+ 检索器 `retriever: 'grep'`。
- **对比口径收窄**：用户决策跳过 P1（BM25 minRag=1），因此本记录对比是「grep(minRag=1) vs BM25(minRag=3)」——检索器与强制次数同时变化，是**实用取舍**评估，非草案 H3 的"仅换检索器"严格对照（严格 H3 需另行再跑 P1）。

### 实现调整
- 新增检索器开关：`config.retriever: 'bm25'|'grep'`（env `BENCH_RETRIEVER` / CLI `--retriever`）。
- 新增强制首检：`config.minRagCalls`（env `BENCH_MIN_RAG_CALLS` / CLI `--min-rag`）；agent 在无工具调用且 `ragCalls < minRagCalls` 时引导模型先检索再作答。
- `DocChunk` 增加 `startLine/endLine`（`corpus.ts` 按行号切分，溯源标注）。
- 新增 `grep-retriever.ts`（字面命中计数 + 查询构造「实体词表 → 中文段/拉丁串短语 → 2 字滑窗回退」+ safePattern 校验 + 命中行明细）。
- 系统提示强化「严禁使用模型自身训练语料作答，必须基于 rag_search 返回片段；未覆盖时明说知识库未查到，不得凭记忆补全/编造」。

### 对比数据
| 指标 | 基线 BM25 minRag=3（12:37） | P3 grep minRag=1 |
|------|------|------|
| 查询数 / 检索上限 | 20 / 拉满 | 20 / MAX_RAG_CALLS=2 |
| LLM 调用数 | 77 | 45 |
| 平均轮次 | 3.85 | 2.25 |
| 0 检索题 | 有 | 0（全部 ≥1 次检索） |
| 总成本 | ¥0.0882 | ¥0.0429（≈ −51%） |
| 每查询输出 tokens | 3739.5 | 1814.5 |
| 轮次耗尽无答案 | 出现过 | 无 |

### 质量核查（subagent 交叉核查 20 题）
- **判定合计**：正确 13 / 编造 3（S02、S03、S05）/ 存疑 4（F03、F05、S04、G01）/ 漏检 0。
- **对基线 4 处编造（S02/S05/S07/S08）的重判**：
  - S02（怪猎中枢）、S05（自动化组）确为编造：S02 把复合干员「火龙S黑角」「麒麟R夜刀」拆成 4 人且误置制造站产木天蓼；S05 杜撰英文别名 TWDN/Halo/Gladiia（G 实为深海链歌蕾蒂娅）。
  - **S07（红松林）、S08（推王龙门）判「正确」，基线属误判**：焰尾(E2)+薇薇安娜 +10%经验/-10%赤金、灰毫/远牙/野鬃；维娜/摩根/戴菲恩 1.35 面板 +10% —— 均能在语料逐项找到依据。
- **新发现漏网编造 S03（深海链）**：答案把「能天使、星熊」列入深海猎人（实为斯卡蒂/幽灵鲨/安哲拉/乌尔比安），并把制造加成误归「潮汐守望」（实为集群狩猎·β）。
- **存疑要点**：F05 絮雨被列为"常规高联络首选"与语料"未启用迷迭香感知链则明确不选"矛盾；G01 黑键配站与语料"黑键不与巫恋同站"相悖且把体系锚点误作散件；F03 "佩佩生成矿石碎块订单"术语语料无据（实为 0赤金→1000龙门币 特别独占订单）；S04 第三人应为龙舌兰（投资·β）且裁缝β需精 2。

### 意外发现 / 结论
- **强制首检能消除「0 检索作答」并大幅降本**（较 minRag=3 约 −51%），但**不能完全消灭编造**——剩余编造多为「检索到片段后对片段的理解/整合错误」（复合干员名拆分、自造别名、跨体系张冠李戴），而非单纯检索不足。
- **提示强化的效果**：答案普遍更依赖检索片段并明确「知识库检索结果/知识库未查到」，编造由首轮的 4 处收敛到 3 处。

### 债务记录
- 来源相关率未计算：`answers.md` 仅存最终答案，未存检索来源块（文件#标题#行号），需在 runner 输出补充后才可量化。
- 关键编造/误判项（S02/S03/S05、S07/S08、G01、F05）建议人工抽查语料原文定稿，subagent 核查非人工终审。
