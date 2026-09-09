# rag-test — 项目代理指南

## 项目概述

**rag-test** 是明日方舟基建 RAG 知识库（`knowledge/`，数据层为唯一真源）及其基准测试工具集。当前基准目标：基于 Qwen3.7-Flash（阿里云百炼 DashScope）的 RAG + facts 查询 Agent 工具链与查询输出成本测量——参考 Concliude 的 agent loop 骨架实现简化版查询 Agent；默认使用 Qwen 关闭思考，Hy3 保留为对照 provider。

- TypeScript / Node.js · pnpm 单包（ESM，NodeNext）· 仅本机运行
- 默认 LLM：Qwen3.7-Flash（阿里云百炼 DashScope，OpenAI 兼容端点），输入 0.2 元/M、输出 0.8 元/M、缓存命中 0.04 元/M；Hy3（TokenHub）保留为对照 provider

## 全局规则

以下规则适用于所有子模块，AI 代理在任何地方修改代码时必须遵守。

> 编码核心约束内联于下方（常驻上下文，全仓生效）；其余复杂规则定义在 `docs/rules/` 目录（软件中立权威目录，不依赖任何 IDE/Agent 专属目录），任务开始前按需读取（触发场景见下方规则索引表）。AGENTS.md 仅保留本段编码约束、规则索引和工作流路由。

### 编码核心约束（常驻上下文，全仓生效）

1. **中文注释与提交**：代码注释和提交信息使用中文
2. **密钥与敏感信息**：API Key 优先从仓库根 `secret.yaml` 直读（config.ts 的 `readSecretKey`，该文件 gitignore 不入库），env 变量作兜底；禁止硬编码；日志和输出不得暴露密钥，敏感配置值必须脱敏
3. **错误提示中文**：面向用户的错误消息和日志输出使用中文
4. **无全局副作用**：模块顶层不得执行网络请求、文件写入等运行时副作用
5. **无调试与死代码残留**：提交前清理 `console.log`/`debugger`、注释掉的代码、未使用的 import/变量/函数
6. **债务落代码 TODO**：可定位到代码的技术债 / backlog / 延期事项，在对应代码处写 `TODO(tech-debt) <编号>：` 中文注释（说明债务内容与重启条件）；notes / plan 等过程文档只留编号与结论，不重复细节
7. **答错不自动触发修复**：知识库问答的正确率是观测指标，不是默认固定验收值。跑测答错、分数下降或回答不理想，应如实记录结果与证据；不得自行设定达标线、将其升级为开发缺陷或反复修改直到答对。
8. **harness 修改须有独立依据**：仅当证据表明实现违反既定需求或契约时，才按当前任务范围修复（如工具协议、计量或数据读取错误）；模型答错本身不构成依据。以提升回答质量为目的修改提示词、检索、工具策略、预算或 agent loop，须有用户明确授权的优化任务；否则只报告问题与建议。
9. **禁止针对评测题追分**：不得为通过当前题集添加题号、问法或预期答案特判，向运行时注入评测答案，或通过修改评分口径、筛选重跑结果掩盖失败。获授权的质量优化也应采用可泛化方案，并用未参与调优的问题验证；知识库事实修订须依据真源，不能以模型输出或评测分数替代事实证据。

| # | 规则 | 详情 |
| - | ---- | ---- |
| 1 | 提交必须完整执行 `commit-convention` 技能；禁止绕过其检查、审查和精准暂存流程直接提交 | 见下方「工作流路由」 |
| 2 | 分支工作流：禁止直接在主分支提交，走 `feature/<描述>` 分支；合并后删除分支 | — |
| 3 | 合并门槛：合并前一律执行 `node scripts/verify.mjs merge -- --base main`（门禁唯一入口，命令清单见 `scripts/gates.mjs`） | `docs/rules/document-lifecycle.md` |
| 4 | 文档模板：ADR 参照 `docs/templates/adr.md`，plan 参照 `docs/templates/plan.md`，实施笔记参照 `docs/templates/notes.md` | — |
| 5 | RAG 散文清洗统一使用玩家侧规范词；references 直出层保留原格式 | `docs/rules/rag-prose-terminology.md` |

## 工作流路由

> 提交/发版等仓库工作流由 `skills/` 目录下的开放格式技能承载（`skills/<name>/SKILL.md`，不依赖宿主技能发现）；机械事实委托仓库脚本，技能只保留时机、判断与确认。

脚本与临时产物的落位、tooling 用法和清理约定以 [`scripts/INDEX.md`](scripts/INDEX.md) 为准。任务完成、交接或放弃前，主动按该规范处理本轮临时产物的去留。默认搜索遵守 `.gitignore` 并限定相关模块；确需查看忽略区时只指定具体任务目录、运行目录或清单，不进行全仓 `--no-ignore`/`-uuu` 遍历。

| 工作流 | 入口 |
| ------- | ---- |
| 提交 | `skills/commit-convention` |
| 发版 | `skills/release-workflow` + `node scripts/tooling.mjs run release/*` |
| 技术债治理 | `skills/tech-debt-governance` |
| 验证（合并前） | `node scripts/verify.mjs merge`（门禁唯一入口） |
| 文档生命周期 | `docs/rules/document-lifecycle`（ADR/plan/notes 模板见 `docs/templates/`） |

## 仓库结构

```
rag-test/
├── AGENTS.md                       ← 本文件（规则索引 + 结构导航 + 工作流路由）
├── package.json                    ← 根包（bench 工具入口，pnpm）
├── tsconfig.json                   ← TypeScript 严格模式（NodeNext/ESM）
├── knowledge/                      ← 明日方舟基建知识库（references 为机械事实真源；base/guides 为人工维护语料）
│   ├── AGENTS.md                   ← 查询 Agent 唯一人工指令源（所有检索模式注入）
│   ├── corpus-manifest.json        ← 检索白名单真源（显式登记可检索语料；raw 默认不进入）
│   ├── references/                 ← 数据层（解包直出：名册 / 技能分片×9 / 类别·技能等价组·歧义 / 数据源）
│   ├── base/                       ← 机制基线语料（机制-*.md / 基建物流链.md）
│   ├── guides/                     ← 已审定的 RAG 玩家散文（组合 / 新手 / 散件）
│   └── raw/                        ← 待进一步核验与拆分的原始语料（默认不进入检索白名单）
├── bench/                          ← 查询输出成本基准（简化版 Agent）
│   ├── src/                        ← provider / retriever / agent / runner / report / cli
│   ├── tests/                      ← vitest 单元测试
│   └── questions.json              ← 基准问题集（20 题，三分类）
├── bench-runs/                     ← 基准运行结果（JSONL，不入库；dev 中间结果在 dev-temp/runs）
├── scripts/                        ← 过程管理脚本与可复用任务（使用规范见 scripts/INDEX.md）
├── docs/                           ← 过程管理文档（inbox / plan / draft / spec / reports / adr / archive）
│   ├── inbox.md                    ← 需求唯一入口
│   ├── plan-*.md / draft-*.md      ← 版本计划 / 未定稿提案
│   ├── spec/                       ← 评测/核查规格（长期复用资产，如 RAG 20 题回答核查基线）
│   ├── templates/                  ← ADR/plan/notes 机械模板
│   ├── rules/                      ← 复杂规则权威目录
│   ├── adr/                        ← 架构决策记录（INDEX.md 为状态索引）
│   └── archive/                    ← 已归档计划（INDEX.md 按完成日期降序）
└── dev-temp/                       ← 开发脚本临时区（不入库）
```

## AI 代理发现流程

1. **首先**：阅读本文件，了解全局规则和项目架构
2. **按需读取复杂规则**：任务涉及文档/ADR/发版/合并 → 读 `docs/rules/document-lifecycle.md`；其余场景按规则索引表从 `docs/rules/` 挑选匹配描述
3. **新需求入口**：所有新需求/决策从 `docs/inbox.md` 起步，评估后路由到 `docs/plan-*.md`（定稿）或 `docs/adr/ADR-NNN.md`（架构决策）
4. **确定任务范围**：判断当前任务涉及哪些模块（bench 工具 / 语料 / 过程管理文档）
5. **阅读代码**：参考同模块内其他实现风格

## 版本管理

- 根版本号由 Conventional Commits 驱动自动推算（`node scripts/tooling.mjs run release/calculate-version` 或 `release/check`）；版本文件为 `package.json`。

## Git 环境

首次 git 操作前执行以下配置（仓库约定，不依赖用户级规则）：

- 必选：`git config i18n.commitEncoding utf-8`、`git config i18n.logOutputEncoding utf-8`、`git config core.quotepath false`（保证中文提交/日志/路径显示正确）
- 可选：`git config --global core.pager cat`

## 运行与验证

本地依赖工具（如 Vitest、TypeScript）统一通过 `package.json` 定义的 `pnpm run <脚本名>` 调用；终端命令、文档示例和自动化脚本均遵守此约定，不直接运行 `vitest` / `tsc`，也不使用 `pnpm exec` 或 `npx` 代替。`package.json` 的 scripts 内直接写工具名，由 `pnpm run` 提供本地 `.bin` 路径。新增工具调用先复用已有 script；确有新用途时再添加命名明确的 script。

当前 Windows 环境曾出现 `PATH` / `Path` 重复，导致 `pnpm exec` 启动子进程时丢失本地 `.bin` 路径；不能仅凭命令未找到就判定依赖未安装。依赖安装仍用 `pnpm install`，仓库自有脚本仍按既有 `node scripts/...` 入口执行。

```bash
pnpm install                        # 安装依赖（含 typescript / vitest）
pnpm run typecheck                  # tsc --noEmit
pnpm run test                       # vitest run
pnpm run test -- scripts/tooling.test.mjs   # 定向测试，参数透传给已有 test 脚本
pnpm run bench:dry                  # 构建后干跑基准（--dry，不发真实请求）
node scripts/doc-check.mjs          # 文档一致性校验
node scripts/verify.mjs merge -- --base main   # 合并门禁
```

> 验证命令以 `scripts/gates.mjs` 门禁清单为准。普通代码修改运行 typecheck + test；修改文档/skills 先跑 `node scripts/doc-check.mjs`；合并前一律 `node scripts/verify.mjs merge -- --base main`。

## 文档导航

| 文档 | 用途 |
| ---- | ---- |
| [`docs/inbox.md`](docs/inbox.md) | 待办事项需求唯一入口 |
| [`docs/spec/rag-answer-baseline.md`](docs/spec/rag-answer-baseline.md) | 评测/核查规格（版本与状态由 spec 自身承载，长期复用资产） |
| [`docs/reports/draft-answer-baseline-v4.md`](docs/reports/draft-answer-baseline-v4.md) | 按 spec v4 的核查草案（已完成全量复核，待独立审定） |
| [`docs/draft-harness-performance.md`](docs/draft-harness-performance.md) | 活跃草案：性能基线与待定优化候选 |
| [`docs/rules/`](docs/rules/) | 复杂规则权威目录 |
| [`docs/templates/`](docs/templates/) | ADR/plan/notes 机械模板唯一权威目录 |
| [`docs/adr/INDEX.md`](docs/adr/INDEX.md) | ADR 状态索引 |
| [`docs/archive/INDEX.md`](docs/archive/INDEX.md) | 已完成计划归档索引 |
| [`scripts/INDEX.md`](scripts/INDEX.md) | 开发脚本体系导航 |
