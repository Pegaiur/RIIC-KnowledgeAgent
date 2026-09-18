# RIIC-KnowledgeAgent — 项目代理指南

## 项目概述

**RIIC-KnowledgeAgent** 是明日方舟基建 RAG 知识库及其基准测试工具集。`knowledge/` 为本地数据层；facts 的唯一上游真源是 arkntools/arknights-toolbox-data 的解包数据，散文包括 lejciy/arknights-base-vault 的总结与本地实践理解，由人类与 Agent 联合审阅，具体分工见 docs/spec/rag-prose-writing.md。当前基准目标：基于 GLM-5.3-Flash 与 Qwen3.7-Flash 的 RAG + facts 查询 Agent 工具链与查询输出成本测量——参考 Concliude 的 agent loop 骨架实现简化版查询 Agent。

- TypeScript / Node.js · pnpm 单包（ESM，NodeNext）· 仅本机运行
- 默认 LLM：GLM-5.3-Flash（智谱 BigModel，OpenAI 兼容端点；默认思考档 low）与 Qwen3.7-Flash（阿里云百炼 DashScope）；单价见 bench/src/pricing.ts；Hy3 已退出，注册表保留以兼容历史运行

## 全局规则

以下规则适用于所有子模块，AI 代理在任何地方修改代码时必须遵守。

> 编码核心约束内联于下方（常驻上下文，全仓生效）；其余复杂规则定义在 `docs/rules/`、长期内容与核查规格定义在 `docs/spec/`（均为软件中立权威目录，不依赖任何 IDE/Agent 专属目录），任务开始前按需读取（触发场景见下方规则索引表与「AI 代理发现流程」）。AGENTS.md 仅保留本段编码约束、规则索引、工作流路由与结构导航。

### 编码核心约束（常驻上下文，全仓生效）

1. **中文语言**：代码注释与提交信息使用中文；面向用户的错误消息和日志输出也使用中文
2. **密钥与敏感信息**：API Key 优先从仓库根 `secret.yaml` 直读（config.ts 的 `readSecretKey`，该文件 gitignore 不入库），env 变量作兜底；禁止硬编码；日志和输出不得暴露密钥，敏感配置值必须脱敏
3. **无全局副作用**：模块顶层不得执行网络请求、文件写入等运行时副作用
4. **无调试与死代码残留**：提交前清理 `console.log`/`debugger`、注释掉的代码、未使用的 import/变量/函数
5. **债务落代码 TODO**：可定位到代码的技术债 / backlog / 延期事项，在对应代码处写 `TODO(tech-debt) <编号>：` 中文注释（说明债务内容与重启条件）；notes / plan 等过程文档只留编号与结论，不重复细节
6. **答错不自动触发修复**：知识库问答的正确率是观测指标，不是默认固定验收值。跑测答错、分数下降或回答不理想，应如实记录结果与证据；不得自行设定达标线、将其升级为开发缺陷或反复修改直到答对。
7. **harness 修改须有独立依据**：仅当证据表明实现违反既定需求或契约时，才按当前任务范围修复（如工具协议、计量或数据读取错误）；模型答错本身不构成依据。以提升回答质量为目的修改提示词、检索、工具策略、预算或 agent loop，须有用户明确授权的优化任务；否则只报告问题与建议。
8. **禁止针对评测题追分**：不得为通过当前题集添加题号、问法或预期答案特判，向运行时注入评测答案，或通过修改评分口径、筛选重跑结果掩盖失败。获授权的质量优化也应采用可泛化方案，并用未参与调优的问题验证；知识库事实修订须依据真源，不能以模型输出或评测分数替代事实证据。
9. **默认禁止新增哈希/指纹字段**：除非用户明确提出，不得新增 sha256 / fingerprint 等哈希字段；留档或溯源改用可读字段或交给版本控制，不引入本项目并不需要的校验复杂度。
10. **TDD 测试先行**：新增功能或调整既有实现时，先补写或修改能表达预期行为的测试并观察其失败，再写/改实现使其通过；不得在实现完成后才补测试。纯文档、无新增可观测行为或已有充分覆盖的情形按 docs/rules/testing.md 的豁免说明处理；提交时变更范围内测试须通过，不提交红灯。

| # | 规则 | 详情 |
| - | ---- | ---- |
| 1 | 提交必须完整执行 `commit-convention` 技能；禁止绕过其检查、审查和精准暂存流程直接提交 | 见下方「工作流路由」 |
| 2 | 分支工作流：禁止直接在主分支提交，走 `feature/<描述>` 分支；合并后删除分支 | — |
| 3 | 合并门槛：合并前一律执行 `node scripts/verify.mjs merge -- --base main`（门禁唯一入口，命令清单见 `scripts/gates.mjs`） | `docs/rules/document-lifecycle.md` |
| 4 | 文档模板：ADR 参照 `docs/templates/adr.md`，plan 参照 `docs/templates/plan.md`，草案参照 `docs/templates/draft.md`，实施笔记参照 `docs/templates/notes.md`，试验参照 `docs/templates/exp.md` | — |
| 5 | 新增、导入、改写或审阅 knowledge/base、knowledge/guides 人工散文前，必须读取并遵循写作与术语两份 spec；类别.md、歧义.md 直出层保留原格式 | `docs/spec/rag-prose-writing.md` + `docs/spec/rag-prose-terminology.md` |
| 6 | 文档引用仓库内其他文档一律写名称（路径/编号），不使用 Markdown 链接；例外为 ADR 索引与归档索引的机械契约表格 | `docs/rules/document-lifecycle.md` |
| 7 | 新增或修改 bench/src、scripts 运行时行为，或新增/修改/删除相关测试时遵循测试约定 | `docs/rules/testing.md` |
| 8 | 添加、导入语料或处理 raw 材料时，必须读取并执行 corpus-addition 技能；普通措辞修订或单独审稿按两份 spec 执行 | `skills/corpus-addition/SKILL.md` |

## 工作流路由

> 提交/发版等仓库工作流由 `skills/` 目录下的开放格式技能承载（`skills/<name>/SKILL.md`，不依赖宿主技能发现）；机械事实委托仓库脚本，技能只保留时机、判断与确认。

脚本与临时产物的落位、tooling 用法和清理约定以 `scripts/INDEX.md` 为准。任务完成、交接或放弃前，主动按该规范处理本轮临时产物的去留。默认搜索遵守 `.gitignore` 并限定相关模块；确需查看忽略区时只指定具体任务目录、运行目录或清单，不进行全仓 `--no-ignore`/`-uuu` 遍历。

| 工作流 | 入口 |
| ------- | ---- |
| 提交 | `skills/commit-convention` |
| 发版 | `skills/release-workflow` + `node scripts/tooling.mjs run release/*` |
| 技术债治理 | `skills/tech-debt-governance` |
| 验证（合并前） | `node scripts/verify.mjs merge`（门禁唯一入口） |
| 文档生命周期 | `docs/rules/document-lifecycle`（ADR/plan/draft/notes/exp 模板见 `docs/templates/`） |
| 添加语料与临时材料清理 | `skills/corpus-addition/SKILL.md`（选材、来源、采用、审阅、验证、清理） |

## 仓库结构

```
RIIC-KnowledgeAgent/
├── AGENTS.md                       ← 本文件（规则索引 + 结构导航 + 工作流路由）
├── package.json                    ← 根包（bench 工具入口，pnpm）
├── tsconfig.json                   ← TypeScript 严格模式（NodeNext/ESM）
├── knowledge/                      ← 明日方舟基建知识库（正式 facts 与人工散文分开维护）
│   ├── AGENTS.md                   ← 查询 Agent 唯一人工指令源（所有检索模式注入）
│   ├── corpus-manifest.json        ← 检索白名单真源（显式登记可检索语料；raw 默认不进入）
│   ├── base/                       ← 机制基线语料（机制-*.md / 基建物流链.md）
│   ├── guides/                     ← 已审定的 RAG 玩家散文（组合 / 新手 / 散件 / 类别 / 歧义）
│   ├── facts/                      ← 规划的正式 facts 输入位置，迁移尚未实施（见 ADR-024）
│   └── raw/                        ← 语料添加临时落点，完成后清理；现有 11 份 facts 输入待迁出
├── bench/                          ← 查询输出成本基准（简化版 Agent）
│   ├── src/                        ← provider / retriever / agent / runner / report / cli
│   ├── tests/                      ← vitest 单元测试
│   └── questions.json              ← 基准问题集（20 题，三分类）
├── bench-runs/                     ← 基准运行结果（JSONL，不入库；dev 中间结果在 dev-temp/runs）
├── scripts/                        ← 过程管理脚本与可复用任务（使用规范见 scripts/INDEX.md）
├── docs/                           ← 过程管理文档（inbox / plan / draft / exp / spec / adr / archive）
│   ├── inbox.md                    ← 需求唯一入口
│   ├── plan-*.md / draft-*.md      ← 版本计划 / 未定稿工程提案
│   ├── exp-*.md / exp/             ← 活动试验记录 / 已结束或已取消的试验记录
│   ├── spec/                       ← 长期内容与核查规格（散文写作、RAG 回答核查等）
│   ├── templates/                  ← ADR/plan/draft/notes/exp 机械模板
│   ├── rules/                      ← 复杂规则权威目录
│   ├── adr/                        ← 架构决策记录（INDEX.md 为状态索引）
│   └── archive/                    ← 已归档计划（INDEX.md）
└── dev-temp/                       ← 开发脚本临时区（不入库）
```

## AI 代理发现流程

1. **首先**：阅读本文件，了解全局规则和项目架构
2. **按需读取规则、规格与技能**：任务涉及文档/ADR/发版/合并 → 读 `docs/rules/document-lifecycle.md`；涉及 bench/src、scripts 运行时行为或测试 → 读 `docs/rules/testing.md`；涉及知识库散文 → 读下一步的写作与术语两份 spec；添加/导入语料或处理 raw 材料 → 同时读 `skills/corpus-addition/SKILL.md`；其余按「全局规则」的规则索引表（第三列）挑选。这些入口均由仓库维护，宿主不自动注入时必须显式读取
3. **新需求入口**：所有新需求/决策从 `docs/inbox.md` 起步，评估后路由到 `docs/plan-*.md`（工程定稿）、`docs/draft-*.md`（未定稿工程提案）、`docs/exp-*.md`（试验）或 `docs/adr/ADR-NNN.md`（架构决策）
4. **确定任务范围**：判断当前任务涉及哪些模块（bench 工具 / 语料 / 过程管理文档）
5. **长期规格**：涉及知识库散文写作/审阅或回答核查时，按下表读取对应 spec（完整正文见 `docs/spec/`；版本与状态由 spec 文内承载）

| Spec | 触发场景 | 版本 | 配套规格与流程 |
| --- | --- | --- | --- |
| `docs/spec/rag-prose-writing.md` | 新增、导入、改写或审阅 knowledge/base、knowledge/guides 人工散文 | v3 | `docs/spec/rag-prose-terminology.md`；添加流程见 `skills/corpus-addition/SKILL.md` |
| `docs/spec/rag-prose-terminology.md` | 同上，规范词、概念边界与练度表达 | v1 | `docs/spec/rag-prose-writing.md` |
| `docs/spec/rag-answer-baseline.md` | 按 20 题核查基线记录与复核回答 | v6 | — |

6. **阅读代码**：参考同模块内其他实现风格

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

> 验证命令以 `scripts/gates.mjs` 门禁清单为准；按变更类型选择：普通代码 typecheck + test，改测试跑全套 `pnpm run test`（定向命令不能替代），改文档/skills 跑 `node scripts/doc-check.mjs`，合并前 `node scripts/verify.mjs merge -- --base main`。

## 文档导航

| 文档 | 用途 |
| ---- | ---- |
| `docs/inbox.md` | 待办事项需求唯一入口 |
| `docs/rules/` | 复杂规则权威目录（触发场景见「全局规则」规则索引表） |
| `docs/spec/` | 长期内容与核查规格（索引见「AI 代理发现流程」；版本与状态由文内承载） |
| `docs/templates/` | ADR/plan/draft/notes/exp 机械模板唯一权威目录 |
| `docs/adr/INDEX.md` | ADR 状态索引 |
| `docs/archive/INDEX.md` | 已完成计划归档索引 |
| `scripts/INDEX.md` | 开发脚本体系导航 |

## 质量基线

> 正式质量基线的唯一记录处，人工指定进入 `bench/results/` 的结果，且至少一份标注为基线；`node dist/cli.js validate` 机械校验「`bench/results/` 内每份结果都已在本表登记」。哈希为结果文件的 SHA-256，供变更核对。各行的适用口径以说明列为准：已登记快照生成于 `references/` 目录、默认全文展开、尚未注入关键词目录时期，只适用于迁移前来源与检索范围，不与迁移后配置作同口径成绩对照。

| 结果（`bench/results/` 下） | SHA-256 | 说明 |
| ---- | ---- | ---- |
| `2026-09-12T15-38-28-892Z-glm-low-default.json` | `0ba20b13d3c6bc9715afa971cf706e6cfa919148b9e0256323943e12747c0825` | **正式质量基线**（适用迁移前来源与检索范围）：GLM-5.3-Flash low / hybrid / 20 题；spec v4 核查满足 63、遗漏 9、冲突 0、待核验 0，「完整且有据」9/20 |
| `2026-09-13T01-14-52-980Z-qwen-off-t0.json` | `264a6d2c1c4583ec1d4658e0fff1e348adb256daaa1ccea1f67417004c378aa3` | **qwen 侧对照基线**（适用迁移前来源与检索范围）：qwen3.7-flash off t0 / hybrid / 20 题（schema v12，47 记录，¥0.0478，0 失败）；与 glm-low 正式基线同题集、同检索配置的跨 provider 对照样本 |
