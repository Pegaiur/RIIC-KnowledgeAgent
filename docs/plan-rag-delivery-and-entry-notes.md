# 实施笔记：RAG 送达范围与入口优化计划

> 对应 plan：docs/plan-rag-delivery-and-entry.md
> 开始日期：2026-09-11

## 决策偏离

### 2026-09-11 — 需求复核与工程/试验验收分开

- **背景**：用户将草案转为计划后要求检查、修正和细化需求；当前尚未开始运行时实现。
- **决策**：保留 plan 作为工程入口，首版按小节命中文件扩展；施工前收口容量与 ADR。实体标记和付费对照保留承接设计，实际运行另行 exp，工程验收不要求先跑出试验结果。
- **影响**：已回馈 plan 的目标、步骤顺序、步骤 0/4/5/6 与验收清单；不启动代码改造或付费调用。旧实体标记设计未执行，按已取消迁入 docs/exp/exp-entity-marking-probe.md，保留历史设计与收束说明。

### 2026-09-11 — facts 附带开关采用三态（undefined = 随模式默认）
- **背景**：plan 要求「显式在 bm25 请求附带应报中文参数错误」，同时 bm25 默认不得附带。
- **选项**：
  - A: `attachFacts: boolean` 必填，bm25 默认写 false；CLI 需同时改两处，所有构造配置处都要补字段。
  - B: `attachFacts?: boolean` 三态，undefined 表示随模式默认（hybrid 开、bm25 关），仅显式 true 在 bm25 报错。
- **决策**：B。新增 `effectiveAttachFacts()` 统一解析有效值；默认组合与对照组合共用同一配置装配。
- **影响**：inputs/meta 记录有效值（布尔）而非三态；历史缺字段表示不可用。

### 2026-09-11 — 容量分配口径定稿：facts 附带为独立额外额度

- **背景**：ADR-013 决策 4 与 plan 步骤 0 要求容量分配先落文档、不得由执行者随意选择；步骤 0 只登记「总上限 12,000」，RAG/facts 分配一直待定稿。
- **决策**：用户裁决「facts 额外给 4000 额度」——RAG 正文沿用 `maxContextChars`（12,000）不变，facts 附带在该上限之外另给独立额度 **4,000 UTF-16 字符**，两部分不互相回收，合并 `data` 上限 16,000；外层 JSON 单独观测。facts 分区头、未附带提示与卡正文均计入该 4,000 额度。
- **影响**：已回馈 ADR-013 决策 4 与 plan 步骤 0/3；`RAG_ATTACH_FACTS_QUOTA_CHARS = 4000` 落在 tool-executor。plan 步骤 3「若连完整未附带提示都放不下应先收缩证据正文」在独立额度口径下改写为：提示同样计入 facts 额度，放不下分区头时不产生附带正文（固定 4,000 下实际不可达），不改动 RAG 正文预算。

## 实现调整

### 2026-09-11 — 步骤 0：契约与三开关配置落地
- **plan 原文**：为步骤 6 提供可读、相互独立的「是否含技能表 / 是否扩展原文 / 是否附带 facts」开关，由统一配置装配供 runner/CLI 使用并写入 inputs/meta。
- **实际做法**：ExperimentConfig/BenchConfig 增加 includeSkillTables（默认 false）、expandFulltext（默认 true）、attachFacts（可选三态）；inputs.config 与 meta.json 写入有效值；快照 META_ALLOWED_KEYS 放行三个键。步骤 0 只登记配置，不改变检索行为，范围/扩展/附带分别在步骤 1/2/3 接入。
- **原因**：步骤 0 定位为施工前契约收口；行为接线按步骤顺序推进，保持每次提交可回归。
- **后果**：步骤 1/2/3 各自消费对应开关；`inputsSchemaVersion` 与 meta `schemaVersion` 维持现值（字段为向后兼容追加，旧运行缺字段表示不可用）。

### 2026-09-11 — 步骤 1：技能表退出检索范围
- **plan 原文**：在检索装配层过滤九份 `references/技能-*.md`，不改 knowledge 真源与 corpus-manifest 语义；两组范围共用装配；过滤在建索引前执行，索引下标与过滤后数组配套。
- **实际做法**：corpus.ts 新增 `isSkillTableFile` 与 `selectRetrievalChunks`；runner 先载入全量 `corpusChunks`，再按 `includeSkillTables` 装配检索 `chunks` 与索引；meta `chunks` 记为检索范围块数，新增 meta `corpusChunks` 记全量块数。小节目录、read_section 与 gold/hitrate 仍用真源原文，本阶段不动。
- **原因**：满足「范围可辨识 + 下标配套」，把 gold/hitrate 口径变更留给步骤 5，保持每次提交可回归。
- **后果**：默认运行 meta `chunks` 由全量降为排除技能表后的块数；历史运行缺 `corpusChunks` 表示不可用。

### 2026-09-11 — 步骤 2：命中文件原文扩展
- **plan 原文**：取 topK 后 base/guides 按文件去重扩展到文档范围，顺序取首次命中位置；references 仍按原块；扩展取运行级原文快照；超限按可续读连续原文送达并记录 offset/行范围/complete/next_offset；极小上限报明确 error。
- **实际做法**：sections.ts 新增每文件的文档范围条目（level 0、覆盖含标题前首部的整篇正文，ID `doc:<相对路径>`，可由 `get` 解析以续读，不进入 `sections` 数组以免影响既有小节计数与 ID）；tool-executor.ts 将 buildRagData 拆为 legacy（关闭扩展或无小节目录时按原「拼接 + 硬截断」行为）与 expanded 两条路径。expanded 对 base/guides 按文件去重扩展，容量不足时元数据先留位并按行边界送达可续读前缀，极小上限返回容量错误（status error、非 fatal）；新增 `FulltextRange` 观测并接入 trace 工具事件。
- **原因**：既满足扩展与续读契约，又不改动既有小节体系与 `sectionCount`；保留 `expandFulltext=false` 对照组合的既有行为。
- **后果**：默认运行 base/guides 命中会送达整篇原文（受 `maxContextChars` 约束）；references 截断由硬截断改为按行边界；步骤 5 需在报告层明确范围与送达。

### 2026-09-11 — 步骤 3：RAG 精确词条自动附带 facts
- **plan 原文**：仅 hybrid 的 rag_search 启用；整条精确优先，否则按空白边界取已登记完整词；多词分支仅 ≥2 字干员/技能/技能组/阵营/alias/substring/combo，设施/职业不展开，不解析自然句；复用 store.factsSearch，不新增 LLM 请求；按单个触发词完整集合为原子单位附带，放不下整组不附带并给原因；1 次 attempt、有效送达才计 success；trace 记录内部触发/路径/送达；本步一并把 TOOL_SCHEMA_VERSION 9→10 并同步断言与 inputs/meta。
- **实际做法**：store.ts 新增只读 `entryDictionary`（六类词条与 alias/substring/combo 并集，提供 `categoriesOf`/`isCuratedEntry`），导出 `serializeCard` 与 `serializeResolutionPaths` 供独立 facts_search 与内部附带共用同一措辞；tool-executor.ts 新增 `recognizeEntryTriggers`（入口规则 3–6，整词优先、最长完整词边界、未准入不拆内部短词）与 `buildFactsAttachment`（独立额度 4,000、按触发词出现顺序原子装配、跨词 canonical 去重、未附带给原因）。rag_search 改为原子组装：先算完 RAG 与 facts 全部分支确认最终输出，再更新共享注入列表；附带观测经 `ToolExecutionResult.attachedFacts` → `TraceToolEvent.attachedFacts` 落 trace；`TOOL_SCHEMA_VERSION` 9→10。
- **原因**：复用既有 store 与卡片序列化，保持「同一套事实解析规则」，不新增 LLM 请求、不新增哈希字段；facts 用独立额外额度，避免改变纯 RAG 对照行为。
- **后果**：hybrid 默认 rag_search 会（首次）加载 facts store 并按入口附带记录卡；RAG 与 facts 任一实际送达非空证据即计一次 success，提示与路径元数据不扣点；工具描述与 knowledge/AGENTS.md 首版不改（保持四组对照同一指令与工具描述），仅 schema 版本递增，`FACTS_RESULT_VERSION` 保持 5。

### 2026-09-11 — 步骤 5：测量口径与观测消费者收敛
- **plan 原文**：保留 gold/spec 事实要求与真源锚点，不以移除技能表为由删减分母；区分小节排序命中、扩展原文送达、附带 facts 送达与回答覆盖；明确过滤后索引与 gold 解析目录映射，runner/CLI hitrate 范围一致；保留旧 hitCount 口径并说明局限，新增实际证据送达计数；消费者检查覆盖 tool-executor→agent/trace→runner 与 report、snapshot；沿用旧 chunk ID 字段，新增有类型的范围/卡附带观测。
- **实际做法**：hitrate.ts 新增 `HitrateOptions.directoryChunks` 与 `HitrateScope`：gold 在完整、未截断定位目录解析，检索范围只决定可达性，候选块映射回稳定原键 `chunk.id`；被排除但真源存在的键计未命中、仍保留 recall 分母，precision/nDCG 用全部 gold 原块定义；`QuestionHit.excludedKeys` 与 `scope` 如实输出排除数量，renderHitrate 打印范围计数。cli.ts hitrate 改为「未截断目录解析 + 与 runner 同源（maxContextChars + includeSkillTables）的检索装配」，checkGold 用完整目录。cli-args/cli 新增 `--include-skill-tables`/`--expand-fulltext`/`--attach-facts`（0|1，其他取值中文报错），dry 启动行与 meta/inputs 记录有效值，用于复现步骤 6 四组对照。report.ts 将 `successes` 明确标注为「证据送达（成功）」（ADR-013 决策 5 定义 success 即实际送达非空证据），并把旧 `hitCount` 标注为「旧 chunk 口径，不含 facts-only 送达」，避免只附带的成功被读成没有证据。
- **原因**：测量口径须先于对照固定，且范围收缩不能悄悄删减 gold 分母；四组对照缺少可复现的运行期开关。
- **后果**：CLI `hitrate` 默认在排除技能表的 145 块上排序、以 749 块完整目录解析 gold，输出「定位目录 749｜检索范围 145｜排除 604｜被排除 gold 键 23」；历史 `runHitrate(index, chunks, …)` 调用（缺省 directoryChunks）保持单范围口径。观测消费者未改字段契约，仅收敛标签与范围输出。

## 债务记录

本轮未新增或修改代码技术债；施工前待决事项直接列于 plan 步骤 0。

### 2026-09-11 — 步骤 2 独立审查的非阻塞项承接
- **债务**：独立审查指出三项非阻塞项：① `TOOL_SCHEMA_VERSION` 未随步骤 2 的 rag_search 返回数据语义扩展递增；② 容量错误路径 `ToolExecutionResult.message` 为空、trace `error` 字段缺失；③ 缺跨文件稳定排序、恰好容纳、正文中段/尾部与未 clamp 快照对照等边界测试。另记录 injectedIds 去重计数边界（同文件多命中只记首个 chunk，扩展范围另记 `fulltextRanges`）。
- **未来偿还**：① 在步骤 3 与 facts 附带（及工具描述同步）一并把 `TOOL_SCHEMA_VERSION` 从 9 递增到 10，避免同一步两次改版本；② 归入步骤 5 的观测消费者收敛，统一错误文本来源；③ 随步骤 5 契约测试补齐。三项均不影响本步运行正确性，plan 对应验收项保持未勾选。

### 2026-09-11 — 步骤 3 偿还 TOOL_SCHEMA_VERSION 债务
- 步骤 2 债务①已在本步偿还：`TOOL_SCHEMA_VERSION` 9→10，同步更新 tool-executor 与 runner 测试断言；值随 `toolSchemaMetadata` 自动写入 meta 与 inputs，无需另改字段。债务②（trace 容量错误 message/error 收敛）与③（跨文件排序/恰好容纳/正文中段尾部等边界测试）继续归入步骤 5，plan 对应验收项保持未勾选。

### 2026-09-11 — 步骤 3 审查遗留（归步骤 5）
- **债务**：hybrid rag_search 的 facts store 加载/查询异常缺直接回归测试（应断言 status=error、fatal、`context.injectedIds` 不残留）；当前仅覆盖 facts_search 的异常路径。plan 验收项「长文续读、空/错误/预算拒绝、附带容量与共享注入状态、历史格式及全部观测消费者通过契约测试」保持未勾选。
- **未来偿还**：随步骤 5 观测消费者与错误文本收敛一并补齐；不影响本步运行正确性。

### 2026-09-11 — 步骤 5 偿还步骤 2/3 遗留
- **步骤 3 遗留（facts 异常原子性）已偿还**：facts-attach.test.ts 新增三项——store 加载失败与内部 factsSearch 抛错均断言 `status=error`、`fatal=true`、`context.injectedIds` 与结果 `injectedIds/fulltextRanges/attachedFacts` 不残留、`successUsed=0`；预算拒绝的 rag_search 不触发内部查询、不改动共享注入列表。
- **步骤 2 债务②（容量错误观测）已偿还**：tool-executor 对操作直接返回的 `status=error`（原文扩展容量不足）写入 `message`，trace `error` 不再为空；仍非 fatal、不扣成功额度，与 catch 分支口径一致。
- **步骤 2 债务③（边界测试）已偿还**：fulltext-expansion.test.ts 补「恰好容纳整篇判 complete」「多文件命中按首次命中顺序跨文件稳定排序」「read_section 从正文中段读到尾部、offset 对应原文」三项。
- **未改动的既有债务**：`docs/plan-facts-crossref-navigation.md` R5 系列、report A2、hitrate D1 与步骤 2 的「设施大集合整组先渲染再判额度」均属既有登记，本轮不改。

## 意外发现

### 2026-09-11 — 证据归因与协议引用校正

- **发现**：S08 原始 facts 返回完整阵营名单，支持 plan 的 13/7 归因并修正旧 exp 的 14/6 引用；六个单小节目标中五个所属文件已命中，F08.3 需按复合要求单列。词条检测也不能把 S07 阵营查询说成不触发。
- **影响**：已回馈 plan 的证据表与归因说明；未重评整轮答案、未回改已结束 exp 正文。旧 query_operators 路由及笼统 schema v5 表述改为当前工具定义 v9、facts 结果 v5，已验证表述更正为待验证。

### 2026-09-11 — 快照键白名单会静默丢弃新 meta 字段
- **发现**：bench/src/snapshot.ts 的 sanitizeMeta 只保留 META_ALLOWED_KEYS 内的键；未登记的 meta 新字段在导出共享快照时被静默丢弃。
- **影响**：新增 meta 字段必须同步登记白名单，否则对照快照缺配置且无报错；步骤 0 已一并登记 includeSkillTables/expandFulltext/attachFacts。

### 2026-09-11 — meta.chunks 语义随范围收缩改变
- **发现**：meta `chunks` 原为全量分块数，步骤 1 后改为检索范围块数，跨策略对比会看到该值变化；为避免歧义新增 meta `corpusChunks` 记录全量块数。
- **影响**：步骤 5 需在报告/快照层明确检索范围与排除数量，避免把不同范围的块数直接横比。

### 2026-09-11 — 文档范围 ID 采用可读路径而非哈希
- **发现**：文档范围需要稳定可调用的 ID；但编码核心约束 #10 默认禁止新增 sha256 / 指纹字段，故未沿用 `encodeSectionId` 的哈希方案，改用可读的 `doc:<相对路径>`。既有小节 ID 不变、不失效。
- **影响**：该 ID 随文件重命名变化（与既有小节 ID 行为一致）；read_section 以 `get` 解析文档范围、续读链路可用。后续消费者不得以 `sec-` 前缀假定所有可读 ID。

### 2026-09-11 — 工具描述与 AGENTS.md 首版不改
- **发现**：plan 非目标允许同步工具描述与 knowledge/AGENTS.md 以准确描述附带行为，但步骤 5 要求四组工程对照保持相同指令与工具描述；attach 是 hybrid 内的配置开关，而工具描述按 retriever 而非按 attach 生成，改描述会让关闭附带的对照组拿到与行为不一致的说明。
- **影响**：首版不改工具描述与 AGENTS.md，仅递增 `TOOL_SCHEMA_VERSION`；附带行为差异由运行时 `data` 体现，步骤 6 对照时按实验条件差异如实标注。

## 阻塞与解决

ADR-013 已登记，契约收口完成；容量沿用总上限 12,000，RAG 预留与 facts 附带额度按 ADR 要求待最终 renderer 离线复算后定稿。步骤 1 的检索范围与步骤 2 的原文扩展接线已完成，步骤 3 的 facts 附带尚未开始。原始轨迹仅只读核对，本轮未新增临时产物。

### 2026-09-11 — 本轮验证

- 离线使用当前 corpus/retriever/sections/facts store 实现复算六个目标小节排名、词条命中卡与序列化长度；结果见 plan，未调用模型，未生成一次性文件。
- git diff --check 通过；新增文档另检查空白、冲突标记与末尾换行。
- doc-check 当前只报告本计划尚未完成的工程验收项（D1），其余检查无错误或警告；未运行 typecheck/test，文档修订不冒充代码验证。
- 本轮仅勾选已完成的设计承接、登记范围判定及评测影响评估三项，其他实现与验证条目继续未勾选。

### 2026-09-11 — 步骤 0 验证

- `pnpm run typecheck` 通过；`pnpm run test` 全量 439 项通过（含新增 ADR-013 三开关配置用例）。
- `node scripts/doc-check.mjs` 仅剩本计划未完成验收项的 D1，ADR D2/D5 无错误；D1 属合并门禁、施工期预期。
- 本轮勾选「跨模块契约 ADR 登记」一项（ADR-013）；行为接线与其余验收项继续未勾选。

### 2026-09-11 — 步骤 1 验证

- `pnpm run typecheck` 通过；`pnpm run test` 全量 443 项通过（新增 retrieval-range 4 项与 runner 范围断言）。
- 真实语料断言：九份技能表文件被排除，其余 references 与 base/guides 保留；默认 `meta.chunks` 小于 `meta.corpusChunks`。
- `node scripts/doc-check.mjs` 仍仅剩本计划未完成验收项 D1；本轮勾选「技能表范围、模式边界与排除落点确定」一项。

### 2026-09-11 — 步骤 2 验证

- `pnpm run typecheck` 通过；`pnpm run test` 全量 454 项通过（新增 fulltext-expansion 11 项，覆盖同文件去重、references 不扩展、续读拼接无缺口、极小上限 error、非 BMP 代理对、无/多 H1 与空正文）。
- 原 section-navigation 用例显式置 `expandFulltext=false`，隔离小节上下文行为、保留对照组合回归。
- `node scripts/doc-check.mjs` 仍仅剩本计划未完成验收项 D1；本轮勾选「base/guides 检索与原文扩展方案、分页和合并容量边界确定」一项。

### 2026-09-11 — 步骤 3 验证

- `pnpm run typecheck` 通过；`pnpm run test` 全量 471 项通过（新增 facts-attach 17 项，覆盖整词精确与内部短词不重扫、空白边界完整词、含内部空格长词整体匹配与 trim 区间、最长词边界、设施/职业与单字不进入多词分支、重复去重、整组容量未附带并给原因、跨词共享卡去重、额度极小/只够分区头两类不产生附带、仅 facts 非空计成功、bm25 与显式关闭不附带、设施大集合整组超限、trace 附带观测）。
- 真实 store 断言：`刻俄柏` 仅 facts 送达即 success 且 `attachedFacts` 记录触发/路径/送达；`制造站` 整组超 4,000 额度未附带并给原因，仅 RAG 空结果判 empty。
- `node scripts/doc-check.mjs` 仍仅剩本计划未完成验收项 D1（施工期预期，非回归）；本轮勾选步骤 3 两项。
- 容量待定稿阻塞已由用户裁决消解（facts 独立额外 4,000，见「决策偏离」与「债务记录」）。

### 2026-09-11 — 步骤 3 独立审查非阻塞项处置

- 独立子代理审查结论 PASS；三项非阻塞与两项项目关注处置如下：
  1. **触发词区间语义**：工具参数层已对 query 做 trim，生产路径识别函数的 `first` 恒为 0，`EntryTrigger`/`AttachedFactsObservation` 原注释「原 query（未 trim）」不准确 → 改为「本次实际检索 query（工具层已 trim，识别函数对未 trim 输入自行校正偏移）」；识别函数保留首尾空白偏移校正，plan「校正首尾 trim 带来的偏移」在此语义下达成。
  2. **合并 data 上限**：RAG 与 facts 之间的 2 字符分区分隔符原未计入任一额度，最坏合并 data 达 16,002 → 已将分隔符计入 facts 4,000 额度（`FACTS_ATTACH_SEPARATOR`、`budget = quota - 2`），合并 data 严格 ≤ maxContextChars + 4,000；新增「额度只够分区头、连提示都放不下时不写入无内容分区」用例。
  3. **hybrid rag_search 无条件加载 facts store**：失败面由「命中入口」扩大到全部 hybrid rag_search → 经核对符合 plan 步骤 3「候选检测使用同一 store 的只读词典」与「内部 store 加载/查询抛错走 fatal 语义」，确认为预期，不改。
- 审查后代码改动涉及额度计量与边界行为，按 commit-convention「须重新审查」重新派生未参与实现、上下文隔离的子代理复审最终内容。

### 2026-09-11 — 步骤 3 二次独立审查处置

- 二次独立复审结论 PASS。四项非阻塞处置：
  1. **未附带原因文案自相矛盾**（剩余额度不足但整组未超总额度时仍写「整组 X 超出额度 Y」）→ 文案与 `omittedReason` 改为「整组 X 字符未放入剩余附带额度 R」，同时给出所需与剩余；相关测试断言同步。
  2. **plan 步骤 3 旧条款未同步**（仍写「先收缩证据正文为其留位」）→ 已改为主工程采用的独立额度口径：分区头与提示计入 facts 额度、二者都放不下时不写截断词条、不回改 RAG 正文预算。
  3. **hybrid rag_search 的 facts 异常原子性缺直接测试** → 归入步骤 5 契约测试（见「债务记录」），plan 对应验收项保持未勾选，不改本步运行正确性。
  4. **跨词共享卡块头计数表观不一致** → 块头补「（本次新增 M 张）」，避免与仅渲染新卡产生歧义。
- 改动涉及渲染文案与 plan 契约，按 commit-convention「须重新审查」再派生隔离子代理复审最终内容。

### 2026-09-11 — 步骤 3 三次独立审查处置

- 三次独立复审结论 PASS。两项非阻塞已修：
  1. **观测虚报**：额度极小、未附带提示也写不下时 `chars` 仍记提示长度 → 仅在提示行实际写入时记长度，否则记 0，并补断言。
  2. **前导空行**：仅 facts 送达（RAG 正文为空）时 data 以 2 字符分区分隔符开头 → 分隔符仅在 RAG 正文非空时前置，并补「data 以分区头开头」断言。
- 余项：hybrid rag_search 的 facts 异常原子性直接测试仍归步骤 5（见「债务记录」）；doc-check D1 为施工期预期。
- 上述改动按 commit-convention「须重新审查」再派生隔离子代理复审最终内容。

### 2026-09-11 — 步骤 5 验证

- `pnpm run typecheck` 通过；`pnpm run test` 全量 485 项通过（新增 hitrate 范围口径 5 项、report 证据送达 1 项、cli-args 三开关 3 项、facts 异常原子性与预算拒绝 3 项、原文扩展边界 3 项；另更新 renderHitrate 与 report 渲染断言）。
- 真实语料核对：`node dist/cli.js hitrate --topk 5` 输出「定位目录 749｜检索范围 145｜排除 604｜被排除 gold 键 23」，与 plan 证据表一致；`--check-gold` 仍以完整目录校验 20 题 / 69 项全部可解析。
- dry 构造核对：`node dist/cli.js run --dry --limit 1 --include-skill-tables 1 --expand-fulltext 1 --attach-facts 1` 启动行与 meta/inputs 均记录有效开关；临时运行目录已按 scripts/INDEX 约定清除。
- `node scripts/doc-check.mjs` 在 plan 验收清单勾选后通过（D1 归零）。
- 本轮勾选「统一配置可复现四组工程对照」「契约测试」「typecheck」「test」「doc-check」五项；步骤 4/6 仍为未执行的独立试验与付费对照。

### 2026-09-11 — 步骤 5 独立审查处置

- 首次隔离子代理审查结论 PASS。非阻塞项处置：① hitrate 分支原先只吃 config 默认范围、忽略 `--include-skill-tables` → 已补读取该开关；② plan「gold/hitrate 影响评估」括注「实现与兼容验证仍待完成」已过时 → 改为「2026-09-11 实现与兼容验证完成」；③ 容量错误 `message` 与 `data` 同源重复序列化，沿用 catch 分支既有口径，接受不改；④ 排除键与「视野外」逐题合并展示，保留现状（行末已给排除计数）。
- 因涉及代码行为与文档结论变化，按「须重新审查」重新派生未参与此前审查、上下文隔离的子代理复审最终内容；二次复审结论 PASS。
- 二次复审非阻塞项处置：① hitrate 用法行补 `--include-skill-tables 0|1`；② 修正 report 中 `hitCount` 注释对原文扩展的误述，明确「不含仅由内部附带 facts（hitIds 为空）送达的 rag_search」。两项均为非逻辑文案改动，按复审豁免沿用二次 PASS。③ hitrate 对 `--expand-fulltext`/`--attach-facts` 静默忽略、④ 排除键与视野外逐键区分、重复标题 `chunk.id` 复用的 nDCG 最小用例，均记录为不阻塞、留待后续。

### 2026-09-11 — 步骤 5 契约缺口补齐与 hitrate 跨范围数值对比

- **补齐非阻塞缺口**（对应上文二次复审 ③④ 及交接记录的契约缺口，均为离线改动）：
  - ③ hitrate 静默忽略开关：新增 `ignoredHitrateFlags`，hitrate 分支对显式 `--expand-fulltext`/`--attach-facts` 输出中文提示（stderr），不再静默；补纯函数测试。
  - ④ 逐题明细逐键区分：`QuestionHit.misses` 新增 `excluded`，被范围排除的键标注「被检索范围排除」、与「视野外」分开，去掉行末冗余总数。
  - nDCG IDCG 口径最小用例：多个 golden 键解析到同一 `chunk.id`（id 复用）时，IDCG 按唯一 id 集合（`goldenIds.size`）计，`total` 仍按 golden 键保留分母。
  - facts-only 端到端聚合：新增 agent（mock provider）→ `CostRecord.toolBatch` → `aggregate` → `renderMarkdown` 断言——facts-only rag_search 计「证据送达 1」、旧 chunk 命中 0。
- **hitrate 跨范围数值对比**（离线，bigram / entityBoost=0 / topK 3,5,10；`node dist/cli.js hitrate --include-skill-tables 0|1`）：
  - 含技能表（检索 749）：recall 49.7 / 58.7 / 65.3%，precision 51.7 / 38.0 / 21.0%，nDCG 0.657 / 0.646 / 0.673。
  - 排除技能表（检索 145）：recall 47.7 / 59.7 / 64.1%，precision 45.0 / 35.0 / 19.0%，nDCG 0.603 / 0.629 / 0.647。
  - 结论：排除技能表未抬高纯 BM25 hitrate——recall@3/@10 与全部 K 的 precision、nDCG 小幅下降（recall@5 微升），因 23 个被排除 gold 键（全在 S 题）原为技能表块、现计未命中且保留分母；F04、F10 逐题改善与 plan 证据表一致，S02/S07 明显下降。该对比只反映排序与覆盖率，不代表工具或回答质量，跨范围不直接横比。
- **验证**：`pnpm run typecheck` 通过；`pnpm run test` 全量 488 项通过（较步骤 5 的 485 新增 3 项）；`node scripts/doc-check.mjs` 通过。以上均为本地离线，无 provider 调用。

### 2026-09-11 — 实施验收缺口修复与复验

- 根据用户“进行修复后提交”，修复本任务验收提出的三项实现问题；未启动实体标记探针、付费对照或作答优化。
- 原文扩展完整/分页分支均保留此前已组装正文；跨文件测试同时断言最终正文存在、顺序与实际送达区间，避免仅检查 fulltextRanges 造成虚假通过。
- 送达观测沿用 trace 的完整路径，新增 CostRecord.ragDelivery（每次外部 RAG 的 callId/status/fulltextRanges/attachedFacts）；路径持久化保留 kind/term/memberIds/category，完整来源登记仍由 trace/inputs 承载。runner 的 records.jsonl 写入台账，meta.ragDeliveryStats 与 report 共同聚合内部查询、实际附带调用、未附带词条、卡次及原文范围；快照按嵌套白名单保留台账、从 records 重算汇总。injected.json 保持旧 chunk ID 口径，answers 与 inputs 的原有职责不变，不能用 injected.json 单独核查扩展/facts 送达。
- 同次跨词共享卡只计一次送达卡次，跨次重复送达仍计入；未执行的拒绝/参数错误可确认为零，执行异常缺观测与旧记录缺字段保持不可用，不反推零查询。外部工具额度、模型调用与费用计量均不变。
- nDCG 的 DCG/IDCG 均按实际分块计量：理想相关块数为 gold 解析的去重目录下标数；多个 gold 键指同一实际块只计一次，重复标题对应多个实际块则分别计数。更正上文将“多个 gold 键指同一块”称为“重复标题块”的混淆；新增真正重复标题双块用例，nDCG@2=1。
- 验证：pnpm run typecheck 通过；pnpm run test 全量 493 项通过（新增 5 项并增强原用例）；包括模拟 provider 的真实 runner→records/meta→snapshot 导出读回→report 聚合链路。测试临时目录均由 finally 清理，未新增需交接的临时产物。
