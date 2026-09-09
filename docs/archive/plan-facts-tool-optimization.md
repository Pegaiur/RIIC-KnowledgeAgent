# facts 工具优化与契约测试计划

> 创建日期：2026-09-07
> 状态：已完成
> 需求入口：[inbox](../inbox.md)
> 前置：[独立工具计划](plan-independent-tools-schema.md)、[策略评估](../exp-harness-performance.md#按设计契约调整策略2026-09-07)

## 目标与边界

后续草案定向为 facts 工具优化：确认 `lookup`、`query_operators` 的输入、查询和输出契约，使模型能区分无匹配、合法结果及参数错误，并理解事实匹配范围。独立工具拆分作为现有基础，不重新施工。

本轮不进行付费跑测。问题判定依据为代码与既定职责，测试负责验证这些契约，不以当前题集正确率、lookup 调用占比或省钱比例决定设计。不增加必须调用 facts 的规则，不修改 auto、5 点预算、错误扣点、检索排序或游戏事实。

## 当前能力与问题分级

核对基点：`b2de56cdd157`。范围为 `bench/src/facts/store.ts`、`card.ts`、`project.ts`、`bench/src/tool-executor.ts`、schema、trace/report 与现有 facts 测试。下列直调仅核实机械行为，未调用模型。

### F-01：确定缺陷——空结果状态与命中集合不一致

`serializeCards([])` 返回非空占位文本；`executeOne` 用 `output.data` 的真假决定 success/empty。因此 `lookup({term:"__不存在的规范名_核查__"})` 与不存在设施的分类查询均出现 `executed=true, hitIds=[], status=success`。输入合法、查询已执行与结果有命中是三个不同事实，当前返回把后两者混淆。既有 empty 状态及独立工具草案都要求可明确识别空结果。

拟修正：facts 用实际命中数组确定 empty/success，保留 executed=true、空 hitIds/injectedIds、预算正常扣点和原有无匹配说明。不将空结果改为 invalid_params，也不因此终止 agent。存储/真源异常仍是 error/fatal，不伪装成空查。共享 executor 中 RAG/grep 的既有返回语义不顺带修改。

### F-02：设计缺口——分类字段含义与可用值不够明确

`query_operators` 的 room/faction/profession 是精确匹配；termQuery 是字面子串，多个条件为 AND。工具只说“已有分类”，未提供完整可用值；模型必须猜测名称。未知非空值在现协议下是合法查询但无匹配，不能据此认定校验器有 bug。

第一阶段仅校正 schema 描述：明确精确匹配、AND、termQuery 对设置 room 后的技能作用域，以及 excludeIds 的 canonical 身份；不扩大名称匹配能力。room/profession 的小型枚举或分类发现接口作为第二阶段候选：须使用既有权威定义，不手抄名单；确定未知值是参数错误还是合法空查后再落接口。faction 不以超长 enum 常驻，第一阶段继续字符串。

### F-03：设计风险——宽查询完整返回但没有结果边界

store 对合法过滤完整返回，serializeCards 全量输出，facts 未应用 RAG 的 maxContextChars。机械直调当前 `termQuery="进驻"` 命中 423 卡、序列化 60,995 字符；`profession="近卫"` 命中 83 卡、12,450 字符。当前行为不违反已约定的“完整返回”，不能直接截断后宣称修复。

第一阶段增加可解释的结果数量和范围信息；第二阶段再决定是否做显式分页。若分页，必须记录 matchedCount/returnedCount/hasMore 或下一页游标、固定排序、筛选及数据指纹，保留完整记录边界，不截半条技能、不把第一页当全量名单；不在本次小修中偷偷加默认 topK。分页会改变公共协议，应另定稿并补 ADR。

### F-04：呈现限制——匹配依据与输出范围容易混淆

lookup 命中后输出整张卡，技能名还可能通过等价组展开多卡；query_operators 可因 canonical/关键词或同设施技能命中，随后按 room/termQuery 投影。模型看见“命中卡”不一定知道是名称、技能还是等价组命中。卡头列全部设施，skillGroups 和卡级备注也保留全量，不能把这些卡级属性误读为当前设施专属。该行为部分是既有“保留全部审定备注”的要求，因此属于需澄清的呈现限制，不是已经证明的跨设施检索 bug。

第一阶段明确 scope：原样回显已验证的查询字段；分类查询结果说明“卡头为干员全局属性；技能行为当前查询投影，不保证包含该卡全部技能”。无 room 但有 termQuery 时同样可能裁剪技能：关键词命中技能时只展示匹配技能，命中 canonical/卡级字段而没有技能命中时回退展示 scopedSkills；必须保留这一既有差异。每条输出技能显式标注已有 room，缺 room 的兼容 fixture 显示未知，不猜设施；保留解锁、替换关系、技能备注和卡级约束。第一阶段不增加 matchedBy 或技能级裁剪到 lookup；待确需精确解释等价展开时再设计结构化匹配证据。

### 已知能力边界，不在本轮修复

- R5-2：真实投影 aliases 为空，当前只承诺已核验的 canonical、技能名、技能组和等价组精确查询。不得靠模型生成别名或添加评测名称特判。
- 无数值效率排序、无精英等级筛选、无默认只返回最高练度技能；旧版与升级版并存是事实，不是重复错误。
- “技能等价名返回多位持有者”和“room+termQuery 同设施技能匹配”已有明确契约，必须保留。
- singleton 按当前本机单根任务使用；多根进程隔离不是本轮功能。测试使用 buildCardStore 的合成卡或独立进程，不能依赖修改 cwd 后自动重载单例。

## 实施方案

1. 在 facts 派发边界以 hits.length 确定空/成功；底层查询和预算不变。结果增加仅适用于 facts 的结构元数据：`matchedCount`（匹配卡数）、`returnedCount`（本阶段等于 matchedCount）、`complete:true`（本次过滤所得卡集合完整返回）、`scope`（经过校验和 trim 的实际查询参数）。complete 不表示每卡全部技能都被展示，也不表示知识库完备或答案正确；分类结果的投影范围说明必须与此同时出现，不能只回显参数让模型猜测。
2. 结果 metadata 放在现有 envelope 顶层，不将事实卡 data 二次 JSON 字符串化；status/executed/data/budget_remaining 保持。参数错误、拒绝和系统异常不携带伪造的零数量；计数缺失代表未查或未知，不等于无匹配。
3. serializeCards 输出的技能行增加明确设施标签，保留全部审定备注、解锁和替换。所有 query_operators 结果均说明卡级属性与技能投影的不同范围，覆盖 room 和 termQuery-only 路径。lookup 全卡语义保持，查询的匹配集合不变。
4. schema 精炼术语和匹配语义，不增加新输入字段、enum、模糊匹配或分页；模型根据实际证据决定继续查或回答，不强制补 lookup。
5. trace 的 writtenContent 与发给模型的 tool content 同源；report 继续以 hitIds 判定命中，新 metadata 仅增强可解释性。新增字段需同步相应 types/序列化与兼容测试；持久化格式只在新字段实际进入该格式时扩展，旧快照不回填。工具 schema 描述变更同步 schema 指纹/版本；结果协议另记录结果版本，不混用工具输入 schema 版本。

结果版本具体采用 facts 成功/空查 envelope 顶层的 `factsResultVersion:1`，随 writtenContent 保存，不另建重复统计列；缺失表示旧协议或无此结果元数据，不能解释为版本 1 或零命中。错误/拒绝不附该版本及查询结果元数据。输入 schema 版本继续沿用既有机制。

本计划已定稿并通过 notes 记录实施；旧输入工具契约继续有效。按实际公共协议变化评估 ADR，不能仅因新增可选字段自动要求 ADR。若引入分页或改变分类合法值，则须明确记录架构决策。F-02 的枚举/发现、F-03 的分页和 F-04 的匹配证据归为候选，未获选前不写成已承诺实施项。

## 具体测试方案

### 测试素材与独立预期

最小合成卡如下。三卡均 `rarity="4", aliases=[]`；技能均 `target=""`，未列出的可选字段缺省。技能组只在 A/B 上为 `["测试技能组"]`，C 为空。A/B/C 是下文集合简写，实际断言使用 canonical；每个预期手工定义，不调用被测过滤函数生成 expected。

| 卡 | canonical | rooms | class | factionGroups | notes |
|---|---|---|---|---|---|
| A | 测试甲 | 制造站、办公室 | 医疗 | 测试组一 | 卡级专词：全局约束 |
| B | 测试乙 | 制造站 | 近卫 | 测试组一 | 空串 |
| C | 测试丙 | 制造站 | 近卫 | 测试组二 | 空串 |

| 卡/ grantId | room | name | unlockType | effectText | notes | 替换/等价 |
|---|---|---|---|---|---|---|
| A/a0 | 制造站 | 锻造初式 | 初始解锁 | 制造站生产力+5% | 初始备注 | 无 |
| A/a1 | 制造站 | 锻造进式 | 精英1提升 | 制造站生产力+10% | 升级备注 | replacesGrantId=a0；equivalenceSkillNames=[锻造进式,锻造同效] |
| A/a2 | 办公室 | 联络术 | 初始解锁 | 联络关键词 | 办公室备注 | 无 |
| B/b1 | 制造站 | 锻造同效 | 初始解锁 | 制造站生产力+10% | 空串 | equivalenceSkillNames=[锻造进式,锻造同效] |
| C/c1 | 制造站 | 锻造进式附注 | 初始解锁 | 制造站生产力+1% | 空串 | 无 |

具体预期：lookup 测试甲→{A}，锻造初式→{A}，锻造进式或锻造同效→{A,B}，锻造进→{}。query_operators 的 room=制造站→{A,B,C}，faction=测试组一→{A,B}，profession=医疗→{A}，termQuery=锻造进→{A,B,C}；room=制造站+faction=测试组一+profession=近卫→{B}；faction=测试组一+excludeIds=[测试乙]→{A}。room=制造站+termQuery=联络/卡级专词→{}；termQuery=联络→{A} 且只展示 a2；termQuery=测试甲→{A} 且展示 a0/a1/a2。T04 的 skillGroups 分支另用 room=办公室+termQuery=测试技能组→{}，防止 B 的单设施回退干扰断言。

合成素材不进入 knowledge 或运行提示。真实 references 样本锁定：[温蒂](../../knowledge/references/技能-制造站.md#温蒂)（第92–95行）初始自动化·β、精英2提升仿生海龙及替换关系；[技能等价组](../../knowledge/references/技能等价组.md) 第38–40行的手工艺品·β/裁缝·β/鉴定师的手段，lookup 裁缝·β 的预期 canonical 集合为 {卡夫卡,折光,明椒,柏喙}。实施时核对源行和实际标题，expected 不从 serializeCards 输出反推。复用现有 facts-tools/projection/curation 测试，不另建评分台账。

### 用例矩阵（第一阶段必做）

| 编号 | 场景与输入 | 预期断言 | 层级/落点 |
|---|---|---|---|
| T01 | lookup 未收录名称；query_operators 合法值但无卡匹配 | status=empty、executed=true、两计数=0、complete=true、hitIds=[]；各扣1点 | tool-executor/facts-tools；F-01 红灯用例 |
| T02 | canonical、精确技能名、等价技能名分别查询 | 返回手工定义的单卡/多卡集合；计数与集合一致；C 不因相似子串进入精确 lookup | facts-tools/store |
| T03 | room、faction、profession、termQuery 单条件和多条件；excludeIds | 单条件集合正确；多条件为交集；排除仅按 canonical；count 按卡而非技能行计 | facts-tools/store |
| T04 | A 的 room=制造站 + termQuery=办公室独有“联络” | A 不匹配；卡级备注/skillGroups 不能绕过多设施作用域 | facts-tools；沿用既有契约 |
| T05 | A 的 room=制造站 + termQuery=A 的 canonical | A 匹配，技能仅制造侧；全局属性标识明确，卡级约束保留 | 序列化/projection |
| T06 | room=制造站+termQuery=锻造进式；lookup 测试甲；query 有 room | 前者返回A/B/C，在A卡内只展示a1但仍含精英1提升、替换锻造初式、升级备注和卡级约束；lookup含a0/a1/a2各自解锁及备注；逐条断言设施与替换文本，不做模型能否理解叠加的主观断言 | 序列化/curation |
| T07 | 空格、{}、null、数组根、错类型、未知字段、只有excludeIds、坏数组元素 | invalid_params、executed=false，无数量/complete/scope 查询结果元数据；扣1点，不触碰 store | tool-executor |
| T08 | 第5次合法空查、第五次坏参数、第6次拒绝；同批混合三工具 | 空查仍执行并附预算提示；坏参数不执行；拒绝不伪造零命中；顺序、余额与call ID一致 | tool-executor/agent |
| T09 | facts store/真源异常；缺失或重复call ID | fatal异常保留已有usage和trace并终止，不向后续provider回写结果，不标empty；坏ID整批零执行、零扣点、无tool回写 | agent/provider-ledger |
| T10 | facts/hybrid 成功、空查、可回写参数错误各一条，模拟provider读取结果 | 有后续调用的content与trace.writtenContent逐字一致；hitCount/hitUnknown不由占位文本或status推断；不为fatal测试新增续调 | agent/trace/report |
| T11 | 旧快照缺新字段与新结果往返 | 旧数据原样可读，未知不补0；新计数与ID集合一致，版本可追溯 | snapshot/trace/report |
| T12 | 合法宽查、多条技能同一持有者 | 第一阶段完整返回卡集合，不偷偷套RAG字符上限；returnedCount=matchedCount，按卡去重，查询投影内的技能记录不截断 | facts-tools/序列化 |
| T13 | schema语义与数据边界 | 描述明确精确/子串/AND/room作用域，未声称真实别名或数值排序；描述人工审阅，勿为整段措辞写脆弱断言 | schema审查+已有参数测试 |
| T14 | 仅termQuery命中A的一条技能；另一次只命中A的canonical | 前者展示匹配技能，后者无技能匹配时回退全部scopedSkills；两者卡计数相同且complete=true，但明确不保证整卡全技能展示 | facts-tools/序列化 |

T04 不禁止 canonical/aliases 的卡级匹配，T05 专门保护这一路径；技能词必须在同设施技能上命中。单设施旧 fixture 允许按已有回退规则匹配，另保留回归用例。无room的多设施fixture不猜技能归属，明确未知范围。

### 执行顺序与完成条件

先加入 T01 确认现实现因 status=success 失败，其他用例按当前契约先建立基线；F-04 新输出断言在实现前应按预期失败。然后修结果语义和序列化，再跑 agent 集成与历史兼容。定向命令：`pnpm run test -- bench/tests/facts-tools.test.ts bench/tests/tool-executor.test.ts bench/tests/projection.test.ts bench/tests/curation.test.ts bench/tests/agent-provider-ledger.test.ts bench/tests/trace.test.ts bench/tests/report.test.ts bench/tests/snapshot.test.ts`；最后 typecheck、全量test、build和五模式dry，文档检查及合并门禁遵守仓库入口。

完成条件为上述确定性契约及来源保持；不要求模型调用某工具的比例、不以答题通过率设门槛、不通过改测试 expected 掩盖真源差异。第一阶段不要求付费模型比较，若需检查新结果结构是否被provider接收，可另做小型兼容冒烟，但它不代替本地契约断言，也不决定设计方向。

## 验收清单

- [x] T01–T04：facts store 与空结果状态、精确/分类/作用域匹配契约通过。
- [x] T05–T06、T14：查询投影、设施标签、解锁/替换/备注和卡级属性范围契约通过。
- [x] T07–T09：参数错误、预算边界、协议 ID、底层异常和终止行为契约通过。
- [x] T10–T11：tool content、trace、report 与历史快照兼容契约通过。
- [x] T12–T13：宽查完整返回和 schema 语义审查通过。
- [x] 指定 references 真源样本核对通过，expected 未从序列化输出反推。
- [x] `pnpm run typecheck` 全通过。
- [x] `pnpm run test -- bench/tests/facts-tools.test.ts bench/tests/tool-executor.test.ts bench/tests/projection.test.ts bench/tests/curation.test.ts bench/tests/agent-provider-ledger.test.ts bench/tests/trace.test.ts bench/tests/report.test.ts bench/tests/snapshot.test.ts` 全通过。
- [x] `pnpm run test` 全通过。
- [x] `pnpm run build`、五模式 dry 和 `node scripts/doc-check.mjs` 全通过。

## 关联 ADR

- [ADR-006](../adr/ADR-006-independent-function-tools.md) — 按检索模式暴露独立函数工具与扁平参数
- [ADR-005](../adr/ADR-005-chat-auto-tool-budget.md) — auto 工具循环与每题积分预算（其余契约继续有效）

## 本轮产物与后续

独立 agent `review_facts_optimization` 完成初审和修订复审，结论为通过、无阻塞问题。已落实：complete 仅指卡集合；termQuery-only 与 canonical 回退覆盖；fatal 不要求继续回写；合成卡字段、预期集合及真源样本具体化。复审的非阻塞措辞意见也已采纳，T06 明确整次查询返回 A/B/C、只在 A 卡内投影为 a1。

本计划承接独立审查通过的草案和前置工具拆分结果。实施仅限第一阶段确定性契约；旧 schema 优化和历史基线文档保持为前置证据，不扩展为泛化 agent 优化计划。

## 实施纪要

# 实施笔记：facts 工具优化与契约测试

> 对应归档计划：docs/archive/plan-facts-tool-optimization.md
> 开始日期：2026-09-07

## 决策偏离
> spec 中没有提到，但在实施中做出的重要决策

### 2026-09-07 — 以定稿计划承接已审查草案
- **背景**：草案已完成独立审查和修订复审，实施前必须按文档生命周期转为正式 plan。
- **选项**：
  - A: 保留 draft 作为活跃入口，另建重复 plan。
  - B: 将 draft 原位重命名为 plan，并建立对应 notes。
- **决策**：选择 B；正式施工入口为 `docs/archive/plan-facts-tool-optimization.md`，审查结论和测试矩阵继续保留在归档计划中。
- **影响**：后续进度以计划验收清单为唯一机械信号；归档时由 release 脚本将 notes 合并回 plan。

## 实现调整
> spec 中有描述，但实际实现方式不同

### 2026-09-07 — 结果元数据在内部结果对象中聚合、序列化时展开
- **spec 原文**：facts 成功/空查 envelope 顶层增加 `factsResultVersion`、`matchedCount`、`returnedCount`、`complete` 和 `scope`。
- **实际做法**：执行器内部以 `factsResult` 聚合这组字段，写入 tool message 时展开到现有 envelope 顶层；错误、拒绝和预算耗尽结果不生成该对象。
- **原因**：避免 facts 元数据散落在内部结果字段，同时保持对模型和 trace 写盘内容的顶层协议不变。
- **后果**：`writtenContent` 与实际回写 content 继续共用 `serializeToolResult`，旧记录读取无需补字段。

### 2026-09-07 — 兼容未标设施技能的展示标签
- **spec 原文**：每条输出技能显式标注已有 room；缺 room 的兼容 fixture 显示未知设施，不猜归属。
- **实际做法**：序列化严格读取 `RecordSkill.room`，缺失或空白时显示“未知设施”，不使用单设施卡的回退推断值。
- **原因**：store 查询允许兼容旧 fixture 按单设施回退匹配，但展示层不能把推断归属伪装成真源字段。
- **后果**：新投影技能均显示真实设施；旧 fixture 的技能范围保持兼容，标签显式标为未知。

### 2026-09-07 — 输入 schema 描述变更同步版本
- **背景**：第一阶段精炼 lookup/query_operators 的匹配语义描述，既有工具 schema 版本为 2。
- **选项**：
  - A: 只依赖新的 schema 指纹，保留版本号。
  - B: 同步递增工具 schema 版本，并单独保留 facts 结果版本。
- **决策**：选择 B，将 `TOOL_SCHEMA_VERSION` 调为 3；facts envelope 继续使用 `factsResultVersion: 1`。
- **影响**：运行 meta 可区分输入工具协议与 facts 结果协议，旧快照仍按原有兼容规则读取。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项
> 可定位到代码的债务须在代码处写 `TODO(tech-debt) <编号>：` 注释；此处只记编号、结论与未来偿还条件

## 意外发现
> 实施中发现的 spec 未覆盖的依赖/边界/风险

### 2026-09-07 — 用户验收与单次 hybrid 对比
- **验收基点**：`2e31fa6`；按计划核对两处运行实现，未发现阻塞缺陷。空查以 hitIds 判断，facts 元数据仅在合法执行后生成并展开至模型 envelope；匹配集合、预算和 fatal 路径未被修改。
- **本轮验证**：重新执行全量 31 文件/286 项测试、typecheck、build、doc-check；通过内存 dry 验证五模式各20题（共100题），未产生 dry 运行目录。额外直调验证 fatal 无伪造元数据、trim 后 scope 与顶层字段、termQuery-only 技能裁剪及 canonical 回退。
- **覆盖边界**：现有测试通过不等于 T01–T14 每个组合都有独立持久断言。例如 T14 的无 room 技能命中路径由本轮直调补核；本轮不把该直调描述成已新增仓库测试。
- **对比设计**：用户授权一次完整20题真实 hybrid 运行，Qwen3.7-Flash/off/temperature=0、预算5、auto、允许并行、无工具回馈开启、300秒单题超时。与历史嵌套 hybrid 和拆分后中间样本比较；历史提示与协议有差异，且只有单次观测，不作 facts 改动的因果归因或稳定提升结论。
- **本次证据**：[共享快照](../../bench/results/2026-09-07T13-47-32-341Z-qwen-off-t0.json)，原件目录 `bench-runs/2026-09-07T13-47-32-341Z-qwen-off-t0/`。用途为本次验收后的直接对比，当前未指定正式质量基线。原件保留用于回答和完整 trace 复核，待共享证据提交可恢复且实验结束后再按清理规范处理。

| 指标 | 嵌套 hybrid：09:55 | 拆分后中间样本：10:39 | facts 验收：13:47 |
|---|---:|---:|---:|
| 完成题数（非正确题数） | 20/20 | 20/20 | 20/20 |
| 模型调用 | 65 | 44 | 45 |
| 工具执行 | 45 | 33 | 33 |
| RAG / lookup / query_operators | 28 / 11 / 6 | 32 / 0 / 1 | 32 / 0 / 1 |
| 工具错误 / 拒绝 | 12 / 1 | 0 / 0 | 0 / 0 |
| 输入 / 输出 tokens | 151322 / 20516 | 96331 / 16011 | 103948 / 17032 |
| 工具结果字符 | 45062 | 44045 | 46498 |
| 总成本（元） | 0.044996 | 0.031748 | 0.034085 |
| 总耗时（秒） | 213.065 | 125.765 | 168.939 |

- **对照位置**：嵌套样本为 `bench-runs/2026-09-07T09-55-37-752Z-qwen-off-t0/`（共享快照同名）；拆分后中间样本为 `dev-temp/work/independent-tools/after/dev-temp/work/controlled-after/2026-09-07T10-39-20-267Z-qwen-off-t0/`，继续保留为本次直接对照。三次问题定义、provider/model、温度、思考、检索参数、预算、超时和价格配置逐字段一致；指令指纹依次以 `9388e3fe`、`819acb2f`、`11c8039c` 开头，输入工具协议也不同，不能视为严格只改变 facts 的 A/B。
- **观测结论**：相对拆分后中间样本，本次成本 +7.36%、耗时 +34.33%；相对最早嵌套样本，成本 -24.25%、耗时 -20.71%。单次端到端耗时包含模型服务波动，不代表本地 executor 性能。未因这些变化修改 harness。
- **facts 实际覆盖**：仅 S08 执行一次 `query_operators({faction:"格拉斯哥帮"})`，命中4卡。已逐字段核对真实 trace 的结果版本、scope、计数和状态一致；lookup、合法空查未被这次真实模型触发，不能从 0 工具错误推断它们的真实成功率提高。回答正确率本轮未重新逐题核查，20/20 仅表示运行完成。

### 2026-09-07 — 空结果占位文本不能作为命中证据
- **发现**：facts 空查仍需要保留可读的无匹配说明，但该文本不能参与 success/empty 判定；必须以 `hitIds` 的实际卡集合为准。
- **影响**：已回馈计划 F-01，并验证 RAG/grep 的既有 data 语义未被顺带修改；report 继续沿用明确 `hitIds` 的命中统计。

### 2026-09-07 — 结果范围元数据不扩展到错误 envelope
- **发现**：`matchedCount=0` 只有在合法查询实际执行且结果为空时有意义；参数错误、拒绝、预算耗尽和系统异常的“缺失”不能回填为零。
- **影响**：已回馈计划第 1、2、5 点；错误和拒绝结果没有 facts 结果版本或查询范围字段。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

### 2026-09-07 — doc-check 首次拒绝未完成 plan
- **症状**：实现和测试完成后直接运行 `node scripts/doc-check.mjs`，D1 报告活动 plan 的验收清单仍含未勾选项。
- **根因**：文档门禁把活动 plan 的 `[ ]` 作为施工未收束信号。
- **解决方案**：核对验证记录后将本计划 10 项验收条目逐项标记为 `[x]`，保留未冻结状态，不执行归档。
- **预防**：后续实施结束时先同步 plan checklist，再运行文档检查；归档仍交由 release 脚本处理。

> ✅ 已完成于 2026-09-08
