# scripts 体系导航

> 本文件是 scripts 体系的唯一使用入口：任务目录、lib 基元、临时路径边界、清理约定、tooling 用法。
> 写 task 或临时脚本前先查 lib 模块表，能力已存在则直接 import，不要重复实现。

## 目录职责

| 路径 | 职责 | 入版本控制 |
|------|------|:---:|
| `scripts/tooling.mjs` | 开发任务工具 CLI（list/run/tmp/显式清理清单） | ✅ |
| `scripts/verify.mjs` | 合并/发版门禁唯一入口（执行引擎，命令清单见 gates.mjs） | ✅ |
| `scripts/gates.mjs` | 门禁命令清单（适配层：换技术栈唯一必改文件） | ✅ |
| `scripts/doc-check.mjs` | 文档一致性校验（合并门禁组成部分） | ✅ |
| `scripts/prose-terms-check.mjs` | RAG 玩家侧散文统一术语检查（扫描 base/guides） | ✅ |
| `scripts/lib/` | 共享基元（单一职责、只读边界显式、接受注入依赖便于测试） | ✅ |
| `scripts/tasks/` | 可复用开发任务（目录发现即注册，无 manifest） | ✅ |

## 脚本落位与复用

- **tasks**：可复用开发任务直接创建在 `scripts/tasks/<domain>/<name>.mjs`，目录发现即注册；临时脚本需要正式化时作为普通代码变更移入此处，人工修正相对导入并做匹配验证。
- **work**：一次性脚本、输入、输出和需交接的产物共置于 `dev-temp/work/<任务>/`；不强制再分 scripts/results 子目录。只做一次的计算、查询和评估优先直接终端输出。
- **lib**：基础逻辑出现**两个真实消费者**时下沉 lib——没有消费者的能力不进 lib（防过度抽象）。
- tasks 的注册事实就是目录本身，不维护第二份 manifest；构建清单（package.json 等）不承担任务注册表职责。

## lib 模块表

| 模块 | 核心导出 | 用途 | 现有消费者 |
|------|----------|------|-----------|
| repo-context | resolveRepoRoot / isPathInside / tasksRoot | 仓库根定位（向上找标志文件，默认 .git）、路径内收 | 全部脚本 |
| process | runCapture / runStreaming / resolveCommandPrefix | 子进程执行（参数数组 + windowsHide，不拼 shell）、Windows .cmd 垫片前缀 | verify、git、tooling |
| git | head / diffFiles / logMessages / describeLatestTag / showFile 等 | 只读 git 封装（不执行 add/commit/reset） | verify、git/*、release/* |
| conventional-bump | calculateBump / classifyCommit | 约定式提交版本推算（pre-1.0 保护） | release/calculate-version |
| dev-workspace | createRunDir / getWorkDir | dev-temp runs 与任务共置 work 落位（run-id：时间戳-PID-随机） | verify、tooling、git/* |
| output | formatJson / formatTsv / writeOutput | 结构化输出与文件落位 | verify、release/*、git/* |
| glob-match | globToRegex | 全路径 glob（** 递归跨段）→ 正则 | verify 路由 |
| task-ref | normalizeTaskRef | domain/name 引用规范化（防穿越） | tooling、ref-check |
| ref-check | collectRefIssues | 文档/脚本引用存在性检查（doc-check D4） | doc-check |
| skill-check | checkSkillStructure | skills/ 开放格式结构校验（S1-S5） | doc-check |
| verify-profile | PROFILE_VERSION | 门禁 profile 版本事实源（命令构成变化时递增） | verify |

## 临时路径边界（所有权分离 + 清理白名单）

| 路径 | 所有权 | 可否清理 |
|------|--------|:---:|
| `dev-temp/runs/` | 开发脚本完整中间结果（含 verify 诊断现场） | ✅ `tooling tmp clean` |
| `dev-temp/work/<任务>/` | 临时脚本、输入、输出及交接产物 | ✅ `tooling tmp clean` |
| 应用运行时临时目录 | 应用自身 | ❌ 不归 tooling 管 |
| 测试 tmpdir（os.tmpdir） | 测试框架 | ❌ 不归 tooling 管 |

> 清理约定：安全语义不同，不合并清理命令。默认统计/预览只输出终端；显式清理优于自动删除，失败现场可保留（runs/ 按 run-id 隔离）。持久清单必须放在所有候选目标之外；成功执行自删除，部分失败保留以便重试。历史 `scripts/scratch/` 与 `dev-temp/cache/` 目录即使存在也不再由 tooling 生成或提供专用接口。

## 范例 task

- `tasks/git/head-diff.mjs` — 多 lib 基元组合范例（git + process + dev-workspace + output）
- `tasks/git/show-file.mjs` — 只读边界 + 核心逻辑可测（runShowFile 注入 root）范例
- `tasks/knowledge/update-reference-projection.mjs` — references 公共练度说明的统一投影与检查
- `tasks/release/archive-plan.mjs` — 文档状态机机械实现 + dry-run/--apply 范例
- `tasks/release/changelog.mjs` — 同源双视图 renderer（人类分类分节 / Agent 限行单行）+ 追加写防重范例

## tooling 用法

```bash
node scripts/tooling.mjs list                     # 列出 tasks（目录发现）
node scripts/tooling.mjs list --lib               # 枚举 lib 基元（文件名 + 头部摘要）
node scripts/tooling.mjs run <task> -- <args>     # 独立 Node 子进程运行，args 原样透传
node scripts/tooling.mjs tmp path|list|clean      # 临时区管理（clean 默认终端预览；真实删除必须使用显式 manifest）
node scripts/tooling.mjs tmp manifest --out dev-temp/work/<任务>/cleanup-<名称>.json --snapshot bench/results/<run-id>.json <target...>
node scripts/tooling.mjs tmp clean --manifest dev-temp/cleanup-<名称>.json  # 按显式清单预览
node scripts/tooling.mjs tmp clean --manifest dev-temp/cleanup-<名称>.json --apply  # 复核后删除
node scripts/tooling.mjs tmp clean --reason <理由> <target...>  # 内存清单预览，不落文件
node scripts/tooling.mjs tmp clean --snapshot bench/results/<run-id>.json <target...>  # 内存清单预览
```

直接路径预览必须提供 `--reason` 或 `--snapshot`，不写清单、不自动删除；需要执行时先用 `tmp manifest` 将清单写到所有候选目标之外，再走 `tmp clean --manifest ... --apply`。默认搜索遵守 `.gitignore`，查看忽略区时限定到具体任务目录或清单路径。

清单建议与对应 work 任务共置；若候选目标包含整个 `dev-temp/work/<任务>/`，清单必须改放该任务目录之外（例如 `dev-temp/cleanup-<名称>.json`），避免清单落入自身删除范围。

共享基准快照的入库、当前用途与淘汰规则见 [`docs/rules/document-lifecycle.md`](docs/rules/document-lifecycle.md)；发布技能只承载分支收尾时机。

退出码约定：0 成功 / 1 一般错误 / 2 参数错误。
