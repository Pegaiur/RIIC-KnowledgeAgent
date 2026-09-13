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

### 2026-09-13 — 第 2 步：关联解析与机械检查的落地方式

- **plan 原文**：「用少量现有小节作为能力验证样本（办公室联络选择、源石制造及含替换关系的对象），仅新增旁挂标注，不改正文或新增标签」「生成器检查定位、引用存在性/解析唯一性及映射一致性」。
- **实际做法**：新增 `bench/src/prose-links.ts`（`loadProseLinkFile` 读取/校验旁挂文件，`resolveProseLinks` 连接小节目录与 references 事实解析为当前内部 ID，`buildProseLinkIndex` 做真源装配）；机械检查汇总到 `ProseLinkIndex.issues`，由 `bench/tests/prose-links.test.ts` 断言真实语料 issues 为空。样本标注落在 `knowledge/prose-links.json`：办公室小节关联凯尔希·思衡托、斥罪、普罗旺斯、遥、艾雅法拉及普罗旺斯的升级技能（含替换关系），源石小节关联褐果、炎熔、艾雅法拉。
- **原因**：解析必须连接小节目录（定位）与 references 事实（内部 ID），放在 bench/src 可直接复用既有 `buildSectionDirectory` 与 `loadReferenceFacts`，避免在 scripts 侧反推真源。
- **后果**：解析问题可降级（跳过无效对象并记 issue），但真源语料要求零 issue；后续语料新增标注只改 `knowledge/prose-links.json`。
- **补充**：条目内重复引用去重并记 issue（对齐 ADR-020 §2「条目内引用无重复」的检查口径）；旁挂文件仅在 ENOENT 时视为无标注，其它读取失败报中文错误，不静默降级。

### 2026-09-13 — 第 3 步：RAG 关联事实入口的装配与观测

- **plan 原文**：「rag_search 继续按现有正文范围返回，额外给出对应小节的可展开提示和可调用定位」「即使原文被按文件扩展，也保留关联所属小节」「元数据与原文分离装配，原文分词、切块与排序输入保持一致」。
- **实际做法**：`buildSectionContext` 增「【关联事实入口】」块，按命中小节所属文件列出登记了非空关联的小节（整行可复制 ID，原子行，空间不足整行省略）；新增 `LinkedEntryObservation`（sectionId/file/objectCount/written），提示不计送达、仅导航；`rag_search` 描述补充该能力。runner 装配 `buildProseLinkIndex(process.cwd(), config.corpusDir)` 并经 `KnowledgeToolContext.links` 下发，同时写入 `inputs.links`（条目/对象数/解析问题，不含正文）。`TOOL_SCHEMA_VERSION` 13→14；trace 的 tool_call、records 的 ragDelivery、snapshot 白名单与 meta 汇总（`ragDeliveryStats.linkedHints`，按 written 计数）同步。
- **原因**：提示必须与实际送达可区分，且不能按篇继承或自动附带；观测沿用既有分层（提示写入正文才计 linkedHints，未写为 0 或不可用）。
- **后果**：跨该变更做质量/成本对照须注意工具 schema 版本与提示词/返回差异；既有两份基线早于本变更，不含 linkedEntries 观测。
- **复核调整**：按独立审查把关联事实入口块移到既有小节上下文（父级引导、小节导航）之后，确保只用剩余预算；agent 侧 `linkedEntries` 未执行也记空数组，避免一次参数错误使整轮 `linkedHints` 不可用（历史缺字段仍为 null）；`buildProseLinkIndex` 在无标注时短路，不装配小节目录与 references 事实。提示文案中的 read_section `linked` 参数在紧随其后的第 4 步落地，其间不单独跑测或发版。

## 债务记录

（待后续步骤记录）

## 意外发现

### 2026-09-13 — plan 样本小节名与正文实际标题不一致

- **发现**：plan 第 2 步写作「办公室联络选择、源石制造」，正文实际标题为 `guides/高效率散件.md` 的 `## 办公室联络散件` 与 `## 源石碎片制造（搓玉）`。
- **影响**：不修改 plan 正文；标注按实际「文件 + 标题路径」登记（`人工定位使用文件与标题路径` 本就是 plan 要求），测试断言使用实际标题路径。

## 阻塞与解决

（暂无）
