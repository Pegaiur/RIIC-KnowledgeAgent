# 单词条 facts 统一入口实施计划

> 创建日期：2026-09-07
> 状态：实施完成（待发布元数据收束）
> 需求入口：[inbox](inbox.md)

## 目标

核心目标是降低LLM选择工具及填写字段的负担：用一个 `facts_search({query})` 替代对外的lookup/query_operators。query表示一个完整词条，可以是中文多字名称，如“格拉斯哥帮”，不要求语言学上的单字或单词。

## 非目标

第一阶段仅做确定性精确词条查询：不解析自然语言、不分词、不做子串兜底、BM25、向量、模糊匹配、拼写纠正或LLM分类。RAG保持原状。不是把旧工具塞回operation/params外壳，也不要求模型选择kind/filter字段。

## 架构分析

原 facts 能力由 lookup 与 query_operators 两个入口承载：前者要求模型识别名称类词条，后者要求模型选择分类字段和过滤参数。两套 schema、参数校验及历史兼容路径增加了工具选择与填参负担；本计划把分类判断下沉到审定 RecordCard 的确定性索引，同时保留 RAG 与预算、trace、报告等既有边界。

## 实施方案

### 对外 schema

```json
{
  "type": "function",
  "function": {
    "name": "facts_search",
    "description": "用一个完整词条精确查询干员事实卡：干员正式名、技能名、已收录技能组词、设施、阵营或职业。不拆词，不解析句子或多个条件。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {"type":"string","minLength":1,"description":"一个完整名称或分类词条；保留名称内部标点。"}
      },
      "required": ["query"],
      "additionalProperties": false
    }
  }
}
```

校验只接受对象根、唯一query字段、trim后非空字符串。只去首尾空白，保留内部空格、标点和大小写；不尝试判断输入是不是自然语言，也不添加空格禁令。句子或拼接词若不是已收录词条则合法empty，仍执行并扣1点；原始记录确有带空格名称则可精确命中。

facts模式仅暴露facts_search；hybrid暴露rag_search和facts_search。bm25/grep/both不变。人工指令只保留“具体对象或分类词条用facts，机制/组合关系用RAG（若可用）”，不再让LLM区分term、faction、profession等字段。

### 内部确定性解析

从已通过真源门禁的RecordCard构建统一词条索引，保留命中类别；不维护独立手写词表或评测别名。

| 类别 | 词条来源 | 命中集合 |
|---|---|---|
| 干员 | canonical | 该干员卡 |
| 技能 | skills.name、equivalenceSkillNames | 精确技能名及同效持有者 |
| 技能组 | card.skillGroups | 持有该已收录技能组词的卡 |
| 设施 | card.rooms | 声明该设施的卡 |
| 阵营 | card.factionGroups | 该阵营/干员组的卡 |
| 职业 | card.class | 该职业的卡 |

不索引全文notes/effectText、等价组整段标题、未建立真源的别名/俗称或策略组合合称。技能组入口严格取card.skillGroups；当前投影中该字段与taxonomy.skillCategories同源，不能声称是不同真源，但本轮不额外合并skills[].skillCategories建立新词域。内部lookup/queryOperators可继续保留供既有测试或数据调用者使用，但不在新facts/hybrid工具数组里同时暴露。

同一个词条跨类别同名时查询所有精确命中类别，返回卡集合并集，按canonical去重；不猜唯一意图，不使用隐式优先级吞掉另一种解释。结果须列出匹配类别及各卡的命中依据，提醒多类别同名；同一张卡只输出一次，类别顺序固定、卡顺序沿用store稳定顺序。模型不需要额外kind参数，能够从返回区分其含义。这是确定性词条歧义，不是自然语言理解。

### 结果契约与功能取舍

所有命中统一返回完整卡，技能设施、解锁、替换、技能及卡级备注照常保留，不做room/termQuery投影。设施词只负责筛选卡，不把全卡其他设施技能伪装成该设施专属；输出明确“筛选依据”和“全卡内容”不同。

沿用status/executed/data/budget_remaining及数量元数据。新工具成功/空查采用factsResultVersion=2、scope={query:实际trim词条}、matchedCount/returnedCount为去重后的卡数，complete=true仅表示本次精确匹配卡集合完整返回。data内用简短匹配说明列出类别，并在卡头附其命中类别；设施命中与技能命中不会丢在无标签并集中。不新增让模型填写的解释字段。空查data明确“未收录精确词条”，不能说相关事实不存在；错误/拒绝不伪造查询数量。旧工具历史结果继续按版本1读取，不回填。

第一阶段不分页、不截断、不默认topK，因此设施/职业词可能返回较大文本；这是已知成本取舍，不能声称统一入口就必然省token。仍是每个准入调用1点，内部跨类别匹配不拆成多次计费；auto、并行、错误扣点、协议坏ID整批拒绝、fatal与超时不变。

**不承诺完整替代旧高级过滤能力**：单词条覆盖lookup的规范词条查询，以及query_operators的room/faction/profession单条件入口；主动不暴露多条件AND、excludeIds、termQuery任意子串与技能裁剪。这是简化接口的能力取舍。不能让LLM把多个返回的零散卡当成已由工具执行的AND，也不通过“制造站 近卫”这样的隐式语法恢复复杂过滤。组合条件需求后续另评估，本轮不增加参数。

精确空查可以在已有证据提供另一规范词条时继续，或用当前可用RAG查证；不自动改写词条、不触发检索兜底。真实示例“格拉斯哥帮”应通过阵营分类索引命中；未知合称仍可为空，这是第一阶段边界而非要求追分的缺陷。

### 迁移范围

这是工具公共接口改变，已由[ADR-007](adr/ADR-007-single-term-facts-tool.md)局部替代ADR-006的facts暴露决策；不要改写旧ADR历史。同步工具类型、模式映射、派发、isFactTool、provider dry、系统能力列表、trace/report工具分类及兼容测试。snapshot当前按字符串保留工具名称，没有固定工具名枚举白名单，优先验证兼容，不无故修改其格式或版本。旧lookup/query_operators历史记录继续可读、按原名统计；新的运行只记录facts_search，不自动重写旧快照。历史结果版本缺失保持未知，不补成版本1或2。

历史名称识别与当前允许执行的工具白名单必须分开：保留旧工具名类型/统计识别，不代表当前executor继续接受旧调用。新facts/hybrid运行若收到lookup或query_operators，应按既有unknown_operation路径拒绝执行、正常占用一个准入点（预算已耗尽则先按既有规则拒绝）；不自动转译参数、不暗中兼容两个外部入口。

实施时将当前schema版本4递增为5（如基点已变则核对后递增），自动计算工具指纹；结果版本2与输入schema版本分离。保留RAG、查询agent主体和预算实现。已完成的提示词/facts计划作为前置，当前未提交历史产物不覆盖。

### 具体验证方案

基础fixture仅包含A/B/C：A的canonical=测试甲，rooms=[制造站]，class=近卫，factionGroups=[测试组]，skillGroups=[共享词]，技能名=甲技能、equivalenceSkillNames=[甲技能,乙技能]。B的canonical=共享词，rooms=[办公室]，class=医疗，factionGroups=[测试组]，技能名=乙技能且等价数组同A。C的canonical=测试丙，rooms=[制造站]，class=医疗，factionGroups=[另一组]，技能名=甲技能附注，无等价组。三卡均rarity="4"、aliases=[]，未列技能组为空；每卡一个技能，room等于所属设施、grantId分别为a/b/c、unlockType="初始解锁"、target=""、effectText="测试效果"、notes="技能备注"，卡notes="卡级备注"。

独立变体不混入基础预期：U05仅用D（由A复制，canonical改为"测试 甲"）。U07仅用A，rooms增办公室，增加a1（制造站、甲技能升级、精英1提升、replacesGrantId=a）及a2（办公室、联络技能、初始解锁），两技能各自effectText="升级效果"/"联络效果"、notes="升级备注"/"联络备注"、target=""；查制造站仍展示a/a1/a2及替换与各备注。U08同名变体仅用A一张卡，将factionGroups改为[共享词]，预期共享词只返回A一次、同时注明技能组/阵营；宽查另生成100张同设施卡（从A复制，canonical为宽查001至宽查100），手工断言该ID集合、卡数100和最后一张卡正文存在。所有预期手工定义，不调用被测索引生成expected。

| 编号 | 输入/场景 | 独立预期 |
|---|---|---|
| U01 | 测试甲；甲技能；乙技能 | {A}；{A,B}；{A,B}，相似名称C不进入精确技能匹配 |
| U02 | 制造站；测试组；医疗 | {A,C}；{A,B}；{B,C}；证明无需LLM选择字段 |
| U03 | 共享词 | {A,B}，A标技能组、B标干员；卡不重复，类别和卡序稳定 |
| U04 | 甲技；制造站 近卫；未知词 | empty、executed=true、两计数0、扣1点，不拆词或子串兜底 |
| U05 | D的完整带空格名称；前后附空白 | 均仅命中D；内部空格不被删除 |
| U06 | null/数组根/空对象/query空白/错类型/额外字段 | invalid_params、不查询、不带结果元数据，仍遵守准入扣点 |
| U07 | 设施命中一张多设施卡 | 全卡展示，逐技能设施、解锁、替换、备注保留；不会把全卡声明成设施局部技能 |
| U08 | 同名多类别同一卡、合法宽查 | canonical去重、计数按卡、完整返回；没有隐藏topK或RAG字符上限 |
| U09 | 第5次空查、第6次请求、缺失/重复ID、存储异常 | 保持既有预算、拒绝、fatal、trace/usage契约；单次跨类别只扣1点。类别元数据与中文标签的逐类断言见测试文件中的 U09 参数化用例。 |
| U10 | 五模式schema、dry、旧trace/snapshot | facts/hybrid只暴露新facts入口；其它模式不变；旧工具名记录保留可读和原统计，不被误判RAG或丢弃 |
| U11 | 新facts/hybrid向executor提交旧lookup/query_operators名，剩余预算充足 | unknown_operation、executed=false、每个准入请求扣1点，无facts结果元数据；报告读取历史同名记录仍正常 |

真源核对：格拉斯哥帮预期推进之王/因陀罗/摩根/达格达，依据knowledge/references/名册.md第58/183/221/319行；裁缝·β依技能等价真源返回卡夫卡/折光/明椒/柏喙。实施时核对当时源行，不向运行时注入这些预期作为特判。

结构负担验收：hybrid从3工具降为2，facts从2降为1；facts参数由两个入口、6个不同业务字段收束为1个query，无anyOf和分类字段。比较实际发送schema的序列化字符数并记录，不把字符数等同于token或成功率。保留名称标点规则和精确匹配边界即可，不用长提示重新要求模型模拟旧筛选器。

使用当前schema v5与最终 JSON 执行JSON.stringify计数（无空白格式）：facts工具数组306字符，hybrid数组559字符；这是结构测量，不等同于token、费用或回答质量收益。当前复核原件及命令记录见对应实施笔记。

正确性由词条索引、命中集合和协议确定性测试验收，不做RAG命中率调优。用户已授权转计划并交接实施；不含付费跑测。

### 实施顺序

1. 在facts store层建立带命中类别的精确词条索引及统一查询结果；按U01–U08验证手工预期集合和全卡渲染，复用已有真源加载及内部查询函数。
2. 在执行器接入facts_search单字段schema与结果版本2，完成模式白名单、输入schema版本、工具分类和历史名称处理；依U09/U11保护预算和异常路径。
3. 同步provider dry、人工指令、agent能力暴露及trace/report兼容；依U10确认新运行只暴露新入口而旧快照仍按原名统计。人工指令只作与新入口相关的路由修改，保留已有证据和停止条件。
4. 运行定向测试：`pnpm run test -- bench/tests/facts-tools.test.ts bench/tests/tool-executor.test.ts bench/tests/agent.test.ts bench/tests/agent-auto-loop.test.ts bench/tests/agent-provider-ledger.test.ts bench/tests/provider.test.ts bench/tests/runner.test.ts bench/tests/report.test.ts bench/tests/snapshot.test.ts`；新增测试文件应纳入定向清单。完成`pnpm run typecheck`、`pnpm run test`、`pnpm run build`，最终构建五模式各至少2题dry；重测schema字符数，更新notes及验收清单，运行文档检查与差异检查，按scripts/INDEX.md收尾临时产物。

## 验收清单

- [x] 单词条精确索引覆盖六类来源，同名并集及canonical去重正确，U01–U05通过
- [x] 参数校验、全卡及匹配依据输出、计数与结果版本2符合契约，U06–U08通过
- [x] 预算、坏ID、fatal、旧名称执行拒绝保持契约，U09/U11通过
- [x] 五模式工具列表与dry同步，旧工具名历史记录和缺失版本兼容，U10通过
- [x] 人工指令与新入口一致，未加入自然语言解析、子串兜底或高级筛选语法
- [x] 定向测试、typecheck、全量test、build及五模式dry通过，schema负担实测已记录
- [x] 文档及差异检查通过，ADR状态、notes与临时产物按实际完成状态收束

## 关联 ADR

- [ADR-007](adr/ADR-007-single-term-facts-tool.md)：单词条facts统一入口。
- [ADR-006](adr/ADR-006-independent-function-tools.md)：保留其RAG暴露、独立调用与预算等其余契约。

## 独立审查

设计阶段独立agent `review_single_facts` 已审查方向与实际代码，认可精确跨类别并集、全卡输出和高级过滤取舍。已采纳意见：旧工具历史识别与执行准入分离，新增U11；U08限定仅A，U07明确三技能；说明技能组投影同源关系；真源样本明确四名成员；snapshot按现有字符串能力兼容，缺失版本保持未知。实施后的代码与测试批次已由只读 subagent 复核通过；当前文档批次的验证记录以实施笔记为准。
