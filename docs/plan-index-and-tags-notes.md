# 实施笔记：索引与标签框架

> 对应 plan：docs/plan-index-and-tags.md
> 开始日期：2026-09-13

## 第 1 步交付：共同语义与对象约定

> plan 第 1 步要求输出「可执行的词义/入口与对象约定，记录在本计划实施笔记」，供 docs/plan-prose-linked-knowledge.md 独立消费。本节为最小事实对象语义与「明确引用 / 自然语言搜索词」的边界，不依赖标签入口或语料迁移。

### 最小事实对象

| 对象 | 身份 | 稳定锚点 | 说明 |
|---|---|---|---|
| 干员 | `operator:<canonical>`（ADR-010） | 名册标准名（稳定） | canonical 取自 knowledge/references/名册.md；可作人工锚点 |
| 技能 | `SkillFact`，内部 id `skill:<原文哈希>` | 无稳定内部 id | id 随效果/注记原文变化，不作跨版本人工锚点 |
| 持有关系 grant | `grant:<原文哈希>` | 无稳定内部 id | 绑定 operator + skill + 解锁（unlockKind/elite/level）+ replacesGrantId |
| 设施 | 设施名（`REFERENCE_ROOMS` 九项固定序） | 设施名（稳定） | 办公室、发电站、会客室、加工站、控制中枢、贸易站、宿舍、训练室、制造站 |
| 标签 | 技能行〔标签：…〕的值（`SkillFact.tags`） | 标签文本 | 当前 44 个不同值、跨设施共 45 项；只描述被加成对象/功能，不等于完整效果等价 |
| 产物 | 〔作用产物：…〕的值（`SkillFact.products`） | 产物名 | 当前枚举 7 项：赤金、作战记录、源石碎片、精英材料、基建材料、技巧概要、芯片 |
| 引用术语 | 〔引用术语：…〕的值（`SkillFact.referencedTerms`） | 术语名 | 指向类别/资源/组合等已登记主题 |
| 技能组 | 类别.md「技能组」（5 条） | 组名 | 如标准化类技能 |
| 阵营/干员组 | 类别.md「干员组」（28 条，=名册阵营组） | 组名 | — |
| 组合 | `combo:<规范名>`（ADR-010） | 组合规范名 | 登记于 bench/src/facts/curation/terms.ts 的 combos；当前 19 个 |

技能—持有者—解锁—替换关系必须逐项保留：同一技能可由多名干员持有，同一干员可能在不同练度解锁或替换；不得由「描述相同」推断「完整效果等价」，不得把组合收益写成单人固定值。

### 明确引用与搜索词的边界（沿用 ADR-010）

- **自然语言搜索词**：`facts_search` 的 queries 走 exact → alias → 已登记子串 → combo 路径，允许同名全部返回、登记别名与短名扩展，不消歧。
- **人工明确引用**：不走别名、子串或同名集合扩展；必须解析为唯一对象，缺失或歧义显式报告，不猜测迁移。
- 干员明确引用用 `operator:<canonical>`；技能/grant 明确引用用可读坐标（设施 + 技能名 + 持有者 + 解锁/替换），生成期解析到当前 `skill:`/`grant:` id，**不直接以内部 id 作跨版本锚点**。

### 目录层级与入口约定

- 常驻目录层级：设施 → 产物/功能 → 机制条件 → 资源/类别/技能组 → 组合。
- 覆盖全部已登记主题与类别；干员名（425）与技能名（697）不由常驻目录逐项铺开，继续走精确索引。
- 入口标记沿用 plan：F = facts 登记类别已核对（可用 `facts_search`）；R = `rag_search` 有内容依据但未实跑验证召回排名；标签独立入口在步骤 3 接通前如实标当前路径。

## 决策偏离

### 2026-09-13 — 关键词目录的生成与注入方式

- **背景**：plan 第 2 步要求「从现有事实登记、标签、类别和正文主题取得词条，人工维护规范词与范围说明，生成可随 knowledge/AGENTS.md 一起送达的目录」，但未指定生成器落位、生成物位置与注入点。
- **选项**：
  - A：生成器放 `bench/src`（可直接读 facts 登记、`类别.md`、`TERM_CURATIONS` 等真源），生成物入库，经 CLI 子命令生成/检查；注入点扩展现有 `loadKnowledgeAgentInstructions`。
  - B：生成器放 `scripts/tasks/knowledge`，从 knowledge markdown 反推真源（组合名从 guides 标题取）。
- **决策**：选 A。理由：组合等真源在 TS（`bench/src/facts/curation/terms.ts`），scripts 与 bench/src 存在既有的分层/构建约定（间接依据见 scripts/tasks/bench/facts-evidence-observation.mjs 的 R5-10 债务注解、以及 update-reference-projection.mjs 自行重复声明设施而非 import），B 会造成真源漂移；A 可复用既有 curation 作为人工维护位置，生成物与真源在同一构建内保证一致。
- **影响**：新增 `bench/src` 目录生成模块与 CLI 子命令；新增门禁步骤（生成物一致性）；运行时 system prompt 增加目录段，`agentInstructionsSha256` 随内容变化。

### 2026-09-13 — 人工说明与机器汇总的维护位置

- **背景**：plan 要求「人工说明和机器汇总各保留一处维护位置」「不高手写第二份长名单」。
- **选项**：
  - A：人工说明单独一份 Markdown；B：人工说明进入 bench curation（与既有 `curation/*.ts` 同构）。
- **决策**：选 B。人工维护「规范词、范围说明、入口」等无法机器推导的部分，落在 `bench/src/facts/curation/` 下的说明模块；机器汇总（设施/标签/类别/组合的枚举与入口）由生成器从真源取得。两处职责不重叠。
- **影响**：新增 curation 说明模块；生成物只由生成器产出，禁止手改。

### 2026-09-13 — 标签反查入口协议（步骤 3 施工契约）

- **背景**：plan 要求「现有 facts 工具增加显式标签入口，保持普通 queries 的精确词条语义；不自动合并同名职业、设施和标签」，并把参数与宽标签送达方式留待本步骤编码前确定。
- **选项**：
  - A：复用 `queries`，靠同名类别自动识别为标签；B：新增独立可选参数 `tags`。
- **决策**：选 B。`facts_search` 增加可选 `tags` 字符串数组；`queries` 语义完全不变；同名职业/设施/标签不自动合并——走 `tags` 只返回标签派生结果，走 `queries` 只按六类精确词条/别名/子串/组合。派生链为 标签 → 设施 → 技能 → grant → 干员，卡级按 canonical 去重聚合，同卡多命中保留各命中依据。
- **影响**：facts_search schema 与结果协议版本递增；需按判据建立 ADR；`queries` 与 `tags` 至少提供其一。新增 ADR 必须显式界定本入口对既有条款的局部替代范围：ADR-015「不再保留单字符串入参或第二字段」与 ADR-010 §5「不新增参数」原为精简精确词条入口而设，本标签入口是 plan 明确要求的不同语义入口，需在 ADR 中说明其边界（仅标签派生，不改变 `queries` 精确词条语义、不自动合并同名职业/设施/标签）。

### 2026-09-13 — 宽标签分页契约（步骤 3 施工契约）

- **背景**：plan 要求「宽标签不静默 Top-N 或截断卡片，必要分页明确覆盖范围，具体分页契约在本步骤实施前确定」。
- **决策**：标签结果不做静默截断。新增可选 `offset`（非负整数，默认 0）与页大小上限；返回元数据给出命中总数、本页返回数、`next_offset` 与 `complete`；每张卡保持完整。**页大小取 20 张记录卡（`FACTS_TAG_PAGE_CARDS`）**，作为固定常量不单独配置：按真实来源标签复核，44 个标签中最大命中为「订单效率」73 张、共 12 个标签超过 20 张，取 20 既限制单次结果体积，又能用 `offset` 覆盖全部命中。
- **影响**：标签入口需携带分页元数据；不改变 queries 路径（queries 仍一次完整返回）。

## 实现调整

### 2026-09-13 — 关键词目录生成与交付的落地方式
- **plan 原文**：「从现有事实登记、标签、类别和正文主题取得词条，人工维护规范词与范围说明，生成可随 knowledge/AGENTS.md 一起送达的目录」。
- **实际做法**：生成器落 bench/src/catalog.ts，人工说明落 bench/src/facts/curation/catalog.ts；生成物为 knowledge/关键词目录.md（178 条数据行、约 1.75 万 UTF-16 字符）；重算入口 `node dist/cli.js catalog`、比对入口 `--check`；`loadKnowledgeAgentInstructions` 在 AGENTS.md 之后追加目录正文；生成一致性由 bench/tests/catalog.test.ts 按真源重算比对保证，未在门禁命令清单新增步骤（符合 ADR-018 决策 5）。
- **原因**：组合等真源在 bench/src，scripts 按分层约定不共享，避免反推造成真源漂移。
- **后果**：system prompt 增加约 1.75 万字符，agentInstructionsSha256 随内容变化；目录只列真实可用入口，标签独立入口仍标 R/当前路径，待步骤 3 接通后同步。既有两份质量基线（bench/results）生成于目录引入前，其 agentInstructionsSha256 与后续运行不同，跨该变更做质量或成本对照时须注意提示词差异。

### 2026-09-13 — 标签反查入口落地与目录同步
- **plan 原文**：「现有 facts 工具增加显式标签入口」「首版保留完整卡并前置命中设施技能，按设施与名称稳定排序」。
- **实际做法**：`RecordSkill` 新增 `tags`（投影自 `SkillFact.tags`）；store 增 `factsSearchByTags`（标签 → 设施 → 技能 → grant → 干员，卡级 canonical 去重、同卡多命中保留全部依据，按最小设施序 + canonical 稳定排序）；`facts_search` 增 `tags`/`offset`，`queries` 与 `tags` 互斥、`offset` 仅随 tags；页上限 `FACTS_TAG_PAGE_CARDS=20`；`TOOL_SCHEMA_VERSION` 12→13、`FACTS_RESULT_VERSION` 6→7，结果元数据新增 `tagPage`；命中技能前置并逐卡给出命中依据；目录来源标签行入口由「标签独立入口尚未接通」改为 `F：tags`，重算生成物。
- **原因**：见 ADR-019；接口说明归工具 schema，不在 knowledge/AGENTS.md 重复定义。
- **后果**：RAG 内部 facts 附带仍只走 `factsSearch`，未改 ADR-013 语义；技能—持有者—解锁—替换逐项保留，标签不参与 RAG 自动附带。

### 2026-09-13 — 第 3 步运行时送达证据与验收清单勾选
- **plan 原文**：plan 要求「验证目录覆盖、生成一致性以及运行时实际送达，不以文件存在代替已注入」；施工进度以验收清单 checkbox 为唯一机械信号。
- **实际做法**：以 `pnpm run bench:dry`（2 题、不发真实请求）做运行时送达核对：运行目录 inputs.json 的 `agentInstructions` 含「查询关键词目录」正文，`systemPrompt` 含 `F：tags` 且不含 provenance 注释，meta.json 记录 `agentInstructionsSha256=cc462b16…`、`toolSchemaVersion=13`。据此勾选 plan 验收清单前 8 项。
- **原因**：plan 要求「验证目录随查询 Agent 指令实际送达」，不以文件存在代替已注入；dry 运行的真实快照是送达证据。
- **后果**：最后一项「文档及最终合并/发版检查通过；质量试验按 exp 流程」留待发版收束，本计划维持施工中。第 4 步「接收语料反馈并收束」按 plan 为依赖 docs/plan-corpus-supplement.md 的持续通道，不在本次批量交付。

### 2026-09-13 — 第 2/3 步与计划对齐的三处修正
- **plan 原文**：「应按实际登记逐项标注入口，未接通的只标 R」「建议明确展示可直接使用的 tags 值」「应将同设施其他技能及替换关系一起放在其他设施之前」。
- **实际做法**：① 类别区段改为按现有登记逐项标注：全局资源 4 条、规则说明 17 个名称（共 23 行）无对应 facts 词条，入口改标「R：类别定义；F 无对应登记词条」；新增 catalog.test.ts 用例校验类别区段的 F 标注与 `factsSearch` 是否有命中一致，防止再引导空查询。② 来源标签行只要规范词不等于原始标签就附注「（来源标签：X）」，不再用「互相包含」省略，使「近卫（训练速度）」「线索1（线索倾向）」等可直接取到可传入 `tags` 的原始标签值。③ 标签卡排序由「命中技能前置」改为「命中设施技能前置」：命中技能 → 同设施其他技能（含替换关系）→ 其他设施技能，各组内保持原卡顺序，整卡不裁剪。
- **原因**：均为实现与 plan 第 2/3 步要求不一致的实际缺陷（空查询引导、tags 值不可直接使用、同设施技能被其他设施技能隔开），非新增需求。
- **后果**：重算 knowledge/关键词目录.md；tags 卡内技能顺序变化不改变命中集合与完整卡；无公共契约变更，不新增 ADR。

## 债务记录

### 2026-09-13 — IDX-1 常驻目录体积
- **债务**：关键词目录约 1.75 万字符随每次查询注入 system prompt，显著增加输入长度；当前只验证覆盖与生成一致性，未测量其对成本与时延的影响，也未压缩同类重复说明。代码锚点：bench/src/catalog.ts 顶部 `TODO(tech-debt) IDX-1`。
- **未来偿还**：成本或质量试验表明不划算时，评估压缩呈现（合并同类说明、按需展开），须保持覆盖与入口如实，不以压缩为由漏标能力。

## 意外发现

### 2026-09-13 — plan 引用的标签真源文件不存在

- **发现**：plan 0.2 节第 87 行以 knowledge/references/技能-对应设施.md 作为来源标签真源，但该文件不存在；实际是九份 `knowledge/references/技能-<设施>.md`，标签写在每行技能末尾的〔标签：…〕注记里。
- **影响**：不修改 plan 正文；按实际真源（九份分片 + `SkillFact.tags`）实施。标签 44 个不同值、跨设施 45 项，与 plan 盘点一致。

### 2026-09-15 — 正文引用的 knowledge/references 路径已迁移

- **发现**：plan 第 27、87、141 行提到的 knowledge/references（名册、技能分片、类别）随目录迁移改记 knowledge/raw/（名册、技能分片、技能等价组）与 knowledge/guides/（类别、歧义）；目录迁移细节见 docs/archive/plan-progressive-disclosure.md 实施纪要。
- **影响**：不修改本 plan 正文，上述引用按新位置理解；迁移范围、manifest 计数与旧参数退役以 docs/archive/plan-progressive-disclosure.md 实施纪要为准。

## 阻塞与解决

（暂无）
