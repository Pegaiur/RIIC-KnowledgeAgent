# facts 跨引用导航备注 S07 复现核查

> 创建日期：2026-09-11
> 状态：已结束
> 结束日期：2026-09-11
> 需求入口：docs/inbox.md

## 过程

### 目的与范围

在 plan-facts-crossref-navigation 落地 operator notes 后，对其动机案例 S07（红松骑士团组）做回归式复现：用真实 GLM-5.3-Flash low 单题跑 3 次，观察新增备注是否送达、模型是否跟进、S07.2（薇薇安娜精二按每名制造站骑士干员 +7%）是否仍遗漏。只观测与记录，不修改知识库、规格、提示词、检索、预算或 agent loop，不因答错重跑，不设达标线。本项是动机案例回归，不是留出集验证，也不与其它组合的泛化结论挂钩。

### 固定条件

命令：`node dist/cli.js run --provider glm --thinking low --questions dev-temp/s07-questions.json --out dev-temp/runs/s07-repro`，连续执行 3 次。临时问题集仅含 S07 一题（id/category/question 取自 bench/questions.json）；因带 `--questions`，运行不触发基准完整性校验。运行参数：retriever=hybrid、tokenizer=bigram、topK=5、maxContextChars=12000、toolBudget=5、toolAttemptLimit=10、sessionTimeoutMs=300000、maxTokens=4096、temperature 服务端默认、未调用工具回馈开。基线取 2026-09-11 该 20 题 hybrid 运行（bench-runs/2026-09-11T03-07-08-197Z-glm-low-default）中的 S07，同一配置、备注修复前。

### 执行

运行于 2026-09-11 北京时间约 15:18:35、15:19:05、15:19:30，每次 1 会话，全部完成、无缺测。临时原件目录 `dev-temp/runs/s07-repro/`（三次运行各含 answers.md、trace.jsonl、injected.json、records.jsonl、meta.json、inputs.json）；临时问题集 `dev-temp/s07-questions.json`。均为未入库的临时产物。

## 结果

### 协议与用量

3 次均 status=completed、终止原因 answer；0 失败、0 截断、0 重试。模型轮数 4/3/3，工具调用各 3 次。费用 ¥0.006192 + ¥0.005969 + ¥0.005358 = **¥0.017519**，费用完整。耗时 30.0s / 24.2s / 28.8s。

### 送达与跟进

| 次序 | 起始（北京时间） | 轮数 | 工具序列 | 备注送达 | 追问薇薇安娜 | S07.2 |
|---|---|---|---|---|---|---|
| 1 | 15:18:35 | 4 | rag_search → read_section → facts_search("薇薇安娜") | 否（未查阵营词） | 是 | 覆盖 |
| 2 | 15:19:05 | 3 | facts_search("红松骑士团") + rag_search → facts_search("薇薇安娜") | 是 | 是 | 覆盖 |
| 3 | 15:19:30 | 3 | rag_search + facts_search("红松骑士团") → facts_search("薇薇安娜") | 是 | 是 | 覆盖 |

- **修复前基线**：S07 只发 `rag_search` 与 `facts_search("红松骑士团")` 后直接作答，未追问薇薇安娜，其技能证据未送达，S07.2 记为遗漏。
- **修复后**：3/3 均出现 `facts_search("薇薇安娜")`。run2、run3 先查阵营词「红松骑士团」，返回的 焰尾 卡携带新备注原文（trace 结果文本可命中 `本卡属「红松骑士团组」`），随后追问薇薇安娜并得到「烛骑士微光」+7%。run1 未查阵营词，而是经 `read_section`（制造站组合 > 经验组合 > 红松骑士团组）到达，该指南小节本身已列薇薇安娜。
- 3/3 回答均覆盖 S07.1 与 S07.2：焰尾（红松骑士团，+10%/−10%）与薇薇安娜（骑士，+7%）分列，并说明两者计数口径不同；制造候选列灰毫/远牙/野鬃。run1 用「制造侧门槛」表述“至少两名”，措辞与 S07.3「至少两名是 guide 推荐而非统一最低触发人数」的口径略有模糊，未单独判定。

### 局限

- 动机案例（S07 正是设计该批备注所依据的案例），非留出集；不能用于宣称跨组合泛化。
- 修复前基线仅 1 次（n=1），修复后 3 次；模型具随机性，1 与 3 的差异不足以做统计归因。
- run1 表明既有指南小节也能把模型导向薇薇安娜，备注不是唯一通道，更像提高稳定性。
- 结论未经独立复核；仅单模型（GLM-5.3-Flash low）、单配置。

## 结论

在本轮条件下 S07.2 未被复现：3/3 覆盖，且 3/3 出现对薇薇安娜的主动追问；新增备注在 2/3 运行中实际送达，与随后的追问链路一致。修复前基线的单次遗漏与之形成对照，但样本极小且非受控，**不支持“备注为唯一原因”或跨组合泛化的结论**。

本试验未修改任何运行时输入，未因答错重跑，未启用优化。临时原件目录 `dev-temp/runs/s07-repro/` 与临时问题集 `dev-temp/s07-questions.json` 保留在本机（未入库），如需收尾清理可直接删除，删除后不承诺完整重放。
