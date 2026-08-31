# rag-test Hy3 查询输出成本基准（草案）

> 创建日期：2026-08-31
> 状态：未定稿草案（架构实施完成；真实探针与全量运行待 API Key，完成后转 plan 定稿）

## 目标

在 rag-test 仓库内搭建一套基准工具（`bench/`），用简化版 LLM Agent（参考 Concliude `conversationLoop` 骨架）对 `arknights-base-vault/docs/**/*.md` 语料做 RAG 查询，测量基于腾讯混元 Hy3（TokenHub API）的 **输出 token 成本**，按 thinking 档位（off / low / high）对比量化。

## 非目标

- 不做检索质量 / 答案质量评估（仅抽样人工抽查）
- 不做与 DeepSeek V4 Flash 等模型的横向对比（问题集与运行工具支持后续扩展，本期不实现）
- 不实现向量检索 / embedding（BM25 关键词检索即可，成本评估不追求检索精度）
- 不接入 Concliude 全量 agent 能力（护栏 / Hook / 遥测 / subagent 全部裁掉）

## 架构分析

- rag-test 现状：纯语料仓库（约 27 篇 Markdown），无检索代码、无问题集、无 git 仓库（本期已 init）。
- Hy3 成本特征：输入 1 元/M、输出 4 元/M、缓存命中 0.25 元/M；默认 `no_think`，`reasoning_effort: low/medium/high` 控制思考深度。思考 token 计入输出——是输出成本最大变量。
- 参照 Concliude：agent loop 核心 = `conversationLoop`（轮次预算 → provider.stream → 工具执行 → 结果回写），成本聚合 = `llm.done` 事件监听 usage。简化版保留循环骨架与 usage→费用映射，裁掉全部安全/遥测层。

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
- [ ] 真实探针：单题 `--thinking off` 校准 usage 字段（需 `TOKENHUB_API_KEY`）
- [ ] 全量 60 次查询 + 报告产出（需 `TOKENHUB_API_KEY`）

## 关联 ADR

- 无（本期无架构级决策；若后续引入向量检索或对比基线再登记）
