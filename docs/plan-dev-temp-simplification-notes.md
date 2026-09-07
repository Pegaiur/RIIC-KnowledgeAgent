# 实施笔记：开发临时区精简与分支收尾

> 对应 spec：[实施计划](plan-dev-temp-simplification.md)
> 开始日期：2026-09-06

## 决策偏离

暂无。用户要求如无必要勿增实体，优先删减无消费者的入口和规范，复用现有 work/runs。

## 实现调整

- 已移除 `tooling new/promote`、scratch 模板/升迁辅助代码、`scratchRoot` 及 cache 专用目录导出；保留 `normalizeTaskRef`，因其仍被 `tooling run` 与 `ref-check` 使用。历史 `scripts/scratch/` 忽略规则和引用豁免保留，不再生成、移动或批量处理旧文件。
- `tmp clean` 的直接路径现以 `--reason` 或 `--snapshot` 生成内存清单并复用既有校验/评估/输出；不写文件、不支持 `--apply`，输出明确标为内存预览。持久清单写入和执行仍走原入口，且写入/执行均拒绝清单落在候选目标内部；成功自删除、部分失败保留行为不变。
- `scripts/INDEX.md` 承载落位、tooling 与清理规范；AGENTS 仅保留路由和默认搜索约定，release 技能仅保留分支收尾时机。临时脚本、输入、输出与交接产物统一建议共置于 `dev-temp/work/<任务>/`，正式工具运行记录继续使用 `dev-temp/runs/`。
- 独立提交审查指出两处非阻塞规范残留：release 技能重复了清理结论、output 基元注释仍称 work 为长期查看区；已分别收敛为规范链接与任务共置表述。

## 债务记录

暂无新增债务。

## 意外发现

- cache 专用接口未发现业务消费者；scratch 创建及提升主要由 tooling 自身维护。`normalizeTaskRef` 有 `tooling run` 与 `ref-check` 两个真实消费者，未随退役入口删除。
- 当前 `dev-temp` 存量仍含根部散放文件、旧的一次性评估组、基准运行材料、`runs/verify` 正式诊断记录以及待执行的 `cleanup-temp-cleanup-closeout.json`；本轮未移动或删除任何生产/历史产物。
- 旧存量处理建议：`agent-loop-evaluation`、`agent-tuning-evaluation`、`agent-trace-acceptance`、`auto-budget-acceptance`、`functional-acceptance`、`functional-acceptance-r2`、`overfit-acceptance`、`post-functional-20q`、`session-tool-budget-evaluation`、`temperature-audit`、`unified-required-session` 按任务用途逐组核对，仍需复核的保留在原目录并作为交接；若脚本需要长期复用，人工按普通代码变更移入 `scripts/tasks/`，不得批量迁移。
- `run-facts-real`、`run-s02-noskill`、`run-s246-bm25` 以及 `2026-09-02T01-11-19-993Z-gongsun-*` 三组含 `meta/answers/summary` 的运行材料先核对对应快照或结论引用；可恢复的证据以共享快照为准，已共享且实验停止后才用显式清单处理原件。
- `dev-temp/runs/`（含 `runs/verify`）按正式工具运行目录和结束产物单独核对；空的 `2026-09-01T03-26-22-939Z-qwen-low`、`2026-09-01T04-36-20-031Z-qwen-low` 仅建议确认无待恢复路径后再舍弃。`prts`、`prts-crawl.mjs` 与 `arknights-base-vault-dot-git-backup` 属于原始/备份材料，来源未核对前保留并优先备份核验。
- 根部散放的 `*.mjs`、`*.json`、hitrate/temperature/query 文档建议先按所属任务回指或备份核对；没有明确用途才在任务收尾时以 `reason` 清单舍弃。现有 closeout 清单继续保留，不能因新规范而删除。

## 验证记录

- tooling 定向回归 7/7、`pnpm run typecheck`、`pnpm run test`（31 个测试文件 / 269 项测试）、`pnpm run build` 与构建后 `node dist/cli.js validate` 均通过；validate 报告 20 题、3 份共享快照、313133 字节。
- 直接路径 `--reason` 实测为内存预览且不写清单；直接路径与 `--apply` 被拒绝；退役 `new/promote` 均返回用法错误。预勾选阶段 `node scripts/doc-check.mjs` 仅报告本计划 4 个未勾选 D1；勾选后 doc-check 与统一合并门禁均通过。

## 阻塞与解决

独立方案审查 PASS，无阻塞。采纳两项文字澄清：持久清单在所有候选目标之外；无文件预览显式处理可选 manifestPath，不伪造路径。现有分支清理预览清单保留，计划不授权实际删除或批量搬移。实施完成后按证据更新验收项；文档初期 D1 反映尚未实施。

### 2026-09-06 — 独立验收

独立复核两笔实施提交并重跑统一门禁，31 个测试文件、269 项测试及其余门禁全部通过。额外 CLI 复验 reason/snapshot 内存预览、直接 apply 拒绝、new/promote 退役及 list 可用；dev-temp 根目录条目及原待执行清单内容未变。生产清单的成功自删和部分失败保留由正式测试覆盖。

验收时补齐两处文档约定：新临时脚本和数据不散放根目录；普通无用途临时物允许任务结束即清理，发布技能的分支收尾时机不限制此行为。同步明确放弃清单只移除清单本身。未改产品代码或删除生产产物；文档微调待提交。

### 2026-09-07 — 主动收尾规范补充

- 独立方案审查 PASS：与现有内存预览、显式清单执行及保护检查衔接，无需新增清理机制或文档实体。
- AGENTS 补充任务完成、交接和放弃时的路由；INDEX 集中主动去留判断、保留用途、分支遗漏核对及收尾结果约定；release 在归档前核对交接，在共享可复核且实验停止后清理正式证据原件。
- 审查澄清已采纳：根目录特指 dev-temp；notes 的精简只适用于收尾记录；普通任务结束不强制生成清单。历史存量整理不变成每分支重复全量审核。
- 按既有计划验收和实施记录同步 inbox 完成状态；完成指实施验收，生产清理及发布收束尚未执行。本轮仅补充文档，未生成临时文件或改变现有清单。
