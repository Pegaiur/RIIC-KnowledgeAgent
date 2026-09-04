# 需求收件箱

> 原始想法、改进提议、架构疑虑在此登记。评估后路由到版本计划(plan)、架构决策(ADR)、或关闭。
> 所有需求/决策/扩展提议的唯一入口——不要直接从 AGENTS.md 活跃待办或 ADR 起步。

## 路由规则

评估后按以下规则分流：

| 场景 | 路由目标 | 说明 |
|------|------|------|
| 新功能、功能改进 | → `docs/plan-*.md` checklist | 版本计划轨道 |
| 模块接口扩展（新增 API、类型签名变更） | → `docs/plan-*.md` checklist | 消解为 plan 的普通条目 |
| **重大架构变更/技术选型变化** | → 先建 `docs/adr/ADR-NNN.md` → plan 引用 | 需要记录决策前因(why)时 |
| 暂不确定方向 | → 保留在 inbox 待评估（标注暂缓原因） | 问题明确、方向已知，但依赖不成熟 |
| **技术调研**（评估外部方案/API/工具） | → inbox 条目跟踪 → 调研量较大时路由到 `docs/draft-*.md` 承载详细内容 → 有决策结论时转 ADR | 复用需求→draft 管线。调研因需求而起，路由路径与需求一致 |
| 明确不采纳 | → 已关闭（记录理由） | — |

### ADR 触发判据

**需要建 ADR（正向）**：新依赖引入、跨模块公共接口签名变更、分发/部署策略变更、废弃旧方案（需替代理由）。

**直接进 plan（反向）**：单模块内部重构、配置默认值调整、渐进式重构不改变公共接口、Bug 修复。

> 不确定是否需要 ADR 时，先写入 plan checklist。如果条目需要解释"为什么这样做"再补 ADR。

## 待办区

<!-- 格式: - [ ] **简短标题** — 描述 — 提出日期 — 可能路由 -->
<!-- 完成后标记 [x]，发版时清理已完成条目；定期（如每季度）治理重估：确认暂缓原因仍成立、路由目标未悬空 -->

- [x] **R5 事实查询基础设施（facts-first：规范化记录卡 + lookup/query 查询 tool）** — 在 bench 用 `knowledge/references/` 唯一原始事实源落地确定性记录卡、全量核对和查询工具；本轮不再以评测循环为目标，后续质量闭环见 `docs/draft-facts-quality-iteration.md` — 2026-09-04 — 路由 `docs/plan-hybrid-facts.md`，记录卡细化至 `docs/plan-facts-record-cards.md`
- [x] **R5 facts 查询契约高 ROI 收缩** — `query_operators` 移除低选择性的稀有度过滤，拒绝空查询、空白查询、仅排除条件与非法 JSON；暂不引入分页、截断或结果预算 — 2026-09-04 — 已落地，路由 `docs/plan-facts-query-contract.md`
- [ ] **R5 facts 质量闭环后续迭代** — P0.4 F/G 参考要点重制、语义字段人工抽检、12+5 查询/裸查评测、人工判定表和 v3 结论登记 — 2026-09-04 — 暂缓，路由 `docs/draft-facts-quality-iteration.md`
- [x] **知识语料显式白名单** — 非 facts RAG 仅加载 `knowledge/corpus-manifest.json` 登记的 Markdown；新增文件需显式批准，单模块 bug 修复无需 ADR — 2026-09-04 — 已落地
- [x] **RAG + facts 混合工具模式** — 同一查询 Agent 同时暴露 BM25 机制语料检索与 facts 精确查询工具，并以 Qwen 关闭思考完成真实工具调用冒烟 — 2026-09-04 — 已落地，见 `docs/adr/ADR-003-rag-facts-hybrid-retriever.md`、`docs/plan-rag-facts-hybrid.md`
- [x] **当前基准目标纠正为 Qwen** — 修正 AGENTS.md 与包元数据中仍把 Hy3 描述为当前目标的过时表述；默认目标为 Qwen3.7-Flash 关闭思考，Hy3 仅保留为对照 provider — 2026-09-04 — 已落地
