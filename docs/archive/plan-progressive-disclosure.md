# 渐进披露实施计划

> 创建日期：2026-09-15
> 状态：已完成
> 需求入口：docs/inbox.md「渐进披露与 references 定位调整」
> 定稿范围：整份渐进披露；2026-09-15 用户授权补齐 read、scope 等具体契约。本文为实施蓝图，尚未迁移语料或修改运行时。

## 目标

RAG 默认送达命中小节及可复制的阅读入口，read 按需返回原文和明确关联的事实；散文按窄命题组织，关联包含干员、具体技能及概念定义。先补齐事实出口，再完成 references 归并，保留单一真源、完整来源定位及可核查的送达记录。

实施顺序为 ADR 前置 → 事实出口 → 目录迁移及必要消费者 → 关联格式、read 和观测 → 检索默认与目录注入开关 → 分支收尾的定位与门禁同步 → 散文试点及标注 → 最终验证与观测。门禁延后只限第 3 步至第 6 步之间的指定项目，不把整个渐进披露留成后续候选。

## 非目标

- 不引入向量检索、rerank、第二打分塔，不改 BM25、分词、排序或 topK 默认值。
- 不做散文数值、条件和练度断言的自动核验，不新增查询分类器、黑话解析或综合推荐计算。
- 不恢复退役 raw、不全量刷新上游、不把 raw 加入 RAG 或模型原文阅读目录；不新增事实副本或哈希/指纹字段。
- 不登记德狼、能蕾、银崖、孑拉德四条合称，不改变 facts 同名全部返回及现有 tags 查询语义。
- 不修改 facts_search 的 queries/tags 参数、分页或匹配策略；概念卡经明确关联读取，不增加自然语言概念搜索入口。
- 不恢复目录压缩 stash，不实施目录文本压缩；本计划实现独立的目录注入开关。
- 不将回答正确率、hitrate、调用次数或费用改善设为通过门槛。观察到答错如实记录，不据此追加策略修复或针对当前题集追分。
- 本轮计划转换仅交付文档与决策，不执行功能实现、语料迁移、实现批次提交、合并或付费运行；文档与决策本身的定稿提交不受此限。

### 已授权的门禁延后例外

保留草案中 2026-09-15 的用户裁决：前置清理可以先提交，gold 定位与检索范围分离、既有白名单/基准完整性断言、关键词目录生成一致性检查及两份已登记基线的口径处置留到分支收尾第 6 步。

该例外允许指定旧断言暂红，涉及根 AGENTS.md 核心约束 #10「提交时变更范围内测试须通过，不提交红灯」及 docs/rules/testing.md「相关测试与实现同一次提交内更新」。不豁免新行为的 TDD，不豁免新协议、读取、路径隔离、分页和安全边界测试；白名单文件本身、可运行的装配与生成器路径必须随迁移同步。

每个实施批次仍运行全套测试，在实施笔记记录失败用例、原因和归属；只有第 6 步列明的延后项可以暂红，其余新增失败须当批消解。红态不合并、不发版、不跳过检查、不改评分分母，不登记新 bench/results 快照、不修改质量基线表，不执行付费试验、不作为对照基点。全部延后项转绿后才能进入散文试点、hitrate 和真实模型观测；整个计划完成前必须全套测试通过。

## 架构分析

### 实施基点与证据边界

- 当前工具定义版本为 14，facts 结果版本为 7，prose-links 格式为 1。read_section 使用 section_id、offset、linked；原文与关联事实分开调用，关联展开未分页。
- corpus.ts 仍按 H2/H3 切检索块；sections.ts 按 H1–H6 建原文目录，正文包含子树。sectionId 依赖路径、标题路径和出现序号；现有 ID 只在当前装配快照中有效。
- 默认 includeSkillTables=false、expandFulltext=true；base/guides 命中按整篇扩展。关联元数据不参与 BM25；query 触发的 RAG 内部 facts 附带与正文旁挂关联是两条独立通道。
- 技能注记已有规范化 products/professions/referencedTerms，但未投影到 RecordSkill；target 原文已经入卡。等价组 ID/名称已入卡及索引，但尚未显示关系与共同效果原文。
- 目录注入当前恒定开启且缺文件时报错；注入前后 system prompt 为 1,852 / 19,592 字符。跨基点观测可证明体积变化，不能单独证明费用变化全部由目录导致。
- 同 HEAD 的关闭全文扩展一轮 read_section 5 次，其中 4 次取得新增内容；开启的两轮均为 0 次。开启侧必答满足数两轮均略高（60、62 对 58），但费用两轮方向相反（+11.2%、−3.6%），单轮采样与缓存波动不足以支持改善或退化结论。共同遗漏不能证明与开关无关，也不能全部归因为技能文本未送达。
- ID 错传、空结果和已送达内容未被答案采用均有既有记录。必须分别记录检索命中、提示送达、原文/事实送达与答案覆盖，不能互相替代。
- 依据为 docs/exp/exp-no-expand-read-section-glm-low.md、docs/exp/exp-expand-fulltext-glm-low.md 及本地既有运行。跨配置或提示词的比较需记录差异；现有 agentInstructionsSha256 变化本身不否定受控比较，不增设新指纹。
- 草案盘点的 16 个超 6,000 字符小节均来自当前 references；迁移后不再属于模型阅读目录。read 的容量测试仍需覆盖长正文和宽关联，不能把旧盘点当作迁移后实际分布。

### 目录迁移清单

判据是 facts 是否覆盖及该文件是否还含 RAG 独占内容。base/guides 的 references 回指不是事实副本。所有目的文件保持原文件名，不在 raw 下重建 references 子目录。

| 当前路径（knowledge/references/ 下） | 数量 / 当前块数 | 目的地 | 最终职责 |
|---|---|---|---|
| 技能-会客室.md、技能-制造站.md、技能-办公室.md、技能-加工站.md、技能-发电站.md、技能-宿舍.md、技能-控制中枢.md、技能-训练室.md、技能-贸易站.md | 9 / 604，已默认排除 | knowledge/raw/ | 技能、grant、解锁、替换与注记真源 |
| 名册.md | 1 / 7 | knowledge/raw/ | 干员及机械字段真源 |
| 技能等价组.md | 1 / 10 | knowledge/raw/ | 同描述组及其效果依据真源 |
| 类别.md | 1 / 7 | knowledge/guides/ | 可检索定义；taxonomy、目录和概念引用的单一输入 |
| 歧义.md | 1 / 4 | knowledge/guides/ | 可检索的指代说明、现有登记 evidence |
| 数据源.md | 1 / 7 | 移除，不保留在 knowledge/ | 开发来源说明按本计划第 3 步转入文档轨道 |

未拆正文时，31 份 manifest 文件变为 19 份（base 12、guides 7）；默认检索块预计 145 → 121，额外排除 24 块＝名册 7＋等价组 10＋移除数据源 7。数据源不被当前 gold 引用；gold 共 20 个题键、69 条 golden 锚点，其中 26 条 references 锚点待重定位。这些是迁移盘点，不是质量门槛；散文拆分后重新计数。

## 实施方案

### 0. 决策、实施笔记与版本边界

**输入**：本计划、ADR-008/010/013/018/019/020、当前源码与已有事实。**输出**：ADR-021、ADR-022 及 docs/plan-progressive-disclosure-notes.md（两份 ADR 与笔记已随定稿先行落盘，其余第 0 步内容随实施补记）。

- ADR-021 承载目录职责、旧开关退役、事实出口及门禁延后；ADR-022 承载 read、scope、概念引用、默认送达与目录注入。均在运行时代码修改前完成，当前状态为「已决策」。
- 旧 ADR 仅部分条款被后继决策调整，保留原文和「已实施」状态；新 ADR 写明替代范围，不在旧 ADR 增加前向引用。
- 本次结果卡语义变化使 FACTS_RESULT_VERSION 7 → 8；最终新工具协议使 TOOL_SCHEMA_VERSION 14 → 15；PROSE_LINKS_VERSION 1 → 2。前置事实出口可先使用工具版本 14 / facts 版本 8；read 切换时工具版本升至 15，不按每个内部提交重复递增。
- 既有 inputs/meta/snapshot 采用可选字段兼容追加，版本维持 1；section 目录结构和 ID 算法不变，版本维持 1。旧字段缺失表示不可用，不填 0、不套新含义。若实施基点已被其他工作更新，在笔记登记实际递增值及原因，不覆盖他人版本。
- 已定稿 plan 正文不批量改路径；当前实施中的旧计划通过各自 notes 记录新契约与路径，冻结归档、历史试验、历史运行及共享快照保持原貌。后续新决策、偏离和债务按文档规则落位。

**验收**：两份 ADR 与索引一致；没有「实施时再决定」的本轮公共契约；尚未实施的行为不记成已交付。

### 1. 先接通迁移前缺失的事实出口

**输入**：规范化 SkillFact、等价组、raw/curated 两种投影和同一 serializeCard。**输出**：可供 facts_search、RAG 附带、read 共用的结果卡 v8。

| 字段 | 类型及来源 | 输出约定 |
|---|---|---|
| products | 可选 string[]，复制 SkillFact.products | 非空时写「作用产物：甲、乙」 |
| professions | 可选 string[]，复制 SkillFact.professions | 非空时写「作用职业：甲、乙」 |
| referencedTerms | 可选 string[]，复制 SkillFact.referencedTerms | 非空时写「引用术语：甲、乙」；名称不自动触发概念展开 |
| target | 保持现有 string 原文 | 非空时写「原始注记：原文」，保留无法结构化的缺口注记 |
| equivalenceGroupId / equivalenceSkillNames | 保留既有字段 | 用已解析的精确组；不凭同名重新归组 |
| equivalenceEffectText | 可选 string，复制 SkillEquivalenceGroup.effectText | 与同描述技能名、设施一起显示共同原文依据 |

- 新数组在真实投影中总是存在（空时 []），旧 fixture/旧卡缺省合法；保持源顺序与措辞，不推断缺项，不改变 tags 反查。每条注记紧随对应技能，固定顺序为作用产物、作用职业、引用术语、原始注记、同描述说明。
- 同描述输出固定含「同描述技能：…」「共同描述（原文）：…」「仅描述相同；解锁、替换、作用对象与完整效果须分别核对」。不宣称任意持有者可互换；curated effectText 不覆盖等价组原始依据，二者有差异时分别标示。
- 保留技能与持有者、设施、解锁、替换的绑定；不改变效果、数值、候选集合或匹配路径。标签投影已有的补证据边界保持。
- 名册闭包移入 knowledge/AGENTS.md 的证据边界：「干员身份以当前知识库名册为边界；规范名及现有别名/同名解析均未找到时，说明知识库未收录、不知道其身份，不凭记忆补全。」一次空检索不能证明名册外或游戏中不存在，不显示 raw 文件阅读建议。
- 不将类别定义、歧义硬规则、数据源说明接入 facts_search；不补登记四条合称。概念引用由第 4 步单独实现。

**验收**：先用已登记真源及合成边界样本观察投影/渲染测试失败，再实现；raw/curated 两种模式字段同源，旧字段内容不变，各送达入口复用同一格式。计数核对为 425 张卡、913 条 grant、167 条替换边、82 组，同时逐字段核对内容与解析结果；新增字段与预期路径变化单列，不能要求新增前后卡对象字节完全相同。

### 2. 明确文件维护与格式约定

**输入**：迁移清单、既有解析器及术语规则。**输出**：以下维护约定随第 3 步在相关入口生效。

- raw 中本次 11 份是版本控制内的机械真源；其他 raw 保留各自核验/退役状态。facts 只读明确指定的文件，禁止递归扫描 raw、失败后回退旧 references 或静默返回空库。RAG manifest 的加载校验只接受 base/、guides/ 下的批准文件，显式登记 raw/references/开发文档也应拒绝，保持现有文件类型、符号链接和真实路径越界检查；gold 的指定 raw 输入使用独立定位装配，不放宽这条边界。
- 原始事实的标题、表格、条目、持有者、解锁、计数、数值和原始措辞保持；文件路径/维护头注更新可独立核对。类别中的 81 条记录及两个同名「特殊加成」「特殊叠加规则」各自保留，不合并。
- 术语检查采用精确文件例外：guides/类别.md、guides/歧义.md 作为保留原格式的参考资料，整文件不进入玩家散文禁词匹配；其余 base/guides 继续全量检查。例外在规则与脚本明确登记这两个路径，不按任意头注、文件名模式或整个 guides 放宽。例外不豁免来源、定位及指令冲突审阅。
- 这两份参考资料允许改维护说明、路径及与当前工具契约冲突的指令段；不得趁迁移改定义和成员数据。歧义的设施线索用于答案解释或必要追问，不能指示工具静默删掉同名匹配；「推王」等现有冲突按 ADR-010 的全部返回契约修订说明，登记本身不改。
- 各当前文件的生成头注改为真实维护信息：历史由上游生成，当前以受版本控制文本为输入；本仓库没有 scripts/build_refs.py，不承诺运行它即可重建，也不新增该生成器。公共练度说明仍由已有 update-reference-projection.mjs 投影，限定它能维护的片段。
- base/guides 回指统一改成能力表述，例如「具体技能效果、持有者、解锁与替换以 facts 返回的记录为准」；不给模型 raw 路径。当前盘点 base 34 行、guides 3 行，实施时重新搜索并审阅语义，不以固定替换次数验收。

**验收**：保留层格式能由原解析逻辑消费；两个例外以外的文件仍会被术语测试检出；解释语句不改变词条解析政策；未产生第二份真源。

### 3. 迁移文件并闭合运行消费者

**输入**：第 1 步事实出口、第 2 步维护规则。**输出**：11 raw＋2 guides、数据源移除、references 目录撤销。

| 消费者 | 本批必须完成 |
|---|---|
| facts/references.ts、equivalence.ts | 指定 raw 真源及中文读取错误路径 |
| facts/taxonomy.ts、catalog.ts | 类别新路径；taxonomy/目录生成保持同一输入 |
| facts/curation/terms.ts 及其它 evidence | 歧义及真实来源新路径，不改变登记集合 |
| 公共练度投影脚本、facts 观测脚本、测试夹具 | 读写路径、帮助文字及隔离夹具同步 |
| corpus-manifest.json、corpus.ts、sections.ts、runner.ts | manifest 只留 base/guides；RAG 与模型目录排除 raw；删除旧技能表过滤依赖 |
| CLI/config、inputs、meta、snapshot | 按下方退役与历史格式契约同步 |
| prose-links、当前规格、指令、规则、导航 | 更新当前定位和说明；spec 版本递增但不改题号、必答项及判定含义 |

**旧开关退役**：

- 新配置移除 includeSkillTables 与 EXPERIMENT 默认；运行代码不再读取该开关。CLI 对显式 --include-skill-tables（包括 0、1、缺值及非法值）在执行前报中文参数错误、按 bench CLI 现有口径以退出码 1 结束，提示「--include-skill-tables 已退役；RAG 仅检索 base/guides，精确事实请使用 facts 能力」。无开关时正常运行，不把 0 当静默兼容。
- run、hitrate、catalog 的解析/拒绝清单及帮助同步，不能让旧参数落入 catalog 写入分支；不扫描 raw。新 inputs/meta 写可选的 retrievalScope: "base-guides"，不再写 includeSkillTables。
- 旧快照/元数据的 includeSkillTables 保留可读；新读取器允许旧值与新范围字段共存，但不根据 false 推断为新范围。inputs 中历史 includeSkillTables 改为可选兼容字段；snapshot 白名单保留旧字段并新增 retrievalScope。只读历史展示原事实。
- expandFulltext 在此批仍保持既有默认，类别/歧义进入 guides 后按 guides 规则送达；第 5 步统一改默认。同时验证开/关两条路径，不能借目录变化暗改开关。

**数据源文档移除**：

删除前在本计划实施笔记记录最小来源依据与限制：主源仓库/提交、425 干员/747 上游技能/81 术语，补源 415/727、20 技能及 10 干员缺补源字段、三项口径差异、生成器缺位；其中 747 是上游条目数，不是规范化技能事实数。为仍需定位的缺口保留原标识清单及已知玩家提示，不复制整篇开发文档或新增 knowledge 副本。该记录随计划归档进入实施纪要，未来真源刷新需单独更新真实来源证据。

**验收**：文件、读取/生成器路径、manifest 登记、当前 prose-links/规格定位在同批闭合，目标目录无冲突后撤销旧目录；指定输入缺失会失败，facts 正常加载，raw 不可由 rag_search/read_section 定位。仅第 6 步指定的门禁允许暂红；本批新增测试与 typecheck 通过。

### 4. 交付关联格式 v2、read 和送达观测

**输入**：迁移后的事实与模型小节目录。**输出**：同一运行快照中的可解析关联、可续读 read、完整的实际送达记录。

#### 4.1 prose-links.json 格式

文件继续为 knowledge/prose-links.json，不进入 manifest 或 BM25。UTF-8 JSON，顶层仅 version、links；version=2。每条仅 file、headingPath、可选 occurrence、必填 scope、objects；顶层、entry 和各 kind 引用的未知字段均报中文错误，所有名称须为非空字符串并精确匹配，不自动改词。

- file：knowledge 根相对路径，统一正斜杠，仅允许当前 manifest 文件；拒绝绝对路径、反斜杠、空段、.、.. 及越界路径。
- headingPath：从 H1 到目标标题的原始文本数组，不含 #；文档根用 []，统一定位 documentRange 的 doc:<file>，不指向标题前引言。occurrence 为从 1 起的正整数；省略要求唯一，显式值必须存在；文档根显式出现序号只能为 1。
- scope："section" 或 "subtree"，必须显式填写。objects 可以为空；同一定位仅一条 entry，单条内解析到同一对象的重复引用为错误；跨节点可引用同一对象。
- kind=operator：canonical 必填且只能用名册规范名。
- kind=skill：operator、room、name 必填；unlock 可选，使用原始解锁文本做精确消歧，仍不唯一时报错，不走别名/子串/同名扩张。
- kind=concept：file、headingPath 必填；occurrence 用于标题消歧；term、termOccurrence 用于条目消歧，规则见下节。
- 当前 v1 两条标注逐条显式迁移并补 scope=section；当前运行拒绝 v1 文件并提示迁移，历史 inputs 原样可读。文件缺失仍代表无标注，非法 JSON/IO 失败不得降级成空关联。

格式示例（展示当前真实名称与结构，实施时仍须通过实际定位校验）：

~~~json
{
  "version": 2,
  "links": [
    {
      "file": "guides/高效率散件.md",
      "headingPath": ["高效率散件", "办公室联络散件"],
      "scope": "section",
      "objects": [
        {"kind": "skill", "operator": "普罗旺斯", "room": "办公室", "name": "天灾信使·β"},
        {
          "kind": "concept",
          "file": "guides/类别.md",
          "headingPath": ["官方术语与类别", "规则说明（25 条）"],
          "term": "心情落差"
        }
      ]
    }
  ]
}
~~~

该示例只说明格式，不据此断定「心情落差」应标注到该办公室小节；实际标注由正文命题决定。

#### 4.2 scope、读取范围与去重

scope 只定义关联适用范围，不修改章节树、不参与检索、不改变原文分页：section 的引用仅作用于登记节点；subtree 的引用作用于该节点及其后代。不同文件之间不继承。

read(S) 的原文范围沿用 S 的整棵子树；关联集合由 S 子树中的全部登记，加上 S 严格祖先中 scope=subtree 的登记组成。读取子节点不会自动带上祖先 scope=section 的关联；读取父节点因包含子树正文，会收集子节点的明确登记。文档范围 doc:<file> 收集该文件的全部登记，不扩展其它文件。文档根作为所有标题的逻辑祖先参与 subtree 继承，即使既有 SectionEntry.parentId 没有记录这条边；通过关联装配补足，不修改 sectionId 算法。空 objects 只是不新增关联，不能屏蔽祖先显式适用的关联。

来源登记按文件原文顺序、objects 内顺序稳定合并；继承来源同样保留原节点。正文页与事实页共享这一逻辑范围，关联不因正文暂时只返回前半页而变成另一组。每个送达对象保留全部登记来源，不把作用域声明当成正文断言已获证实。

- operator 引用产生完整干员卡；skill 引用只投影该持有者的指定 grant，并沿 replacesGrantId 补齐被替换链，标识「明确引用」与「替换依据」，不加同卡其它设施或无关技能。
- 同 canonical 的多个 skill 引用合并成一张投影卡；同时有 operator 引用时完整卡覆盖投影卡，登记依据仍全部保留。投影卡卡头仍标为干员全局属性，不冒充技能专属属性。
- 卡按首次出现顺序去重；概念按精确来源位置去重，不按名称合并；facts_offset 以最终混合对象序列计数。
- 不递归追踪技能文本、referencedTerms、同描述技能或概念正文出现的名字。新增引用必须人工登记。

#### 4.3 概念引用与卡面格式

概念引用只从当前模型原文快照中的 manifest 文件读取，禁止 raw/开发文档；不新建独立概念真源、不复制定义到 JSON。

- 未填 term：目标必须是有非空正文且无子标题的单概念小节，读取其正文作为定义；用 sectionId 对应的精确位置做身份，不将整个宽章节包装为概念。
- 填 term：在已定位小节的直接正文中精确匹配行首「- **名称**」条目，名称是加粗内容；允许后接现有数量括号、冒号及正文。连续内容取至下一条同级条目或下一个标题，不跨入子小节。
- termOccurrence 是相同名称在该直接正文中从 1 起的序号；重复名称时必填。缺 term 不允许填 termOccurrence，缺失、空值、越界或不支持格式报错。两个「特殊加成」必须显式区分，不能依顺序猜测对应技能档位。
- 概念卡固定顺序为「【概念：名称】」「来源：file#标题路径（条目序号）｜行范围」「定义：原文」。来源为可检索的 base/guides 路径；共同名称不能覆盖来源差异。
- 装配期校验格式、目标存在性、唯一性、空正文与重复引用；真实语料有任何解析问题即装配失败，不在运行时静默跳过。测试中的损坏快照则显式返回错误，不冒充没有标注。

#### 4.4 read 参数与兼容

新工具名为 read，取代运行时 read_section。保留 section_id 的既有写法；不提供 linked 或关闭事实附带的参数。

| 参数 | 类型 / 默认 | 含义 |
|---|---|---|
| section_id | 必填非空 string，trim | 本运行返回的 sec-* 或 doc:<file>；精确定位，不接受 file#标题/整行提示/对象名称 |
| offset | 可选非负安全整数，默认 0 | 原文 body 的 UTF-16 索引 |
| facts_offset | 可选非负安全整数，默认 0 | 合并、去重后的关联对象序列下标 |

拒绝未知参数、linked、负数、小数及超过范围的偏移；offset 等于正文长度、facts_offset 等于对象数均合法，分别表示该部分已读完。offset 不能落在 UTF-16 代理对中间。未知 ID 返回 empty，并提示使用当前返回的 ID，不模糊搜索或访问文件系统。

旧 read_section 不再暴露给模型；运行时收到旧工具名按未知工具规则拒绝，并给出新工具名，不静默改译。ToolId/历史解析仍识别旧名称，report/snapshot 不把旧 linked 读取解释为新 read。bm25 与 hybrid 都保留 read；未暴露 facts_search 的模式也能通过明确登记读取事实。

#### 4.5 容量、分页与返回格式

read 的 data 仍是文本，采用固定分区「【阅读范围】→【分页】→【原文】→【关联事实】→【导航】」，外层沿用工具结果 envelope。元数据、来源、原文、卡片、导航合计受 maxContextChars（默认 12,000）约束，计 UTF-16 长度；外层 JSON 字符另观测。正文每页最多 6,000 字符，事实按完整对象分页，不截断卡片或定义。

「【分页】」下用一行合法 JSON 表达元数据，字段固定为 section_id、offset、next_offset、body_complete、body_total_chars、facts_offset、next_facts_offset、facts_complete、facts_total、facts_returned、facts_result_version、complete、next_call。计数为非负安全整数，完成状态为 boolean，facts_result_version=8；next_offset/next_facts_offset 为下一偏移或 null，在各自结束时为 null。complete 仅当两部分均完成时为 true，不表示问题已答完。next_call 是可直接复制的工具调用：

~~~json
{"name":"read","arguments":{"section_id":"从当前返回值复制","offset":6000,"facts_offset":3}}
~~~

两部分未完成时分别带下一偏移；某部分完成后，next_call 对应参数使用它的总长度/总对象数，不传 null，从而续读另一部分时不重复已读内容。完全结束时 next_call=null。

容量分配依次为：

1. 按当前范围、总长度、最大可能数字位数，先预留必要元数据、来源及完整 next_call；页后重新序列化验证总上限，不对最终字符串硬切。
2. 若尚有事实，先确保下一完整对象及其登记来源可放入本页；放不下整个剩余额度则本次返回 error「关联对象超过阅读容量」，注明对象及可用容量，不返回半张卡或不前进的 next_call。提示可缩小阅读范围、用现有 facts 入口或调整配置，不自动扩预算。
3. 在保证首个待送事实可放入的前提下，正文使用不超过 6,000 的剩余额度；优先完整行，超长单行可按字符切且不拆代理对。再按顺序装入其余放得下的完整事实，不跳过前面的对象挑短卡。
4. 无事实时正文独用可用额度；正文完成时事实独用。可用额度连必要元数据或一单位证据都放不下则明确 error。一次成功分页至少推进一个偏移，单次请求不要求两部分同时推进；两条偏移都单调不减。
5. 导航仅使用余量，按完整行裁减并记录省略数量，不截断 ID。原文为空但有事实仍可成功；两部分均为空或读至末尾只返回完成元数据，状态 empty、不扣成功额度。

「【阅读范围】」给 file、标题路径、section_id 与本页原文行范围；「【原文】」「【关联事实】」按上述格式显示内容，空分区明确写无本页内容。可选「【导航】」整区可省略；前三种元数据/证据分区不得依赖导航存在。卡面按 v8 输出；技能引用投影与 operator 全卡的差别在卡头说明。字符预算按最终格式测量，不按卡数猜测；所有分页使用同一次装配快照，运行中不重读源文件改变排序与偏移。

超容量沿用 status=error、非 fatal、实际证据为空、无 next_call；非法参数为 invalid_params 且 executed=false，未知旧工具名为 unknown_operation。两者按既有获准尝试规则计量。极小配置下错误说明走现有错误结果通道，不将无法容纳正常分页响应宣称为成功；成功/empty 的阅读 data 必须遵守完整预算。

#### 4.6 实际送达、历史与计量

一次外部 read 只计一次获准 attempt；原文或事实任一非空证据实际送达才计一次 success。提示、分页信息、对象总数不算事实送达；重复返回证据仍沿用现有扣点规则。内部解析、替换依据和概念读取不伪造额外调用。

- 为每次已识别的新 read 调用增加可选 readDelivery 观测，记录字段固定为 callId、status、sectionId、factsResultVersion、bodyRange、factsPage、deliveredObjects、resultChars；不能解析的 sectionId 为 null。bodyRange/factsPage 无法取得时省略，已观察无证据则 bodyRange=null、deliveredObjects=[]；失败发生在送达前不得记实际范围。容量失败不写成空关联。
- bodyRange={file, sectionId, offset, endOffset, docOffset, docEndOffset, startLine, endLine, complete}；前两个 offset 相对所读 section.body，docOffset/docEndOffset 相对同运行 documentRange.body，均采用 UTF-16 半开区间。factsPage={offset, nextOffset, total, returned, complete}；对应模型侧分页元数据，已取得对象序列但失败时 returned=0、complete=false，不伪造下一调用。
- deliveredObjects 是带 kind 的联合：card={kind:"card", canonical, projection:"full"或"skills", grantIds, origins}；concept={kind:"concept", file, headingPath, occurrence, term?, termOccurrence?, startLine, endLine, origins}。grantIds 是实际展示的 grant（含替换依据），完整卡亦列明；概念不新增散列 ID。origins=[{sectionId, objectIndex}]，objectIndex 为登记 entry.objects 的零基下标，保留实际全部登记依据；不得把未返回的整组序列写为已送达。
- trace 保留实际正文和完整参数/结果；records 保存无正文的台账，meta/report 从 records 汇总 read 次数、成功/空/错误、原文字数、送达卡次及概念卡次。跨调用重复计卡次；不能把同一调用中的多条登记依据计成多卡。
- snapshot 增加对应的有类型白名单，逐层验证并过滤未知字段，不保存正文或密钥；缺字段表示历史不可用。readDelivery 在 CostRecord 中使用数组，与同轮 ragDelivery 一样按 callId 保存；trace 单个 tool_call 事件保存对应单条。meta/report 新增 readDeliveryStats，其字段为 calls、successes、empty、errors、bodyChars、deliveredCards、deliveredConcepts；从 records 重算，缺观测或覆盖不完整的证据汇总为 null，不把未调用与未观测混同。读到 0 次且该运行明确支持新观测时才记 0。
- inputs 保留现有计数并新增可选 links.entries，保存每条 v2 登记的 sectionId/file/headingPath/occurrence/scope/objects，概念精确位置通过引用与送达记录关联；保存生效配置及 factsResultVersion。当前 inputs 只保存小节/关联摘要，不包含完整原文，不能称为既有完整正文快照。运行内将同一 sections/facts 快照注入关联解析及 read，避免各自重读；落盘证据正文继续以 trace 为准，不新增整库正文备份或承诺历史完整重放。
- injectedIds 保持既有标识口径，不能容纳的概念/范围信息以 readDelivery 为准；不把任意概念名塞成 canonical，也不据 injectedIds 推导完整送达。
- 内容级新增/复读按同题已送达正文的来源与行/字符范围并集判断；事实按身份和投影范围判断。仅文件相同不能判复读；已有台账缺实际范围时标无法判定，不补推断。
- TOOL_SCHEMA_VERSION、类型联合、参数解析、工具路由、指令、RAG 续读示例、agent trace、runner/report、snapshot、观测脚本及测试一并切换；PLK-1 的关联分页债务完成后按代码债务规则收束。

**验收**：第 8 节测试矩阵覆盖 v2、scope、同名概念、精确投影、混合分页、容量失败及各观测消费者；读完整个范围后无跳项/重复/伪完成，旧运行可读且不混用含义。

### 5. 检索默认与关键词目录注入

**输入**：第 4 步可用 read。**输出**：默认 expandFulltext=false、默认 injectKeywordCatalog=false，保留显式回退。

**RAG 送达**：

- 默认保留命中 H2/H3 块的正文及来源，不改成只有标题的目录。返回范围严格取该命中块在同一原文快照中的行范围（至下一个 H2/H3 边界），不能用 SectionEntry.body 直接替代而混入未命中子节。超过预算时连续截取并给 read 入口，不把检索侧首尾压缩片段标成连续原文；BM25 的索引输入保持，不扩大命中块或整篇正文。
- 必要元数据优先于正文：已送达块必须有完整 section_id、来源和原文范围；容量不足以同时容纳该元数据与非空正文时，不发送该块，不能产生只有片段而无 ID 的结果。按检索顺序组装，不在省略后重新检索补满 topK。
- 有剩余空间才给不超过 300 字符的父级引导、兄弟/子节导航（最多 8 项）及关联提示，均原子保留 ID；每个命中块的必要 ID 不依赖末尾导航是否装得下。
- 关联提示面向实际显示的命中节点与导航项，按第 4.2 节计算是否有可展开关联，给出 read 示例及对象数；不再列出命中文件全部不相关登记。written 只表示提示确实进入 data，不表示事实已送达。
- 保留 --expand-fulltext 0|1，不增加「容量允许时扩展」中间档。显式 1 仍按文件去重扩展 base/guides，保留 fulltextRanges，续读指向 read，类别/歧义遵循同样规则。
- hybrid 的 --attach-facts 及默认 query 精确匹配附带行为保持，bm25 不启用；其独立 4,000 字符额度与匹配集合原子性沿用 ADR-013。read 是旁挂关联的展开入口，不能把本计划表述为禁止全部 RAG facts 附带。
- RagDeliveryRecord 增加可选 fragmentRanges 数组；每项为 {kind:"hit"或"parent_lead", file, sectionId, chunkId?, docOffset, docEndOffset, startLine, endLine}，只登记实际返回的连续正文，不计来源头/导航。所有偏移相对 documentRange.body，与 readDelivery 的 docOffset 同坐标，跨小节即可比较重叠；父级引导也纳入，不漏算为新证据。全文模式继续用 fulltextRanges，不重复登记相同正文到 fragmentRanges；无片段已观察为 []，历史缺失为不可用。字段接通 trace/records/snapshot，meta/report 在 ragDeliveryStats 新增 fragmentRanges 计数（不可用为 null），不把 fulltextRanges 冒充所有片段。

**目录注入**：

- 配置 injectKeywordCatalog: boolean，EXPERIMENT 默认 false；CLI --inject-keyword-catalog 0|1，缺值/非法值报中文参数错误、按 bench CLI 现有口径以退出码 1 结束。未显式传入沿用默认；run（包括 dry）生效，hitrate 显式传入时提示忽略，catalog 子命令拒绝并不写文件。
- false 时只加载 knowledge/AGENTS.md，不读取关键词目录，目录缺失不报错；true 时按原格式追加目录，缺失/读取失败显式报错。生成与 catalog --check 继续独立工作，不因关闭注入而失效。
- 所有入口及 fallback（含 buildSystemPrompt/runQuery）从有效配置装配，不保留暗中恒定注入的旁路。inputs 捕获最终指令与 config，meta 投影、snapshot 白名单同步 injectKeywordCatalog 与 retrievalScope；历史缺字段不推定当时关闭。
- 生成器输出入口名与路径同步，但既有目录全文重新生成与一致性门禁放在第 6 步统一完成。压缩 stash 不应用，目录文本压缩另留 inbox。

**验收**：新默认、显式回退和四组 expand/inject 开关组合均有隔离测试；小预算不出现截断 ID；raw 始终不可见；开关有效值与实际送达/留档一致。

### 6. 分支收尾：定位、门禁与历史基线

**输入**：迁移与新工具协议已实现、延后失败登记。**输出**：完成以下全部项目，解除红态限制。本步骤属于整个计划的必需交付。

- gold 保留当前 JSON 结构 {题号: {golden: ["file#标题"]}}。26 个 references 键按真源路径改为 raw 或 guides，标题语义保持；迁移阶段 20 题与 69 个键不删减。数据源无 gold 键，不虚构替代证据。
- 定位目录与检索范围在装配上分离：hitrate/benchmark-integrity 的完整定位目录＝manifest 原文分块＋facts 加载器声明的 11 个 raw 真源路径；复用其指定输入清单与同一切块函数，不截断、不另建人工名单或扫描其它 raw。RAG、模型 sections、inputs 模型目录仍只用 manifest，两个目录不能互相传错。
- gold 先在完整定位目录解析；来源缺失时报错，来源存在但检索排除时保留 recall 分母并计 excluded。precision/nDCG 仍按原定义，候选映射原键，不将排除后的相关集合用作更小的理想分母。
- white-list/integrity 断言按已定新职责调整：manifest 文件集合、真实加载集合、模型阅读集合一致且不含 raw；gold 来源有效不再等价于属于 manifest。保留精确计数和关系检查，不改成大于零、不跳过用例。
- 统一重生成关键词目录，完成 catalog --check 一致性检查；注入默认关闭仍需生成物有效。对纯迁移和后续内容拆分分别记录计数，避免混为一个改进。
- 两份已登记快照逐份核对真实的当前非 exp 工程消费者与用途，不预设「历史兼容核对」就足以长期保留；处置说明标明「适用迁移前来源与检索范围」，不修改其内容和历史计数。不能仅因当前路径失效就宣称原运行无效，也不能用它们作迁移后同口径成绩对照。
- 基线处置遵循 docs/rules/document-lifecycle.md：有当前非 exp 用途则保留；用途结束则正常移除，历史查阅记录可恢复的完整提交与路径，不为试验对照长期留快照。至少一份基线的现有要求仍有效；不得为了删除旧基线自动指定新基线、制造用途或放宽校验，尚未消解则如实未完成。
- 通过 typecheck、全套 test、reference-projection、prose-terms、catalog --check、validate 和 hitrate --check-gold；doc-check 如仅剩活动计划未勾选的 D1，明确记录，等全部交付和正常归档后由合并门禁最终解除。

**验收**：延后测试逐项转绿，事实数据与新范围相符，历史兼容不改写原记录；未通过时不启动第 7 步质量观测或第 8 步真实模型运行。

### 7. 散文特化试点与当前标注交付

**输入**：第 6 步已闭合的定位和检索范围、第 4 步已验证的标注格式。**输出**：一批可实际使用的窄命题散文及明确关联。

- 试点固定从 guides/高效率散件.md 开始：办公室选择和源石碎片制造按正文已有的对象、设施、条件、代价、练度边界整理；优先只拆 H2/H3，不改解析器为 H4–H6 检索，不按题号或预期答案造标题。
- 随后审阅现有 guides/贸易站组合.md、guides/制造站组合.md、guides/跨设施组合.md：每个组合保留独立 H2/H3；已满足的段落不强拆。新手培养与 base 本轮只做路径/能力表述及确有必要的关联，不全量重写。
- 一个可检索小节承载一个明确命题，标题用玩家规范词；正文交代主语、设施、条件、代价、最低解锁与推荐练度的区别。只在依赖事实可实际展开且条件不丢失时删除重复事实段落。
- 对上述范围内「需要精确事实补足才能成立」的段落逐条标注；skill 优先于宽 operator，跨子节确实共用才用 subtree。正文涉及规则定义时指向概念的精确来源；不根据名字出现机械挂满所有卡。
- 办公室/源石碎片已有两条标注必须重新核对，正文明确依赖的候选及其代价不能只覆盖其中部分；以真源与正文命题为依据，不把标注存在性检查当作相关性审核。概念字段也不自动证明引用正确。
- 每一批标题/来源变化同步 prose-links、目录生成物、gold 和 spec，spec 递增版本并保留判定含义；拆分 gold 按原要求对应的新证据范围逐项映射，记录旧→新，不因难命中而删项。不再沿用第 3 步红态例外。
- 在纯迁移完成、试点完成两个时点分别运行零模型费用 hitrate --topk 3,5,10，记录 precision@5、nDCG、范围计数及 gold 变更；跨粒度指标仅作带口径说明的观察，不直接认作改善。

**验收**：指定内容范围全部人工审阅、该标注的已标注、无需变动的有结论；关联校验、gold 定位、术语和全套测试通过，无未解释的原文条件丢失。

### 8. 测试矩阵、命令与端到端观测

新增行为按 docs/rules/testing.md 先失败后实现，测试置于已有 bench/tests 或 scripts/tests 路由；不为纯文档新增运行测试。既有充分覆盖可复用，但须覆盖真实调用与消费者，不在测试中重写实现求期望值。

| 范围 | 主要测试位置/主题 | 必测行为 |
|---|---|---|
| 事实出口 | normalized、projection、final-gate、facts-tools、facts-tag-lookup | 空/缺省/多注记、原始缺口、同描述与 curated 差异、替换关系、内容不变 |
| 目录迁移 | corpus-allowlist、benchmark-integrity、reference-projection、观测脚本测试 | 11/2/删除、旧目录缺失正常、指定真源缺失失败、raw 隔离、写入临时目录 |
| scope/概念 | prose-links 及其新边界用例 | v1 拒绝、重复/非法字段、父 section/subtree、兄弟隔离、doc 范围、同名概念/条目续行、越界路径 |
| read | prose-links-read、sections、section-navigation、facts-tools | operator/skill 精确投影、替换链、混合对象去重、独立偏移、长行/代理对、两侧耗尽/空/越界、超大原子对象与极小预算 |
| RAG | rag-delivery、prose-links-hint、facts-attach、section-navigation | 新默认/回退、必要 ID 优先、原文片段范围、事实独立额度、非相关入口不扩列 |
| 配置与留档 | cli-args、inputs、runner 相关测试、snapshot、report | 退役参数含 0/缺值拒绝、catalog 不误写、注入四组合/缺目录、所有 fallback、历史缺字段 |
| 计量与历史 | tool-executor、agent/runner、snapshot、观测脚本 | attempt/success 各一次、empty/error 不扣成功额、实际送达与提示分离、旧工具名和 v1 输入只读 |
| 定位与质量口径 | hitrate、benchmark-integrity、真实语料门禁 | gold 不缩水、raw 真源可定位但不可检索、缺源报错、拆分映射与两份历史基线 |

常规验证命令（本仓库已有入口；修改测试后最终必须全套）：

~~~text
pnpm run typecheck
pnpm run test
pnpm run check:reference-projection
pnpm run check:prose-terms
pnpm run build
node dist/cli.js catalog --check
node dist/cli.js validate
node dist/cli.js hitrate --check-gold
node dist/cli.js hitrate --topk 3,5,10
pnpm run bench:dry
node scripts/doc-check.mjs
~~~

零费用端到端契约观测必须覆盖「RAG 命中→复制 read→原文与关联分页→记录/报告/快照」真实装配路径，provider 用隔离替身，不使用真实密钥或网络。另选未用于语料试点的通用问题/合成样本验证适用性，不以当前 20 题答案作为实现断言。

工程测试及数据门禁全绿后（活动 plan 的未勾选 D1 按第 6 步生命周期边界处理），按 exp 模板登记并执行一轮真实模型观测：GLM-5.3-Flash low、hybrid、20 题、新默认配置，记录实际工具/schema/来源范围、必答计数、token/费用、工具分布、非法 ID、空结果、额度耗尽和内容级新增/复读。试验输入与费用预算在执行前记录；当前定稿不启动付费请求。未获费用执行授权则该项保持未完成，不能用 dry 冒充真实观测；无需为工程通过重复追分。单轮不主张因果或质量提升，不自动登记新正式基线。

**验收**：上述工程检查通过，端到端观测结果无论好坏都按真实状态记录；合并前按生命周期归档活动计划，再执行 node scripts/verify.mjs merge -- --base main，不能在活动 plan 仍有未完成项时声称合并就绪。

## 验收清单

- [x] ADR-021/022 在编码前落决策并与索引一致，实施笔记创建并记录版本与授权例外。
- [x] 技能注记与同描述依据按卡 v8 投影/渲染，名册边界声明送达，旧内容与查询语义逐字段核对。
- [x] 11 份 raw、2 份 guides、数据源移除和 references 撤销完成，来源与缺口记录保留在文档轨道。
- [x] 读取、生成、观测脚本、夹具、manifest、当前语料/spec/规则/导航同步；旧参数退役与新范围留档验证完成。
- [x] prose-links v2、必填 scope、概念定位、精确技能投影及当前 v1 标注迁移完成。
- [x] read 替代旧工具，双偏移、容量、next_call、错误与预算契约全覆盖，PLK-1 按规则收束。
- [x] read/RAG 实际范围与对象送达接通 trace、records、meta/report、inputs、snapshot，历史缺字段和旧名称兼容通过。
- [x] expandFulltext 默认关闭及显式回退有效，必要 ID 优先，原有 query facts 附带契约保持。
- [x] injectKeywordCatalog 默认关闭，CLI/fallback/目录生成及三处配置留档同步，未应用压缩 stash。
- [x] 全部延后项转绿：gold 定位分离与 26 键迁移、白名单/完整性断言、目录一致性和两份基线用途/口径处置完成。
- [x] 指定散文试点与组合小节审阅、精确关联及概念标注完成，gold/spec/目录随批更新并记录范围变化。
- [x] pnpm run typecheck、全套 pnpm run test、reference-projection、prose-terms、catalog --check、validate、gold 校验和 dry 全部通过。
- [x] 零费用端到端契约、分阶段 hitrate 和一轮真实模型观测完成，费用授权与结果记录完整，不设质量达标线。
- [x] 文档结构/引用审查完成，临时产物按 scripts/INDEX.md 处理；验收清单全部勾选后执行 release/archive-plan 归档本计划，再运行 node scripts/verify.mjs merge -- --base main。

## 关联 ADR

- ADR-021 — facts 真源目录归并、事实出口与迁移边界。
- ADR-022 — 渐进披露的阅读、关联与默认送达契约。
- ADR-008 — 原文目录与小节导航；新工具保留其原文快照与子树阅读基础。
- ADR-010 — 同名全部返回与明确引用边界，不增加四条合称登记。
- ADR-013 — 本计划替代技能表范围和默认全文送达，保留 query facts 附带及独立容量。
- ADR-018、ADR-019 — 目录交付默认由新开关替代；tags 反查语义保留。
- ADR-020 — 旁挂位置与明确引用原则保留；格式、提示与 linked 展开由新契约替代。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan docs/plan-progressive-disclosure.md --apply）时替换此行，标记完成日期 -->

## 实施纪要

# 实施笔记：渐进披露

> 对应 plan：docs/plan-progressive-disclosure.md
> 开始日期：2026-09-15

## 决策偏离

### 2026-09-15 — ADR 先行落盘（第 0 步部分先于实施完成）
- **背景**：plan 第 0 步要求「ADR-021、ADR-022 及实施笔记在运行时代码修改前完成」。定稿阶段已先建两份 ADR 并同步 docs/adr/INDEX.md（状态「已决策」），实施笔记随本次定稿审查一并创建。
- **决策**：ADR 先行落盘并保持「已决策」状态，不提前记为「已实施」；第 0 步其余内容（记录实际递增值、授权例外边界、实施批次划分）在实施开始后补记于本笔记。
- **影响**：计划状态为「施工中」但尚未改任何运行时代码或语料；版本号（facts 7→8、工具 14→15、prose-links 1→2）仍是待实施约定，实施基点若被其他工作更新则在本笔记登记实际值与原因。

### 2026-09-15 — ADR-018／ADR-020 部分条款被替代但仍保持「已实施」
- **背景**：ADR-022 替代 ADR-018 的「恒定目录注入」与 ADR-020 的「格式 v1、提示与 linked 展开」，ADR-021 替代 ADR-013 的技能表检索范围与 includeSkillTables 选择。document-lifecycle 的 ADR 表写有「被替代时标『已废弃』」，可被读作要求整体改状态。
- **选项**：
  - A：把 ADR-013／018／020 整体标为「已废弃」。
  - B：保留原状态与原文，由新 ADR 逐条写明替代范围（仅部分条款被替代）。
- **决策**：选 B。三份旧 ADR 仍有大量继续生效的条款（ADR-013 的 query facts 附带与独立容量、ADR-018／019 的标签反查与目录生成、ADR-020 的旁挂位置与明确引用原则），整体废弃会误示这些条款失效；ADR-021／022 的「替代」行逐条点名被替代的决策。
- **影响**：新决策不写入旧 ADR 作前向引用；历史记录与冻结文档保持原貌。如后续认为需要「部分废弃」状态语义，另从 inbox 起步。

### 2026-09-15 — 定稿审查与修缮记录（自 plan 第 9 节迁入）
- **背景**：plan 定稿阶段做过一轮独立审查与修缮，原先作为「第 9 节」写在 plan 内；按文档生命周期，plan 只承载蓝图与验收信号，决策／变更日志归本笔记，故迁入此处，实施期新增偏离继续按五段追加。
- **内容**：

| 审查点 | 定稿处理 |
|---|---|
| 草案「本步仅前置清理」与「整份计划」范围冲突 | 按用户本轮答复纳入 A–E、目录注入及最终观测；目录压缩独立保留 |
| 两个独立翻页维度容易导致重复正文或跳卡 | 明确 UTF-16 offset、对象 facts_offset、结束位置及可复制 next_call |
| scope、父子阅读与隐式继承混淆 | scope 仅作用于关联，原文仍为子树，列明父/子/doc 范围与去重规则 |
| 同描述关系容易被表述为完整效果等价 | 同时显示原始依据与限定，保留解锁、作用对象及 curated 差异 |
| raw 迁移、术语规则和失效生成命令冲突 | 精确两文件例外，保留真实格式；移除失实重建承诺，来源记录进入实施笔记 |
| 延后白名单被误读为延后 manifest 与运行装配 | manifest/路径/新行为测试当批闭合，仅指定旧门禁延后，全套照跑 |
| gold、历史快照与运行时目录混用 | 单列完整定位目录，分母保持，历史记录不改写，不自动指定新基线 |
| 目录注入效果与共同遗漏的归因过强 | 缩为实测事实与有限推断，不把配置差异或现有哈希变化当成比较失效的充分条件 |
| 原文复读统计使用小节偏移，无法跨小节比较；父级引导易漏算 | 新增统一文档正文坐标的 fragmentRanges/readDelivery 范围，覆盖父级引导并避免全文重复登记 |
| 文档根不在既有 parentId 树内，scope 继承会漏 | [] 统一对应 doc 范围，在关联层补逻辑祖先，ID 算法不变 |
| 把 inputs 现有摘要当作完整正文快照 | 明确新增仅为关联登记和配置，运行内复用快照，实际正文以 trace 留存 |
| 最后一项要求先归档/过门禁再勾选，与归档前全勾选形成循环 | 验收项只确认交付和收束准备，归档/合并门禁随后按现有生命周期执行 |

- **影响**：plan 不再保留该节；后续同类审查继续记入本笔记，不写回 plan 正文。

### 2026-09-15 — 提交前审查修缮（plan 两处措辞与 exp 引用同步）
- **背景**：工作区提交前的独立审查指出 plan 两处表述与实际动作或证据不符：非目标的「不执行…提交」字面上与本次文档定稿提交冲突；架构分析「必答计数与费用没有稳定改善方向」比两份 exp 的数值更保守（扩展侧必答满足数两轮均略高，仅费用方向相反）。同时 exp-no-expand-read-section-glm-low 的「完整且有据」名单漏列 S07，与同一表格的逐题判定不一致。
- **处理**：plan 非目标限定为「实现批次提交……文档与决策本身的定稿提交不受此限」，架构分析改为分维度表述（plan 第 23、42 行，已回馈 plan）；exp 记录按自身口径就地更正为 10/20（含 S07）并留更正注记，exp-expand-fulltext-glm-low 的汇总、配对差表与跨文件说明随之同步。
- **影响**：plan 正文在定稿后仅作措辞与事实一致性更正，未改需求、契约、版本号或验收项；两份 exp 只更正计数与引用，逐题判定与其余数字未变。

### 2026-09-15 — 授权回执（用户确认）
- **背景**：ADR-021 决策 8、ADR-022 背景与 plan「已授权的门禁延后例外」记载了 2026-09-15 的用户裁决，但审查指出仓库内没有可核对来源；主代理据此在提交前向用户确认。
- **回执**：用户确认全部四项：①整份渐进披露定稿范围；②授权补齐 read、scope 等具体契约；③目录迁移裁决（11 份移 raw、类别/歧义移 guides、数据源移除、撤销 references）；④限定门禁延后例外——仅第 3–6 步指定旧断言可暂红，红态不合并、不发版、不登记新基线、不执行付费试验。
- **影响**：四项授权在实施期可据此执行，例外范围不变，仍以本 plan「已授权的门禁延后例外」节为边界；本条只补回执来源，未改需求、契约或验收项。

### 2026-09-16 — 用户允许目录迁移先于事实出口

- **背景**：本批已实施第 2–3 步，但 plan 原定前置的第 1 步事实出口尚未补齐；原有门禁延后授权不包含这一顺序偏离。
- **选项**：迁移先行并保留缺口、先补齐事实出口、或暂缓迁移批次提交。
- **决策**：用户在本次验收中确认：「允许迁移先行，明确保留事实出口缺口；其余检查通过后提交该批」。据此仅调整本批执行顺序，不删除第 1 步验收要求。
- **影响**：技能注记、同描述依据与名册边界出口继续保持未完成，facts 卡仍为 v7；迁移验收不代表这些信息已可经模型工具完整送达。旧 gold／白名单／基准完整性断言仍按既有例外留待第 6 步，其他新行为及受影响检查须通过；红态期间不合并、不发版、不登记新基线、不执行付费试验。

### 2026-09-16 — 验收清单第 12 项暂不随第 6 步勾选

- **背景**：第 6 步完成后，验收清单第 12 项列出的命令（typecheck、全套 test、reference-projection、prose-terms、catalog --check、validate、gold 校验与 dry）当前全部通过，但该项在清单中位于第 11 项（散文试点与关联标注）之后；plan 第 6 步的验收只列到 `hitrate --check-gold`。
- **选项**：
  - A：验证既已通过，随第 6 步一并勾选。
  - B：保留未勾选，留待第 7 步内容拆分落地后按同一批命令重新验证时勾选。
- **决策**：选 B。第 7 步会再次改动语料小节、gold、spec 与目录，验证结论应以拆分批次的实际结果为准；提前勾选会让「全部通过」早于它要验证的变更生效。
- **影响**：doc-check D1 仍保留该活动 plan 的未勾选条目（第 11–14 项）；第 6 步的实际验证结果已逐条记入本笔记「实现调整」，不因未勾选而缺失。

### 2026-09-16 — 两份迁移前基线继续保留的用户裁决

- **背景**：第 6 步要求核对当前用途；只引用登记表、通用 report/compare 入口或「至少一份基线」要求，不能证明两份快照应继续保留。
- **决策**：用户在本轮验收中明确授权：「明确保留两份作为迁移前基线，本次授权其继续保留」。按该裁决保留现有 GLM 正式基线与 Qwen 对照基线，适用范围限定为迁移前来源与检索配置；不据此把旧成绩用于迁移后同口径比较。
- **影响**：此次明确授权闭合两份快照的保留处置；快照内容、历史计数、基线登记要求及机械校验均不改写。目录注入历史按 docs/plan-index-and-tags-notes.md 核对：两份均产生于关键词目录引入前。

### 2026-09-16 — 组合小节关联标注的范围与准则

- **背景**：plan 第 7 步要求「对上述范围内『需要精确事实补足才能成立』的段落逐条标注」，同时禁止「根据名字出现机械挂满所有卡」，但未给出组合小节的登记粒度；按标签（核心/重要/次级/挂件）机械登记会让只靠进驻计数的成员也各挂一张卡，按技能效果判断又需要逐条裁定。
- **选项**：
  - A：按 plan 与用户确认的范围，对组合小节按内容判定登记，边界与使用类小节只出审阅结论。
  - B：只补全试点两节的标注，组合小节仅记录审阅结论。
  - C：对三份组合指南的每个 H2/H3（含使用边界、原则类）都登记标注。
- **决策**：用户选定 A。据此确定准则：(a) 登记正文赋予明确技能职责的成员技能，skill 引用优先于宽 operator；(b) 只靠进驻计数的类别成员改用 guides/类别.md 的分类或规则条目概念引用；(c) 次级/可选/挂件候选名单与纯排除说明不登记。
- **验收澄清**：上述 (c) 只排除未承担正文具体机制的单纯名单，不能排除必需角色的可选人选（如龙舌兰组至少一名达标裁缝、赤金工艺和水月组的启动候选），也不能排除已登记职责所依赖的并存技能。精确投影只补被替换链，不会自动补同卡的其他技能；资源生成、转换、消费、容量输入、设施分工与心情代价必须按正文和真源分别核对。技能类别定义不提供持有者与解锁依据，不能替代已点名启动候选的技能引用。
- **影响**：三份组合指南的 20 个组合小节与 base 的两节获得标注，使用边界、组合收益边界、全基建核心散件边界等原则类小节不登记；概念引用只作来源定位，不复制定义。该准则只约束本次散文标注，不改工具协议、gold 或 spec。

## 实现调整

### 2026-09-15 — CLI 参数错误退出码由 2 统一为 1
- **plan 原文**：第 3 步「CLI 对显式 --include-skill-tables（包括 0、1、缺值及非法值）在执行前报参数错误、退出码 2」；第 5 步「--inject-keyword-catalog 缺值/非法值报中文参数错误，退出码 2」；ADR-021 决策 5 同。
- **实际做法**：统一为退出码 1。bench CLI 当前所有失败路径（含参数错误）都由 bench/src/cli.ts 顶层 catch 设为 1，只有 scripts/ 侧（tooling.mjs、verify.mjs、release 任务）才有「0 成功／1 一般错误／2 参数错误」的约定。
- **原因**：避免同一 CLI 内出现两套退出码口径（仅退役参数用 2、其余参数错误用 1），也不在本计划内顺带改写全 CLI 的退出码契约。
- **后果**：plan 第 3、5 步与 ADR-021 决策 5 的退出码描述已同步为 1；若将来要在 bench CLI 引入「2＝参数错误」的统一口径，属独立议题，从 inbox 起步。

### 2026-09-15 — 数据源.md 移除前的来源与缺口留档
- **背景**：第 3 步移除 knowledge/references/数据源.md（开发来源说明不再作为语料文件）。按该步要求，删除前把最小来源依据与限制记入本笔记，不在 knowledge 下新建副本。
- **来源依据**：主源仓库 `arkntools/arknights-toolbox-data`，commit `4d474755461300c5c5a0414937191412162f620e`（经 RIIC-Web/src/generated/arkntools/ 落地），计数为干员 425／上游基建技能条目 747／术语 81；补源 RhodeLogisticsSteward/（派生自 ArknightsGameData）提供主源缺失的 efficiency、targets（产物／职业）与 nationId/groupId/teamId，计数略旧（干员 415、技能 727），均为主源子集。
- **已核对的口径差异**：①星级——主源 rarity 即实际星数，补源 0 起算（+1），全量零例外；②buffId——补源 `xxx[000]`、主源 `xxx_000`，归一化后 727/747 命中；③roomType——主源无该字段，由 id 前缀推出，与补源标注全量一致。
- **限制**：747 是上游条目数，不是规范化技能事实数；生成器缺位——本仓库没有 scripts/build_refs.py，不能承诺重跑即可重建，本次也不新增该脚本。
- **仍需定位的缺口原标识**：补源缺 targets/efficiency 的技能 20 条——`control_hire_spd_all_000`、`dorm_rec_oneself_002`、`dorm_rec_single&tag_000`、`hire_spd_013`、`manu_formula_spd_011`、`manu_formula_spd_214`、`manu_prod_cost_min_001`、`meet_spd&cost_condChar_002`、`meet_spd_023`、`meet_spd_notOwned_004`、`meet_spd_notOwned_P_000`、`power_rec_spd_027`、`trade_ord_spd&limit_tag_000`、`trade_ord_spd_022`、`trade_ord_wt&cost_004`、`train_spd&profession3_190`、`train_spd&profession3_191`、`train_spd_doubleProf3_000`、`train_spd_doubleProf3_100`、`workshop_formula_probability_301`；补源缺派系字段的干员 10 名——予愿安洁莉娜、佩德洛、嘉辛塔、时隙、机械师、焰狐龙梓兰、珊比、罗德岛隐秘队、谬因、雷狼龙S空爆。无法判定设施的技能 0 条。原文档未给玩家侧定位提示，缺口以本标识清单为准。
- **影响**：未来真源刷新需单独更新上述真实来源证据；本记录随计划归档进入实施纪要。

### 2026-09-15 — 第 2–3 步：目录迁移与消费者闭合的实施范围

- **范围**：本批只实施第 2–3 步（目录迁移与消费者闭合）。第 1 步事实出口（卡 v8）与第 4 步起的关联格式 v2、read、检索默认与目录注入开关均未实施，相关版本号（facts 7→8、工具 14→15、prose-links 1→2）仍是待实施约定，不记成已交付。
- **迁移落位**：11 份移入 knowledge/raw/——技能-会客室.md、技能-发电站.md、技能-办公室.md、技能-加工站.md、技能-控制中枢.md、技能-贸易站.md、技能-宿舍.md、技能-训练室.md、技能-制造站.md、名册.md、技能等价组.md；类别.md、歧义.md 移入 knowledge/guides/；数据源.md 删除，来源与缺口留档见上条。knowledge/references/ 目录撤销，文件保持原名，未在 raw 下重建 references 子目录。
- **manifest**：knowledge/corpus-manifest.json 登记由 31 条改为 19 条（base 12 + guides 7）；raw 不进检索白名单。
- **旧参数退役**：includeSkillTables 与 `--include-skill-tables` 退役；显式传入（含 0、1、缺值及非法值）一律在执行前报中文迁移错误、按 bench CLI 现有口径以退出码 1 结束，无开关时正常运行。新 inputs/meta 写可选 retrievalScope: "base-guides"；历史 includeSkillTables 字段与旧快照/元数据保持可读，不据 false 推断为新范围。
- **文档同步**：docs/spec/rag-answer-baseline.md 版本 v4 → v5，仅同步证据块路径与白名单范围表述（原 references/ 改记 raw/ 与 guides/）；题号、必答项、判定含义及历史运行记录均未改动。
- **说明**：本批验证的实际数字由主代理在收齐各批次后统一补记，此处不预写测试通过/失败数。

### 2026-09-15 — 目录迁移批次验证结果与红态归属
- **验证环境**：分支 feature/index-and-tags 工作区（含本批全部改动），命令均在仓库根执行。
- **验证结果**：`pnpm run typecheck` 通过；全套 `pnpm run test` 625 通过 / 2 失败（49 个测试文件 48 个通过）；`pnpm run check:prose-terms` 通过；`pnpm run check:reference-projection` 通过（9 分片一致）；重算后的 knowledge/关键词目录.md 与 `node dist/cli.js catalog --check` 一致；`node scripts/doc-check.mjs` 21 个错误全为 D1「活动 plan 存在未勾选条目」（plan-corpus-supplement 8、plan-progressive-disclosure 11、plan-index-and-tags 1、plan-prose-linked-knowledge 1），无 D2/D3/D4/D5/S 错误。
- **红态与归属**：bench/tests/benchmark-integrity.test.ts 两条用例失败（「questions、gold、spec 与 manifest/实际切块完全对齐」「在隔离快照集合中统计新增和移除后的数量与字节，并拒绝无效 JSON」），原因是 bench/gold.json 的 26 条 references 锚点尚未重定位；`node dist/cli.js validate` 与 `pnpm run bench:dry`（run 分支未指定 --questions 时先做基准完整性校验）因同一原因失败。以上均属 plan「已授权的门禁延后例外」列明的「旧 gold／白名单／基准完整性断言」，解除条件为第 6 步的「gold 定位分离与 26 键迁移、白名单/完整性断言、目录一致性和两份基线口径处置」；红态期间不合并、不发版、不登记新基线、不执行付费试验。
- **退役参数实测**：`node dist/cli.js run --include-skill-tables 0 --dry` 输出「错误：--include-skill-tables 已退役；RAG 仅检索 base/guides，精确事实请使用 facts 能力」并以退出码 1 结束。
- **新增行为覆盖**：manifest 拒绝 raw／references 条目、检索块与模型原文阅读目录不含 raw、CLI 退役参数四形态与退出码 1、facts 从 raw 正常加载、snapshot 历史字段与新 retrievalScope 并存、prose-terms 两文件精确例外未被放宽（新增 scripts/tests/prose-terms-check.test.mjs 与 facts-evidence-observation 默认名册路径用例）。
- **语料侧非路径改动**：13 份真源的生成头注改为真实维护信息（历史由上游生成、当前以版本控制内文本为输入、本仓库无该生成脚本）；base 35 行＋guides 3 行 references 回指改为能力表述；knowledge/guides/歧义.md 的「推王」条按本 plan 第 2 步与 ADR-010 的全部返回契约修订说明文字（不设默认目标、登记条目与成员未改）。
- **未闭合的已知遗留**：①bench/gold.json 26 条锚点与 validate/bench:dry 的解除属第 6 步；②docs/spec 证据块现引用白名单外的 raw 真源，「可定位不可检索」的完整口径同样待第 6 步闭合；③knowledge/base/机制-心情与工休.md 首部仍有一处指向 knowledge/raw/ 的既有来源标注（本批只把同行的 references 子句改为能力表述，raw 那半句与「等 raw 案例」措辞未改，属预先存在、非 references 回指）；④历史试验、归档计划、基线表与本机 bench-runs 保持原貌；⑤docs/adr/ADR-020 正文仍写 canonical 出自 knowledge/references/名册.md（ADR 正文按维护口径不在迁移批改写，留待后续文档清理或第 6 步一并处理）。
- **清理批验证**：补覆盖与注释同步后 `pnpm run typecheck` 通过、定向 fulltext-expansion 16/16、全套 `pnpm run test` 632 通过 / 2 失败——2 条仍为上述 gold 锚点用例，无新增失败；`node scripts/doc-check.mjs` 仍为 21 条 D1（8＋11＋1＋1），无 D2/D3/D4/D5/S。

### 2026-09-16 — 验收审查修复与复测

- **审查发现**：首次独立审查为 FAIL，阻塞项为 manifest 使用未归一化前缀校验导致目录穿越、CLI 入口测试缺少副作用隔离与完成等待，以及 inputs 测试共享清理未恢复原值；既有 gold 红态与已授权的事实出口延期不计为新增缺陷。
- **目录边界修复**：先在 bench/tests/corpus.test.ts 新增 4 种路径穿越、1 种目录链接和 1 种合法归一化路径用例，定向运行观察到 5 失败／13 通过；随后校验归一化 docId 与 realpath 的实际目标均属于 base/guides，18 条用例转绿。所有夹具及目录链接均位于测试持有的临时目录并自动清理。
- **测试隔离修复**：CLI 用例在导入前用依赖替身阻断配置读取、基准运行、完整性读取、目录生成和文件写入，断言这些边界均未调用、标准输出为空、中文错误及退出码正确；先运行 6 条入口用例确认缺少完成信号导致失败，再导出已有入口 Promise（cliCompletion，包含错误处理）并等待它收束。此导出只提供入口完成信号，不更改工具协议、默认配置或 CLI 退出语义。inputs 的 beforeEach 捕获 EXPERIMENT 前值，afterEach 恢复原值；属测试装配修复，由原有行为用例覆盖，11 条 inputs 用例通过。
- **复测结果**：`pnpm run typecheck`、`pnpm run build` 通过；全套 `pnpm run test` 为 631 通过／2 失败（49 个文件，48 个通过），新增 6 条目录边界用例均通过；剩余 2 条仍为上述旧 gold 完整性用例。此前 625／2 是修复前记录，保留作本轮验收过程证据。文档校验的未勾选计数按 8＋11＋1＋1＝21 更正，没有勾选未实施条目。

### 2026-09-16 — 第 1 步：事实出口（卡 v8）实施范围与验证

- **范围**：本批只实施第 1 步——接通技能注记 products/professions/referencedTerms 的投影与显示、保留 target 原始注记、显示等价组技能名与共同效果原文，并把 FACTS_RESULT_VERSION 由 7 升至 8。TOOL_SCHEMA_VERSION 保持 14（按 plan 第 0 步，read 切换时再升至 15）；prose-links 仍为 v1。
- **卡字段**：RecordSkill 新增可选 products/professions/referencedTerms/equivalenceEffectText。前三个在真实投影中恒存在（空注记保持 []，不推断缺项），raw 与 curated 两种模式同源；equivalenceEffectText 复制 SkillEquivalenceGroup.effectText，仅命中等价组时投影，curated 的 effectText 覆盖不改写它。旧 fixture/旧卡缺省这些字段仍合法（final.ts 的 fixture 兼容比较只覆盖 name/unlockType/target/effectText，未随之收紧）。
- **卡面渲染**：serializeCard 在技能行既有「效果／替换／备注」之后追加注记片段，固定顺序为作用产物、作用职业、引用术语、原始注记、同描述说明。旧卡缺省新增字段仍合法，空注记与缺省字段不产生占位片段；已有的非空 target 等字段按 v8 规则显示。同描述说明采用「同描述技能：甲、乙（设施：贸易站）」「共同描述（原文）：…」「仅描述相同；解锁、替换、作用对象与完整效果须分别核对」——设施放在技能名之后的括号内，以保留 plan 要求的固定前缀。facts_search、RAG 附带与 read_section 关联三个出口继续共用同一 serializeCard，未新增第二套渲染。
- **指令**：knowledge/AGENTS.md「证据边界」新增名册身份边界：规范名及现有别名、同名解析都未找到时说明知识库未收录、不凭记忆补全；一次空检索不能证明名册外或游戏中不存在，也不提出读取知识库原始文件的建议。
- **TDD 与验证**：先补测试并观察失败（8 条：projection 3、facts-tools 卡面 2、facts-tools 版本 2、trace 版本 1），再实现转绿。定向验证 projection／facts-tools／facts-resolution-executor／facts-tag-lookup／tool-executor 151 通过；全套 `pnpm run test` 640 项中 638 通过、2 失败，两条仍为旧的 gold 锚点完整性用例（第 6 步延后项），本批无新增失败；`pnpm run typecheck`、`pnpm run build`、`catalog --check`、`check:reference-projection`（9 分片一致）、`check:prose-terms` 均通过。计数门禁未变：425 卡／913 grant／167 替换边／82 等价组（final-gate 用例继续通过）。
- **新增覆盖**：projection 两条（注记数组同源、全量数组恒存在与等价组共同原文）＋训练室 professions 一条；facts-tools 新增「卡 v8 注记与同描述依据渲染」三条（固定顺序与空数组、同描述三句式、旧卡不补占位）及真实卡面一条（多萝西注记、巫恋同描述组）。版本断言随协议在 facts-tools／facts-resolution-executor／facts-tag-lookup／tool-executor 同步为 8。
- **未闭合**：第 4 步关联格式 v2＋read、第 5 步检索默认与目录注入开关、第 6 步 gold 定位分离与门禁转绿、第 7–8 步均未实施；旧 gold／白名单／基准完整性断言与 validate、bench:dry 的红态依旧，红态期间不合并、不发版、不登记新基线、不执行付费试验。

### 2026-09-16 — 第 4 步（分批之一）：关联格式 v2、scope 与概念引用

- **范围**：本批只交付第 4 步的关联层——prose-links 格式 v2（必填 scope、概念引用、文档根定位、路径与未知字段校验）、当前两条标注的显式迁移，以及 read 关联范围的合并算法。read 工具本体与 readDelivery 观测（plan 4.4–4.6）仍在下一批，工具定义版本保持 14，运行时的原文读取入口暂仍是 read_section（其 linked 展开复用同一批对象渲染）。
- **格式 v2**：顶层仅 version=2 与 links；每条为 file、headingPath、可选 occurrence、必填 scope（section｜subtree）、objects。file 校验语料根相对路径（拒绝绝对路径、反斜杠、空段、. 与 ..），并以当前 manifest 文件集合为准（raw 与开发文档不可定位）；headingPath 不含 #，空数组统一按文档范围 doc:<file> 定位且出现序号只能为 1；顶层、条目与各 kind 引用的未知字段一律报中文错误。运行拒绝 v1 文件并提示逐条补 scope 迁移，历史 inputs 中的 v1 记录原样可读。
- **对象模型**：解析结果统一为 { kind: 'card' | 'concept' } 的登记顺序数组，卡片保留原 ref/canonical/grantId/skillId 并新增 kind；概念携带 name、精确来源位置（file、headingPath、occurrence、term、termOccurrence）与定义原文行范围。概念引用只在当前原文快照中读取，不建第二份定义，不递归展开正文名字（ADR-022 决策 5）。
- **概念定位规则**：未填 term 时目标必须是有非空正文且无子标题的单概念小节；填 term 时在该小节直接正文（子标题之前）按行首「- **名称**」匹配，连续内容取至下一条同级条目，同名条目必须显式 termOccurrence，越界、未命中、宽章节、空正文与白名单外来源都进入 issues 与 unresolved，不静默跳过。缺 term 填 termOccurrence 属格式错误，加载即报错。
- **错误传播**：解析层保留 issues/unresolved 供诊断，重复引用记错误并只保留首项；装配入口按 plan 4.3 拒绝任何解析问题，不能仅靠真实语料测试把关。readObjectsFor 同样拒绝损坏索引；现有 linked 展开遇到索引错误返回 error，手工构造的失效对象保留 requested/omitted 明细并返回 error，不将其记为成功或空关联。缺文件及合法空标注仍表示无关联。
- **读取范围合并**（plan 4.2）：新增 readObjectsFor(sectionId, directory, index)，按「S 子树中的全部登记 + S 严格祖先中 scope=subtree 的登记」计算；文档根作为所有标题的逻辑祖先参与 subtree 继承（不改 sectionId 算法与 parentId 树）；读取子节点不继承祖先的 section 作用域；来源按节点原文顺序与 objects 内顺序稳定合并，卡按 canonical 去重（operator 完整卡覆盖同卡技能投影，explicitGrantIds 累加），概念按精确来源位置去重，每个对象保留全部 { sectionId, objectIndex } 来源。
- **当前标注迁移**：knowledge/prose-links.json 升为 v2，两条原有标注逐条补 scope=section，对象与顺序未改；未新增概念标注（标注相关性审核属第 7 步）。
- **概念卡渲染**：新增 serializeConceptCard，固定输出「【概念：名称】」「来源：file#标题路径（条目序号）｜L行范围」「定义：原文」；当前 read_section 的 linked 展开已复用该格式并在观测中新增 deliveredConcepts，未返回对象仍逐条报告。
- **TDD 与验证**：先改/补测试并观察失败（prose-links 套件 27 项中概念、格式、合并用例与三处观测断言转红），再实现转绿。定向：prose-links／prose-links-read／prose-links-hint／inputs 55 通过；全套 `pnpm run test` 656 项中 654 通过、2 失败（仍为第 6 步延后的旧 gold 锚点用例，本批无新增失败）；`pnpm run typecheck` 通过。
- **新增覆盖**：prose-links 增补格式校验 5 条（v1 拒绝、scope 必填与取值、未知字段三级、路径与 # 校验、缺 term 的 termOccurrence）、概念引用 4 条、读取范围合并 4 条（子树与祖先继承、文档根、同卡合并与来源、概念按位置去重）；prose-links-read 增补概念卡送达 1 条。
- **未闭合**：read 工具与双偏移分页（plan 4.4、4.5）、readDelivery 与 trace/records/meta/report/inputs/snapshot 接通（4.6）未实施，工具版本仍为 14，RAG 关联入口提示仍引导 linked 展开；第 5–8 步未开始。

### 2026-09-16 — 事实出口与关联 v2 批次验收修缮

- **事实出口验收**：独立审查放行第 1 步，亲自运行相关 7 个文件共 176 项测试通过；其全量比对覆盖 raw/curated 各 425 卡、913 grant、167 替换边、82 等价组，排除四个新增字段后旧字段一致，两模式共 2,380 次登记词查询的解析路径、成员与类别一致。按审查意见将代码注释及本笔记中的「旧卡逐字一致」改为缺字段可读、无占位片段；纯措辞修正未改变实现。该批提交为 94c68b8（10 文件）。这些全量比对为独立审查记录，主代理未重复执行。
- **关联层初审**：独立审查为 FAIL，确认真实解析问题未阻断装配、concept 文档根越过标题边界且未校验出现序号、linked 去重漏掉标题 occurrence。自查补充同级普通列表条目截断问题。以上均违反本批既定契约，不属于延期门禁；原笔记将装配失败称为后续独立收紧的说法已更正。
- **修复先红**：主代理先新增 12 条回归用例并将 3 条损坏快照用例的状态断言改为 error，定向运行 prose-links/prose-links-read 得到 15 失败／35 通过。覆盖真实装配入口的失效定位、失效对象、重复引用，根概念范围与序号，普通同级列表边界，损坏索引读取，以及重复标题概念分别送达。
- **修复与复测**：装配与范围合并拒绝错误索引，linked 显式报错；文档根按同一目录快照的首个真实标题划定直接正文，空名称概念拒绝；列表定义在下一同级条目前结束；概念身份计算统一包含标题 occurrence。定向 50 项全部通过；全套 `pnpm run test` 为 666 通过／2 失败（共 668 项、49 文件），剩余两项仍是 benchmark-integrity 的 26 个旧 gold 锚点。`pnpm run typecheck`、`pnpm run build`、`git diff --check` 通过。
- **复审补充**：独立复审发现，无子标题但包含多个术语条目的叶小节仍可被整段包装为概念。先补不带 term 引用术语表的回归用例，观察 1 失败／37 通过，再要求这类小节显式填写 term。随后全套 `pnpm run test` 为 667 通过／2 条旧 gold 失败（共 669 项），`pnpm run typecheck`、`pnpm run build` 与差异空白检查通过。
- **格式与标识修缮**：复审另确认空字符串字段名绕过未知字段校验，并建议保持 injectedIds 的既有标识口径。新增顶层/条目/对象的 3 条空键回归，更新两个概念送达用例验证概念名不进入 injectedIds，定向先观察 5 失败／49 通过；随后使用显式 undefined 判断未知键，injectedIds 仅保留 canonical。最终全套为 670 通过／2 条旧 gold 失败（共 672 项），类型检查、构建与差异空白检查通过；概念送达仍单独记录于 linkedFacts.deliveredConcepts，完整位置观测待后续 readDelivery。
- **其余核对**：本轮 `catalog --check`、`check:reference-projection`（9 分片）、`check:prose-terms` 通过；文档检查仍只报告活动计划未勾选的 20 个 D1（8＋10＋1＋1）。旧 gold、validator 与 benchmark-integrity 断言未修改；未执行付费试验、合并或发版。事实出口已补齐，精确技能投影、read 本体/双偏移分页/观测及第 5–8 步仍待后续实施，本轮不勾选关联层整项。

### 2026-09-16 — 第 4 步（分批之二）：read 本体、精确技能投影与 readDelivery

- **范围**：本批实施 plan 4.2 剩余的精确技能投影、4.4 read 参数与旧工具退役、4.5 双偏移分页与容量契约、4.6 实际送达观测接通 trace/records/meta/report/inputs/snapshot。TOOL_SCHEMA_VERSION 14 → 15（facts 结果仍为 8、prose-links 仍为 2、小节目录结构与 ID 算法未改）；第 5 步（expandFulltext 默认、injectKeywordCatalog、RAG fragmentRanges）与第 6–8 步未实施。
- **工具切换**：模型侧只暴露 `read`（bm25 与 hybrid 都保留），参数固定为 section_id、offset、facts_offset；`read_section`、`linked`、`offset` 与 linked 互斥等旧契约整体移除，`LinkedFactsObservation`、`linkedFacts` 字段一并删除。运行时收到 `read_section` 时按未知工具拒绝（status=unknown_operation、executed=false），文案为「read_section 已退役；请改用 read（参数：section_id、offset、facts_offset），原文与关联事实在同一次读取中返回；本次调用未执行。」，不静默改译；ToolId 与 isObservedTool 仍识别旧名，供历史记录与聚合读取。
- **输出格式**：read 的 data 固定为「【阅读范围】→【分页】→【原文】→【关联事实】→【导航】」五个分区；【阅读范围】给出 file、标题路径、section_id 与本页原文行范围（无正文时写「无」）；【分页】为单行合法 JSON，字段与顺序固定为 section_id、offset、next_offset、body_complete、body_total_chars、facts_offset、next_facts_offset、facts_complete、facts_total、facts_returned、facts_result_version、complete、next_call；空分区显式写「（无本页内容）」。【导航】为可选分区，含直接父级范围入口与同级/子小节导航（最多 8 项），只用余量、整行保留 ID 并按行裁减后附「（省略 N 项）」。
- **容量与偏移**：正文页不超过 6000 UTF-16 字符，优先完整行、超长单行按字符切且不拆代理对；offset 落在代理对中间、超出正文长度、facts_offset 超出对象数都按 invalid_params 拒绝（不计 executed）；未知 ID 返回 empty 并提示使用本次返回的 ID。事实按完整对象分页，容量不足时按顺序停止、不跳过前面的对象挑短卡；单个对象超过整页可用额度时报 error「关联对象超过阅读容量」，不给半张卡也不给不前进的 next_call。已读完的一侧在 next_call 中用总长度/总对象数（不传 null），两侧都读完时 next_call=null。
- **readDelivery 口径**（plan 4.6 两种说法的落地）：`bodyRange`/`factsPage` 在无法取得时省略（参数级非法、容量错误、索引损坏等送达前失败），在已构成页面但无证据时写 null（bodyRange）或写实际分页计数（factsPage），`deliveredObjects` 在送达前失败时省略、已观察无证据时为 []；容量失败不写成空关联。`grantIds` 为实际展示的 grant：投影卡含明确引用与被替换链、完整卡列出卡内全部 grant；概念沿用文件+标题路径+条目序号定位，不新增散列 ID。
- **旧运行不混用**：report 的 `readDeliveryStats` 在「任意记录使用过 read_section」或「请求过 read 却缺台账」时整体为 null（不可用），只在明确没有 read 调用的新运行记 0；`errors` 计未取得证据的非空结果（含容量错误与参数错误），`bodyChars` 取送达区间长度、跨调用重复计卡次。
- **接口与留档**：`CostRecord.readDelivery` 为按 callId 的数组（与 ragDelivery 同形），trace 单个 tool_call 事件保存对应单条，snapshot 新增逐层类型白名单（未知字段被过滤，不保存正文），meta 增加 `readDeliveryStats`，inputs 新增顶层 `factsResultVersion` 与 `links.entries`（每条登记保留 sectionId/file/headingPath/occurrence/scope 与可读引用，概念带精确来源位置；定义原文与正文仍只在 trace/readDelivery 中按引用关联）。
- **指令与示例**：knowledge/AGENTS.md 的阅读入口改为 `read`；rag_search 关联事实入口提示改为「用 read 读取该小节即可同时取得原文与登记事实」；全文扩展续读行改为可直接复制的 `续读：read(section_id="…", offset=…)｜complete false｜正文 N 字符`。
- **容量预留的偏离说明**：plan 4.5 要求「先预留必要元数据、来源及完整 next_call」。实现按当前范围与最大数字位数预留含 next_call 的额度，并在「整段可能一次读完」时另算一份不含 next_call 的额度作为回退（该额度仍经页后序列化验证，若实际需要续读就回落收紧或报容量错误）。未预留 next_call 的额度只在页内没有续读调用时成立，因此不产生「预留不足却宣称成功」的页；这样可避免单页读完的短范围被无谓判为容量不足。
- **TDD 与验证**：先写/改测试并观察失败：新增 bench/tests/read.test.ts 22 项（工具定义与旧名退役、参数校验、分区格式与分页元数据、双偏移与容量、精确投影、送达观测），迁移 11 个既有测试文件（prose-links-read、section-navigation、section-navigation-runner、tool-executor、facts-tools、agent、agent-auto-loop、fulltext-expansion、retrieval-range、runner、report）并新增 snapshot/inputs/report 的 read 台账用例；首轮定向运行读到 21 项失败，实现后全部转绿。全套 `pnpm run test` 为 690 通过／2 失败（共 692 项、50 文件），两条失败仍是第 6 步延后的 benchmark-integrity 旧 gold 锚点用例，本批无新增失败。`pnpm run typecheck`、`pnpm run build`、`check:reference-projection`（9 分片一致）、`check:prose-terms`、`catalog --check`、`git diff --check` 通过；`node dist/cli.js validate` 与 `bench:dry` 仍因同一批旧 gold 锚点失败（属已授权延后项）；`node scripts/doc-check.mjs` 报 18 条 D1（plan-corpus-supplement 8、plan-progressive-disclosure 8、plan-index-and-tags 1、plan-prose-linked-knowledge 1），无 D2–D5 与结构类错误，其中本计划由 10 条减为 8 条对应当前批次勾选的两项。
- **新增覆盖要点**：read 参数四类非法与代理对边界；分区顺序与 13 个分页字段；长正文连续分页无中段丢失且每页不超过 maxContextChars；小预算下多页拼回原文（含非 BMP 字符）；事实按完整对象分页并在续读时不重复；两侧完成状态与 next_call 的两种形态；元数据放不下与单对象超容量两种容量错误；skill 引用只投影指定 grant 与被替换链并标注明确引用/替换依据、同卡合并与 operator 覆盖；概念只按精确位置去重且不进 injectedIds；首次/续读的 attempt 与 success 计量；runner 端 trace、records 的 read 台账与 inputs.links.entries/factsResultVersion。
- **未闭合**：第 5 步的 expandFulltext 默认关闭与 injectKeywordCatalog 开关、RAG 的 fragmentRanges 与必要 ID 优先；第 6 步 gold 定位分离与 26 键迁移、白名单/完整性断言与两份基线处置；第 7–8 步散文试点与真实模型观测。上述两项验收条目（关联层格式与精确投影、read 替代旧工具）在本批完成，已在 plan 验收清单勾选；「read/RAG 实际范围与对象送达接通」因 RAG 片段范围属第 5 步，仍未勾选。
- **观测脚本核对**：scripts/tasks/bench/facts-evidence-observation.mjs 只读 trace 的 facts_search 事件与 records.ragDelivery，两者字段形状未变，无需机械改动；其口径（显式 facts_search + RAG 附带）本就未包含阅读路径送达的卡片，本批 read 的送达另由 readDeliveryStats 观测。是否把 read 送达的卡片计入该脚本的正式名送达统计属口径变更，未自行修改，留待需要时另行决定。

### 2026-09-16 — inputs.links.entries 用解析后可读引用而非登记原文

- **背景**：plan 4.6 要求 inputs 保存「每条 v2 登记的 sectionId/file/headingPath/occurrence/scope/objects」，并「概念精确位置通过引用与送达记录关联」。
- **实际做法**：`ProseLinkIndex` 只保留解析结果（可读 ref、canonical/grantId、概念精确位置），登记原文只存在于 knowledge/prose-links.json。为避免为留档再读一次旁挂文件或让索引携带原文，entries 记录解析后可读引用：卡片写 {kind, ref, canonical[, grantId]}，概念写 {kind, ref, name, file, headingPath, occurrence, term?, termOccurrence?, startLine, endLine}，解析失败引用写 {kind:'unresolved', ref, reason}；不含定义原文与正文。
- **影响**：entries 与登记条目一一对应（真实语料中重复引用与失效引用都在装配期被拒绝，故不丢条），足以把 readDelivery 的送达对象按 ref/精确位置回溯到登记；若将来需要在留档中逐字保存登记原文，应改为直接留档 prose-links.json 内容，属独立议题。

### 2026-09-16 — 第 4 步交付的验收审查修复（分页前进、来源送达与台账口径）

- **审查发现**：独立审查对本批 read 交付提出 7 项阻塞与 3 项整理：①窄容量下可能返回「无证据且偏移不前进」的页，未知 ID 提示不受 maxContextChars 约束；②report 把缺失观测（历史/字段不完整台账）记为零送达，预算拒绝的 read 没有台账；③运行快照未统一（目录、关联解析、事实卡各自加载）；④参数含空字符串键时绕过未知字段校验；⑤明确引用标签受登记顺序影响；⑥登记来源只留在后台台账，没有随对象送入模型也未计入分页容量；⑦容量失败丢弃已取得的事实页信息；另加导航省略数量不完整、死代码与进度文档不一致。这些均属 plan 4.4–4.6 既定契约内的缺陷，不计入第 6 步的延后例外。
- **分页前进（bench/src/read.ts）**：容量收缩循环内重新校验首个待送对象是否仍放得下（放不下即按「关联对象超过阅读容量」报错），成功页返回前再兜底拒绝「未完成且两侧偏移原地不动」的页。修复前复现：甲节＋5 张卡、maxChars=770 时原实现返回 empty、complete=false、两侧偏移仍为 0；对应用例已固化为窄容量扫描断言。
- **来源送达（bench/src/read.ts）**：renderReadObject 为每个送达对象追加「登记来源：<file>#<标题路径>」（多来源按「；」连接，节点取不到时回退 section_id），来源文本位于【关联事实】分区并计入同一分页预算；此前 notes「容量预留的偏离说明」只预留元数据与 next_call，来源未预留，本批按 plan 4.5 补齐。
- **失败台账（bench/src/read.ts）**：容量错误、记录卡缺失等送达前失败改为登记 factsPage（offset=factsOffset、nextOffset=null、returned=0、complete=false），仍不写实际范围与 deliveredObjects；预算拒绝的 read 也留下 status=budget_exhausted、sectionId=null 的台账（未解析参数，不上报范围，tool-executor.ts 的 exhaustedResult）。
- **台账汇总（bench/src/report.ts）**：readDeliveryStats 改为逐字段判定可用性——任一调用缺 bodyRange 或 deliveredObjects 时对应字段为 null，只把已观察到的空值记 0；calls/successes/empty/errors 口径不变。此前的记录（「整体为 null 或 0」两档）随之细化为按字段不可用。
- **未知字段校验（bench/src/tool-executor.ts）**：rag_search、facts_search、read 三处未知键判断由真值改为 `!== undefined`，空字符串字段名不再绕过校验，返回 invalid_params。
- **技能投影（bench/src/facts/store.ts）**：skillProjection 改为两遍处理，先登记全部明确引用、再沿 replacesGrantId 补替换依据；先引用升级技能再引用其被替换技能时，后者仍标「明确引用」。
- **导航与死代码（bench/src/read.ts）**：省略数量改为「导航上限截断数（navigationFor 的 omitted）＋预算裁减数」，尾部数字按实际保留条数计算；删除未被调用的 assemblePage。
- **运行快照（bench/src/runner.ts、prose-links.ts、tool-executor.ts、agent.ts）**：buildProseLinkIndex 改为可选对象入参，可注入运行级小节目录与 raw facts；runner 只装配一次小节目录并注入关联解析，另以运行级惰性提供者（factsStore）注入 facts 卡片快照，供 facts 工具与 read 共用同一实例；模块级单例仍是缺省回退，无 runner 的调用方与测试替身路径不变。
- **未知 ID 提示（bench/src/tool-executor.ts）**：新增 boundIdMessage，未知小节与无目录提示按 maxContextChars 截断回显的 ID（不拆代理对），empty 结果的 data 同样守住预算。
- **进度文档**：docs/inbox.md 的渐进披露条目由「第 4 步部分实施」更正为「read 本体、精确技能投影与 readDelivery 已实施，第 5–8 步待实施」；sections.ts、delivery.ts、agent.ts、prose-links.ts 中指向已退役 read_section / linked 展开的过期注释同步更新。
- **TDD 与验证**：先补/改用例并观察失败——read 8 条（未知 ID 预算、空键拒绝、导航省略数量、窄容量分页前进扫描、来源入预算、超容量 factsPage、投影顺序、预算拒绝台账）、report 2 条、tool-executor 1 条、prose-links 1 条（快照注入）；修复后定向 4 个文件 137 项全绿，全套 `pnpm run test` 为 701 通过／2 失败（共 703 项、50 文件），两条失败仍是第 6 步延后的 benchmark-integrity 旧 gold 锚点，本批无新增失败；`pnpm run typecheck` 通过。
- **未闭合**：第 5 步（expandFulltext 默认、injectKeywordCatalog、RAG fragmentRanges 与必要 ID 优先）与第 6–8 步未开始；plan 验收清单第 7 项因 RAG 片段范围属第 5 步保持未勾选，read 侧范围与对象送达（含本批修复）已接通。

### 2026-09-16 — 第 4 步遗漏项修复（复审）

- **背景**：前一条「第 4 步交付的验收审查修复」声称已修的三项经复审仍不完整：report 只在记录里出现旧工具名 read_section 时判不可用，正式旧快照（下发过 read_section 但未调用）仍返回七项全零；运行快照只统一了小节目录，关联解析与卡片投影仍各自加载 facts，卡片继续走跨运行单例；skillProjection 对卡上不存在的 grant 仍静默跳过，read 会返回「成功但技能数为 0」的投影卡。另有三项边界与契约遗漏（快照边界、失败页完成状态、重复标题来源显示）。以下均属 plan 4.2–4.6 既定契约与冻结契约内的缺陷，不属第 6 步延后例外。
- **report 汇总（bench/src/report.ts、cli.ts、runner.ts）**：新增 ReportRunDeclaration（toolNames）与 runDeclarationFromMeta；readDeliveryStats 只在运行明确下发 read 时才把「零次调用」记 0，未声明（无 meta 的裸 records、toolSchemaVersion 12 的旧快照）保持 null，不再把未调用与未观测混同；新增台账覆盖检查——请求过 read 却缺台账数组、或台账条目数与单调用规则下实际准入的调用不符（含未请求 read 却出现台账）都判整体不可用，同批超量拒绝的 read 仍不计。runner 以工具 schema 的 toolNames 声明，cli 的 run/report 从运行目录 meta.json 读取同一声明。
- **运行级 facts 快照（bench/src/facts/final.ts、facts/store.ts、prose-links.ts、runner.ts）**：final.ts 拆出 loadValidatedFacts 与 projectValidatedRecordCards（loadValidatedRecordCards 保留为组合入口，行为不变）；buildProseLinkIndex 的 facts 入参支持惰性提供者；runner 只加载一次 raw facts，同时注入关联解析与卡片投影，并以新增的 createRunCardStore 从运行级卡片构建 store，不再回落模块级单例（单例仍是缺省回退，供无 runner 的调用方与测试替身使用）。
- **技能投影（bench/src/facts/store.ts）**：skillProjection 对卡上不存在的明确引用、以及替换链中缺失的被替换 grant 直接报中文错误，read 由此得到 error 结果而不是静默丢弃该引用；环状关系与已入选项的稳定跳过保持。
- **快照边界（bench/src/snapshot.ts）**：数值统一要求非负安全整数；factsPage 校验 offset 与 offset+returned 不越 total，并要求完成状态与 nextOffset 一致（complete 时为 null，未完成时等于本页结束偏移）；概念 occurrence/termOccurrence 必须从 1 起；概念条目与原文范围的倒置行范围（endLine < startLine）拒绝。
- **read（bench/src/read.ts）**：送达前失败页的 factsPage 恒为 returned=0、complete=false（无事实或 facts_offset 已耗尽时不再标成完成）；登记来源在同文件同标题路径重复标题时附「（出现序号 N）」，按 sectionId 去重，显示不再把两处来源合并成一条。
- **TDD 与验证**：先补/改用例并观察失败——report 4 项、snapshot 2 项、read 4 项、prose-links 1 项、runner 1 项、inputs 1 项（vi.doMock 改为在卡片投影阶段抛错，raw facts 快照仍正常加载），首轮定向读到 10 项失败（含 4 条既有断言的改造）；实现后定向 5 个文件 122 项全绿。全套 `pnpm run test` 为 711 通过／2 失败（共 713 项、50 文件），两条失败仍是第 6 步延后的 benchmark-integrity 旧 gold 锚点，本批无新增失败；`pnpm run typecheck`、`pnpm run build`、`check:reference-projection`（9 分片一致）、`check:prose-terms`、`catalog --check` 通过。
- **实测复核**：`node dist/cli.js report` 两份已登记快照的 read 行由七项 0 改为七项「不可用」；本轮 dry 端到端（run → export 共享快照 → report）在明确下发 read 的运行下得到调用 0／成功 0，临时运行目录与快照已删除，未新增入库产物。
- **未闭合**：第 5 步（expandFulltext 默认、injectKeywordCatalog、RAG fragmentRanges 与必要 ID 优先）与第 6–8 步未开始；旧 gold 及依赖它的 validate／bench:dry 红态不变。

### 2026-09-16 — 提交验收中的失败记录衔接修缮

- **范围**：按用户要求，只核对第 4 步冻结契约并使用现有测试入口；本轮未新增探针、基准、诊断框架或留档产物。独立审查指出失败事实页被快照校验拒绝、取得对象序列后的加载/投影异常丢失 factsPage，以及概念 termOccurrence 缺少 term 的校验遗漏。
- **修缮**：快照按 error 状态接受 returned=0、complete=false、nextOffset=null 的失败页，正常续读校验保持；补齐概念字段依赖。读取层在已知对象序列与有效事实偏移时保留失败 factsPage，原有 fatal 语义保持，不写实际范围或送达对象；清除未使用的正文页常量导入。
- **TDD**：在原有 snapshot 测试中补充失败页与字段依赖回归，先观察 2 失败／12 通过；测试夹具补齐对应 queries 条目。随后扩展原有缺失 grant 用例，观察 1 失败／47 通过；实现后 read/snapshot 两个文件共 48 项通过。未修改旧 gold、benchmark-integrity 或门禁脚本。
- **复测**：全套 `pnpm run test` 为 712 通过／2 条旧 gold 失败（714 项、50 文件）；类型检查、构建与差异空白检查通过。文档检查仍仅 18 条活动计划 D1；本轮既有 reference-projection、prose-terms、catalog --check 通过。第 5–8 步及旧门禁延后范围保持。

### 2026-09-16 — 第 5 步：检索默认送达与关键词目录注入开关

- **范围**：本批实施 plan 第 5 步——默认 `expandFulltext=false` 的命中块送达与 `fragmentRanges` 观测、默认 `injectKeywordCatalog=false` 的目录注入开关（含 CLI、指令装配与三处留档）。既有协议契约未变：TOOL_SCHEMA_VERSION 仍为 15、FACTS_RESULT_VERSION 仍为 8、prose-links 仍为 2、小节目录结构与 ID 算法未改。第 6–8 步未实施。
- **RAG 默认送达**：默认（未显式 `--expand-fulltext 1`）只送达命中的 H2/H3 块。块头为 `【<file> | <标题> | L<起>-<止> | <section_id>】`，正文取该块在**同一次装配的原文快照**中的行范围（止于下一个 H2/H3 边界），不再使用 `SectionEntry.body`，命中 `##` 小节时不会混入未命中的 `###` 子节；BM25 的索引输入（`chunk.text`）保持不变。必要元数据（小节 ID、来源、行范围）优先于正文：额度连元数据加一单位正文都放不下时不发送该块（继续尝试后续更小的块，不重新检索补满 topK），全部块都放不下时返回明确容量错误。块超预算时按行边界连续截取（超长单行按字符切且不拆代理对），并追加可复制的 `续读：read(section_id="…", offset=N)｜complete false｜正文 M 字符`；`offset` 为块首行在所属小节 body 中的偏移加本页长度，续读返回的正是该块后续原文。
- **片段范围观测**：`RagDeliveryRecord` 新增可选 `fragmentRanges`，每项为 `{kind:"hit"|"parent_lead", file, sectionId, chunkId?, docOffset, docEndOffset, startLine, endLine}`，偏移相对同运行 `documentRange.body`，与 readDelivery 的 `docOffset` 同坐标。只登记实际返回的连续正文（不含来源头、导航与分页元数据）；父级引导按实际写入登记。字段接通 trace 的单条 tool_call、records 的 ragDelivery、snapshot 白名单（逐层过滤未知字段，只接受 hit/parent_lead）与 meta/report 的 `ragDeliveryStats.fragmentRanges`（任一调用缺该字段即判不可用，全文扩展模式为已观察的 0）。全文扩展模式继续只用 `fulltextRanges`，不重复登记相同正文。
- **关联提示改向**：`rag_search` 的【关联事实入口】改为面向**实际显示的命中节点与导航项**，按 ADR-022 决策 4 的读取范围合并规则逐节点计算是否有可展开关联，只列确实有登记对象的小节，行内给出对象数与可直接复制的 read 示例（`｜示例：read(section_id="…")`）；不再按命中文件列出全部登记。提示仍是导航，`linkedEntries.written` 只表示该行确实写入本次 data。
- **目录注入开关**：`ExperimentConfig`/`BenchConfig` 新增 `injectKeywordCatalog`（默认 false）；`loadKnowledgeAgentInstructions(root, injectKeywordCatalog)` 关闭时只读取并返回 `knowledge/AGENTS.md`（目录缺失不报错），开启时按原格式追加目录正文，缺失/读取失败/为空仍按中文错误失败。CLI 新增 `--inject-keyword-catalog 0|1`（缺值与非法值按 `readBinarySwitch` 报中文错误、退出码 1），未显式传入沿用默认；run 的回显行新增「目录注入：开/关」；hitrate 显式传入时提示忽略；catalog 子命令列为不支持参数且不写文件。runner 与 `runQuery` 的提示兜底都按有效配置装配指令，`buildSystemPrompt` 的缺省入参等于默认配置（关闭），不保留暗中恒定注入的旁路。inputs/meta 记录 `injectKeywordCatalog`，snapshot 的 meta 白名单放行该键（历史缺字段不推定当时关闭）。
- **实施决策**：①命中块无对应小节时（标题前首部等「（未分段）」块）以同文件文档范围 `doc:<file>` 作为可调用 ID 与续读基准，不新增 chunk ID 冒充 read 目标；②关联提示不含上级范围入口与文档范围块，后者等价于「列出命中文件全部登记」；③父级引导取最多 300 UTF-16 字符的连续前缀，行范围与字符范围均按该前缀登记，展示单元放不下则整条省略；④默认路径缺少目录或原文映射失败时报错，停止发送无阅读 ID 的正文；显式全文回退保留既有无目录兼容行为。
- **契约变更**：RAG 极小额度下的失败语义由「硬截断产生截断头部 → empty」改为「不发送该块 → 明确容量错误（`无法在 maxContextChars=N 内返回命中块…`）」，与 ADR-022 的 read 容量口径及既有全文扩展分支一致，仍不扣成功额度；tool-executor 原用例随之更名并改断言。
- **TDD 与验证**：先写/改测试并观察失败——配置与目录注入一批（config/catalog/cli-args/inputs 4 文件）在把 `bench/src` 改动暂存回旧实现后运行，得到 11 失败／60 通过；RAG 送达与片段范围一批（新增 bench/tests/rag-delivery.test.ts 6 项，另改 prose-links-hint、section-navigation、report、snapshot、facts-attach、tool-executor）首轮定向 13 失败／101 通过，修正夹具与契约后 4 失败／118 通过，实现完成后相关 5 文件 89 项全绿。最终全套 `pnpm run test` 为 727 通过／2 失败（729 项、51 文件），两条失败仍是第 6 步延后的 benchmark-integrity 旧 gold 锚点用例，本批无新增失败；`pnpm run typecheck`、`pnpm run build`、`catalog --check`、`check:reference-projection`（9 分片一致）、`check:prose-terms` 通过；`node scripts/doc-check.mjs` 由 18 条 D1 减为 15 条（本计划勾选 3 项），无 D2–D5 与结构类错误。
- **新增覆盖要点**：默认 `expandFulltext`/`injectKeywordCatalog` 为 false 且可显式回退；四组 expand/inject 组合下的 systemPrompt、inputs.config 与 meta 一致性；目录关闭时缺失不报错、开启时缺失与空目录报中文错误；`--inject-keyword-catalog` 解析、hitrate 忽略提示与 catalog 拒绝；命中块头含 ID/来源/行范围且止于下一个 H2/H3 边界；末尾上下文装不下时 ID 仍随块送达；容量不足不发送该块、不出现被截断 ID；连续截取页与 read 续读拼接覆盖整块；父级引导片段坐标与原文一致；全文扩展模式 `fragmentRanges` 为空且不重复登记；提示只覆盖命中节点与导航项、未被显示与其它文件的登记不再列出；report 的 `fragmentRanges` 计数与不可用口径；snapshot 片段的往返、未知字段过滤与非法类型拒绝；真实 runner 下默认无全文扩展范围、片段范围非空并与 meta 汇总一致。
- **连带更新**：`bench/src/catalog.ts` 的 `TODO(tech-debt) IDX-1` 注释改为「显式开启注入时才随 prompt 送达」（债务对象不变）；docs/inbox.md 的渐进披露条目与本条目录压缩条目的实施状态同步；plan 验收清单勾选「read/RAG 实际范围与对象送达接通」「expandFulltext 默认关闭」「injectKeywordCatalog 默认关闭」三项。
- **未闭合**：第 6 步（gold 定位分离与 26 键迁移、白名单/完整性断言转绿、关键词目录全文重生成与一致性门禁、两份基线用途与口径处置）、第 7 步（散文试点与标注）与第 8 步（零费用端到端契约、分阶段 hitrate、真实模型观测）均未开始；旧 gold 及依赖它的 `validate`／`bench:dry` 红态不变，红态期间不合并、不发版、不登记新基线、不执行付费试验。

### 2026-09-16 — 第 5 步验收修缮

- **审查处置**：独立审查发现父级引导范围高报／漏记、小预算下实际附带 facts 却未计成功、默认无目录入口送达无阅读 ID 正文及未使用导入。按既定契约修复：引导展示与登记共用连续切片，余量不足整条省略；RAG 或 facts 任一实际送达即计成功；默认缺少有效阅读范围明确失败；删除失去消费者的导入和中间字段。
- **TDD**：在 rag-delivery 与 section-navigation 的现有测试入口先观察 3 失败／25 通过，修复后 28 项通过。全套复测暴露 21 项旧无目录夹具的前置条件变化；循环、预算与 facts 边界用例显式选择原有全文回退，保持原断言；默认容量用例改用真实白名单目录。默认行为仍由真实目录的送达、续读、范围与缺目录回归覆盖，无独立探针或新诊断框架。
- **验证**：修缮后全套 pnpm run test 为 729 通过／2 条旧 gold 失败（731 项、51 文件），pnpm run typecheck 通过。旧 gold、benchmark-integrity 断言与门禁脚本均未修改。目录开关的新增测试覆盖解析、分流辅助函数、四组合 prompt 与留档；真实 CLI 退出处理及 runQuery 缺省装配由静态审查核对，未宣称新增入口回归覆盖。

### 2026-09-16 — 第 6 步：gold 定位分离、26 键迁移与门禁转绿

- **范围**：本批实施 plan 第 6 步——gold 的 26 条 references 锚点按真源路径迁移；hitrate／benchmark-integrity 的完整定位目录改为「manifest 原文分块 + facts 声明的 11 份 raw 真源」并与检索范围分离；白名单/完整性断言按新职责调整并转绿；关键词目录重算与一致性检查；两份已登记快照的逐份用途核对与口径标注。TOOL_SCHEMA_VERSION 15、FACTS_RESULT_VERSION 8、prose-links v2、小节目录结构与 ID 算法均未变；第 7–8 步未实施。
- **gold 迁移**：bench/gold.json 保留原结构 `{题号: {golden: [file#标题]}}`，20 题与 69 条 golden 未增删、未替换；26 条 references 锚点按迁移清单改路径——`references/类别.md` → `guides/类别.md`（S02、S03 共 2 条），`references/技能-*.md` 与 `references/技能等价组.md` → `raw/` 同名文件（24 条）；标题文本逐条保持原样，未按长度或难度调整。数据源.md 无 gold 键，未补替代证据。
- **定位目录**：corpus.ts 新增 `loadGoldAnchorChunks(corpusRoot, rawDocIds)`＝`loadCorpus(manifest)` + 指定 raw 真源分块，复用同一 `splitChunks`；raw 清单由 facts/references.ts 新增的 `RAW_MACHINE_SOURCE_DOC_IDS` 单点声明（名册、技能等价组、9 个设施分片，共 11 份），references.ts 与 equivalence.ts 的加载器改用同一批文件常量，避免第二份人工名单。`resolveRawSourceFiles` 只接受 raw/ 下的普通 Markdown 文件：越界路径、非 raw 前缀、符号链接、非普通文件与缺失都直接报中文错误，不递归扫描 raw、不静默返回空库。
- **消费者**：cli.ts 的 hitrate 与 `--check-gold` 改用定位目录（上下文行标注「manifest + raw 机械真源 11 份」）；benchmark-integrity.ts 的 gold 文档/锚点校验与 checkGold 改在定位目录解析，summary 新增 anchorFileCount／anchorChunkCount，`validate` 输出同步；RAG 检索、模型 sections 目录与 inputs 模型目录仍只用 manifest，两个目录不互相传错。
- **完整性断言**：白名单断言维持「manifest 文件集合＝真实加载集合＝模型阅读集合、均不含 raw」与精确计数（19 份：base 12、guides 7）；「gold 来源有效」不再等价于属于 manifest，改由定位目录判定，raw 真源可定位但被检索范围排除。
- **实测计数**：`node dist/cli.js validate` 通过并输出 20 题 / 20 个 gold 题号 / 20 个 spec 题号 / 19 个白名单文档 / 121 个切块 / 30 个定位文档（742 个定位切块）/ 2 个共享快照；`hitrate --check-gold` 通过（20 题 69 项 golden 全部可解析）；零费用 `hitrate --topk 3,5,10` 的范围计数为定位目录 742 块｜检索范围 121 块｜排除 621 块｜被排除 gold 键 24 项（@3 R 51.1%／P 48.3%／nDCG 0.623，@5 60.7%／36.0%／0.638，@10 66.7%／20.0%／0.664）。这是纯迁移时点观测，与迁移前（定位 749／检索 145／排除 23）口径不同，不直接横比；试点时点的分阶段对照仍按第 7 步口径另行记录。
- **关键词目录**：`node dist/cli.js catalog --check` 通过，重算写回后无差异；纯迁移时点计数为 18 张表／178 条数据行／17,727 字符（含换行），后续内容拆分批次另行记录同一口径，避免把迁移与拆分两类变化混为一个改进。
- **基线口径处置**：逐份核对两份已登记快照的真实消费者与用途——`2026-09-12T15-38-28-892Z-glm-low-default.json` 是正式质量基线的来源运行（消费者为根 AGENTS.md 质量基线表登记、`node dist/cli.js validate` 的「至少一条且全部登记」机械校验、report/compare 的快照入口），`2026-09-13T01-14-52-980Z-qwen-off-t0.json` 是 ADR-017 允许登记的跨 provider 对照基线；两者生成于 `references/` 目录、默认全文展开、尚未注入关键词目录时期，其迁移后同口径成绩对照不再适用。2026-09-16 用户在本轮验收中明确回复：「明确保留两份作为迁移前基线，本次授权其继续保留」。据此保留两份迁移前基线；保留依据为本次用户授权，非历史 exp 引用或机械校验要求。现有「至少一份基线」要求不变，只在根 AGENTS.md 说明列与段首标注「适用迁移前来源与检索范围」，快照内容与历史计数未改。
- **TDD 与验证**：先改/补测试并观察失败——benchmark-integrity 更新 corpusFileCount 并新增定位目录精确计数与「gold 的 raw 来源可定位、不进检索」关系断言，corpus-allowlist 新增定位目录 2 条（真实语料组成＝manifest+11 raw、真源缺失/越界/非 raw 即失败），首轮定向读到 5 失败／2 通过；实现后 benchmark-integrity、corpus-allowlist、hitrate 共 26 项通过。全套 `pnpm run test` 为 734 通过／0 失败（51 文件），持续多批的 2 条旧 gold 锚点失败全部转绿。`pnpm run typecheck`、`pnpm run build`、`check:reference-projection`（9 分片一致）、`check:prose-terms`、`catalog --check`、`validate`、`hitrate --check-gold`、`pnpm run bench:dry` 均通过；`node scripts/doc-check.mjs` 由 15 条 D1 减为 14 条（本计划勾选第 10 项），无 D2–D5 与结构类错误。
- **临时产物**：`bench-runs/2026-09-16T06-59-46-775Z-glm-low-default`（bench:dry 的 2 题假数据运行目录）已删除；hitrate 只输出终端、未落盘；未新增入库产物。
- **未闭合**：验收清单第 12 项列出的命令在本批均已通过，但按步骤归属保留未勾选（见「决策偏离」）；第 11、13、14 项分别属第 7 步散文试点与第 8 步端到端/真实模型观测，均未开始。docs/adr/ADR-020、ADR-010 正文仍写 `knowledge/references/` 旧路径，历史 ADR 正文按维护口径未回改，迁移事实由 ADR-021 承载；knowledge/base/机制-心情与工休.md 首部的既有 raw 来源标注同样保持原样。

### 2026-09-16 — 第 6 步验收记录

- **复验**：全套 pnpm run test 为 734 通过／0 失败（51 文件）；typecheck、build、reference-projection、prose-terms、catalog --check、validate、hitrate --check-gold、bench:dry 全部通过。hitrate 仍为 69 个 gold 键，其中 24 个被检索范围排除，分母未删减；未设答对或命中率门槛。doc-check 仅 14 条活动计划 D1。
- **修缮与清理**：纠正旧快照的目录注入历史，按本轮用户明确裁决登记保留范围；本轮 dry 产物 dev-temp/work/step6-acceptance 已经 tooling 清单预览和执行删除，清单同步移除。未新增探针、诊断框架或入库运行产物。

### 2026-09-16 — 第 7 步：散文试点、组合小节审阅与精确关联

- **范围**：本批实施 plan 第 7 步——guides/高效率散件.md 办公室与源石碎片两节的整理与标注重核、三份组合指南的组合小节审阅与标注、guides/新手培养.md 与 base 的路径/能力表述及必要关联。运行时协议未变（TOOL_SCHEMA_VERSION 15、FACTS_RESULT_VERSION 8、prose-links v2、小节目录结构与 ID 算法均未改）；第 8 步未开始。
- **试点审阅结论**（guides/高效率散件.md）：「办公室联络散件」（H2）已承载单一命题「达到 45% 联络速度参考线且不依赖指定干员或设施的选择」，「有额外条件或代价的办公室选择」（H3）承载「带心情消耗、设施依赖或资源转换的选择」，「源石碎片制造（搓玉）」承载「搓玉独立口径下的人选与目标练度」，各自成块，无需新增或拆分标题，也不存在需要删除的重复事实段落（跨节重复事实已用「另行处理」「不重复生成同一目标」等表述处理）。为让 H3 分块不依赖父节正文交代命题，补一句引导语；并按 raw 真源补足两处原文限定与代价——凯尔希·思衡托的「不包含副手及活动室」、水灯心 +1 与地灵 +2 的心情消耗；标题与来源均未改。
- **试点逐条核对**：正文数值与 raw 真源逐条一致——珊比／艾雅法拉／遥／普罗旺斯 45%（艾雅法拉取「天灾信使·β」），斥罪 50% 且心情 +0.5，凯尔希·思衡托 30% 加每间精英干员设施 4% 最多五间，水灯心 45% 且 +1，地灵 45% 且 +2，焰狐龙梓兰的办公室相关 +10% 记在控制中枢技能「办公室年度人物」，源石碎片六人（褐果 30%＋15%、炎熔 35%、地灵 35%、谬因 35%、艾雅法拉 35%、薄绿 30%）。除上述两处补足外未发现其他条件丢失；办公室参考线不把依赖宿舍等级的锡人等选项计入，与正文「不依赖指定干员或设施」的口径一致。
- **组合小节审阅结论**：贸易站组合（7 个高效率组合＋2 个低效率或过渡组合）、制造站组合（8 个组合＋「怒潮凛冬：按散件使用」）、跨设施组合（3 个组合）均保留独立 H2/H3，没有需要强拆的段落；使用边界、组合收益边界、全基建核心散件边界、不设固定核心的赤金搭配、跨设施安排原则等边界与使用类小节只出审阅结论，不登记卡片。
- **标注交付**：按「决策偏离」记录的准则共 25 条登记、121 个技能引用与 17 个概念对象（初版为 84 个技能、13 个概念，两轮验收修缮共补齐 37 项技能与 4 项概念；按登记对象计，非去重后的记录卡数）。办公室两节各按本节内容登记（H2 为四项无条件选择，H3 为斥罪／凯尔希·思衡托／水灯心／地灵／絮雨／焰狐龙梓兰），源石碎片六人各自登记对应技能（褐果两条：地质学·α 与标准化·α）。概念引用取 guides/类别.md：叙拉古、谢拉格、格拉斯哥帮、杜林族、红松骑士团、深海猎人、龙门近卫局、精英干员取「干员组（28 条）」，金属工艺类技能、标准化类技能、莱茵科技类技能取「技能组（5 条）」，人间烟火、感知信息与同名特殊加成、特殊叠加规则取「规则说明（25 条）」；概念只作来源定位，不复制定义，同名规则按来源分别保留，不据此补造适用映射，泛化提及的资源名与技能族不登记。
- **base 与新手培养**：knowledge/base/机制-心情与工休.md 首部的 raw 路径改为能力表述（「上游工休时间资料中可由公式复算的通用部分」），闭合第 6 步留存的路径标注；机制-后勤技能结算.md 的「容量、差值与他人效率」「归零与清除自身影响」按正文点名的具体技能登记（招商引资、摊贩经济、配合意识、低语、团队精神、杯莫停），泛化提及的自动化技能族与资源名不登记。guides/新手培养.md 只含推荐目标表，没有技能效果断言，未登记关联。
- **gold／spec／目录**：本批没有标题或来源变化，gold 的 20 题 69 项锚点、spec 的证据块与判定含义均未变，故不做旧→新映射与版本递增；关键词目录重算一致（catalog --check 通过），目录内容不随散文正文变化。分阶段 hitrate 的范围计数与纯迁移时点一致：定位目录 742 块｜检索范围 121 块｜排除 621 块｜被排除 gold 键 24 项（@3 R 51.1%／P 48.3%／nDCG 0.623，@5 60.7%／36.0%／0.638，@10 66.7%／20.0%／0.664）。跨粒度指标只作带口径观察，不认作改善，不设质量门槛。
- **TDD 与验证**：先改 bench/tests/prose-links.test.ts 的真实语料用例并观察失败——原断言「所有关联对象都是卡片」在概念标注落地后读到 1 失败／42 通过（expected 'card'，received 'concept'），据此把断言改为卡片与概念分别校验（卡片要求非空 canonical，概念要求非空名称与定义原文），并新增「办公室两个小节各自登记本节候选、不靠父节 scope=section 继承」用例；实现后该文件 44 项通过。全套 pnpm run test 为 735 通过／0 失败（51 文件）；pnpm run typecheck、pnpm run build、check:reference-projection（9 分片一致）、check:prose-terms、catalog --check、validate（20 题／19 白名单文档／121 切块／30 定位文档／742 定位切块／2 共享快照）、hitrate --check-gold、hitrate --topk 3,5,10、bench:dry 全部通过；node scripts/doc-check.mjs 由 14 条 D1 减为 12 条（本计划勾选第 11、12 项），无 D2–D5 与结构类错误。补足两处原文限定与代价后重跑同一组命令，结果不变。
- **临时产物**：dev-temp/work/step7-annotations/dump-links.mjs（打印 25 条标注解析结果与 read 示例的临时核对脚本）经 tooling 清单预览并执行删除；bench:dry 两次生成的 bench-runs/2026-09-16T11-48-48-890Z-glm-low-default 与 bench-runs/2026-09-16T11-51-42-367Z-glm-low-default 均已删除；未新增入库运行产物。
- **未闭合**：第 8 步（零费用端到端契约观测与一轮真实模型观测）未开始，验收清单第 13、14 项保留未勾选；真实模型观测需费用授权，本轮未执行。

### 2026-09-16 — 第 7 步验收修缮

- **首次独立审查**：FAIL。水月标准化组缺「意识协议」；红云重要分支缺容量技能；感知信息组缺资源生成与中间转换；龙舌兰组缺必需的裁缝 β 候选。关联能解析、测试全绿不能替代这些职责的完整性核对，原完成结论须在修缮后重新验收。
- **修缮范围**：保留 25 条登记及 13 个概念引用，补齐 20 项精确技能引用，共 104 项。除四项阻塞涉及的 15 项外，同类核对补入鸿雪「销路宣发」、苍苔「金属工艺·α」、娜斯提「莱茵科技·β」、孑「摊贩经济」、泡泡「囤积者」，分别保留资源消费、技能类别成员资格或容量输入。依据为组合正文与 raw 真源的并存关系，未改正文的任选条件、运行时投影、gold、spec 或检索策略；inbox 同步第 7 步进度。
- **亲验 TDD**：在既有 prose-links.test.ts 中先增加 9 组真实关联投影回归，覆盖上述必要输入，观察 9 失败／44 通过；再补数据，53 项全部通过。回归调用现有 readObjectsFor 与 skillProjection，不新增探针或诊断框架，不以评测题答案作为预期。此前实施者的 TDD 和 dry 过程仍按上段原记录引用，本次未重演其历史顺序。
- **本轮修缮验证**：全套 pnpm run test 为 744 通过／0 失败（51 文件）；typecheck、build、reference-projection（9 分片）、prose-terms、catalog --check、validate、hitrate --check-gold 与 hitrate --topk 3,5,10 通过。范围和三档指标与本步前述记录一致。bench:dry 使用 2 题假数据，命令通过、HTTP 尝试为 0；内含 2 条模拟工具错误且无 read 调用，不将它作为第 8 步端到端契约完成的证据。
- **清理**：本次 dry 目录 dev-temp/work/step7-acceptance 经现有 tooling 显式清单预览与执行删除，清单同步移除；未触碰其他任务目录。第 8 步、付费观测与合并收束仍未实施。

### 2026-09-16 — 第 7 步第二轮验收修缮

- **第二轮独立审查**：FAIL。仍遗漏塑心与琴柳的具体设施职责、森蚺的中枢路线、赤金工艺与水月标准化的启动候选，以及深海猎人的心情代价与同名规则来源。第一轮修缮后的测试通过不能替代这些内容核对。
- **补齐关联**：新增 17 项技能引用：塑心与琴柳各两项、森蚺「我寻思能行」、赤金工艺五名候选的金属工艺技能、水月组六名候选的标准化技能、歌蕾蒂娅「潮汐守望」。另将两条「特殊加成」和两条「特殊叠加规则」按各自 termOccurrence 分别引用，最终共 25 条登记、121 项技能、17 项概念；不改任选条件，不扩大为完整干员卡。
- **真源边界**：深海猎人组新增正文说明，原始技能与类别资料未给出同名定义到具体技能解锁档或效果的明确映射。本次交付保证各定义按来源展开并显式保留未知，不声称该映射已经解决；既有 spec v4 也要求两条特殊加成的档位映射有直接依据，禁止按排列顺序推断。未更改技能效果、类别定义、标题、gold 或 spec，不引入新数值结论。
- **亲验 TDD 与验证**：先扩充既有真实语料投影回归并增加同名概念来源用例，观察 6 失败／50 通过，再补关联数据后 56 项全部通过；全套 pnpm run test 为 747 通过／0 失败（51 文件）。typecheck、reference-projection（9 分片）、catalog --check、validate、gold 校验与三档 hitrate 通过，范围计数及指标不变。术语检查首次发现新增正文的「技能档」写法，改为规范词「技能解锁档」后通过；git diff --check 通过。运行时代码未变，build 与无 read 的 dry 沿用本轮前述验证，不重复生成无关产物。

### 2026-09-16 — 第 8 步：零费用端到端契约观测与真实模型观测

- **零费用端到端契约**：一次性替身脚本（隔离 fetch、占位密钥、无真实网络）在真实装配路径上跑通「RAG 命中 → read 原文与关联分页 → trace/records/meta → report → export 快照 → 快照重算报告」：2 个合成问题、9 次模型步骤、7 次工具调用；关联事实的多页分页与续读、跨登记 canonical 合并经真实语料触发；原文多页（`next_offset`）在默认配置与当前语料下不可达，仅由工程测试覆盖。四处台账口径一致。记录见 docs/exp/exp-e2e-contract-glm-stub.md（提交 `753222b`）。
- **真实模型观测**：2026-09-16 用户授权执行一轮 20 题、未设金额上限（历史参考 ¥0.16–0.27 仅作量级参考）；命令为 `pnpm run build` 后 `node dist/cli.js run --provider glm`（默认 thinking low / hybrid / 新默认配置），运行目录 bench-runs/2026-09-16T13-56-21-467Z-glm-low-default/。结果：20/20 以 answer 终止、0 失败；55 次模型调用 0 重试 0 截断，输入 263,454／输出 12,402 tokens，费用 ¥0.1827（完整）；工具 35 次（rag_search 20、read 13、facts_search 2）提出＝准入＝执行，0 拒绝 0 错误，额度未耗尽（最低剩 1）；read 13 次全部成功，RAG 命中片段 151（命中块 100＋父级引导 51）、关联入口提示 79 条全部写入；内容级送达正文累加 48,556 字符、去重 28,845，重复主要来自命中块与 read 原文重叠。记录见 docs/exp/exp-progressive-disclosure-glm-low-default.md；未做必答语义核查，不主张质量或因果，不登记 bench/results 快照、不改质量基线表。
- **分阶段 hitrate**：第 7 步已完成纯迁移与试点两个时点的 `hitrate --topk 3,5,10`——纯迁移时点见 docs/exp/exp-hitrate-migration-scope-compare.md 与 docs/exp/exp-retrieval-hit-diff-migration.md，试点时点与复验见本笔记第 7 步段；本步未重复运行，据此与端到端契约、真实观测一并闭合验收清单第 13 项。
- **清理**：一次性统计脚本与汇总 JSON（dev-temp/work/pd-real-run/）经 tooling 显式清单预览并删除；真实运行目录按既有惯例保留在 bench-runs（不入库，供后续核查），未新增入库运行产物，未新增 bench/results 快照。

## 债务记录

### 2026-09-16 — PLK-1 关联载荷体积（已关闭）

- **原债务**：bench/src/tool-executor.ts 的 `readLinkedFactsOperation` 首版不设分页或截断，一次展开全部登记对象，体积可能超过 maxContextChars（记录见 docs/plan-prose-linked-knowledge-notes.md「债务记录」）。
- **关闭依据**：本批以 read 取代该入口，关联事实按完整对象分页（facts_offset/next_facts_offset），单对象放不下整页时显式报容量错误；`readLinkedFactsOperation` 与代码锚点 `TODO(tech-debt) PLK-1` 一并删除，不再存在无分页的关联展开路径。对应契约与用例见本笔记「第 4 步（分批之二）」。
- **关闭记录**：同步记入 docs/plan-prose-linked-knowledge-notes.md 债务记录（该计划为债务原属记录）。

### 2026-09-15 — 关键词目录文本压缩（IDX-1）
- **债务**：关键词目录约 1.75 万字符的重复说明文本压缩未纳入本计划；本计划只交付注入开关（默认关闭）并把压缩 stash 排除在外。代码锚点：bench/src/catalog.ts 顶部 `TODO(tech-debt) IDX-1`。
- **未来偿还**：成本或质量试验表明不划算时评估压缩呈现，须保持覆盖与入口如实；入口见 docs/inbox.md 对应条目。

## 意外发现

### 2026-09-15 — 「16 个超 6,000 字符小节」的归属经复算确认
- **发现**：用当前 `buildSectionDirectory` 复算，正文超 6,000 字符的小节共 16 个、最大 17,898 字符，全部位于 references（技能-\*×2×7 份＋技能等价组 1＋名册 1），与 plan 架构分析的表述一致；迁移后这些小节不再属于模型原文阅读目录，故 read 的容量测试不能沿用该分布。
- **影响**：无需更新 plan；实施时按迁移后的实际分布重测容量，不把旧盘点当作迁移后基线。

## 阻塞与解决

（暂无）

> ✅ 已完成于 2026-09-16
