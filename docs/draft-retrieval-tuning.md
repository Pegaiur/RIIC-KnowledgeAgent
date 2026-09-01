# 检索质量与成本收敛草案（命中率评测 / 注入收敛 / 中文分词）

> 创建日期：2026-09-01
> 修订：2026-09-01 实施前评估修正（gold 转录口径 / recall@K 定义 / R1 质量对照口径 / maxContextChars 语义 / terms.ts 前置抽取 / 控制字符笔误）
> 状态：未定稿草案（待实施；R2 先行，R1/R3 依其结果推进）
> 上游：成本敏感场景 ROI 调研结论（#3 检索注入收敛 / #6 中文分词 / #8 命中率评测 为高 ROI 前三项）

## 背景

成本敏感场景下（qwen3.7-flash 实测：思考占输出 >55%、多轮轮次成本 3 倍放大），业界数据显示三项高 ROI 优化：

- **#8 命中率评测**（诊断）："标注几十个问题统计命中率，≥90% 则无需向量/更多检索优化"——业界反方共识（dev.to / n1n.ai / Hacker News 实证 grep 式检索可打平向量）。
- **#3 检索注入收敛**（省钱且可能更准）：top-k 与准确率呈**倒 U 曲线**——>5 片段边际递减且引入干扰（KTH 研究 top-k≈5 后 plateau）；**弱模型（Flash 级）抗干扰差、需要更少片段**（ICLR 2026 LDAR：开源小模型 token 用量 0.25–0.47 vs 闭源 0.52–0.63）；阿里云实测「TopK=3–5 稳定安全区，TopK=10 缝合互斥证据→编造」。
- **#6 中文分词 jieba**（检索质量翻倍）：MTEB LeCaRDv2 BM25 nDCG 0.359（默认）→ **0.641（jieba）**；社区实测召回 30–50%→80%。当前 bigram 折中是无依赖妥协，jieba-node 纯 JS 零原生依赖（Concliude 已在生产用）。

## 目标

以**命中率评测（R2）为度量基础**，验证两项低成本优化：检索注入收敛（R1）与中文分词（R3），最终确定「topK/注入总量（maxContextChars）/分词器」三参数的**成本-准确率平衡点**。

## 非目标

- 不引入向量检索 / 混合检索 / reranker（命中率 ≥90% 时按业界判据明确不需要）
- 不改变 Agent 循环、prompt、问题集、语料
- 不做 HyDE/查询改写（收益不稳定，调研结论）

## 实施顺序与依赖

```
R2 命中率评测（先行：度量工具 + gold 标注）
   ├─→ R1 注入收敛实验（topK/注入总量矩阵，用 R2 判定）
   └─→ R3 jieba 分词（仅当 R2 命中率 <90% 时触发；用 R2 验证提升）
```

## R2 命中率评测（先行项，~2 天）

### 目的
得到当前 BM25（bigram）的 **recall@K** 基线：每题 golden 块在 top-3/5/10 候选中的命中比例（宏平均 + 逐题明细）。这是 R1/R3 的判定标尺。

### gold 标注（人工，复用质量核查工作）
- 文件：`bench/gold.json`（评测资产，入库）
- 粒度口径：golden 键 = `file#heading`（即 `splitChunks` 生成的 chunk.id，heading 为清洗后标题）；**行号一律省略**（chunk 行号由语料加载自动生成）；粒度跟随基线出处小节，不做加深/放浅
- 格式（示意；完整转录需覆盖基线出处全部小节）：
  ```json
  {
    "F01": { "golden": ["0-规则/发电站机制.md#无人机机制"] },
    "S07": { "golden": ["2-体系/红松林经验.md#中枢", "2-体系/红松林经验.md#制造站", "2-体系/红松林经验.md#缺人降级路径"] }
  }
  ```
- **标注来源（转录 + 逐项校验，非纯机械复制）**：`docs/notes-rag-answer-baseline.md`（20 题回答核查基线 v2 详版）。两点注意：
  1. 基线出处是 `file#小节1/小节2/…` 的**汇总串**——需按 `/` 展开为多个独立 golden 项（如 S07 出处含 9 个小节，展开 + 不一致映射后为 10 项）
  2. 个别小节名与语料实际标题不一致（已发现：`红松林经验.md#与其他体系的关系` 不存在，实际对应 `#中枢共存` / `#明确不选清单`）——转录时逐项对照 chunk 清单校验，不一致处人工映射后落库
- 先行小步：先标 2–3 题跑通 `hitrate --check-gold` 确认口径，再全量 20 题
- 数据质量：基线文末自述「内容不可盲信」——gold 落库前对关键题出处抽查语料原文（S02/S03/S04/S05、G01、F03/F05）
- 补充来源：11:30 / 12:37 运行 answers.md 的检索来源（人工核验过的）

### 实现
- 新文件：`bench/src/hitrate.ts`
  - 指标唯一口径：**recall@K = |golden ∩ topK 检索结果| / |golden|**，逐题计算后取宏平均（多 golden 题按比例计，不退化为「含 1 个即命中」）；题目级命中率与逐题明细（每题命中 x/y）作辅助输出
  - `loadGold(path): GoldMap`（校验：gold 引用的 chunk 必须存在于语料，不一致即报错并逐条列出）
  - `runHitrate(index, chunks, questions, topKs: number[]): HitrateResult`——输出 **recall@3 / recall@5 / recall@10** 曲线 + 逐题明细
  - 复用 `buildIndex` / `search`（不重复造检索）
- `cli.ts` 加子命令：
  - `node dist/cli.js hitrate [--topk 3,5,10]`——读取 questions.json + gold.json + 语料 → 输出曲线 + 摘要（哪些题 miss、miss 题的 topK 内最佳位次）
  - `node dist/cli.js hitrate --check-gold`——仅校验 gold ↔ 语料 chunk 对应关系（标注阶段先行使用，不跑检索）
- 单测：miss/multi-gold/越界 chunk 校验 3 例

### 判定
- recall@5（宏平均）≥ 90% → 检索器无需更换向量（可关 R3 的"上向量"担忧），R3 仅作锦上添花评估
- recall@5（宏平均）< 90% → 触发 R3（jieba），并用于确认是否需要混合检索（超范围，另行登记）

## R1 检索注入收敛（~1 天 + 3 次运行）

### 目的
验证「更少注入」是否能：① 降输入成本；② 不降准确率（甚至提升——少干扰少编造）。

### 参数矩阵（叠加 minRag=1 强制首检，qwen low 档，20 题）
| 组合 | topK | maxContextChars | 说明 |
|---|---|---|---|
| 基线 | 5 | 12000 | 当前配置（已有 P0/P1 数据） |
| A | **3** | 6000 | 收敛版（安全区下限） |
| B | 3 | 12000 | 隔离 topK 影响 |
| C | 5 | 6000 | 隔离注入总量影响（可选，观察成本曲线即可） |

- 判定指标：**成本**（总成本/题均、输入 token/题）与**质量**（**注入覆盖率** = |golden ∩ 实际注入片段| / |golden|——与 K 无关、各组直接可比；不能直接比 recall@K：各组 topK 不同，K 随之变化属循环论证。用 hitrate 对各组 topK 分别计算覆盖率 + 重点题答案核查：S02/S05/S07/S08/F04 编造是否复发）
- 预计：每次 run ~13 分钟；A/B/C 三跑 + 核查 ~2 小时人工

### 实现
- 纯配置（env 已支持 `BENCH_TOP_K` / `BENCH_MAX_CONTEXT_CHARS`），零代码改动——仅新增 `hitrate` 辅助指标后跑矩阵
- ⚠️ 参数语义修正（核实 `runner.ts` / `agent.ts`）：`maxContextChars` 同时作用于两处——① 语料加载时 `clampTexts` 按 chunk 截断（**会改变检索语料本身**）；② BM25 注入时 topK 片段 join 后整体 `slice`（**注入总量上限**，非「单块注入长度」，topK=5 时靠后片段可能被整体截掉）
- 混淆风险评估：实测（2026-09-01）语料最大 chunk ≈ 1.1k 字符——6000/12000 档均不触发 clamp，各组检索语料一致，两参数事实上独立，矩阵解读成立；**语料扩充后若出现 >maxContextChars 的 chunk**，①会使 A/C 组检索语料与基线不同（两参数不再独立），届时需解耦（如新增 `BENCH_CLAMP_CHARS` 固定 12000）或在结论中注明混淆

## R3 中文分词 jieba（触发制，~1 天 + ADR）

### 触发条件
R2 命中率（bigram）< 90% 时实施；≥90% 时暂缓（记录为债务）。

### 实现
- 前置小步（与 jieba 解耦，可先行）：**抽取词表** `bench/src/terms.ts`——`ENTITY_WORDS` 现硬编码于 `grep-retriever.ts`，先迁移至此（grep-retriever 改 import、行为不变，单测回归），一份词表供 grep / P2 专名 boost / R3 jieba 词典三处消费
- 新依赖：`jieba-node`（纯 JS、0 原生依赖、Windows 无编译风险——Concliude 会话检索 ADR 同款判据）；**新依赖引入须先登记 ADR**（`docs/adr/` 下新建，编号待定：理由=中文 BM25 检索质量翻倍、对比 bigram 实测数据、替代方案 trigram 无法覆盖 2 字词）
- `retriever.ts` 分词参数化：`BENCH_TOKENIZER=bigram|jieba`（默认 bigram 保持兼容与可复现）；hitrate 复用同一 env，保证 R2 复测与检索器同分词器
- **索引侧与查询侧强制同一分词器**（调研确认的常见 bug：只索引时分词 → 零匹配；现有 `buildIndex`/`search` 已共用 `tokenize`，参数化时保持此结构即可天然规避）
- **自定义词典**：干员/机制名词表（terms.ts）`jieba.addWord`（词典须在 buildIndex 前加载，见下方经验表 initTokenizer 条目）
- 单测：jieba 分词与 bigram 的 token 集抽样对照、词典词不被切开（如"灰毫""红松林"单 token）
- 验证：`BENCH_TOKENIZER=jieba` 跑 R2 工具得 jieba 版 recall@K，对比 bigram 版 → 落盘差值

### Concliude jieba 经验提炼（避免重复试错）

来源：packages/platform/storage/src/session-search.ts（生产在用，jieba-node ^1.0.1 纯 JS）+ 其会话检索 ADR 实测（jieba 召回 1.00 vs trigram 0.78）。以下经验直接映射到本草案实现：

| Concliude 经验 | 映射到 R3 |
|---|---|
| **API 参数**：jieba.lcut(text, false, true)——第三参 HMM=true 必须开（未登录词/新词发现），否则领域新词切碎 | 索引与查询侧都用 lcut(text, false, true) |
| **标点过滤**：validToken——token 须含字母/数字（/[\p{L}\p{N}]/u），纯标点滤掉（FTS5 中 - 会被解析为 NOT；BM25 虽无语法问题但纯标点 token 无检索价值） | 同款过滤函数放进 retriever.ts（bigram 版已有类似语义：非 CJK/字母数字连续串即跳过，保持统一） |
| **查询宽化回退**：精确切分（lcut）→ 空结果时 lcutForSearch(text, true) 细粒度扩展子词兜底——应对「未登录词边界」：「工具链」被切 [工具,链] 而索引侧粘连导致 AND 漏召回 | BM25 虽为求和打分（天生 OR 语义），但保留**同款降级**：lcut 切分后 topK 全空 → lcutForSearch 宽化重查一次（防「检索空结果→模型编造」的极端场景） |
| **用户词典**：jieba.addWord 补领域词（干员名/机制名）是解决未登录词的正道 | 与 bench/src/terms.ts 干员词典一致；**词典必须在 buildIndex 前加载**（建索引与查询共享同一分词状态），建议 terms.ts 暴露 initTokenizer() 幂等初始化 |
| **纯 JS 已验证**：Windows 无编译风险、词典内置零外部依赖 | 无需再验证环境兼容性（Concliude 生产在用）；package.json 按运行时依赖登记 |
| **性能**：80 会话 → 1477 tokens，索引秒级 | 267 chunks 规模更小，构建与查询分词开销可忽略；注意 BM25 打分器（k1=1.5/b=0.75）**只换 token 层，不改打分** |
| **可复现性**：索引侧稳定（lcut 固定分词） | 保持 BENCH_TOKENIZER 默认 bigram；jieba 切换后运行记录标注分词器版本（meta.json 增 tokenizer 字段） |


## 验收清单

- [x] R2：`gold.json` 20 题标注完成（汇总串逐项展开 + chunk 存在性校验 + 不一致小节名人工映射 + 关键题出处抽查原文复核；映射决策见 `docs/notes-retrieval-tuning.md`）
- [x] R2：`hitrate` 子命令实现 + 单测通过；产出 bigram 版 recall@3/5/10 基线（recall@5 = 33.5% ≪ 90%，R3 形式触发；失败模式分析见实施笔记「意外发现」）
- [ ] R1：A/B/C 三组合运行 + 成本对比表 + 注入覆盖率对照 + 重点题核查（编造未复发）
- [ ] R1：确定 topK/注入总量的推荐平衡点（写入 qwen 笔记）
- [x] R3 前置：`terms.ts` 词表抽取（grep-retriever 迁移，单测回归通过）
- [x] R3（条件触发）：jieba 接入 + ADR 登记 + 词典单测；R2 复测 recall 提升数据（**结论：jieba 全面略降（@5 29.4% vs bigram 33.5%），默认保持 bigram**，数据与归因见 `docs/notes-retrieval-tuning.md` R3 节 / ADR-001 复测结论）
- [x] 结论落盘：`docs/notes-hy3-rag-bench.md` 或新增实施笔记（R2/R3 结论均落 `docs/notes-retrieval-tuning.md`）

## 关联

- R2 先行，gold 标注转录自 `docs/notes-rag-answer-baseline.md`（20 题回答核查基线 v2）——出处为汇总串，需展开 + 逐项校验（见 gold 标注节）
- 上游：`docs/draft-retrieval-experiment.md`（P1 minRag=1 / P2 专名 boost——词表共用）；grep 检索器实现已在 main（`bench/src/grep-retriever.ts`）
- 依据：成本敏感 ROI 调研（Batch/思考预算/缓存为另三条高 ROI 线，本期不做）
- 参考：Concliude 会话检索选型实测（jieba 召回 1.00 vs trigram 0.78）、MTEB BM25 官方数据（0.359→0.641）
