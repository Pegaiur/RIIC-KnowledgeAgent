# RAG + facts 20 题质量闭环计划

> 创建日期：2026-09-04
> 状态：施工中

## 目标

基于当前 `knowledge/corpus-manifest.json` 白名单重建 RAG + facts 20 题评测定义，建立 questions、gold、spec 与实际切块的一致性门禁，为下一阶段真实质量实跑提供稳定输入。

## 非目标

- 本阶段不发起真实付费的 20 题 LLM 运行，不做逐题回答质量复盘。
- 不建立全量审阅矩阵、来源台账、逐卡处置表或额外治理体系。
- 不从 raw 恢复未经审定的固定排班、完整 243 布局、统一九步算法或缺人收益。
- 不把本快照升级为独立游戏事实真源；知识事实仍由当前 base/references/guides 负责。

## 架构分析

原有 gold 和 spec 仍使用已删除目录，无法解析到当前白名单切块；questions 还保留旧组合名、旧练度前提和未被当前语料支持的固定排班问题。references 九个技能分片的公共练度说明也与 base 冲突，且此前没有跨 questions、gold、spec、manifest 和实际锚点的统一校验入口。

## 实施方案

1. 读取当前白名单和现有 base/references/guides，按事实、体系、散件三类保留 10/8/2 的题量；对证据不足的题目收缩问题或替换为同类覆盖题。
2. 用统一可重跑的 references 投影步骤修正九个技能分片的公共练度说明，并以测试和 merge 门禁防止旧说明回归。
3. 重建 `bench/gold.json`，仅引用 manifest 文档中的真实标题切块；移除已删除目录和无关证据。
4. 将 `docs/spec/rag-answer-baseline.md` 升级为 v3 当前知识库评测快照；逐题写明必须覆盖、允许补充和明确陷阱。
5. 增加基准完整性校验和 `validate` CLI，覆盖题号集合、分类规模、白名单文档与实际切块锚点；完成 dry-run 验收。
6. 真实 20 题付费运行及回答质量闭环保留为本 inbox 条目的下一阶段。

## 验收清单

- [x] 题集保持 20 题及 fact/system/gadget = 10/8/2，且问题前提只使用当前白名单可支持的结论
- [x] references 九个技能分片统一使用当前星级/练度说明，并补回归测试与投影门禁
- [x] gold 20 题全部改为当前 manifest 文档和实际存在的切块锚点
- [x] spec 升级为 v3 当前知识库评测快照，逐题区分必须覆盖、允许补充和明确陷阱
- [x] 增加 questions、gold、spec 题号集合与单一定义校验
- [x] 增加 gold 文档白名单与实际切块锚点校验
- [x] 增加 `node dist/cli.js validate`、`hitrate --check-gold` 与相关 dry-run 验收
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] `node scripts/doc-check.mjs` 全通过
- [x] 未发起真实付费 20 题 LLM 运行，下一阶段入口仍保留在本 inbox 条目

## 关联 ADR

- 无。本次是基准重建、投影收敛和校验增强，不改变跨模块架构决策。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
