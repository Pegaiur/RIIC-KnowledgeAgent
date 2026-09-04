# ADR-004：查询 Agent 采用三层知识结构

- 日期：2026-09-04
- 状态：已实施

## 背景

通用基建规则散落在 `knowledge/SKILL.md` 与 base，查询 Agent 又不会读取仓库根 `AGENTS.md`；具体干员案例常驻提示会增加输入并污染无关问题，而只靠 RAG 又会让基础判断依赖召回。

## 决策

新增由 facts 与 hybrid 模式默认注入的 `knowledge/AGENTS.md`，承载稳定通用知识和工具契约；具体干员的跨技能解释进入 facts notes；详细机制、数值、组合与建议保留在 base/guides 按需检索。历史 BM25/grep 模式不默认注入，以维持既有对照语义。

## 理由

三层结构让常用基础不依赖召回，又避免把对象级细节和完整语料塞进 system prompt。每类知识只有一个主要运行时落点，迁移后删除重复内容即可控制漂移，无需另建全量审阅台账。

## 备选方案

- 把领域知识加入根 `AGENTS.md` — 放弃原因：只影响开发代理，不会进入 Qwen 查询上下文。
- 扩写旧 `rules-prefix.ts` — 放弃原因：该模块是默认关闭的历史检索词实验，且需要保留对照语义。
- 所有内容继续走 RAG — 放弃原因：作用域、工具契约和基础判断仍受召回波动影响。

## 后果

facts/hybrid 的 system prompt 增加一段稳定前缀；修改常驻知识时需要运行提示注入和相关答案回归。具体技能事实仍以 references 投影为准，AGENTS 不成为干员数值来源。

## 关联

- 规划文档：`docs/plan-agent-facts-knowledge-layering.md`
- 扩展需求：`docs/inbox.md` 的“R5 查询 Agent 知识分层”
