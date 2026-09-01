# 检索质量与成本收敛草案（命中率评测 / 注入收敛 / 中文分词）

> 创建日期：2026-09-01
> 状态：未定稿草案（待实施；R2 先行，R1/R3 依其结果推进）
> 上游：成本敏感场景 ROI 调研结论（#3 检索注入收敛 / #6 中文分词 / #8 命中率评测 为高 ROI 前三项）

## 背景

成本敏感场景下（qwen3.7-flash 实测：思考占输出 >55%、多轮轮次成本 3 倍放大），业界数据显示三项高 ROI 优化：

- **#8 命中率评测**（诊断）："标注几十个问题统计命中率，≥90% 则无需向量/更多检索优化"——业界反方共识（dev.to / n1n.ai / Hacker News 实证 grep 式检索可打平向量）。
- **#3 检索注入收敛**（省钱且可能更准）：top-k 与准确率呈**倒 U 曲线**——>5 片段边际递减且引入干扰（KTH 研究 top-k≈5 后 plateau）；**弱模型（Flash 级）抗干扰差、需要更少片段**（ICLR 2026 LDAR：开源小模型 token 用量 0.25–0.47 vs 闭源 0.52–0.63）；阿里云实测「TopK=3–5 稳定安全区，TopK=10 缝合互斥证据→编造」。
- **#6 中文分词 jieba**（检索质量翻倍）：MTEB LeCaRDv2 BM25 nDCG 0.359（默认）→ **0.641（jieba）**；社区实测召回 30–50%→80%。当前 bigram 折中是无依赖妥协，jieba-node 纯 JS 零原生依赖（Concliude 已在生产用）。

## 目标

以**命中率评测（R2）为度量基础**，验证两项低成本优化：检索注入收敛（R1）与中文分词（R3），最终确定「topK/注入长度/分词器」三参数的**成本-准确率平衡点**。

## 非目标

- 不引入向量检索 / 混合检索 / reranker（命中率 ≥90% 时按业界判据明确不需要）
- 不改变 Agent 循环、prompt、问题集、语料
- 不做 HyDE/查询改写（收益不稳定，调研结论）

## 实施顺序与依赖

```
R2 命中率评测（先行：度量工具 + gold 标注）
   ├─→ R1 注入收敛实验（topK/注入长度矩阵，用 R2 判定）
   └─→ R3 jieba 分词（仅当 R2 命中率 <90% 时触发；用 R2 验证提升）
```

## R2 命中率评测（先行项，~2 天）

### 目的
得到当前 BM25（bigram）的 **recall@K** 基线：20 题中恰好多少题能在 top-3/5/10 候选里命中期望块。这是 R1/R3 的判定标尺。

### gold 标注（人工，复用质量核查工作）
- 文件：`bench/gold.json`（评测资产，入库）
- 格式：
  ```json
  {
    "F01": { "golden": ["0-规则/发电站机制.md#充能基础规则#L30-36"] },
    "S07": { "golden": ["2-体系/红松林经验.md#制造站#L45-53", "2-体系/红松林经验.md#缺人降级路径#L65-76"] }
  }
  ```
- **标注来源（直接转录，无需重新标注）**：`docs/notes-rag-answer-baseline.md`（20 题回答核查基线 v2 详版）——每题「参考要点」已带 `file#小节` 出处，逐题转录为 golden 数组即可（file+heading 为匹配键，行号省略；转录时校验 chunk 存在）
- 补充来源：11:30 / 12:37 运行 answers.md 的检索来源（人工核验过的）

### 实现
- 新文件：`bench/src/hitrate.ts`
  - `loadGold(path): GoldMap`（校验：gold 引用的 chunk 必须存在于语料）
  - `runHitrate(index, chunks, questions, topKs: number[]): HitrateResult`——对每题按金色标注∩检索结果判断命中，输出 **recall@3 / recall@5 / recall@10** 曲线
  - 复用 `buildIndex` / `search`（不重复造检索）
- `cli.ts` 加子命令：`node dist/cli.js hitrate [--topk 3,5,10]`——读取 questions.json + gold.json + 语料 → 输出列表 + 摘要（哪些题 miss、miss 题的 topK 内最佳位次）
- 单测：miss/multi-gold/越界 chunk 校验 3 例

### 判定
- recall@5 ≥ 90% → 检索器无需更换向量（可关 R3 的"上向量"担忧），R3 仅作锦上添花评估
- recall@5 < 90% → 触发 R3（jieba），并用于确认是否需要混合检索（超范围，另行登记）

## R1 检索注入收敛（~1 天 + 3 次运行）

### 目的
验证「更少注入」是否能：① 降输入成本；② 不降准确率（甚至提升——少干扰少编造）。

### 参数矩阵（叠加 minRag=1 强制首检，qwen low 档，20 题）
| 组合 | topK | maxContextChars | 说明 |
|---|---|---|---|
| 基线 | 5 | 12000 | 当前配置（已有 P0/P1 数据） |
| A | **3** | 6000 | 收敛版（安全区下限） |
| B | 3 | 12000 | 隔离 topK 影响 |
| C | 5 | 6000 | 隔离注入长度影响（可选，观察成本曲线即可） |

- 判定指标：**成本**（总成本/题均、输入 token/题）与**质量**（R2 recall 不变 + 重点题答案核查：S02/S05/S07/S08/F04 编造是否复发）
- 预计：每次 run ~13 分钟；A/B/C 三跑 + 核查 ~2 小时人工

### 实现
- 纯配置（env 已支持 `BENCH_TOP_K` / `BENCH_MAX_CONTEXT_CHARS`），**零代码改动**——仅新增 `hitrate` 辅助指标后跑矩阵
- 注意：`splitChunks` 的 chunk 划分不受 maxContextChars 影响（那是注入截断），两参数独立

## R3 中文分词 jieba（触发制，~1 天 + ADR）

### 触发条件
R2 命中率（bigram）< 90% 时实施；≥90% 时暂缓（记录为债务）。

### 实现
- 新依赖：`jieba-node`（纯 JS、0 原生依赖、Windows 无编译风险——Concliude 会话检索 ADR 同款判据）；**新依赖引入须先登记 ADR**（`docs/adr/` 下新建，编号待定：理由=中文 BM25 检索质量翻倍、对比 bigram 实测数据、替代方案 trigram 无法覆盖 2 字词）
- `retriever.ts` 分词参数化：`BENCH_TOKENIZER=bigram|jieba`（默认 bigram 保持兼容与可复现）
- **索引侧与查询侧强制同一分词器**（调研确认的常见 bug：只索引时分词 → 零匹配）
- **自定义词典**：干员/机制名词表（~50 词，`bench/src/terms.ts`）`jieba.addWord`——**与检索实验草案 P2 专名 boost 的词表共用**（一份词表两处消费）
- 单测：jieba 分词与 bigram 的 token 集抽样对照、词典词不被切开（如"灰毫""红松林"单 token）
- 验证：R2 工具跑 jieba 版 recall@K 对比 bigram 版 → 落盘差值

## 验收清单

- [ ] R2：`gold.json` 20 题标注完成（含 chunk 存在性校验）
- [ ] R2：`hitrate` 子命令实现 + 单测通过；产出 bigram 版 recall@3/5/10 基线
- [ ] R1：A/B/C 三组合运行 + 成本对比表 + 重点题核查（编造未复发）
- [ ] R1：确定 topK/注入长度的推荐平衡点（写入 qwen 笔记）
- [ ] R3（条件触发）：jieba 接入 + ADR 登记 + 词典单测；R2 复测 recall 提升数据
- [ ] 结论落盘：`docs/notes-hy3-rag-bench.md` 或新增实施笔记

## 关联

- R2 先行，gold 标注直接转录自 `docs/notes-rag-answer-baseline.md`（20 题回答核查基线 v2，含参考要点与 file#小节 出处）
- 上游：`docs/draft-retrieval-experiment.md`（P1 minRag=1 / P2 专名 boost——词表共用）；grep 检索器实现已在 main（`bench/src/grep-retriever.ts`）
- 依据：成本敏感 ROI 调研（Batch/思考预算/缓存为另三条高 ROI 线，本期不做）
- 参考：Concliude 会话检索选型实测（jieba 召回 1.00 vs trigram 0.78）、MTEB BM25 官方数据（0.359→0.641）
