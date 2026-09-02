# Qwen3.7-Flash 候选模型接入

> 创建日期：2026-08-31
> 状态：已完成

## 背景

- Hy3（TokenHub）基准确认库已就绪（`docs/plan-hy3-rag-bench.md`，简单 RAG 架构）。
- 扩展候选模型用于**跨模型输出成本对比**。
- 初选 qwen3.5-flash（输出 ¥2/M）→ 最终选定 **qwen3.7-flash**：输出仅 ¥0.8/M（官方控制台定价，见下方接入信息），成本更优且 Agent/工具调用能力更强（function calling ✅）。

## 目标

将 **qwen3.7-flash**（DashScope / 阿里云百炼）接入 `bench/` 作为候选模型，与 Hy3 跑**同问题集、同 thinking 档位**的成本对比；保持简单架构（零框架），Provider 参数化为最小侵入改动。

## 非目标

- 不引入 RAG 框架（LangChain/LlamaIndex 等）；不改变检索、问题集与 Agent 循环骨架
- 不做跨模型答案质量对比（仅成本测量；质量留待人工抽查）

## 接入信息（2026-08-31 官方控制台核实）

| 项 | 值 |
|---|---|
| 端点 | `https://dashscope.aliyuncs.com/compatible-mode/v1`（OpenAI 兼容，chat 路径追加 `/chat/completions`） |
| 模型名 | `qwen3.7-flash` |
| API Key | `DASHSCOPE_API_KEY`（环境变量，本地 `.env` 不入库） |
| 定价（≤32k 阶梯档，元/百万 tokens） | 输入 **0.2** / 输出 **0.8** |
| 缓存命中输入 | **0.04**（隐式缓存，输入价 20%）；显式缓存创建 0.25 / 命中 0.02 |
| Batch（限时 5 折） | 输入 0.1 / 输出 0.4 |
| 计费规则 | 阶梯计费（单次输入超档则全量按高档结算）；思考 token 计入输出；缓存折扣仅作用于输入 |
| 思考模式 | 支持深度思考（qwen3.7 系列）；`enable_thinking` 控制，**默认值待探针确认** |

```
单次费用 = 输入×0.2元/M（缓存命中部分×0.04）+ 输出×0.8元/M
```

## 方案：Provider 参数化（沿用 hy3 草案的简单 RAG 架构）

改动为纯增量参数化，不重构循环/检索/报告主体。共 **7 个源文件 + 2 个测试**，估算 ~150 行：

| 文件 | 改动 |
|---|---|
| `bench/src/types.ts` | `ProviderId = 'hy3' \| 'qwen'`；`CostRecord` 增加 `provider` 字段 |
| `bench/src/config.ts` | `BENCH_PROVIDER`（默认 hy3）；provider 配置表 `{ apiKeyEnv, baseUrl, model, chatPath }`——端点后缀差异（Hy3 `/v1/chat/completions` vs DashScope `/chat/completions`）纳入配置 |
| `bench/src/pricing.ts` | 常量 → 按 provider 价表：`hy3 {1, 4, 0.25}`；`qwen {0.2, 0.8, 0.04}`（缓存=输入×20%） |
| `bench/src/provider.ts` | `callHy3` → `callLLM`：① endpoint 拼接；② thinking 参数分支（Hy3: `reasoning_effort`；Qwen: `enable_thinking`，`off` 必须显式 `false`）；③ env 缺失提示按 provider；④ dry 模式保留 |
| `bench/src/agent.ts` | 透传 provider 到 pricing/成本记录（2 处） |
| `bench/src/runner.ts` / `cli.ts` | `--provider hy3\|qwen`；runDir 命名 `<ts>-<provider>-<thinking>`；meta.json 记录 provider |
| `bench/src/report.ts` | 新增按 provider 分组总览（跨模型对比表） |
| `bench/tests/` | pricing 加 qwen 档用例（0.2/0.8/缓存折扣）；新增 `buildChatBody` 参数映射单测（`enable_thinking`/`reasoning_effort` 分支断言） |

## 执行步骤

1. 实施参数化 → `pnpm run typecheck` / `test` 通过；dry run 双 provider 跑通（不发真实请求）
2. **探针**：`--provider qwen --thinking off --limit 1` 校准——确认 `enable_thinking` 默认值、是否支持 `reasoning_effort` 细档、`prompt_tokens_details.cached_tokens` 字段（不支持则 cached=0 保守计费）
3. 全量：**20 题 × 3 档 × 2 provider = 120 次查询** → byProvider 对比报告
4. 抽样人工抽查（仅记录，不做质量评分）

## 验收清单

- [x] Provider 参数化代码落地：`pnpm run typecheck` / `test` 全通过（21 用例）
- [x] dry run：hy3 与 qwen 双 provider 管线跑通（无真实请求）
- [x] 单题探针：确认 thinking 控制参数与 usage 字段（`enable_thinking` 接受、`reasoning_tokens` 正确解析、`cached_tokens` 缺失→按 0 保守计费）
- [x] 首轮对比：20 题 × low 档 × hy3+qwen 跑通（byProvider 对比报告，跨模型 `compare` 子命令）
- [x] 跨模型成本-质量对比结论成立（**验收条件修订 2026-09-02**：原「全量 120 次查询（20 题 × 3 档 × 2 provider）补跑」不再执行——qwen low/high 因 `enable_thinking` 布尔控制本就等价（见 `docs/plan-qwen37-flash-bench-notes.md`「qwen 的 thinking 档位映射先不细分」），3 档设计对 qwen 实为 2 档；qwen off 档 20 题全量数据已由 R4 off 组提供（¥0.0297，见 `docs/archive/plan-rules-prefix.md`），首轮对比 + 后续 P1-P5 / R1-R4 实验线已充分覆盖跨模型对比）
- [x] 两 plan 结论合并完成（**验收条件修订 2026-09-02**：原「本草案与 hy3 草案合并结论（两草案各自验收完成后）」——合并已通过后续实验线实质完成：检索策略实测 P1-P5、检索收敛 R1-R4 的结论与数据分别落盘于 `docs/archive/` 三份 plan 的实施纪要，qwen 侧「成本-可靠性权衡」与 hy3 侧「Hy3 回答质量核查」互为对照）

## 首轮对比结论（2026-08-31）

同 20 题同 low 档真实运行（均 failed 0、截断 0）：

| 模型 | 调用数 | 平均轮数 | 总输出 | 思考 tokens | 总费用(元) | 输出费用(元) |
|------|--------|----------|--------|-------------|-------------|--------------|
| hy3 | 50 | 2.50 | 33,398 | 18,487 | 0.1701 | 0.1336 |
| qwen | 42 | 2.10 | 31,541 | 17,915 | 0.0325 | 0.0252 |

- **成本**：qwen 输出约为 hy3 的 **1/5**（¥0.0325 vs ¥0.1701），输出单价 4→0.8 元/M 是主因；且平均轮数更少、思考 token 略少。
- **质量权衡（关键发现）**：见 `docs/plan-qwen37-flash-bench-notes.md`「成本-可靠性权衡」——qwen 便宜但检索更少、编造倾向更强；hy3 在检索上限下倾向诚实标注缺失，qwen 倾向跳过检索、凭训练记忆作答，导致 S07/S08/F04 等出现与语料直接冲突的编造。

## 关联

- 基础架构见 [`docs/plan-hy3-rag-bench.md`](plan-hy3-rag-bench.md)「简单 RAG 架构」章节（5 环节图与演进触发器）
- 无 ADR：接入不改变架构决策（Provider 参数化仍在简单架构边界内）；若后续引入向量检索/框架再登记

## 实施纪要

# 实施笔记：Qwen3.7-Flash 候选模型接入

> 对应 plan：docs/plan-qwen37-flash-bench.md
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
- **解决**：config 注册表按 `apiKeyEnv` 声明对应环境变量（hy3→`TOKENHUB_API_KEY`，qwen→`DASHSCOPE_API_KEY`），`loadConfig` 优先直读仓库根 `secret.yaml`（`readSecretKey` 按 secretKey 字段剥离引号解析），env 变量作兜底；密钥不入库（gitignore 已忽略 secret.yaml）。

### 2026-08-31 — 跨模型对比中旧运行无 provider 字段
- **症状**：hy3 早期运行记录无 `provider` 字段，`aggregate` 按 `r.provider` 分组会得到 undefined。
- **解决**：`aggregate` 用 `r.provider ?? r.model` 回退，旧记录以 model（hy3）标识。

## 历史记录归属（2026-09-02 拆分留痕）

- 「检索策略实测记录（P1/P3/hy3 三方对照）」与「双检索器搭配实验（P5：rag+grep 同时暴露 + Agent loop 强制作答轮）」两段已并入 `docs/archive/plan-retrieval-experiment.md`「实施纪要」段。
- 「检索注入收敛实验（R1 topK=3 单组，2026-09-01 03:31 run）」结论已被 `docs/archive/plan-retrieval-tuning.md`「实施纪要」的 R1 2×2 全矩阵复测覆盖（其中 B 组 3/12000 即同口径复测）；该段当时记录的两条债务（meta.json 缺 topK/maxContextChars、answers.md 缺「轮次耗尽未答」占位）已分别由插桩 36270f8 与「末位强制作答轮」改进解决。
- `docs/notes-rag-answer-baseline.md` 头部「依据来源」所引的检索策略实测记录，自本拆分起以上述归档文件为准。

> ✅ 已完成于 2026-09-02
