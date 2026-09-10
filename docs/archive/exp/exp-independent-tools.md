# 独立工具与扁平参数 schema 评估

> 创建日期：2026-09-07
> 状态：已结束
> 结束日期：2026-09-07
> 需求入口：[inbox](../../inbox.md)

> 迁移说明（2026-09-09）：下列历史日期、配置、“当前”和附件路径均指原记录时点；附件去留以本文结论中的收尾说明为准，不表示文件仍保留。

## 过程

> 创建日期：2026-09-07
> 状态：前序提案，已由 [归档计划](../plan-independent-tools-schema.md) 取代；正文保留供追溯
> 需求入口：[inbox](../../inbox.md)
> 前置证据：[性能与 hybrid 评估](exp-harness-performance.md)

### 目标

将 `knowledge(operation, params)` 拆为按模式暴露的独立函数工具，让模型直接生成目标函数的参数；降低结构错误和因此浪费的取证预算。成功率提升是待真实对照验证的假设，不预先承诺百分比。

### 非目标

不恢复 `tool_choice=required`，不改 Chat API、模型、思考档位、默认检索模式、5 点预算、取消/费用台账和最终原生正文契约。不同时调整检索排序、证据压缩、答案风格或游戏事实，不引入 SDK/MCP/新验证依赖，不把本轮高频失败题写入提示词。

### 背景与依据

用户说明统一嵌套工具来自此前 required 工具验证。历史 ADR-005 也记录统一 schema 的探针及随后固定 auto 的选择；统一外壳已写入现行 ADR，但不是多工具并行、积分预算或原生正文结束的必要条件。拆分应局部替代该工具暴露决策，不回退已完成的 auto 循环与计量工作。

当前 hybrid 样本 `2026-09-07T09-55-37-752Z-qwen-off-t0`：20/20 完成、58 次提出、57 次准入、45 次执行、12 次参数错误、1 次拒绝。12 次错误均缺少 `params`：11 次 lookup、1 次 rag_search，涉及 6 题。示例：

```json
{"operation":"lookup","term":"普罗旺斯"}
```

现行协议要求 `{"operation":"lookup","params":{"term":"普罗旺斯"}}`。模型已表达出工具与业务参数，却在额外封装层失败。移除外壳能消除这类必需字段，本身不保证模型今后不遗漏 `term` 或选错工具。

代码检查还发现三个 schema/校验问题，均可由结构推导，不依赖回答成绩：

- `operation` 枚举与 `params.oneOf` 没有判别关联，schema 可以接受某些与 operation 不匹配的参数形状，最终才由本地派发拒绝。
- `both` 模式的 rag_search/grep_search 都是 `{query}`，两个 `oneOf` 分支除描述外相同；按 oneOf 语义同时命中两个分支不成立。不能据此推断百炼实际执行了服务端验证，但客户端声明本身不清晰。
- `query_operators.minProperties=1` 允许只传 `excludeIds`，与本地“至少一个正向条件”不一致；本地还会过滤错误数组元素、忽略未知字段，使声明与运行校验存在差异。

官方 [百炼 Function Calling 文档](https://help.aliyun.com/zh/model-studio/qwen-function-calling) 展示按函数名提供 tools、直接在 parameters 声明业务字段，以及通过 parallel_tool_calls 支持多调用。2026-09-07 查阅的该页没有提供本模型 strict schema 的明确保证；不能将 OpenAI 兼容解释为所有 JSON Schema 关键字都强制执行。

### 建议的工具接口

#### 1. 独立名称，直接参数

| 函数 | 入参 | 用途描述 |
|---|---|---|
| `rag_search` | `{query: string}` | 查询机制、组合、排班及培养建议的知识库片段。 |
| `grep_search` | `{query: string}` | 按关键词查找原文片段；只在现有 grep/both 模式提供。 |
| `lookup` | `{term: string}` | 按已核验的 canonical（干员正式名）、技能名、技能组或等价组名精确查记录卡；不承担一般机制问答。 |
| `query_operators` | `{room?, faction?, profession?, termQuery?, excludeIds?}` | 按分类或关键词筛选记录卡；多个条件取交集，至少一个正向条件。 |

例如线上调用为 `function.name="lookup"`、`function.arguments="{\"term\":\"普罗旺斯\"}"`，不再出现 operation/params 两个协议字段。

| 模式 | 提供的函数 |
|---|---|
| bm25 | rag_search |
| grep | grep_search |
| both | rag_search、grep_search |
| facts | lookup、query_operators |
| hybrid | rag_search、lookup、query_operators |

不同时暴露旧 knowledge 包装器；保留它会产生两条路径并污染拆分实验。历史记录继续只读兼容，不表示新运行必须接受旧调用格式。

#### 2. 参数 schema

简单工具使用同一构造方式：根 object、明确 properties、必填业务字段、`additionalProperties:false`；query/term 为非空字符串。字符串空白经本地 trim 后仍为空也拒绝。不要将 function 的 `required` 字段与请求层 `tool_choice=required` 混淆。

lookup 的完整草案示例：

```json
{
  "type": "function",
  "function": {
    "name": "lookup",
    "description": "按干员正式名、技能名、技能组或等价组名精确查找记录卡；一般机制或组合建议使用 rag_search（若可用）。",
    "parameters": {
      "type": "object",
      "properties": {
        "term": {"type": "string", "minLength": 1, "description": "已核验的干员正式名、技能名、技能组或等价组名"}
      },
      "required": ["term"],
      "additionalProperties": false
    }
  }
}
```

lookup 的别名/合称能力仍按 store.ts 中 R5-2 的既有边界处理，本次不宣称支持、不扩展索引。rag_search/grep_search 的根结构相同，业务字段改为 query，描述按其真实检索语义生成；不要复制全套使用策略到每个描述。排序、模式白名单、schema 和派发名称由同一份小型工具定义表生成，避免 agent、dry 和 executor 维护不同名单。

query_operators 的参数部分建议为：

```json
{
  "type": "object",
  "properties": {
    "room": {"type": "string", "minLength": 1, "description": "设施名称；按既有设施规范值匹配"},
    "faction": {"type": "string", "minLength": 1, "description": "阵营或干员组名称；精确匹配已有分类"},
    "profession": {"type": "string", "minLength": 1, "description": "职业名称；精确匹配已有分类"},
    "termQuery": {"type": "string", "minLength": 1, "description": "名称或技能关键词，按字面子串筛选；设置 room 时限定设施技能"},
    "excludeIds": {"type": "array", "items": {"type": "string", "minLength": 1}, "description": "从已返回结果取得的 canonical ID，仅作排除条件"}
  },
  "anyOf": [
    {"required": ["room"]},
    {"required": ["faction"]},
    {"required": ["profession"]},
    {"required": ["termQuery"]}
  ],
  "additionalProperties": false
}
```

这里使用 anyOf 表达至少一个条件，允许多条件共同出现；不使用 oneOf 限制只能填一个。`excludeIds` 缺省等于不排除，空数组允许，单独提交排除数组仍拒绝。不要求可选字段填 null，也不借机改变 AND 筛选语义。

第一版保持分类字段字符串，不立即枚举全部人物、技能或阵营。room/profession 的小型 enum 可作为后续独立变量：须从既有规范分类取值，核对旧合法输入与未来类别扩展，不能手抄第二份名单。大规模枚举增加 schema 长度且不能解决本轮嵌套错误。

anyOf/minLength/additionalProperties 的服务端接受情况先通过小型真实协议探针核对；无论服务端是否强制，宿主执行同样校验。不默默剥离关键字后把两套 schema 当作同一实验；若不兼容，记录证据后修订草案。默认不启用未经该 provider 验证的 strict 标志。

#### 3. 本地校验与错误回馈

直接读取 call.name 选择工具，JSON arguments 必须为普通对象。按对应 schema 拒绝缺字段、未知字段、错误类型、null、数组根、空白必填值、非字符串排除项，以及只有 excludeIds 的分类请求。不静默将坏参数过滤成有效查询，不从原问题补齐，不自动解包旧 knowledge 调用；字符串 trim 属于明确的常规归一化。

工具结果保留现有 status/executed/data/budget_remaining 结构、call ID 关联和预算耗尽提示。invalid_params 用简短中文指出具体字段和预期格式，如“lookup 缺少非空字符串 term；参数示例：{\"term\":\"名称\"}”。示例不携带基准答案，不复制完整 schema，不添加新的 user 消息。

无匹配不算参数错误；分类存在但没有匹配记录仍是执行结果。未知工具或模式未开放的工具拒绝执行。继续使用已有 unknown_operation 状态作为兼容的错误类别，正文描述实际工具名；无需仅因重命名新增结果状态。

预算准入依然先按调用顺序预占：错误尝试扣 1 点，不退款；第 5 次获准尝试仍做校验，合法才执行，第 6 次拒绝。不得通过少记错误、自动修复或放宽校验制造成功率提升。

## 结果

### 历史协议包对照与复核边界

原独立导出副本已用于一次中间实现观测：旧组20/20完成、65模型步骤、58提出/57准入/45执行、12参数错误、1拒绝、¥0.044996、213.065秒；新副本20/20完成、44模型步骤、33提出/33准入/33执行、0参数错误、0拒绝、¥0.031748、125.765秒。after真实工具执行为rag_search 32次、query_operators 1次、lookup 0次；两题兼容探针同样只有RAG，因此不能证明lookup路径改善。

该样本不是最终实现版本，存在call ID防护、聚合来源、命中统计和指令措辞差异。工具schema一致不代表整体输入一致；既未完成留出题验证，也没有新旧各至少三次重复对照。结论仅为中间协议包单轮观测，不是纯拆壳收益、正式质量基线或稳定性证据。以上摘自既有plan实施纪要，未重新执行。



## 结论

### 变更范围与实施顺序（待定稿）

1. **定稿决策**：建立新 ADR 局部替代 ADR-005 的统一工具决策，明确其余 auto/预算/取消契约继续有效；按当时索引分配编号并关联正式 plan。本草案不提前将 ADR-005 标记废弃或已替代。
2. **schema 与派发**：tool-executor.ts 从 knowledgeTool 单对象改为按模式返回工具数组；executor 直接按 call.name 校验并调用现有 runOperation。保留本地统一执行门面，不为拆函数复制四套预算和检索实现。
3. **agent 与 provider**：agent.ts 的能力块、offeredTools、成本工具名提取和 trace 使用实际独立函数名；保持 messages 的原始 tool_calls 与 call ID。provider 真实传输已接收 tools 数组，核查完整数组与并行处理即可；dry fixtures 必须同步改为直接参数，覆盖混合工具同批及依赖续查。
4. **唯一人工规则源**：knowledge/AGENTS.md 将 knowledge/operation/params 说明改为独立工具调用说明，仅做协议对应修改；使用时机、证据边界和答案要求不增加新规则。模式能力从运行时生成，facts 模式不能被指令暗示拥有 RAG。
5. **记录和兼容**：原 operation 名本就等于新工具名，可保持 report 的业务类别；新 trace offeredTools 如实记录数组。meta 增加 `toolSchemaVersion`、`toolSchemaSha256` 和可用工具名，哈希为本次实际发送 tools 的稳定序列化；同步 snapshot.ts 的元数据白名单及读写测试。旧快照缺字段显示未知，不回填或重写；兼容旧 knowledge 名称解析仅留在历史读取边界。需完整核对统计中的“提出”与“实际执行”，避免沿用 CLI 的提出次数误报执行成功。
6. **验证和对照**：先离线边界与五模式 dry，再在同代码基点上做新旧协议包的真实对照。不长期增加生产工具协议切换开关；遵守用户不用工作树的要求，在 `dev-temp/work/independent-tools/` 保存实施前/后的独立可运行导出副本，不创建 git worktree。每份冻结源码/构建产物、knowledge/AGENTS.md、语料及题集，从各自根目录运行；仅复制 dist 却共享修改后的当前仓库指令不构成旧组。按 scripts/INDEX.md 处理依赖与输出，密钥仅运行时从授权的根配置安全读取或通过受控环境传入，不复制到导出副本、清单或日志。记录基点、导出清单指纹及 schema/指令哈希，正式比较结束前保留两份副本和所有输出。

这涉及 agent/provider dry/runner/snapshot 等多模块工具契约替换，定稿后应走 ADR + plan；当前仅新增 draft，不进入施工、不改源码。

### 验证设计

#### 功能验收

- 四个工具的合法参数到达正确底层实现；五模式只暴露并允许各自工具。
- 校验缺字段、错类型、额外字段、空白、排除项错误、任一正向条件和多正向条件交集；不把参数错误计入底层执行次数。
- 混合工具同批预占、剩 2 点提出 3 次、5 次依赖调用、超额拒绝、未知工具；只有合法且可关联的 call ID 才回写对应成功/失败结果。
- 缺失或批内重复 call ID 按现有 protocol_error 整批终止：不准入、不扣点、不执行、不写 tool 结果，也不继续请求；保留原响应、usage 和协议失败统计，不伪造 ID 或部分续传。
- 截断先于工具执行、无工具作答回馈、超时取消、重试与部分 usage 保留继续通过；最终回答仍从 assistant.content 获取。
- 新旧快照报告可读；成本记录、trace、汇总的工具提出/准入/执行/错误/拒绝一致；错误类型与实际参数可追溯。
- 实施时执行 `pnpm run typecheck`、`pnpm run test`、`pnpm run build`，通过现有 bench 入口对五模式做 dry；文档检查及最终合并门禁仍按仓库既有流程。

#### 调用成功率与质量观测

本轮嵌套参考：57 个准入尝试中 12 个参数错误，错误率 21.1%；结构有效且实际执行为 45/57=78.9%。若以所有提出为分母则执行率 45/58=77.6%，另 1 次是预算拒绝，不能算 schema 错误。成功执行不等于非空结果或正确答案。

对照同时报告：参数错误/准入数、未知工具/准入数、实际执行/准入数、非空结果/执行数、受参数错误影响题数、首次错误后下一次尝试修正率、同类错误连续次数；无相应分母时显示不可用。预占预算拒绝的调用未经完整本地验证，不能从未验证参数推断其合法率。旧 rawArguments 保留真实形状，不在统计前修正。

非空结果以已执行且正常返回的工具事件 `hitIds.length > 0` 判定，分母仍为实际执行次数；缺少 hitIds 或执行中断另列未知，不补成无命中。不得用 status=success 或 data 非空替代命中：当前 facts 零匹配会序列化为“（无匹配记录卡）”，现 executor 仍可能标 success；本轮保留既有结果语义，仅在评测中正确读取事实字段，不借本次拆分扩展为空结果状态修复。

既有 hybrid 快照用于诊断参考。正式验证在调优前冻结额外留出问题（机制、人物/技能、分类、组合均覆盖，不只改写本次失败题），新旧配置各至少 3 次交错运行；保留全部成功与失败。模型、temperature、thinking、5 点预算、语料及问题固定，允许的指令差异仅是协议名称和调用格式。原 20 题可观察兼容性，不作为唯一提升证明。

该对照评估“拆分 + schema 内容修正 + 本地校验对齐 + 错误回馈”的协议包总体效果，不能把结果归因为纯拆壳。参数错误分缺字段、未知字段、类型错误、空值和缺正向条件等子类报告，新校验更严格带来的错误单独解释。若后续需要隔离拆分因果，另设保持其余校验与反馈一致的受控实验，不把多变量结果标为单变量收益。

记录 schema 字符数及实际输入/输出/缓存 token、总费用、模型步骤和 P50/P95 事件耗时，不假设多工具一定更省 token；成本增加和质量变化均如实报告。拆分若降低结构错误，但出现工具选择错误、空查增多或事实质量退化，应区分归因，不再针对题集追分。

离线功能契约应全部通过；真实模型的调用成功率和回答质量作为观测指标，不设任意固定及格线。结果支持改善后再决定采纳，不能仅凭“本次零错误”宣称保证成功。

### 方案取舍

推荐独立工具：函数名完成路由，参数只包含业务字段；改动范围可控，符合当前固定 auto 用法。代价是多份工具描述和迁移成本，工具选择错误仍可能发生。

只补嵌套示例/复杂判别 schema 保留了本轮失败的外壳；自动解包虽能减少报错，却掩盖协议错误并引入两种输入形式；换更大模型、思考档位或强制工具选择会增加混杂因素。本草案不选择这些路径。

### 本轮交付

仅完成证据核对和草案；没有实施 schema 变更、追加付费模型调用或新建临时脚本。现有运行原件继续服务直接比较与错误轨迹复核，按原评估文档的条件保留。

#### 独立审查与交接（2026-09-07）

独立 agent 审查提出四项修订：lookup 能力描述、call ID/第五次准入契约、命中率依据字段，以及协议包对照的归因与隔离方式。已全部修正并经同一独立 agent 复核通过，无新的阻塞问题。用户要求开功能分支并交接 Luna/xhigh 新任务，在当前仓库目录继续，不使用工作树。新任务先定稿 ADR + plan，再实施和验证；保留本轮未提交的基线文档、快照与原件，不重做已完成的基线测量。

### 迁移收尾（2026-09-09）

已将历史中间实现对照结果和功能/效果边界纳入本文。`dev-temp/work/independent-tools/` 的before/after源码、构建、语料、配置及试验输出和README已按显式清单清理，不再保留可运行试验副本。实施时before/node_modules、after/node_modules内含junction，清理器拒绝整树删除；before/.pnpm-store（1005个文件）已通过清理器删除。2026-09-09提交前再次用路径存在性检查与父目录枚举核对，`dev-temp/work/independent-tools/` 已不存在，当前没有可定位的依赖残留。本次核对未重新执行删除，不推断后续清理者或清理方式。原设计中的“保留副本和所有输出”为当时安排，不再适用。
