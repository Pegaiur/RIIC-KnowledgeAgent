# facts 工具优化与契约测试计划

> 创建日期：2026-09-07
> 状态：施工中
> 需求入口：[inbox](inbox.md)
> 前置：[独立工具计划](plan-independent-tools-schema.md)、[策略评估](draft-harness-performance.md#按设计契约调整策略2026-09-07)

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

合成素材不进入 knowledge 或运行提示。真实 references 样本锁定：[温蒂](../knowledge/references/技能-制造站.md#温蒂)（第92–95行）初始自动化·β、精英2提升仿生海龙及替换关系；[技能等价组](../knowledge/references/技能等价组.md) 第38–40行的手工艺品·β/裁缝·β/鉴定师的手段，lookup 裁缝·β 的预期 canonical 集合为 {卡夫卡,折光,明椒,柏喙}。实施时核对源行和实际标题，expected 不从 serializeCards 输出反推。复用现有 facts-tools/projection/curation 测试，不另建评分台账。

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

- [ADR-006](adr/ADR-006-independent-function-tools.md) — 按检索模式暴露独立函数工具与扁平参数
- [ADR-005](adr/ADR-005-chat-auto-tool-budget.md) — auto 工具循环与每题积分预算（其余契约继续有效）

## 本轮产物与后续

独立 agent `review_facts_optimization` 完成初审和修订复审，结论为通过、无阻塞问题。已落实：complete 仅指卡集合；termQuery-only 与 canonical 回退覆盖；fatal 不要求继续回写；合成卡字段、预期集合及真源样本具体化。复审的非阻塞措辞意见也已采纳，T06 明确整次查询返回 A/B/C、只在 A 卡内投影为 a1。

本计划承接独立审查通过的草案和前置工具拆分结果。实施仅限第一阶段确定性契约；旧 schema 优化和历史基线文档保持为前置证据，不扩展为泛化 agent 优化计划。
