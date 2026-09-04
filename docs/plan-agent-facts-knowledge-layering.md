# 查询 Agent 单一指令源与 facts notes 分层计划

> 创建日期：2026-09-04
> 状态：施工中

## 目标

以 `knowledge/AGENTS.md` 作为查询 Agent 唯一人工指令源，只保留证据边界、工具分流、领域语义陷阱、计算边界和不确定性表达；模式能力由代码生成。对象级机制说明进入 facts notes，详细事实、设施机制与组合建议继续按需查询。

## 非目标

- 不建立全量来源台账、标题块审阅矩阵或 425 张卡逐项处置记录。
- 不在本轮重制 20 题答案基线，不执行 12+5 查询/裸查大评测。
- 不把完整组合、总效率、缺人路线和培养评价复制进干员备注。
- 不修改现有 facts 查询参数、数值结构化边界或检索轮次预算。
- 不把根 `AGENTS.md` 的开发流程、通用写作习惯、截图流程或具体游戏事实注入查询 Agent。

## 架构分析

根 `AGENTS.md` 是开发代理入口，不能进入 Qwen 查询上下文。查询行为曾同时由 `knowledge/AGENTS.md`、`bench/src/agent.ts` 的手写 system prompt、未被运行时消费的 `knowledge/SKILL.md`，以及默认关闭的 `rules-prefix.ts` 描述；同一证据约束和工具路由存在多处表述，形成遵循竞争与维护漂移。

采用“单一人工指令源 + 机械能力块 + 分层证据”边界：`knowledge/AGENTS.md` 只放无法由代码强制且能预防重复错误的短决策契约；`agent.ts` 仅附加当前模式、实际暴露工具和调用上限；工具参数由 schema 描述并由循环强制。facts notes 放对象级语义解释，base/guides 保留详细机制、数值和方案。

## 实施方案

1. 将 `knowledge/AGENTS.md` 收缩为七条查询决策契约，删除设施百科、截图交互和通用写作方法。
2. 所有检索模式读取并注入同一文件；`agent.ts` 只根据实际工具集生成运行时能力块。缺失文件使用中文错误快速失败。
3. 删除无运行时消费者的 `knowledge/SKILL.md`；删除已证伪且默认关闭的 `rules-prefix.ts` 及配置开关，历史实验结论保留在归档文档。
4. Grant notes 与 Skill notes 合并到对应技能作用域；Operator notes 只承载干员级跨技能解释。序列化直接展示已有替换边，不用备注重复机械事实，并取消会截断审定备注的单卡静默截断。
5. 基准运行元数据记录 `knowledge/AGENTS.md` 内容哈希；以单源注入、模式能力、作用域、替换显示和代表性备注测试验收。

## 验收清单

- [x] 所有检索模式只注入 `knowledge/AGENTS.md` 中的人工规则
- [x] AGENTS 不含开发流程、具体干员数值、设施百科、完整组合或培养结论
- [x] `knowledge/SKILL.md` 与 rules-prefix 运行路径已删除，base/guides 仍可检索
- [x] system prompt 的模式、工具和调用上限由代码根据实际能力生成
- [x] 基准运行元数据记录 AGENTS 内容哈希
- [x] Grant notes 保留在对应技能，结构化升级关系显示被替换技能名
- [x] 巫恋与孑的干员级机制备注可通过 `lookup` 完整返回
- [x] 未新增全量审阅矩阵、来源台账或逐卡处置记录
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] `node scripts/doc-check.mjs` 全通过

## 关联 ADR

- ADR-004 — 查询 Agent 采用单一指令源与分层证据

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
