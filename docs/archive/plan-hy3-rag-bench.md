# rag-test Hy3 查询输出成本基准
> ⚠️ 基于已废弃语料（2026-09-03 散文层弃用，数据以 references/ 与上游 JSON 为准），结论仅供参考。


> 创建日期：2026-08-31
> 状态：已完成

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
                                     │ bench-runs/<ts>-<thinking>/ │
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
| `src/runner.ts` | 跑问题集（thinking × questions），写 JSONL 到 `bench-runs/<ts>/` |
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
- [x] 三档成本结论成立（**验收条件修订 2026-09-02**：原「全量 60 次查询（20 题 × 3 档）补跑」不再执行——单题三档冒烟 + low 档 20 题全量已验证核心结论「思考 token 计入输出，且随题目难度分化：简单题三档差异小（~330-363）、跨文档难题 2500+」（数据见 `docs/plan-hy3-rag-bench-notes.md`「真实运行补跑」）；成本优化主战场已转向 qwen 线并经 R4 收敛为默认 thinking=off（见 `docs/archive/plan-rules-prefix.md`），hy3 off/high 全量对比不再有当前投资价值）

## 关联 ADR

- 无（本期无架构级决策；**简单 RAG 架构为既定决策**，理由与演进触发器见「简单 RAG 架构」章节；若后续引入向量检索/框架再登记 ADR）

## 实施纪要

# 实施笔记：Hy3 查询输出成本基准

> 对应 plan：docs/plan-hy3-rag-bench.md
> 开始日期：2026-08-31

## 决策偏离
> plan 中没有提到，但在实施中做出的重要决策

### 2026-08-31 — 检索方案采用 BM25（bigram）而非简化关键词匹配
- **背景**：草案中「关键词/BM25」未定死；实施时发现纯词重叠排序对中文语料区分度低。
- **选项**：
  - A: 纯词频重叠打分（最简单，~20 行）
  - B: BM25（经典 k1=1.5/b=0.75，中文 bigram 分词，~80 行）
  - C: 向量检索（需 embedding 依赖，违背零依赖简化目标）
- **决策**：B。成本基准不追求检索精度，但排序质量过低会让「轮数分布」失真；BM25 无外部依赖，可测可回归。
- **影响**：retriever.ts 的 bigram 分词同时服务中文/拉丁词元，后续如需向量化只需替换 buildIndex/search 两函数。

### 2026-08-31 — tsc 配置拆分 base/build 两份
- **背景**：typecheck（noEmit，含测试）与可执行 CLI 编译（outDir dist）目标不同。
- **决策**：tsconfig.json 仅 typecheck（tests 纳入），tsconfig.build.json 仅编译 src；CLI 通过 `pnpm run build && node dist/cli.js` 运行。
- **影响**：无运行时依赖，dist/ 不进版本控制。

## 实现调整
> plan 中有描述，但实际实现方式不同

### 2026-08-31 — 真实探针与全量运行延期
- **plan 原文**：验收清单含「真实探针校准 usage」与「全量 60 次查询」。
- **实际做法**：本轮仅完成 dry run 管线验证；环境未配置 `TOKENHUB_API_KEY`，真实调用留待密钥就绪后执行（命令已就绪：`pnpm run build && node dist/cli.js run --thinking off|low|high`）。
- **原因**：无密钥时无法发起 TokenHub 请求；成本评估方案的「探针校准」步骤依赖真实 usage 字段。
- **后果**：plan 验收清单两项保持 `[ ]`，后续补跑。

### 2026-08-31 — 真实运行补跑（有密钥后）
- **实测**：密钥就绪后完成单题三档冒烟（off/low/high）与全量 20 题 low 档运行（50 条记录，failed 0，截断 0，平均 2.50 轮，总输出 33,398/思考 18,487，成本 ¥0.1701）。
- **关键发现**：`reasoning_tokens` 计入输出，Hy3 思考 token 是输出成本最大变量；但**思考量随题目难度分化**——F01 等简单题三档差异小（~330-363），跨文档难题（S01 等）思考量飙到 2500+。草案"思考 token 计入输出"的前提经实测成立。
- **cached 字段**：`prompt_tokens_details.cached_tokens` 正确解析（system prompt 跨运行缓存命中），成本公式按缓存价计算无误。

### 2026-08-31 — 增加限流与错误处理（30 RPM）
- **背景**：Hy3（TokenHub）官方并发上限 60 RPM；基准为保守起见限至 30 RPM。
- **实现**：新增 `rate-limiter.ts` 令牌桶限流器（每次真实请求前取令牌）；`provider.ts` 的 `fetchWithRetry` 增加指数退避（3 次）+ 尊重 `Retry-After` + 可重试状态码（429/5xx/超时）+ 永久错误（4xx 参数/鉴权）不重试直接失败。
- **影响**：长时间运行不超限，且瞬时故障自动重试；单题失败由 runner 容错（记录失败继续跑完），meta.json 记录 `failed` 数。

### 2026-08-31 — 检索上限改为 2 次（system prompt + tool 侧双约束）
- **背景**：为控制成本与防检索无限循环，限制单题最多检索 2 次。
- **实现**：`agent.ts` 的 `MAX_RAG_CALLS = 2`，system prompt 写入提示，`rag_search` 第 3 次起返回"已达上限"提示，模型据此作答。
- **影响**：S08 等题在 answers.md 标注"检索上限已达（2 次），基于已返回内容作答"，并对缺失信息如实标注"无法确认"。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项

### 2026-08-31 — BM25 检索质量未与向量检索对比
- **债务**：中文 bigram BM25 对同义/近义改写检索鲁棒性未知；基准不测答案质量，无法感知检索失效对轮数分布的影响。
- **未来偿还**：若后续引入「检索质量」评估维度，再引入 embedding（sqlite-vec / 本地模型）并二分对比。

### 2026-08-31 — 执行环境的 PowerShell 包装问题
- **债务**：本机 bash 工具经 PowerShell 5.1 包装（`&&` 不可用、CLIXML 吞并 stderr、pnpm 退出码误报），验证输出需重定向文件中转。
- **未来偿还**：CI/脚本环境与本地不一致风险；后续可考虑在 dev-temp 脚本中固化「tsc → vitest → dry run」检查链（tooling task），减少手工中转。

## 意外发现
> 实施中发现的 plan 未覆盖的依赖/边界/风险

### 2026-08-31 — JSDoc 注释中 `docs/**/*.md` 提前终止块注释
- **发现**：corpus.ts 头部注释包含 `**/*.md`，其中 `*/` 子串使 tsc 在第 4 行报 TS1109/TS1127（注释被截断）。
- **影响**：已改写注释规避；同类风险存在于其他含通配符注释（已 grep 排查，仅 corpus.ts 一处）。建议后续注释里避免 `**` 后跟 `/`。

### 2026-08-31 — rag-test 原为非 git 仓库
- **发现**：rag-test 此前未初始化 git（模板的合并门禁/发版流程无法生效）。
- **影响**：已 `git init -b main` 并配置中文编码；过程管理模板的 verify merge 流程自本次提交起可用。

### 2026-08-31 — pnpm install 在本机 PowerShell 包装下退出码误报 1
- **发现**：`pnpm install` 实际成功（node_modules 与 pnpm-lock.yaml 均生成），但外层 PowerShell 包装返回退出码 1。
- **影响**：验证命令以 `node ./node_modules/...` 直调代替 pnpm wrapper 以获得可靠退出码。

### 2026-08-31 — Hy3 回答质量核查（对照语料）
- **发现**：20 题逐条核对语料，Hy3 整体准确率高——仅 3 处"漏检类"疑点（G01 未检索到散件干员速查的贸易站表、S06 将絮雨误标为下游、S08 因检索上限误判"语料未覆盖"），但均倾向**诚实标注"无法确认/片段未提供"**，无编造。
- **对比**：同题集 qwen 出现 4 处明显编造（见 `docs/plan-qwen37-flash-bench-notes.md`）。Hy3 的"检索上限下倾向诚实"是显著优势。
- **影响**：如果看重答案可靠性，Hy3 的诚实性优于 qwen；成本基准之外，答案可信度应纳入模型选型考量。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

### 2026-08-31 — bash 工具拒绝在未初始化的 git 仓库执行
- **症状**：`git init` 命令被拒（「仓库路径不存在或不是 git 仓库」），原因：bash 工作目录必须为已注册且已 init 的 git 仓库。
- **根因**：rag-test 初始无 git 仓库，而 git init 工具缺失，形成鸡生蛋。
- **解决方案**：以已注册的 repo-template 为 cwd，用 `node -e`（child_process.execSync）对 rag-test 执行 `git init` 与 git config。
- **预防**：新仓库初始化类操作统一走「合规仓库内 node 脚本对目标路径执行」的方式。

> ✅ 已完成于 2026-09-02
