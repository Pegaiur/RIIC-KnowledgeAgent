# facts 别名与集合词条真源计划

> 创建日期：2026-09-09
> 修订日期：2026-09-10
> 状态：已完成（待发布元数据收束）

## 目标

让 `facts_search` 对已确认的干员别名、阵营规范名和确定搭配的规范名做确定性查询。同一查询词在支持的索引中命中多个身份时，全部返回，整卡去重并保留每条命中路径的身份、成员和来源。多人集合入口只支持确定的阵营与搭配；不支持“德狼、能蕾、银崖、孑拉德”等简写合称，后续观察后再决定是否扩展。

本计划承接 `TODO(tech-debt) R5-2` 中当前 facts 入口所需的别名与集合查询部分，不顺带恢复历史 lookup 能力。

## 非目标

- 反问、消歧策略、按设施或上下文选人、指代确认及相关提示/测试；不修改 `knowledge/AGENTS.md` 或旧语料中的相关规则。
- 人工子串对入口、短名到长名的候选扩展；不登记或验收31组子串对。“临光”不会仅因是“耀骑士临光”的子串而命中后者。
- 简写合称、未确认的俗称和根据名称猜测成员；不把简写合称作为组合别名或旧称绕道接入。
- 技能、设施、阵营、职业的别名；已有六类规范词条精确查询保持可用。
- 阶段2的新类别、结构化关系边、条件求解、效率数值化、组合完成度、推荐排序、自动培养决策及动态推导完整成员名单。
- RAG 排序、切块、预算或新增工具参数；前两份图片和 PRTS raw 的清洗纳入、干员 notes 修改。
- 运行时用 LLM 生成名称，或针对评测题、问法、预期答案添加特判；不启动付费运行。

## 架构分析

`factsSearch` 当前返回 `FactsMatch[]`，通过 `byFactTerm` 查询六类精确索引；`RecordCard.aliases` 恒空。当前同名跨类别已返回并集，新入口应沿用全部命中原则。卡片数组不足以表达集合身份、多个来源及零卡的已拒绝旧称，因此先明确查询级结果，再实现索引与输出。

`knowledge/references/歧义.md` 是生成文件，只能作为名称证据的查阅线索，不解析为运行时源。其中的子串对、设施判断与反问规则不进入本计划。

现有搭配盘点为19个候选（贸易9、制造8、跨设施2）。数量是核对基线，不证明全部具有可穷尽的静态成员表：guides 还含裁缝任选、红云分支、五选四及技能类别成员。先列具名清单与依据，不为凑数从 raw 反向补成正式知识。

### 依据与维护边界

- 用户最新裁决优先；身份、设施、阵营和技能以 references 为准，人工搭配定义以正式 guides 为准。
- raw §9 只作为历史名称线索。“默认不展示”是推荐策略，不等于词条无效；不得仅凭 raw 拒绝查询或改写搭配。
- 每条 curation 的 evidence 保存仓库相对路径与小节标题；来源变更时同步复核登记。运行时只读登记数据，不解析散文，不新增哈希字段。
- “龙门中枢组”保留该规范名，成员为核心斩业星熊、重要诗怀雅、次级陈；不保留同名二人合称入口。
- 红松骑士团相关搭配的规范名为“红松骑士团组”。它与“龙门中枢组”是两个独立搭配，不互相归一。

## 实施方案

### 步骤1：核对支持范围与名称处置

- 输入：名册、设施技能、正式 guides；名称说明及 raw §9 仅作证据线索，不导入其操作规则。
- 产出：已确认干员别名与19个搭配候选的具名清单。每个旧名称分别标记为已证实同义旧称、明确废弃、暂不支持/证据不足或仅推荐层隐藏，不要求18个历史名称全部成为运行时映射。
- 验收：简写合称未接入；不因推荐隐藏而拒绝查询；逐项给出登记结果或缺证原因，不以总数代替身份核对。

### 步骤2：登记数据与校验

- 产出：新增 `bench/src/facts/curation/terms.ts`，独立于九设施 `CurationBatch`。只登记已确认干员别名、搭配及旧名处置；干员目标采用 `operator:<canonical>`，搭配身份采用 `combo:<规范名>`，不回写 `RecordCard.aliases`。已有阵营成员继续来自事实卡索引，不另抄人工阵营表。
- 一个别名可有多个经证据确认的目标，全部保留；没有证据时不根据子串关系补目标。输入词同时是规范名与别名也不赋予选择优先级。
- 搭配保存显式成员及核心/重要/次级/挂件/可选角色、条件摘要、来源与成员覆盖范围。保留红云任选分支、裁缝任选、杜林五选四、水月对应技能等条件及练度、设施分工；返回成员不表示全员必需或组合完成。
- 技能类别等开放成员范围以文字保留并标为非穷尽，不在阶段1动态推导。
- 旧称只直接指向已登记搭配，禁止链式/循环归一；暂不支持的合称按未收录处理，不新建合称拒绝表。
- 验收：空词、同一身份重复定义、重复目标/成员、悬空目标、旧称链/环、失效证据校验失败。允许同词对应多个已确认身份，不能按字符串全局唯一拒绝合法重叠。

### 步骤3：定义查询级结果与全部命中规则

- 输入：登记数据、`FactsMatch`、`CardStore` 与执行器调用链。
- 产出：查询级结果包含原查询、命中路径列表（精确/别名/组合/旧称/拒绝）、各路径的目标身份、来源及成员信息、去重卡列表、条件摘要与覆盖范围。归一目标放在各路径内，不用单个全局归一词覆盖多目标。
- 规则：trim 后精确收集六类规范词条和登记入口的全部命中，不按类别、别名或上下文择一，不因首个命中提前返回。同卡只输出一次，但保留各路径归属。
- 示例：“叙拉古”同时命中阵营和搭配时，分别保留两套成员归属。若已确认别名与某正式名相同，返回该正式名命中及别名全部目标。
- 子串不等于同名；仅查询词与索引键相等才命中。别名/旧称按目标身份直接取卡或搭配，不递归把目标名称当新查询；集合中的具名成员不扩展为异格。
- 旧称拒绝不遮蔽同词其他合法命中；尚不支持的resource/rule等类别不伪造命中。未收录为无路径无卡，纯拒绝可有路径无卡。
- 卡片按现有卡序稳定输出，路径按固定类别顺序输出；重复查询结果一致。
- 验收：同名多身份全部返回、同卡去重而路径不丢、子串不扩展、简写合称不拆解。

### 步骤4：索引、序列化与元数据

- 产出：`buildCardStore` 接入独立登记索引，同步修改 `factsSearch` 调用者、`serializeFactsMatches`、`tool-executor.ts` 及测试注入点；`FACTS_RESULT_VERSION` 升为3。
- 输出只标注精确、别名、组合、旧称、拒绝或未收录及客观命中依据。组合给出条件、来源和覆盖范围，正式阵营成员与搭配成员分别归属；不增加指代判断字段或提示。
- 查询级信息同时进入工具结果元数据，不从正文字符串反推类型。`matchedCount` 为全部路径合并后的去重卡数，`returnedCount` 为实际返回卡数；继续整卡完整返回，不新增截断。
- `complete=true` 表示本次匹配卡全部返回，不代表开放成员范围已穷尽。
- 未收录与纯拒绝均为empty、executed=true、计数0、complete=true，以路径和正文区分；有合法卡则success。预算、协议错误及trace语义保持现状。
- 验收：同卡多路径仅计一次，拒绝说明不被未知词模板覆盖；正文、hitIds/injectedIds、落盘结果及trace一致。

### 步骤5：工具描述与版本

- 工具描述写清已确认别名、阵营与搭配规范名支持、同名命中全部返回、简写合称不支持；`TOOL_SCHEMA_VERSION` 升为7。
- 不增加参数，不修改Agent决策契约；`toolsForRetriever('facts')` 仍只暴露 `facts_search`。
- 验收：描述与返回能力一致，schema/结果版本及观测输出同步升级。

### 步骤6：回归与维护校验

- 数据测试：别名目标和19个搭配候选按具名清单核对；断言具体成员、角色、条件、来源及缺证处置。数量仅辅助，生产表不能作为唯一预期来源。
- 行为测试：六类既有查询、别名多目标、规范名与别名同名、阵营与搭配同名、同卡多路径、零卡拒绝、未知词/简写合称、trim、不拆词、不做子串扩展及非穷尽提示。
- 异常测试：重复定义、重复目标/成员、悬空目标、旧称链/环、失效证据和合法同名重叠；错误消息中文。
- 协议测试：计数、complete、success/empty/error、预算、新版本trace/落盘输出。不测试反问或上下文选人，不以答题正确率为固定验收线。
- 验收：`pnpm run typecheck`、`pnpm run test` 通过；待办完成后 `node scripts/doc-check.mjs` 通过；合并前执行 `node scripts/verify.mjs merge -- --base main`。

## 实施细化

### 实施定位与接口约定

以下为待实现接口设计，不是已经存在的导出。只新增本功能需要的模块，不改九设施 curation 或 RecordCard 结构。

| 文件 | 具体改动 | 依赖与验证 |
|---|---|---|
| `bench/src/facts/curation/terms.ts` | 导出人工登记的 `TERM_CURATIONS`，包含 `aliases`、`combos`、`legacyNames` | 纯数据，无顶层文件读取；每项附 evidence |
| `bench/src/facts/terms.ts`（新增） | 定义登记类型，`validateTermCurations(cards, data)` 返回只读校验结果 | 检查身份、成员、角色、非空条件和重复/悬空；只接收数据，不依赖单例 |
| `bench/src/facts/store.ts` | `buildCardStore(cards, terms?)` 增加显式可选输入；`factsSearch(query)` 返回 `FactsSearchResult` | 未传 terms 时使用空登记，保留现有合成卡测试隔离；getCardStore加载真实登记并验证后传入 |
| `bench/src/facts/store.ts` | `serializeFactsMatches(result)` 从完整查询结果渲染 | 现有卡片渲染复用；不将combo加入卡级事实类别 |
| `bench/src/tool-executor.ts` | facts执行分支读取 `result.matches`；运行结果内部增加可选 `factsResolution`，映射至 `factsResult.resolution` | 不从正文解析元数据；错误路径没有成功解析结果时不伪造resolution |
| `bench/tests/facts-terms.test.ts`（新增） | 登记校验、路径与混合命中、真实具名清单、来源路径/小节检查 | 文件存在性检查只在测试侧执行，运行时不读取散文 |
| `bench/tests/facts-tools.test.ts` | 原 `.factsSearch(...).map(...)` 改为 `.matches.map(...)`，同步序列化签名及版本断言 | 六类行为仍不变，不能批量改掉原有业务预期 |
| `bench/tests/tool-executor.test.ts`、`bench/tests/inputs.test.ts` | 调整store替身/spy、版本、零卡与异常协议用例 | 不修改预算预期；rg核对所有调用点后再运行全量测试 |

登记最小结构（使用 TypeScript 类型表示设计，中文条件只作文字说明）：

```ts
type OperatorRef = `operator:${string}`
type ComboRef = `combo:${string}`
type EvidenceRef = { path: string; section: string }
type MemberRole = 'core' | 'important' | 'secondary' | 'support' | 'optional'
type ComboMember = { target: OperatorRef; role: MemberRole }
type AliasEntry = { text: string; targets: OperatorRef[]; evidence: EvidenceRef[] }
type ComboEntry = {
  id: ComboRef
  name: string
  members: ComboMember[]
  conditions: string[]
  coverage: 'listed' | 'open'
  openScope?: string
  evidence: EvidenceRef[]
}
type LegacyEntry =
  | { text: string; action: 'redirect'; target: ComboRef; evidence: EvidenceRef[] }
  | { text: string; action: 'reject'; reason: string; evidence: EvidenceRef[] }
```

- text/name须已trim且非空，canonical目标必须与卡片正式名逐字一致；不做大小写、空格折叠、全半角、繁简或加号替换。combo id必须等于 `combo:${name}`。
- 每种登记数组中text/name唯一。同一别名的多目标合并在一个条目内，不能以重复条目隐藏相互矛盾的数据；不同索引之间允许同名。members内一个目标仅一项，角色冲突校验失败，由证据核定角色后重录。
- evidence至少一项；coverage为open时openScope必填，为listed时不填。listed只表示来源明确列出本次搭配名单，不宣称所有游戏可替代成员穷尽。conditions须保留上文列出的分支和使用边界。
- 不在combo内另建aliases数组；同义旧称统一放legacyNames，避免两套归一数据。redirect目标必须是ComboRef且直接存在于combos，不允许指向旧名。

查询结果最小结构：

```ts
type ResolutionPath =
  | { kind: 'exact'; category: FactsMatchCategory; term: string; memberIds: string[] }
  | { kind: 'alias'; term: string; targets: OperatorRef[]; memberIds: string[]; evidence: EvidenceRef[] }
  | { kind: 'combo'; term: string; combo: ComboEntry; memberIds: string[] }
  | { kind: 'legacy'; term: string; combo: ComboEntry; memberIds: string[]; evidence: EvidenceRef[] }
  | { kind: 'rejected'; term: string; reason: string; evidence: EvidenceRef[]; memberIds: [] }
type FactsSearchResult = { query: string; paths: ResolutionPath[]; matches: FactsMatch[] }
```

- query保留trim后的实际参数，与现有 `factsResult.scope.query` 一致；每个路径的memberIds均为去重canonical，不携带RecordCard对象。
- exact路径按现有六类各一项聚合，不用技能名生成唯一SkillFact id；同名技能仍返回其持有者并集。alias/组合命中不会伪装为operator精确命中，只有真实exact路径贡献原 `FactsMatch.categories`；仅新增路径命中时categories允许空数组。
- 顺序固定为exact（原六类顺序）、alias、combo、legacy、rejected；同类内按登记顺序。路径内memberIds及全局matches均使用输入cards顺序，combo.members保留登记角色信息。空输入由派发层按现有协议拒绝；store直接收到空白时返回空结果。
- `factsResult.resolution` 保存 `{ paths }`，matches只进入正文与计数，不复制整卡到元数据。未知结果为paths空数组，纯拒绝为rejected路径；执行异常/预算拒绝不伪造paths。路径附带combo条件和来源是同一数据投影，不维护第二份文本。
- 正文先输出命中路径及组合条件，再复用完整卡序列化。仅别名/组合命中的卡不输出空的“匹配类别”行；其归属由路径说明。complete和计数按步骤4执行。

### 首批具名登记清单

此表锁定实施核对对象，不把历史raw作为正式事实。来源路径统一在 `knowledge/guides/` 下，section使用表内规范名称；完整显式成员及角色从对应小节录入，不能只录核心。

| 来源文件 | 规范名称 | 实施时必须保留的边界 |
|---|---|---|
| 贸易站组合.md | 龙舌兰组 | 核心巫恋/龙舌兰；裁缝任选，技能类别开放，coverage=open |
| 贸易站组合.md | 能天使组 | 能天使与蕾缪安，不加入新约能天使/空弦 |
| 贸易站组合.md | 叙拉古 | 伺夜/八幡海铃核心，贝洛内重要；中枢与贸易分工 |
| 贸易站组合.md | 喀兰贸易组 | 灵知/银灰/孑核心，崖心/琳琅诗怀雅为可选；孑精一 |
| 贸易站组合.md | 格拉斯哥帮组 | 摩根/戴菲恩/推进之王核心，维娜次级 |
| 贸易站组合.md | 鸿雪杜林组 | 三核心与五选四挂件；保留挂件人数约束 |
| 贸易站组合.md | 人间烟火组 | 保留原小节核心/重要/次级，不从新PRTS raw扩员 |
| 贸易站组合.md | 企鹅物流 | 德克萨斯/拉普兰德核心，能天使重要；现有真源未登记同名阵营，仅返回搭配 |
| 贸易站组合.md | 深巡＋乌尔比安 | 深巡核心、乌尔比安挂件，保留全角＋ |
| 制造站组合.md | 自动化组 | 温蒂/清流核心，其他成员按原角色；不是单站固定全员 |
| 制造站组合.md | 赤金工艺组 | 苍苔核心、金属工艺类开放候选，coverage=open |
| 制造站组合.md | 红云组 | 两条重要分支任选其一；其他列明成员均保留 |
| 制造站组合.md | 红松骑士团组 | 焰尾/薇薇安娜核心，灰毫/远牙/野鬃至少两人；砾可选 |
| 制造站组合.md | 深海猎人组 | 歌蕾蒂娅核心，其余四名重要成员及岗位分工 |
| 制造站组合.md | 泡泡组 | 泡泡/火神核心，贝娜等开放挂件，coverage=open |
| 制造站组合.md | 水月标准化组 | 水月核心、同站两名标准化技能成员、中枢涤火杰西卡；coverage=open |
| 制造站组合.md | 莱茵科技 | 多萝西核心、淬羽赫默/娜斯提重要，技能类开放，coverage=open |
| 跨设施组合.md | 感知信息组 | 原小节九名成员及角色；不据新raw追加深律 |
| 跨设施组合.md | 龙门中枢组 | 斩业星熊核心、诗怀雅重要、陈次级；与红松骑士团组不同 |

其余条目默认coverage=listed；表内范围仍需与对应小节同时核查，不能由核心人数推断完整成员数。“凯尔希·思衡托与精英干员挂件”不在这19项内，本轮不增设搭配词条，已有六类精确查询保持原样。

首批干员别名按 `knowledge/references/歧义.md` 第二节中明确说明登记：维娜→维娜·维多利亚、德狗→德克萨斯、拉狗→拉普兰德、推王→推进之王及维娜·维多利亚。推王两目标均返回，不采纳该来源中的默认对象或设施反问说明。德狼、能蕾、银崖、孑拉德全部不登记。

首批旧称仅将正式guides明写的新旧名称登记为redirect：迷迭香感知链→感知信息组、巫恋裁缝核→龙舌兰组、龙门中枢制造组→龙门中枢组；每项引用对应正式小节。其他历史名称先留作审阅线索，不为覆盖18项凑映射；reject分支以合成数据验证，未核定真实拒绝词之前允许生产reject条目为零。

### 可执行验证矩阵与交付顺序

| 用例 | 输入及数据 | 必须观察到的结果 |
|---|---|---|
| A1 | 真实“维娜” | alias路径，1卡；无其他异格扩展 |
| A2 | 真实“推王” | alias路径2目标，2卡，均计入hitIds |
| A3 | “德狼”等4个简写合称 | paths空、0卡、empty；不返回推测成员 |
| A4 | 合成词同时为operator规范名与alias | 两条路径合并全部目标，共享卡只计一次 |
| C1 | 真实“叙拉古”及“企鹅物流” | 叙拉古的faction（18人）与combo（3人）分别保留成员集合，整卡并集去重为19卡；企鹅物流仅返回已登记combo（3人），不伪造阵营 |
| C2 | 真实“红云组” | 条件保留任选分支；不把两分支所有成员写成必需 |
| C3 | “莱茵科技” | 已有精确类别若命中则保留，combo另标open；complete仍为true |
| L1 | “迷迭香感知链” | legacy路径直接关联感知信息组，不递归查询名称 |
| L2 | 合成拒绝词 | rejected路径、empty、0/0、complete=true，正文有理由 |
| L3 | 合成拒绝词同时精确命中卡 | 拒绝路径与exact路径共存，success，卡正常计数 |
| E1 | “临光”及“耀骑士临光” | 只走实际精确索引，不按子串补另一名；明确登记的其他同名类别仍保留 |
| E2 | 首尾空白、内部空白及加号变体 | 仅trim；未登记变体不自动改写 |
| V1 | 空evidence、缺小节、重复/悬空/链环 | 相应校验失败，中文消息；跨索引同名合法 |
| P1 | executor预算耗尽/参数错误/store异常 | 维持既有status、executed、预算与错误输出；无伪成功resolution |
| P2 | serializeToolResult与落盘 | 版本7/3按各自元数据位置出现；paths、计数、hitIds一致 |

按依赖实施：类型与校验 → 纯登记及具名来源测试 → store查询结果与全部调用者同步迁移 → executor/序列化/版本 → 全量回归。每个阶段结束保持可编译；迁移factsSearch返回类型时必须同批调整调用者，不留中间半兼容运行路径。

实施已按“类型与校验 → 登记及来源测试 → store 查询结果与调用者迁移 → executor/序列化/版本 → 全量回归”完成；定向回归、`pnpm run typecheck` 与 `pnpm run test` 均已执行。phase 5 继续完成维护校验与最终门禁记录，不启动付费运行；计划仍待发布元数据收束，暂不执行冻结归档。

## 验收清单

- [x] 支持范围与具名清单落地，简写合称和子串扩展未接入
- [x] 别名/搭配及来源校验完成，旧名处置不混淆推荐隐藏
- [x] 搭配条件、成员角色与非穷尽边界保留
- [x] 同名命中全部返回，跨类别路径和成员归属正确
- [x] 查询级结果、零卡拒绝与计数契约实现
- [x] RecordCard.aliases 仍为空，历史 lookup 不扩展
- [x] TOOL_SCHEMA_VERSION = 7、FACTS_RESULT_VERSION = 3，工具描述同步
- [x] 具名覆盖、异常数据、协议及预算回归通过
- [x] pnpm run typecheck 与 pnpm run test 全通过
- [x] node scripts/doc-check.mjs 全通过

## 本轮设计修订（2026-09-10）

按用户最新裁决，将反问与消歧措施移出范围，删除人工子串入口、设施判断、提示及Agent契约修改，只保留同名命中全部返回。独立审查指出的两个搭配规范名连写已拆开；旧检索内容中的反问规则不在本计划处理。实现与回归已完成，D1 清单已据实际结果勾选；发布元数据收束（冻结归档、版本和变更日志）按本轮“不发版”约束暂不执行。

## 关联 ADR

- [ADR-010](adr/ADR-010-facts-alias-disambiguation.md) — facts 别名、集合词条真源与同名全部返回契约

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
