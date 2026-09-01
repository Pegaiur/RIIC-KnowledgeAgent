# rag-test — 项目代理指南

## 项目概述

**rag-test** 是明日方舟基建 RAG 知识库（`arknights-base-vault/`，纯 Markdown 语料）及其基准测试工具集。当前基准目标：基于腾讯混元 Hy3（TokenHub API）的 LLM 查询输出成本测量——参考 Concliude 的 agent loop 骨架实现简化版查询 Agent。

- TypeScript / Node.js · pnpm 单包（ESM，NodeNext）· 仅本机运行
- LLM：腾讯混元 Hy3（腾讯云 TokenHub，OpenAI 兼容端点），输入 1 元/M、输出 4 元/M、缓存命中 0.25 元/M

## 全局规则

以下规则适用于所有子模块，AI 代理在任何地方修改代码时必须遵守。

> 编码核心约束内联于下方（常驻上下文，全仓生效）；其余复杂规则定义在 `docs/rules/` 目录（软件中立权威目录，不依赖任何 IDE/Agent 专属目录），任务开始前按需读取（触发场景见下方规则索引表）。AGENTS.md 仅保留本段编码约束、规则索引和工作流路由。

### 编码核心约束（常驻上下文，全仓生效）

1. **中文注释与提交**：代码注释和提交信息使用中文
2. **密钥与敏感信息**：API Key 优先从仓库根 `secret.yaml` 直读（config.ts 的 `readSecretKey`，该文件 gitignore 不入库），env 变量作兜底；禁止硬编码；日志和输出不得暴露密钥，敏感配置值必须脱敏
3. **错误提示中文**：面向用户的错误消息和日志输出使用中文
4. **无全局副作用**：模块顶层不得执行网络请求、文件写入等运行时副作用
5. **无调试与死代码残留**：提交前清理 `console.log`/`debugger`、注释掉的代码、未使用的 import/变量/函数

| # | 规则 | 详情 |
| - | ---- | ---- |
| 1 | 提交必须通过 `commit-convention` 技能，禁止直接使用 `git commit` | 见下方「工作流路由」 |
| 2 | 分支工作流：禁止直接在主分支提交，走 `feature/<描述>` 分支；合并后删除分支 | — |
| 3 | 合并门槛：合并前一律执行 `node scripts/verify.mjs merge -- --base main`（门禁唯一入口，命令清单见 `scripts/gates.mjs`） | `docs/rules/document-lifecycle.md` |
| 4 | 文档模板：ADR 参照 `docs/templates/adr.md`，plan 参照 `docs/templates/plan.md`，实施笔记参照 `docs/templates/notes.md` | — |

## 工作流路由

> 提交/发版等仓库工作流由 `skills/` 目录下的开放格式技能承载（`skills/<name>/SKILL.md`，不依赖宿主技能发现）；机械事实委托仓库脚本，技能只保留时机、判断与确认。

| 工作流 | 入口 |
| ------- | ---- |
| 提交 | `skills/commit-convention`（禁止直接 `git commit`） |
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
├── arknights-base-vault/           ← RAG 语料（明日方舟基建知识库，纯 Markdown）
│   ├── README.md                   ← 语料边界（docs/** 入库；meta/templates 与 TODO 不入库）
│   └── docs/                       ← 正文语料（0-规则 / 2-体系 / 3-单站组合 / 4-散件工具人 / 5-cli求解器）
├── bench/                          ← 查询输出成本基准（简化版 Agent）
│   ├── src/                        ← provider / retriever / agent / runner / report / cli
│   ├── tests/                      ← vitest 单元测试
│   ├── questions.json              ← 基准问题集（20 题，三分类）
│   └── runs/                       ← 运行结果（JSONL，不入库）
├── scripts/                        ← 过程管理脚本（模板套用，见 scripts/INDEX.md）
├── docs/                           ← 过程管理文档（inbox / plan / draft / adr / archive）
│   ├── inbox.md                    ← 需求唯一入口
│   ├── plan-*.md / draft-*.md      ← 版本计划 / 未定稿提案
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

```bash
pnpm install                        # 安装依赖（含 typescript / vitest）
pnpm run typecheck                  # tsc --noEmit
pnpm run test                       # vitest run
pnpm run bench                      # 干跑基准（--dry，不发真实请求）
node scripts/doc-check.mjs          # 文档一致性校验
node scripts/verify.mjs merge -- --base main   # 合并门禁
```

> 验证命令以 `scripts/gates.mjs` 门禁清单为准。普通代码修改运行 typecheck + test；修改文档/skills 先跑 `node scripts/doc-check.mjs`；合并前一律 `node scripts/verify.mjs merge -- --base main`。

## 文档导航

| 文档 | 用途 |
| ---- | ---- |
| [`docs/inbox.md`](docs/inbox.md) | 待办事项需求唯一入口 |
| [`docs/rules/`](docs/rules/) | 复杂规则权威目录 |
| [`docs/templates/`](docs/templates/) | ADR/plan/notes 机械模板唯一权威目录 |
| [`docs/adr/INDEX.md`](docs/adr/INDEX.md) | ADR 状态索引 |
| [`docs/archive/INDEX.md`](docs/archive/INDEX.md) | 已完成计划归档索引 |
| [`scripts/INDEX.md`](scripts/INDEX.md) | 开发脚本体系导航 |
