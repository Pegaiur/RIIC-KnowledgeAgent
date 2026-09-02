# ADR-001：引入 jieba-node 中文分词优化 BM25 检索

- 日期：2026-09-01
- 状态：已实施

## 背景

R2 命中率评测实测（`docs/archive/plan-retrieval-tuning.md` 实施纪要）：当前 bigram 分词的 BM25 在 20 题 / 121 golden 上 recall@3/5/10 = 21.3% / 33.5% / 50.3%，recall@5 远低于 90% 业界判据（≥90% 则无需更多检索优化），草案 R3 触发条件成立。

bigram 将中文串切成两字词元 + 边界单字，词元碎片化使「词级精确匹配」缺失：查询词与语料的重叠依赖字符巧合而非词语语义。业界数据（MTEB LeCaRDv2 BM25 nDCG 0.359 → 0.641，jieba）与 Concliude 生产实测（jieba 召回 1.00 vs trigram 0.78）均支持分词升级是当前最高 ROI 的检索质量改进。

约束：零编译风险的 Windows 本机环境；基准需可复现（默认行为不能变）；新依赖须轻量。

## 决策

引入 `jieba-node` 作为**可选**中文分词器：`BENCH_TOKENIZER=bigram|jieba`（默认 bigram 保持兼容与可复现）。jieba 模式下：

- 索引侧与查询侧共用同一 `tokenize`（现有 buildIndex/search 结构天然保证）
- `terms.ts` 的 ENTITY_WORDS 注册为 jieba 自定义词典（addWord），防领域词（干员名/机制名）被切碎
- 分词参数 lcut(text, false, true)（HMM 开启），纯标点词元过滤（token 须含字母/数字）
- 查询宽化回退：lcut 后检索空结果 → lcutForSearch 细粒度重查一次（防「检索空→模型编造」极端场景）
- BM25 打分器（k1=1.5/b=0.75）只换 token 层，不改打分

## 理由

- **对症**：R2 失败模式分析显示「实体词表缺失/词级匹配弱」是三类失败之一，jieba + 领域词典直接改善；bigram 的碎片化是词级匹配缺失的根因
- **低成本**：267 chunks 规模下分词开销可忽略；Concliude 生产同款依赖（jieba-node ^1.0.1），API 与坑已验证（HMM 参数、词典先于索引加载、标点过滤）
- **可逆**：默认 bigram 不变，jieba 仅显式开启；复测若无提升可零成本回退

## 备选方案

- 方案 A：trigram 字面切分 — 放弃原因：Concliude 实测召回 0.78 低于 jieba 的 1.00；无法覆盖 2 字中文词的词级语义
- 方案 B：nodejieba（原生绑定）— 放弃原因：需本地编译，Windows 环境编译链风险，违背零编译约束
- 方案 C：维持 bigram — 放弃原因：R2 实测 recall@5 = 33.5%，触发 R3 条件成立，不作为不可知论维持现状
- 方案 D：向量检索 / embedding — 放弃原因：超出 R3 范围（草案非目标）；先验证低成本分词改进的收益上限，不足再另行登记

## 后果

- `package.json` 新增运行时依赖 `jieba-node`（首个 dependencies 项）
- 运行记录需标注分词器版本（meta.json 增 tokenizer 字段），保证跨运行可比
- jieba 词典初始化必须发生在 buildIndex 之前（幂等 initTokenizer）
- 单测守护：词典词（灰毫/红松林类）不被切碎；jieba 与 bigram token 集抽样对照
- **复测结论（2026-09-01）**：jieba recall@3/5/10 = 19.2% / 29.4% / 41.9%，较 bigram（21.3% / 33.5% / 50.3%）全面略降——词级精确匹配丢失 bigram 的字符级部分匹配容错，且「为什么」类疑问词在词级下成为高区分度词元反噬排序（详见 `docs/archive/plan-retrieval-tuning.md`「实施纪要」R3 节）。**默认保持 bigram**；依赖与参数化代码保留，作未来混合分词 / 词典调优的实验基座。

## 关联

- 规划文档：`docs/archive/plan-retrieval-tuning.md`「R3 中文分词 jieba」章节
- 扩展需求：`docs/inbox.md`「检索质量与成本收敛」条目
