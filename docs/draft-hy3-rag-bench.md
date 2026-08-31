# rag-test Hy3 查询输出成本基准（草案）

> 创建日期：2026-08-31
> 状态：未定稿草案（架构实施完成；真实探针与全量运行待 API Key，完成后转 plan 定稿）

## 目标

在 rag-test 仓库内搭建一套基准工具（`bench/`），用简化版 LLM Agent（参考 Concliude `conversationLoop` 骨架）对 `arknights-base-vault/docs/**/*.md` 语料做 RAG 查询，测量基于腾讯混元 Hy3（TokenHub API）的 **输出 token 成本**，按 thinking 档位（off / low / high）对比量化。

## 非目标

- 不做检索质量 / 答案质量评估（仅抽样人工抽查）
- 不做与 DeepSeek V4 Flash 等模型的横向对比（问题集与运行工具支持后续扩展，本期不实现）
- 不实现向量检索 / embedding（BM25 关键词检索即可，成本评估不追求检索精度）
- 不引入 RAG 框架（LangChain / LlamaIndex 等）：当前规模（24 篇语料、单模型、成本基准）下框架是纯负担，保持零运行时依赖；升级触发条件见「简单 RAG 架构」章节
- 不接入 Concliude 全量 agent 能力（护栏 / Hook / 遥测 / subagent 全部裁掉）

## 架构分析

- rag-test 现状：纯语料仓库（24 篇 Markdown），无检索代码、无问题集、无 git 仓库（本期已 init）。
- Hy3 成本特征：输入 1 元/M、输出 4 元/M、缓存命中 0.25 元/M；默认 `no_think`，`reasoning_effort: low/medium/high` 控制思考深度。思考 token 计入输出——是输出成本最大变量。
- 参照 Concliude：agent loop 核心 = `conversationLoop`（轮次预算 → provider.stream → 工具执行 → 结果回写），成本聚合 = `llm.done` 事件监听 usage。简化版保留循环骨架与 usage→费用映射，裁掉全部安全/遥测层。

## 简单 RAG 架构

本基准采用**手写的最小 RAG 管线**（零运行时依赖，无框架）。架构共 5 个环节，全部在 `bench/` 内实现：

```
┌─────────────┐ 离线构建（每次运行重建，~秒级）      ┌──────────────┐
│ 语料层       │                                    │ 检索层        │
│ arknights-  │──► corpus.ts ─── ► 分块(≈200) ──► retriever.ts │
│ base-vault/ │    collectMarkdownFiles  splitChunks  buildIndex(BM25)
│ docs/*.md   │    24 个文件            按 ## 标题     中文 bigram 分词
└─────────────┘                                    └──────┬───────┘
                                                        │ top-k 片段
                                                        │ (默认 5, ≤12K 字符)
┌────────────────────────────────────────────────────────▼───────────────────────┐
│                         查询 Agent 循环（agent.ts，参照 Concliude 骨架）          │
│   messages = [system, user]                                                    │
│   for round in 1..maxRounds(默认 3):                                           │
│     resp = hy3Chat(messages, tools=[rag_search])        ← provider.ts        │
│     │  ├─ 记录成本 {round,input,output,cached,costIn,costOut} ← pricing.ts   │
│     │  └─ 有 tool_calls → 执行 rag_search → 片段回写 messages → continue      │
│     │     无 tool_calls → finalAnswer → break                                  │
│   逐轮精确记账：思考 token、工具调用参数均计入 output                            │
└──────────────────────────────────────────────────┬────────────────────────────┘
                                                    │ 每次 LLM 调用 → 1 条 JSONL
                                     ┌─────────────▼──────────────┐
                                     │ 成本记录 runner.ts          │
                                     │ bench/runs/<ts>-<thinking>/ │
                                     │   records.jsonl + meta.json │
                                     └─────────────┬──────────────┘
                                                   │
                                     ┌─────────────▼──────────────┐
                                     │ 报告聚合 report.ts          │
                                     │ Markdown + CSV：每查询输出  │
                                     │ 分布 / P95 / 分档汇总       │
                                     └────────────────────────────┘
```

### 环节职责与关键参数

| 环节 | 模块 | 职责 | 关键参数 |
|------|------|------|----------|
| ① 语料加载 | `corpus.ts` | 递归收集 `docs/**/*.md`，按 `##`/`###` 标题分块，过滤 front matter 与模板注释；超长块首尾截断 | `CORPUS_DIR`（默认 `arknights-base-vault/docs`） |
| ② 检索索引 | `retriever.ts` | 中文 bigram + 拉丁词元分词，BM25 打分（k1=1.5, b=0.75），top-k 片段 | `BENCH_TOP_K`（默认 5）、`BENCH_MAX_CONTEXT_CHARS`（12000） |
| ③ LLM 调用 | `provider.ts` | TokenHub OpenAI 兼容端点（`model=hy3`），parse usage（prompt/completion/cached）；dry 模式确定值模拟 | `TOKENHUB_API_KEY`（必填，非 dry）、`HY3_MODEL`、`HY3_MAX_TOKENS=4096` |
| ④ Agent 循环 | `agent.ts` | 轮次预算循环 + 单工具 `rag_search(query)` + 结果回写 messages；逐轮记成本 | `BENCH_MAX_ROUNDS`（默认 3） |
| ⑤ 成本计量 | `pricing.ts` | 输入 1 / 输出 4 / 缓存 0.25 元每百万；cached clamp 防御；round6 取整 | 单价常量（官方定价） |

### 架构边界（为什么它可以"简单"）

- **检索精度不设门槛**：基准目标=成本，BM25 的排序质量不会改变"输出 token 量级"的结论；若未来要测检索质量，先加 embedding，不换框架。
- **单模型单工具**：Hy3 是唯一 LLM，`rag_search` 是唯一工具——不需要模型抽象层与工具注册表。
- **成本记账是内建职责**：`usage`（含思考 token、缓存命中、截断标记）在每次调用的返回路径上直接落 JSONL，不经事件总线/回调，路径最短、最可复现。
- **dry 模式**：无密钥也能回归验证管线（假 usage 确定性返回），保证基准的可复现性。

### 升级触发条件（来自框架评估，2026-08-31）

| 信号出现时 | 动作 |
|---|---|
| BM25 检索质量成为瓶颈（同义/近义改写查不到） | 加 embedding（本地模型或混元 embedding API）+ 简单余弦扫描，仍不引入框架 |
| 语料扩到 500+ 篇且多格式（PDF/网页） | 评估 `@llamaindex/core`（只取 core）或 Python 侧 LlamaIndex |
| 多模型矩阵 + 统一调用层 | 优先评估 Vercel AI SDK / Mastra 类轻量层，而非 LangChain |
| 生产化（并发服务、多用户、可观测性） | 才考虑 LangGraph 级编排 / LangSmith 类平台 |

## 实施方案

### 模块划分（bench/，TypeScript + pnpm，ESM/NodeNext）

| 文件 | 职责 |
|------|------|
| `src/types.ts` | 成本记录、查询、思考档位、usage 类型定义 |
| `src/pricing.ts` | Hy3 单价常量与费用计算（输入 1/输出 4/缓存 0.25 元每 M） |
| `src/config.ts` | 环境变量读取（`TOKENHUB_API_KEY`、`BASE_URL`、`MODEL`，默认值兜底） |
| `src/corpus.ts` | 加载语料（`arknights-base-vault/docs/**/*.md`）并按 `##`/`###` 标题分块 |
| `src/retriever.ts` | 中文 bigram 分词 + BM25 检索，top-k 片段注入 |
| `src/provider.ts` | TokenHub OpenAI 兼容端点调用（fetch），解析 usage，dry 模式模拟返回 |
| `src/agent.ts` | 简化循环：maxRounds=3，单工具 `rag_search(query)`，逐轮记录成本 |
| `src/runner.ts` | 跑问题集（thinking × questions），写 JSONL 到 `bench/runs/<ts>/` |
| `src/report.ts` | JSONL 聚合 → Markdown 报告 + CSV（每查询输出分布、单查成本、轮数、分档汇总） |
| `src/cli.ts` | CLI 入口：`run`（实跑/--dry）/ `report` |
| `tests/*.test.ts` | vitest：retriever 排序、pricing 计算、corpus 分块、report 聚合 |
| `questions.json` | 20 题（单文档事实 / 跨文档论证 / 散件速查 三分类） |

### 关键设计点

- **Provider 参数**：`model=hy3`；thinking off → 不传；low/high → `reasoning_effort` 对应档 + `thinking.enabled`；`max_tokens=4096`，记录 `truncated` 标记。
- **成本公式**：`costOut = completion_tokens × 4/1e6`；`costIn = (prompt − cached) × 1/1e6 + cached × 0.25/1e6`。字段以 TokenHub 实际 usage 为准（首跑探针校准后固化）。
- **结果记录**：每次 LLM 调用一条 JSONL `{ queryId, round, thinking, input, output, cached, costIn, costOut, model, truncated }`。
- **Dry 模式**：不发真实请求，用确定性假 usage 走通整条管线（验证用）。
- **密钥**：`TOKENHUB_API_KEY` 环境变量 / `.env`，不入库。

### 执行步骤

1. 搭建 `bench/` 源码与问题集 → `pnpm install` → `pnpm run typecheck` / `test` 通过
2. 单题探针（`--thinking off --limit 1`）校准 usage 字段与成本公式
3. 全量跑：20 题 × 3 档 = 60 次查询 → 聚合报告
4. 抽样 5 题人工抽查答案（仅记录，不作质量评分）

## 验收清单

- [x] 过程管理模板套用（AGENTS.md / gates.mjs / inbox / docs 生命周期）
- [x] `bench/` 架构源码落地（类型检查通过）
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过（retriever / pricing / corpus / report）
- [x] `pnpm run bench --dry` 干跑管线无真实请求
- [x] 真实探针：单题 `--thinking off/low/high` 校准 usage 字段（含 `reasoning_tokens` / `cached_tokens`）
- [x] 全量 20 题 × low 档运行 + 报告产出（failed 0、截断 0）
- [ ] 全量 60 次查询（20 题 × 3 档）补跑（已完成 low 档，off/high 待补）

## 关联 ADR

- 无（本期无架构级决策；**简单 RAG 架构为既定决策**，理由与演进触发器见「简单 RAG 架构」章节；若后续引入向量检索/框架再登记 ADR）
