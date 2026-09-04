# ADR-004：查询 Agent 采用单一指令源与分层证据

- 日期：2026-09-04
- 状态：已实施

## 背景

查询行为曾同时由 `knowledge/AGENTS.md`、`bench/src/agent.ts` 的手写 system prompt、未被运行时消费的 `knowledge/SKILL.md` 与默认关闭的 rules-prefix 描述。证据约束、工具路由和表达规则发生重复；根 `AGENTS.md` 又属于开发代理，不能混入查询上下文。

## 决策

以 `knowledge/AGENTS.md` 作为所有查询模式唯一的人工指令源，仅承载短查询决策契约。`agent.ts` 根据实际工具集附加模式、可用工具和调用上限，不再手写平行行为规则。删除 `knowledge/SKILL.md` 与 rules-prefix 运行路径；具体干员解释进入 facts notes，详细事实、机制、数值、组合与建议保留在 references/base/guides 按需查询。

## 理由

单一人工指令源消除遵循竞争和维护漂移；机械能力由代码从实际配置生成，不会与工具集失配。只保留能预防重复错误且无法由代码强制的规则，可避免把开发流程、百科事实和通用写作习惯常驻注入。

## 备选方案

- 把查询方法加入根 `AGENTS.md` — 放弃原因：会把开发、提交和文档流程注入 Qwen，并增加无关 token。
- 保留 `SKILL.md` 作为人工交互手册 — 放弃原因：查询运行时不消费它，继续维护只会形成第二份行为说明。
- 保留 rules-prefix 实验开关 — 放弃原因：历史实测未带来质量收益且增加成本；归档结果足以保留决策依据。
- 全部方法继续由 `agent.ts` 拼写 — 放弃原因：模式分支会复制证据与表达规则，无法形成单一真源。

## 后果

全部检索模式共享同一短决策契约，历史 BM25/grep 的 prompt 语义因此发生版本变化；既有运行结果保持不变，新运行通过 AGENTS 内容哈希区分。具体事实仍以工具返回为准，AGENTS 不成为游戏事实来源。

## 关联

- 规划文档：`docs/plan-agent-facts-knowledge-layering.md`
- 扩展需求：`docs/inbox.md` 的“R5 查询 Agent 知识分层”和“R5 查询 Agent 指令单一真源”
