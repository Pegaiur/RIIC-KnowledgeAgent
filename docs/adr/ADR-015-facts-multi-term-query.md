# ADR-015：facts 多词条数组查询

- 日期：2026-09-12
- 状态：已决策
- 替代：局部替代 ADR-007 中「facts_search 只接受单个完整词条、不解析多个条件」的决策；精确索引、一次调用一次结算及其余契约继续有效。

## 背景

ADR-007 将 facts 能力收敛为单词条入口 `facts_search({query})`，一个准入调用只扣 1 点，仅 trim 首尾空白，不解析多个条件。一条问题可能同时涉及多个具名对象，当前每个词条需要独立工具调用，但 executor 已支持同一模型响应内多个 tool_calls，独立调用不必然增加模型往返。需求提出让 facts_search 一次接收多个词条；漏查和取证覆盖变化须实际观测。

现状约束：工具 schema 只声明单个字符串 `query`（additionalProperties false）；参数解析 parseToolParams 对 facts/rag 共用分支，硬编码 `allowedKeys = ['query']` 并经 parseRequiredString 拒绝非字符串，数组会整条判 invalid_params；底层 store.factsSearch 只接受单字符串；结算在 executeBatch 中按「一次调用一次结算」处理，仅非空命中成功扣 1 点。

## 决策

1. facts_search 参数改为简单字符串数组 `queries`（`type: 'array'`，items 为非空字符串，minItems 1），不再保留单字符串入参或第二字段。
2. 单次调用内按词条逐一分段返回；每个分段标注该词命中路径与命中张数，未收录词按合法 empty 输出「未收录精确词条」。
3. 逐词分段按输入顺序产出，段内卡顺序沿用 store 稳定顺序；跨词命中同一张卡时首次出现的分段返回完整卡，后续分段只列 canonical 名称、省略正文。去重范围仅限本次 facts_search，不因之前 RAG 或 facts 已返回过该卡而省略本次正文；重复词保留各自分段并在本次调用内复用查询结果；交叉引用用「第 N 段」等索引表述。
4. 整批仍按一次调用结算：合法词条中有命中即 success 并扣 1 点，全空查为 empty 不扣点；沿用 ADR-012 的双上限、失败不消耗与拒绝路径，不按词数扣点。
5. 数组内元素级非法（非字符串、去空白后为空）只对该元素报错，其余合法词条继续执行；上限按原数组长度检查（不得先过滤非法项或去重再计长度）；全部元素非法或数组为空时整批判 invalid_params，记作调用失败，不执行查询。
6. v6 的逐项结构化记录统一存放于 resolution.items，替代 v5 的 resolution.paths，不并存两份路径真源。每项含 index（原数组零基索引）、query（合法词条 trim 后字符串，非法项为 null）、status（success / empty / invalid）、paths、canonicals、message（非法项的中文原因，合法项为 null）。items 按原数组顺序保留每个元素，非法项也占段，展示段号固定为 index+1；每项 canonicals 保留跨词重复卡，总计数才取并集。
7. 根级状态：有命中为 success 并扣 1 点；合法词全部未命中（即使夹有非法元素）为 empty；没有合法元素为 invalid_params。`complete` 只表示本次合法词条命中的卡已完整送达，不代表全部输入均成功。
8. 结果计数取跨词并集去重口径：`matchedCount` / `returnedCount` 为去重后的 canonical 并集大小。
9. `scope` 保持对象外壳 `{ queries: [...] }`，值取 trim 后的合法词条，保留输入顺序与重复项；actualParams 使用同一规范化参数对象，原始输入由调用 arguments 保留。元数据仅在整次 success / empty 时返回，complete 均为 true。全非法、空数组和其他根级参数错误不返回证据元数据或逐项结果；全非法的中文错误消息逐项列明索引与原因。
10. 运行时异常与元素参数错误区分：逐词结果先在局部组装、全部成功后统一返回；中途 store 抛错整次失败（error + fatal），不返回证据元数据或局部逐项结果，不留下部分注入记录、不扣成功额度，但占用一次获准尝试。
11. 工具 schema 的 maxItems 动态从配置 `factsQueryListLimit`（默认 3）读取，schema 声明与运行时校验同源；工具描述与指令不硬编码具体上限数字。
12. 递增工具 schema 版本与 facts 结果版本，历史结果按原版本仍可读。

## 理由

- 多个原本独立的词条查询被合并时，可减少工具调用条数；不保证减少模型往返或具名对象漏查，取证覆盖变化留待观测。
- RAG 内部 facts 附带（buildFactsAttachment）可提供逐词查询及 canonical 去重的实现参考，但没有逐张重复卡列名与首次分段引用，需新写序列化；首现完整、后续仅名可避免跨词共享卡的重复正文。
- 按调用次数而非词数计量，保持「一次调用一次结算」的原子性，不改动 executeBatch 的结算逻辑，也不让数组长度直接放大或缩小额度。
- 单一规范字段（不使用 anyOf、不保留双入口）延续 ADR-007 去除 anyOf 与 plan-facts-single-query「不暗中兼容两个外部入口」的一贯原则。
- maxItems 由配置动态派生，保证 schema 描述与运行时校验单一真相，避免两处漂移。

## 备选方案

- 保留单词条、由模型多次调用 — 放弃原因：虽可同批发起，仍需为每个词条构造独立调用，不能满足一次调用接收多个词条的需求。
- 按词数扣成功额度 — 放弃原因：破坏一次调用一次结算的原子性，需改 executeBatch 结算，并改变既有预算语义。
- 跨词重复返回完整卡 — 放弃原因：重复正文浪费上下文，与本项目已确立的跨词去重口径不一致。
- 硬编码 maxItems — 放弃原因：schema 与校验两处真相易漂移，配置变更需两处同步。
- `query` 接受 string|array（anyOf）或保留 `query` + 新增 `queries` 双入口 — 放弃原因：重新引入 anyOf 或双入口，与 ADR-007 去 anyOf 及不兼容两入口的原则冲突。

## 后果

- 需同步：工具 schema 与版本、facts 结果版本与元数据、config 参数（ExperimentConfig/EXPERIMENT/BenchConfig/loadConfig/validateBenchConfig）、参数解析分支、逐词序列化与去重、knowledge/AGENTS.md 指令、trace/report 等元数据消费方及相关测试。
- maxItems 动态派生会改变工具 schema 指纹，需核对 meta 与 schema 快照相关断言。
- 放宽「一次调用仅一词条」会削弱成功额度对单次 facts 的约束强度，接受 RAG/facts 调用配比与历史运行可比性可能变化；本决策不承诺 token、费用或回答质量收益，不以评测分数为依据。
- 需在指令与 tool description 中明确：数组内每项仍是完整词条，不拆词、不解析句子或复合条件，数组不是复合过滤语法。
- 上限只约束词数，不代表输出容量上限；首版接受宽查（设施/职业词）完整返回，需离线记录组合序列化字符量，未来若引入分页/截断须同时重定义 `complete` 与送达计数。
- 具体验收以 docs/plan-facts-multi-term-query.md 的 checklist 为准。

## 关联

- ADR-007 — 单词条 facts 统一入口；本 ADR 局部替代其单词条与「不解析多个条件」的决策，其余契约继续有效。
- ADR-012 — 工具预算失败不消耗与双上限；本 ADR 沿用其结算与拒绝路径。
- 规划文档：docs/plan-facts-multi-term-query.md
