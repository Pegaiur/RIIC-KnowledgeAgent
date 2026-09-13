# 实施笔记：散文关联知识与按需展开

> 对应 plan：docs/plan-prose-linked-knowledge.md
> 开始日期：2026-09-13

## 第 1 步交付：引用契约、旁挂位置与展开协议（施工契约）

> plan 第 1 步要求「具体文件名和可读引用字段在本步骤记录为施工契约，并为 read_section 扩展及相关公共接口按判据建立 ADR」。完整决策见 ADR-020，此处只记施工契约事实。

### 旁挂文件与条目

- 文件：`knowledge/prose-links.json`（顶层 `version` + `links` 数组）；不进入 corpus-manifest，不参与分词/切块/排序。
- 条目定位：`{ file, headingPath: string[], occurrence?: number, objects: ObjectRef[] }`；`headingPath` 为 H1→当前标题路径，`occurrence` 仅在同文件同路径有重复标题时用于消歧，缺省按唯一匹配。

### 可读对象引用（两个 kind）

- `{ "kind": "operator", "canonical": "<名册标准名>" }` → 解析 `operator:<canonical>`（名册真源，稳定锚点）。
- `{ "kind": "skill", "operator": "<标准名>", "room": "<设施>", "name": "<技能名>", "unlock"?: "<解锁文本>" }` → 生成期解析到当前 `skill:`/`grant:` 内部 ID；`unlock` 仅在 (operator, room, name) 命中多条 grant 时用于消歧。

### read_section 扩展

- 新增可选布尔参数 `linked`；缺省/`false` 保持读取原文与既有分页契约不变。
- `linked=true` 与 `offset` 互斥；返回登记对象的记录卡，不走别名/子串/同名入口，不递归扩张。

### 版本

- `TOOL_SCHEMA_VERSION` 13→14（read_section 参数 + rag_search 返回数据语义扩展，合并一次递增）；`FACTS_RESULT_VERSION` 保持 7。

## 决策偏离

### 2026-09-13 — 旁挂标注落在 knowledge 数据层 JSON，而非 bench curation

- **背景**：plan 要求「在 knowledge 数据层旁挂关联元数据」，但未指定物理文件；docs/plan-index-and-tags.md「第 1 步交付」前例把人工说明放在 bench/src/facts/curation/*.ts。
- **选项**：
  - A：`knowledge/prose-links.json`，随语料数据层一起维护。
  - B：`bench/src/facts/curation/*.ts`，与关键词目录人工说明同构。
- **决策**：选 A。理由：标注的目标是小节（knowledge 正文）与事实对象（knowledge/references），plan 明确「可读引用…生成时再解析」，且要求「给语料计划提供标注格式和操作说明，后续语料只维护关联内容」；放 knowledge 数据层使标注与正文同源维护，避免在 bench 中重复保存正文定位。同类数据 `corpus-manifest.json` 亦在 knowledge 根。
- **影响**：解析器需从 corpusDir 旁读 JSON；缺文件表示无标注（空关联合法），保证无标注语料（含测试临时目录）行为不变。

## 实现调整

（待后续步骤记录）

## 债务记录

（待后续步骤记录）

## 意外发现

（待后续步骤记录）

## 阻塞与解决

（暂无）
