# 查询 Agent 常驻知识与 facts notes 分层计划

> 创建日期：2026-09-04
> 状态：施工中

## 目标

从 `knowledge/SKILL.md` 与 base 中提炼稳定、通用且高频的基建基础，作为查询 Agent 的常驻 `knowledge/AGENTS.md`；把只对具体干员成立的机制说明放入 facts notes，详细设施机制与组合建议继续按需检索。

## 非目标

- 不建立全量来源台账、标题块审阅矩阵或 425 张卡逐项处置记录。
- 不在本轮重制 20 题答案基线，不执行 12+5 查询/裸查大评测。
- 不把完整组合、总效率、缺人路线和培养评价复制进干员备注。
- 不修改现有 facts 查询参数、数值结构化边界或检索轮次预算。

## 架构分析

根 `AGENTS.md` 是开发代理入口，不会进入 Qwen 查询上下文；查询提示目前由 `bench/src/agent.ts` 构造。旧 `rules-prefix.ts` 是默认关闭的检索词实验，不能承载新的常驻知识。另一方面，`knowledge/SKILL.md` 混合了通用规则、详细干员案例和交互话术，base 又包含可在所有查询前成立的基础，导致运行时必须依赖检索才能拿到最基本的判断框架。

采用三层边界：常驻 AGENTS 只放跨干员通用知识和工具契约；facts notes 放对象级语义解释；base/guides 保留详细机制、数值和方案。迁移范围由选中的内容本身限定，以代表性回归证明可用，不另建治理台账。

## 实施方案

1. 新建 `knowledge/AGENTS.md`，纳入作用域、依据优先级、设施职责、制造/贸易口径、心情、解锁/提升、作用范围、工具选择和计算边界。
2. facts 与 hybrid 模式默认读取并注入该文件；历史 BM25/grep 对照模式保持不变。缺失文件使用中文错误快速失败。
3. 缩减 `knowledge/SKILL.md` 为按需交互手册；base 继续保留完整细节和检索能力，AGENTS 只提炼其中高频基础。
4. Grant notes 与 Skill notes 合并到对应技能作用域；Operator notes 只承载干员级跨技能解释。序列化直接展示已有替换边，不用备注重复机械事实，并取消会截断审定备注的单卡静默截断。
5. 首批只迁移巫恋、孑两个高风险解释；温蒂等升级关系通过结构化替换边输出。以常驻注入、作用域、替换显示和代表性备注测试验收。

## 验收清单

- [x] facts/hybrid 默认注入 `knowledge/AGENTS.md`，BM25/grep 历史模式不受影响
- [x] 常驻文件不含具体干员数值、完整组合或培养结论
- [x] base 仍保留详细可检索内容，`knowledge/SKILL.md` 不再重复常驻规则和干员案例
- [x] Grant notes 保留在对应技能，结构化升级关系显示被替换技能名
- [x] 巫恋与孑的干员级机制备注可通过 `lookup` 完整返回
- [x] 未新增全量审阅矩阵、来源台账或逐卡处置记录
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] `node scripts/doc-check.mjs` 全通过

## 关联 ADR

- ADR-004 — 查询 Agent 采用常驻知识、facts notes 与 RAG 三层结构

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
