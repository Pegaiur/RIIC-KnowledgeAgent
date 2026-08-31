# Qwen3.7-Flash 候选模型接入草案

> 创建日期：2026-08-31
> 状态：未定稿草案（独立于 hy3 基准确认；接入实施后合并结论至主草案/转 plan）

## 背景

- Hy3（TokenHub）基准确认库已就绪（`docs/draft-hy3-rag-bench.md`，简单 RAG 架构）。
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
- [ ] 全量 120 次查询（20 题 × 3 档 × 2 provider）补跑
- [ ] 本草案与 hy3 草案合并结论（两草案各自验收完成后）

## 首轮对比结论（2026-08-31）

同 20 题同 low 档真实运行（均 failed 0、截断 0）：

| 模型 | 调用数 | 平均轮数 | 总输出 | 思考 tokens | 总费用(元) | 输出费用(元) |
|------|--------|----------|--------|-------------|-------------|--------------|
| hy3 | 50 | 2.50 | 33,398 | 18,487 | 0.1701 | 0.1336 |
| qwen | 42 | 2.10 | 31,541 | 17,915 | 0.0325 | 0.0252 |

- **成本**：qwen 输出约为 hy3 的 **1/5**（¥0.0325 vs ¥0.1701），输出单价 4→0.8 元/M 是主因；且平均轮数更少、思考 token 略少。
- **质量权衡（关键发现）**：见 `notes-qwen37-flash-bench.md`「成本-可靠性权衡」——qwen 便宜但检索更少、编造倾向更强；hy3 在检索上限下倾向诚实标注缺失，qwen 倾向跳过检索、凭训练记忆作答，导致 S07/S08/F04 等出现与语料直接冲突的编造。

## 关联

- 基础架构见 [`docs/draft-hy3-rag-bench.md`](draft-hy3-rag-bench.md)「简单 RAG 架构」章节（5 环节图与演进触发器）
- 无 ADR：接入不改变架构决策（Provider 参数化仍在简单架构边界内）；若后续引入向量检索/框架再登记
