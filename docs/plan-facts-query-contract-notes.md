# 实施笔记：facts query_operators 高 ROI 契约收缩计划

> 对应 spec：`docs/plan-facts-query-contract.md`
> 开始日期：2026-09-04

## 决策偏离

> 暂无。实施中如出现计划未覆盖的重要决策，在此流式追加。

## 实现调整

- 2026-09-04：`OperatorFilters` 与 store 过滤逻辑移除 `rarity`；`RecordCard.rarity` 保留，`serializeCards` 继续输出星级。
- 2026-09-04：`queryOperatorsTool()`、facts 系统提示和工具描述改为设施/阵营/职业/关键词契约，并明确至少需要一个非空正向条件。
- 2026-09-04：`safeParseFilters` 统一 trim `room` / `faction` / `profession` / `termQuery`，仅保留非空值；非法 JSON、非对象、空对象、仅 `excludeIds` 或仅旧 `rarity` 均返回无效。`excludeIds` 元素 trim 后忽略空字符串。
- 2026-09-04：facts 派发先校验 `query_operators` 参数，只有有效参数才获取 store、查询和序列化；无效参数统一返回 `查询参数无效：请至少提供非空的设施、阵营、职业或关键词。`。工具调用仍计入现有检索轮次预算，未增加重试。

## 债务记录

> 暂无。本轮明确接受自由文本可能产生宽查询的残余风险；只有真实调用出现问题后才评估新需求，不预先登记代码债务。

## 意外发现

- 2026-09-04：`pnpm exec vitest` 受当前依赖链接状态影响未找到命令；仓库精确脚本 `pnpm run test` 正常执行，未改变代码或依赖声明。
- 2026-09-04：最终验证 `pnpm run typecheck`、`pnpm run test`、`pnpm run build` 均通过；全量测试为 18 个文件、163 个用例，全部通过。
- 2026-09-04：`node dist/cli.js run --dry --retriever facts` 完整执行 F01–F10、S01–S08、G01–G02 共 20 题，60 条记录，0 截断；工具统计为 `lookup 20`、`query_operators 20`，未发现本计划范围内的超宽输出问题。
- 2026-09-04：`node scripts/doc-check.mjs` 仅因既有活动计划 `docs/plan-hybrid-facts.md` 的 6 个未勾选条目（D1：第 73–76、78–79 行）失败；本计划未修改或代勾该计划条目。

## 阻塞与解决

> 暂无。遇到阻塞并解决后，在此记录症状、根因、方案与预防措施。
