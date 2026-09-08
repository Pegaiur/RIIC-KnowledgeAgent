# 名单作答整理优化计划

> 创建日期：2026-09-08
> 状态：实施完成，待发版归档
> 需求入口：[inbox](inbox.md)

## 目标

在 `knowledge/AGENTS.md` 第 10 条补充「名单与事实整理」规则，使多对象事实题按对象集中、按技能与档位分别保留、只输出用户要求的字段、不重复列举、不输出“重新核对/此处修正”等过程性内容；不以变短替代质量，也不牺牲对象覆盖与条件正确性。

## 非目标

不改检索排序、分词、topK、切块、知识事实、工具与协议、预算、模型与 agent loop；不增加整理专用调用、答案后处理或输出长度限制；不写入测试题的具体事实、问法或预期答案；不新增逐字镜像测试或重复历史全量验收。本计划只准备真实对照材料，不发起付费模型请求。

## 架构分析

`knowledge/AGENTS.md` 是所有检索模式唯一的人工指令源。实跑观测显示：多对象名单题存在同一名单重复列举、把不同技能/档位合并、额外补星级/职业、以及“重新核对/此处修正”等自检残留。整理行为属于作答表达层，用现有唯一人工指令源约束即可，无需改工具、检索或宿主循环。

## 实施方案

1. **记录需求与计划**：在 `docs/inbox.md` 登记并落本计划。
2. **补充第 10 条**：在 `knowledge/AGENTS.md` 作答段第 10 条后追加四条整理规则（多对象集中条目/表格行、不同技能与档位分别保留、只输出要求字段、同一名单不重复列举且机制题不强制表格、直接给最终事实并保留冲突/未知/覆盖不足说明），保留取证、阅读、停止与忠实原文规则。
3. **保存指令快照**：改动前后 `knowledge/AGENTS.md` 存入 `dev-temp/work/answer-format-test/{before,after}-instruction/` 并记录指纹。
4. **冻结对照材料**：dev 3 题（H3/R1/R2）与 2 道未参与指令设计的留出题（F1 同对象多技能多档位＝冰酿；F2 少字段短名单＝会客室线索交流速度，只列干员名）写入 `questions-dev.json`、`questions-holdout.json`；`freeze.json` 记录冻结时间、指纹与固定配置，并标注代码固定。
5. **准备对照运行**：提供 `run-compare.mjs`（仅切换指令快照 → 用固定 dist 跑 CLI → 还原）与 README 中的命令/handoff 说明；两方案各跑 5 题一次，共 10 次 query，本任务不执行。
6. **匹配检查**：运行 `node scripts/doc-check.mjs`、`pnpm run typecheck`、`pnpm run test`；不重复历史全量验收或合并门禁。

## 验收清单

- [x] `knowledge/AGENTS.md` 第 10 条补充名单与事实整理规则，保留取证/阅读/停止/忠实原文规则
- [x] 未改工具、检索、预算、模型、agent loop，未增加整理调用、答案后处理或输出长度限制
- [x] 改动前后指令快照已保存，固定对照配置已记录
- [x] dev 3 题与 2 道留出题已就绪，留出题在候选方案输出前冻结
- [x] 对照运行命令与 handoff 说明已准备，本任务未发起付费模型请求
- [x] `node scripts/doc-check.mjs`、`pnpm run typecheck`、`pnpm run test` 通过

## 关联 ADR

- [ADR-004](adr/ADR-004-query-agent-knowledge-layering.md)：继续由 `knowledge/AGENTS.md` 唯一承载人工查询契约。
- 本轮仅补充作答整理措辞，不改跨模块接口、宿主循环或工具协议，无需新建 ADR。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
