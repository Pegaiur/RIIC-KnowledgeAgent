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

### 2026-09-13 — 第 4 步：read_section 显式展开的落地与观测

- **plan 原文**：「保留默认读原文行为；增加显式选择关联事实的能力」「展开直接解析登记引用，复用 facts 对象读取及卡片展示，不经过别名、子串或同名全部返回入口」「响应区分原文与关联事实，标明关联小节和实际返回对象」。
- **实际做法**：`read_section` 增可选布尔参数 `linked`（默认 false 保持原文与分页契约；与 offset 互斥，非布尔或未知字段拒绝）；`linked=true` 走 `readLinkedFactsOperation`，按 `ProseLinkIndex.bySection` 的登记对象经 `store.byCanonical` 直接取卡并复用 `serializeCard`，不递归；响应以「【read_section｜关联事实】」区分原文，列出登记引用→返回对象、未返回原因，`hitIds`/`injectedIds` 取实际送达 canonical；新增 `LinkedFactsObservation` 经 trace 的 tool_call 记录。ADR-020 状态由「已决策」改为「已实施」并同步 INDEX。
- **原因**：直接按 canonical 取卡可保证「明确引用」与「自然语言搜索」边界（ADR-010），替换关系随整卡展示；默认分支零改动避免影响既有阅读行为。
- **补充**：`TOOL_SCHEMA_VERSION` 保持 14（第 3 步已合并递增），`FACTS_RESULT_VERSION` 保持 7。
- **口径说明**：linked 展开的 `hitIds`/`injectedIds` 取实际送达 canonical（与 facts_search 一致），成功展开会计入 toolBatch.hitCount，跨版本比对命中数时须注意；read_section 不回写共享注入列表，injected.json 不受影响。ADR-020 状态在步骤 1–4 完成后改为「已实施」，步骤 5 的独立验证与合并检查另行收束。

### 2026-09-13 — 第 5 步：独立验证证据与交接

- **plan 原文**：「用现有正文和旁挂标注验证提示可见、主动选择有效、事实解析正确；比较开启前后的正文分词/检索输入及既有阅读行为，确保元数据没有暗改召回。给语料计划提供标注格式和操作说明」。
- **验证证据**：
  - 现有小节与标注：`prose-links.test.ts` 断言真实语料 `issues` 为空、`guides/高效率散件.md` 的「办公室联络散件」「源石碎片制造（搓玉）」两小节可解析、对象非空且含技能 grant 细化；`prose-links-hint.test.ts`（6 例）验证提示可见、按文件逐小节、容量不足整行省略、提示不计送达、元数据不入检索输入；`prose-links-read.test.ts`（8 例）验证默认原文阅读不变、`linked` 只展开登记对象、skill 卡保留设施/替换、同卡去重、取不到卡显式报告、参数互斥与校验。
  - 运行时送达（`pnpm run bench:dry`，2 题、不发真实请求）：运行目录 inputs.json 记录 `links:{version:1,linkCount:2,objectCount:9,issues:[]}`、`toolSchema.version=14`、`rag.chunkCount=145`、`sections.sectionCount=764`；meta.json 记 `toolSchemaVersion=14`、`ragDeliveryStats.linkedHints=0`；报告渲染含「关联入口」项。该次两题未命中已标注小节，故 linkedHints 为 0，可据实说明未观察到提示送达。
  - 召回未变：本计划 4 次提交未改动 corpus.ts / retriever.ts / terms.ts / corpus-manifest.json（`git diff --name-only 4ee4478..HEAD` 无这些文件），`knowledge/prose-links.json` 非 `.md`，不进入白名单、分词、切块与排序。
- **交接**：标注格式与操作说明见本笔记第 1 步「引用契约、旁挂位置与展开协议」；后续语料只维护 `knowledge/prose-links.json`（新增/迁移小节改定位，事实更新由 `buildProseLinkIndex` 重新解析），非空标注的无效引用由 issue/测试显式报告并修正。
- **后果**：plan 第 9 项「最终文档/合并检查」留待发版收束（活动 plan 未勾选会使 doc-check D1 与合并门禁保持红灯，属预期），本计划维持施工中。

### 2026-09-13 — 复核发现的两处边界缺陷与修复（P2 失效引用、P3 去重身份）

- **P2：解析失败引用被丢弃**。原实现在 `resolveObject` 解析失败时仅记 issue 并返回 undefined，调用方 `continue` 丢弃，展开结果因此只统计解析成功者、`omitted` 为空，Agent 与该次 trace 看不到缺失（实测「普罗旺斯 + 一个失效技能」展开仅报 1 个对象）。修复：新增 `UnresolvedProseObject` 与 `ResolvedProseLink.unresolved`（按登记顺序保留可读回显与原因）；`readLinkedFactsOperation` 把 unresolved 计入 `requested`，并在 `omitted` 及响应「未返回」行报告原因，合法对象照常返回；仅有失效引用的小节不再误报「没有登记可展开的关联事实」。
- **P3：同一技能不同写法绕过去重**。原实现以回显文字（`ref`）为去重键，省略/填写可选 unlock 会解析到同一 grant 却计为两个对象且 issues 为空。修复：新增 `objectIdentity`，按解析后身份去重（技能细化到 `grantId`，干员定位到 `canonical`），保留首个可读引用用于展示，重复时记 issue。
- **验证**：先写失败测试（prose-links.test.ts 3 例新增/加强、prose-links-read.test.ts 2 例新增）并观察 5 例失败，再实现；`pnpm run typecheck` 通过，全套 `pnpm run test` 48 文件 613 例通过。既有夹具（prose-links-hint、inputs）补 `unresolved: []`，`LinkedFactsObservation.requested` 注释同步为「解析成功者在前、失败者随后」。

### 2026-09-13 — 第 9 项验收回退为待完成

- **原因**：复核确认「最终文档/合并检查通过」尚未成立——`node scripts/doc-check.mjs` 仍有 9 条 D1（均来自同分支 docs/plan-corpus-supplement.md、docs/plan-index-and-tags.md 的活动 plan），合并门禁 `node scripts/verify.mjs merge` 被阻塞；且本计划全勾选未冻结亦触发 release/check P1，故不提前勾选。
- **现状**：plan 第 79 项保持 `[ ]`；本计划实现与定向验证通过，收尾（归档）与合并门禁待三份计划收齐后统一执行。

## 债务记录

### 2026-09-13 — PLK-1 关联载荷体积

- **债务**：read_section 的 linked 展开首版不设分页或截断，一次展开全部登记对象，结果体积可能超过 maxContextChars；plan 将体积/分页列为非目标。代码锚点：bench/src/tool-executor.ts 的 `readLinkedFactsOperation` 顶部 `TODO(tech-debt) PLK-1`。
- **未来偿还**：需要控制关联载荷体积时，引入分页或截断，并同步重定义 complete 与命中/送达口径。

## 意外发现

### 2026-09-13 — plan 样本小节名与正文实际标题不一致

- **发现**：plan 第 2 步写作「办公室联络选择、源石制造」，正文实际标题为 `guides/高效率散件.md` 的 `## 办公室联络散件` 与 `## 源石碎片制造（搓玉）`。
- **影响**：不修改 plan 正文；标注按实际「文件 + 标题路径」登记（`人工定位使用文件与标题路径` 本就是 plan 要求），测试断言使用实际标题路径。

### 2026-09-15 — 数据层事实对象（原 knowledge/references）路径已迁移

- **发现**：本 plan 与笔记中的 knowledge 数据层事实对象（名册、技能分片、技能等价组）已随目录迁移改记 knowledge/raw/，类别与歧义改记 knowledge/guides/；迁移细节见 docs/plan-progressive-disclosure-notes.md。
- **影响**：不修改本 plan 正文，上述事实定位按新位置理解；迁移范围、manifest 计数与旧参数退役以 docs/plan-progressive-disclosure-notes.md 为准。

## 阻塞与解决

（暂无）
