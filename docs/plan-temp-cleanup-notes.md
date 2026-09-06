# 实施笔记：基准结果入库与分支收尾清理

> 对应 spec：[plan-temp-cleanup.md](plan-temp-cleanup.md)
> 开始日期：2026-09-06

## 决策偏离

暂无。已按用户确认及独立评审收敛的计划实施，不重新引入多文件快照或自动归属协议。

## 实现调整

已新增 `bench/src/snapshot.ts`，将运行目录解析为单文件 JSON 快照：顶层固定为 `schemaVersion`、`runId`、`topic`、`meta`、`queries`、`records`；CostRecord 按白名单提取，HTTP 尝试保留用量和结果状态但丢弃错误诊断文本，问题/答案文本执行密钥模式脱敏。相同快照重复导出不覆盖，内容冲突拒绝覆盖。

`report`/`compare` 现在可直接读取快照，并用 `queries` 补齐没有 CostRecord 的失败题。运行器 meta 增加题目 ID、仓库内相对题集路径及嵌入式题目定义、价格快照、主题和运行时 Git/Node/包版本信息；仓库外题集不记录绝对路径，导出依靠嵌入定义恢复。源码版本在运行时采集，缺失时保留 null。

`scripts/tooling.mjs` 增加显式清理清单生成、预览和 apply：清单只含 `path`、指纹及 `snapshot`/`reason`，清单文件固定在仓库内 `dev-temp/`，目标固定在 `dev-temp/` 或 `bench-runs` 运行目录。删除前复核指纹、Git 跟踪状态、`.keep`、reparse point、运行结束产物和共享快照提交状态；默认预览，部分失败保留清单；旧的无清单入口仅允许 dry-run，真实删除必须走 manifest。`release-workflow` 与 `scripts/INDEX.md` 已补充共享后清理步骤。

修正旧 `answers.md` 解析为从最后一行元数据之后读取正文，兼容旧版轮数/检索次数/工具序列格式并保留多行答案中的空行；并为缺少历史 `truncated` 标记的 JSONL 提供兼容缺省值。

## 债务记录

暂无新增债务。

## 意外发现

旧运行目录中部分历史结果没有 `answers.md`、`injected.json` 或题集路径。导出器按嵌入题集、answers.md、records.jsonl 的可确认事实合并题号；只有 meta 明确记录的 `questionsPath` 才读取外部题集，不把当前默认题集冒充历史来源。仍无法取得题目正文时保留 queryId、类别和未知正文，不静默丢弃计量事实。旧存量的数量和体积来自 2026-09-05 盘点，本轮已按明确选择提取必要证据。

## 阻塞与解决

当前分支为 `feature/temp-cleanup`，沿用现有目录，未新建工作树。全量测试和 typecheck/build 已通过；`node scripts/doc-check.mjs --json` 仅保留计划施工中的 7 个 D1 未勾选错误，未为通过检查提前勾选。验证使用隔离临时目录和既有 dry 运行，没有发起真实付费 LLM 请求。

### 2026-09-06 — 独立验收未通过

- **范围**：对当前 feature/temp-cleanup 实现执行 typecheck、build、全部 262 项测试及额外隔离样本验收；不发起真实 LLM 请求，不清理生产目录。
- **通过项**：typecheck/build/262 项测试通过；单 JSON 可以在没有原始 bench-runs 的独立目录中通过 CLI 生成报告、执行比较，比较表包含无记录失败题的完整题目分母。
- **P1 / ACC-01：Git 跟踪保护可被 Windows 大小写绕过**。`scripts/tooling.mjs` 的 isTracked 使用区分大小写的 Git pathspec；已跟踪 protected.txt，以 PROTECTED.txt 生成清单，预览给出 delete。应按 Windows 实际路径同一性核对跟踪项，Git 查询异常不得默认放行。
- **P1 / ACC-02：runs 根候选绕过运行结束检查**。选择 dev-temp/runs 本身时，runCompleted 的带尾斜杠前缀判断未命中，即使包含没有 result.json 的运行，预览仍为 delete。应拒绝此类集合目录，或逐项证明其全部运行已结束。
- **P1 / ACC-03：历史题目恢复丢失原始事实**。缺少可读取题集时，answers.md 内存在但没有 CostRecord 的失败题不会进入 queries；缺少 questionsPath 时又会从当前默认题集按数量裁剪，将历史 ORIGINAL 替换为 CURRENT。应合并答案与记录中的实际题号，以原始题目正文为据，未知来源明确保留未知。
- **P1 / ACC-04：meta 没有落实字段白名单**。sanitizeMeta 实际使用删除已知字段的黑名单；隔离输入的绝对 corpusDir、headers.Cookie 和 unknownExtra 均进入快照。应明确允许字段和嵌套结构，规范化路径并排除请求 headers，不能只依赖密钥前缀正则。
- **P2 / ACC-05：仓库根 .keep 未生效**。hasKeepMarker 的祖先循环在到达仓库根之前终止；根部存在 .keep 时，未跟踪候选仍被预览为 delete。祖先保护应包含仓库根边界。
- **尚未交付的验收证据**：bench/results 目录尚不存在，旧存量未提取入库；当前门禁没有枚举校验已入库快照的检查，snapshot 测试仅使用构造样本。修复导出问题后仍需完成旧证据提取和仓库快照校验，真实原件删除继续等待共享条件。
- **复现**：本机脚本 `dev-temp/acceptance-temp-cleanup.mjs` 和结果 `dev-temp/acceptance-temp-cleanup-results.json`。8 项探针中 6 项失败（ACC-03 含两个独立样本），2 项通过；清理缺陷仅用预览验证，未执行生产删除。这些文件不入库，本段保留可独立重建的触发条件。
- **结论**：验收不通过，不勾选计划以绕过 D1。上述问题需修复并纳入回归后复验；本轮未修改业务代码或提交、合并、推送。

### 2026-09-06 — 验收修复与证据入库

- **ACC-01 / ACC-02 / ACC-05**：清理器统一使用规范化路径比较；Git 跟踪查询枚举完整索引并按 Windows 路径同一性比较，查询失败直接阻塞；`dev-temp/runs` 及任务集合目录无法证明停止时跳过；祖先 `.keep` 检查包含仓库根。回归覆盖大小写路径、Git 查询失败、集合目录和根 `.keep`。
- **ACC-03**：导出器合并嵌入题集、answers.md 与 records.jsonl 的题号；历史答案优先提供题目正文，失败且无 CostRecord 的题仍进入 `queries`；没有明确历史题集来源时不读取当前默认题集，未知正文保持未知。回归覆盖答案独有失败题、题集改名/内容变化和记录独有题号。
- **ACC-04**：`meta` 改为显式允许字段和固定嵌套结构；题集定义、价格、来源单独按结构清洗，仓库相对路径规范化，绝对路径、请求 headers 和未知字段丢弃，文本继续脱敏。
- **证据入库**：已从明确引用的旧运行目录提取 `bench/results/` 下 4 个单 JSON：Qwen 旧基线、2 点预算、5 点预算及 API 失败对照。没有删除原始 `bench-runs`，也没有发起真实请求。
- **门禁复用**：`bench validate` 通过 `readSnapshot` 枚举并校验全部入库快照，不维护第二套 schema 校验；本轮 `node dist/cli.js validate` 报告 4 个共享快照通过。
- **复验**：8/8 隔离验收探针通过；`pnpm run typecheck`、`pnpm run build` 通过；定向快照/清理测试 7/7 通过。计划验收项仍保持未勾选，避免用勾选动作消除施工中的 D1。

### 2026-09-06 — 4745741 独立复验仍未通过

- **已确认修复**：原 8 项探针全部通过，typecheck/build 与 263 项测试通过；bench validate 校验 4 个已入库快照通过，且该校验经 benchmark-integrity 测试纳入现有 test 门禁。ACC-01 的 Git 跟踪保护、ACC-04 的已知元信息泄漏样本本轮未再复现。
- **P1 / ACC-02 未覆盖同类路径**：`dev-temp/RUNS/task/active` 与小写路径在 Windows 上指向同一未结束运行，但 runCompleted 仍直接比较大小写敏感的 rel 字符串，预览返回 delete。应让运行区域分类也复用统一路径同一性判定，不能仅在 Git 跟踪保护中归一化。
- **P2 / ACC-05 未覆盖后代标记大小写**：候选 outer 的后代 inner/.KEEP 存在时，后代遍历只比较 basename === '.keep'，预览仍为 delete。Windows 上 .KEEP 与 .keep 是同一保护标记，需统一处理祖先与后代，而非只修复祖先循环终点。
- **P1 / ACC-03 未覆盖明确路径的版本漂移**：meta 记录 questions=1、questionsPath=bench/questions.json，历史 answers.md 只有 OLD，当前同路径题集已改成 NEW。导出 queries 为 [NEW, OLD]，凭空增加从未运行的问题并改变统计分母。路径可读取不等于来源版本可信；应以可确认的历史事实约束外部题集的成员，不仅让答案覆盖同题号正文。历史版本不能确认时不得用当前题集补入新题。
- **复现与边界**：`dev-temp/reacceptance-temp-cleanup.mjs` 与 `dev-temp/reacceptance-temp-cleanup-results.json`，3 项新增根因变体全部失败；均在隔离临时目录执行，删除缺陷仅检查预览，不执行生产删除。
- **结论**：仍不通过，保留计划未完成状态；doc-check 仍为 7 个 D1。后续需针对同一性判定和历史来源可信度统一修复，再复验，而非继续追加仅匹配单一样本的分支。本轮只追加验收记录，未修改业务代码或提交、合并、推送。

### 2026-09-06 — 复验阻塞修复完成

- **ACC-02**：清理白名单、清单路径、快照路径、候选重叠、运行区域分类及结束产物祖先检查统一使用平台路径同一性与严格包含关系；`dev-temp/RUNS/...` 在 Windows 上会按 `dev-temp/runs/...` 判定，未结束运行继续跳过。
- **ACC-05**：候选自身、祖先目录和后代遍历统一使用平台文件名同一性；Windows 下 `.KEEP` 与 `.keep` 均触发保护，其他平台仍保持大小写敏感。
- **ACC-03**：快照恢复明确来源顺序：嵌入定义或运行目录内题集副本作为可信正文来源；否则仅使用 `meta.questionIds`、答案区题号和 records 题号形成历史成员集合，仓库当前题集不再凭路径引入新成员。缺失可信正文保留未知，答案中的历史原始题目正文优先覆盖同题号低可信内容，records 仍补齐无答案题和无记录失败题。
- **正式回归与复验**：清理/快照定向回归 8/8 通过；旧验收探针 8/8、新增变体 3/3 通过；`pnpm run typecheck`、`pnpm run build` 和全量 264 项测试通过；`node dist/cli.js validate` 校验 4 个已入库共享快照通过。`doc-check` 仍仅报告原有 7 个 D1，计划验收项未提前勾选；未删除生产原件，未发起真实 LLM 请求。

### 2026-09-06 — 最终验收

- **功能复验通过**：独立重跑 typecheck、build、264 项测试、原 8 项及新增 3 项验收探针，全部通过；validate 校验 4 个共享快照通过。另在隔离目录验证 junction 拒绝、未提交快照跳过，以及部分完成后保留清单并成功重试。
- **根因与结构审查**：路径区域分类和保护标记统一使用平台同一性；历史题集成员以运行事实恢复，不从当前仓库题集补入新题。继续采用单 JSON 快照与单 JSON 清单，未增加状态协议或文件拆分。
- **验收微调**：修正后代保护标记测试的非 Windows 断言笔误：样本创建的是 `.keep`，应同样期待跳过；未修改业务行为。
- **状态**：根据实测勾选计划验收项；保留计划和笔记待发布收束。修复仍在工作区，未提交、合并、推送或清理生产原件。
- **统一门禁**：`node scripts/verify.mjs merge -- --base main` 五项全部通过，包含 264 项测试和 doc-check；本次验证针对当前工作区，后续提交发布仍遵循既有流程。

### 2026-09-06 — 提交审查补齐路径校验

独立提交审查复现跨盘清单路径未被拒绝，以及 `dev-temp/a`、`dev-temp/a-foo`、`dev-temp/a/x` 排序后非相邻父子漏检。包含关系统一排除绝对 relative 结果；显式清单逐对核对父子及重复关系，不再依赖排序相邻。新增正反顺序重叠与跨盘清单回归，未扩大清理范围或增加协议。

修订后独立重跑统一合并门禁，五项全部通过，包含 266 项测试、typecheck 和 doc-check；验证目录为 `dev-temp/runs/verify/1788681432074-22808-575bb3`。未执行生产删除。
