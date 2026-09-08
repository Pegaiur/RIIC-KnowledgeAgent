# 实施笔记：单词条 facts 统一入口

> 对应 spec：docs/plan-facts-single-query.md
> 开始日期：2026-09-07

## 决策偏离

### 2026-09-07 — 审查后定稿并交接
- **背景**：用户要求将已独立复审PASS的草案转为计划，同分支按旧配置交接。
- **决策**：草案原位重命名为plan，增加实施顺序及未完成验收清单；新增ADR-007记录公共接口取舍。沿用feature/independent-tools-schema，在当前仓库交给Luna/xhigh新任务，不创建工作树。
- **审查**：review_single_facts的初审意见及最终PASS保留在计划末尾；旧名称执行/历史分离、测试fixture、同源字段和snapshot兼容意见均已落实。
- **影响**：当前仅定稿，worker按U01–U11实施及验证后再勾选验收；本任务未授权付费跑测、自动提交或合并。

## 实现调整

### 2026-09-08 — 单词条入口实施
- 将当前工具 schema 版本从4递增为5；facts/hybrid 对外入口改为 `facts_search({query})` / `rag_search + facts_search`，旧 `lookup`、`query_operators` 仅保留历史统计与 store 内部兼容，执行器收到旧名按 `unknown_operation` 处理。
- 在 RecordCard store 增加六类规范词条精确索引（干员、技能、技能组、设施、阵营、职业），同名按 canonical 稳定去重并带命中类别；facts 结果版本为2，空查明确为未收录精确词条，完整返回卡不做设施投影或 RAG 字符截断。
- provider dry、人工指令、agent 能力块、trace/report 工具识别已同步；历史工具名仍可读和统计，缺失历史结果版本不回填。
- 新增 U01–U08 手工 fixture 与 U11 旧名拒绝测试；参数、预算、坏 ID、fatal、trace、snapshot 兼容回归均保留。

## 债务记录

### 2026-09-08 — R5-2 历史 lookup 消歧能力
- **债务**：旧 lookup 的别名、合称与子串消歧仍未接入独立真源；本轮统一 facts_search 时不恢复这部分历史高级能力。
- **未来偿还**：建立并核验独立别名/合称真源后，再单独评估是否恢复旧数据调用者的多卡解析能力；不得以当前评测答错或分数变化作为恢复依据。

## 验证记录

### 2026-09-08 — 当前 HEAD 的实现验证
- **提交基线**：`7b7cf1aab9910cdb2162059776a7c47477ec8b94`；运行原件的 `source.gitDirty=true` 表示验证时工作树仍有本笔记、其他文档、草稿、spec 与 bench/results 等排除范围内的并行改动，工具实现和测试已包含在该提交。
- **代码验证**：`pnpm run typecheck` 通过；`pnpm run test` 通过（31 个测试文件、302 个测试）；`pnpm run build` 通过；`node scripts/doc-check.mjs` 通过。
- **dry 验证**：使用 `node dist/cli.js run --dry --limit 2 --retriever <mode> --thinking off --out dev-temp/work/facts-single-query-validation/<mode>`，bm25、grep、both、facts、hybrid 五种模式各运行 2 题，均成功结束；facts 实际工具为 `facts_search`，hybrid 实际工具为 `rag_search` 与 `facts_search`。
- **schema 测量**：当前 facts schema 为 v5、JSON 字符数306、指纹 `9ba7685606824268f7f3c4d5bbfa8a57a21a485d1f2aa03db9b43de73a0dfd2f`；hybrid 为 v5、JSON 字符数559、指纹 `25b543f980eacecbd49fb8a6dfacf8e628efa9fb85e15162f0f3c07ce4b9a9c0`。仅作结构负担记录，不推导 token、费用或质量收益。
- **原件位置**：五种模式的 `meta.json`、`records.jsonl`、`trace.jsonl` 等均保留在 `dev-temp/work/facts-single-query-validation/<mode>/<run-id>/`；这些是本机验证中间产物，不入库，清理条件为本批文档审查完成且不再需要复核。

## 意外发现

### 2026-09-08
- 当前最终 schema JSON.stringify 字符数为：facts 306、hybrid 559；仅记录结构测量，不推导 token、费用或质量收益。
- 五模式 dry（bm25/grep/both/facts/hybrid）均以2题通过；facts/hybrid 均实际记录 `facts_search`，未进行付费跑测。完整命令和原件目录见“验证记录”。

## 阻塞与解决

### 2026-09-08
- 仓库 `.git/config` 受当前权限配置只读，约定的 git 编码配置无法写入；未修改该目录，不影响本轮代码验证。
