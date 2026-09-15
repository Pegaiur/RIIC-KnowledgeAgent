# 渐进披露实施计划

> 创建日期：2026-09-15
> 状态：施工中
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
- 本轮计划转换仅交付文档与决策，不执行功能实现、文件迁移、提交、合并或付费运行。

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
- 同 HEAD 的关闭全文扩展一轮 read_section 5 次，其中 4 次取得新增内容；开启的两轮均为 0 次。必答计数与费用没有稳定改善方向。共同遗漏不能证明与开关无关，也不能全部归因为技能文本未送达。
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

- [ ] ADR-021/022 在编码前落决策并与索引一致，实施笔记创建并记录版本与授权例外。
- [ ] 技能注记与同描述依据按卡 v8 投影/渲染，名册边界声明送达，旧内容与查询语义逐字段核对。
- [ ] 11 份 raw、2 份 guides、数据源移除和 references 撤销完成，来源与缺口记录保留在文档轨道。
- [ ] 读取、生成、观测脚本、夹具、manifest、当前语料/spec/规则/导航同步；旧参数退役与新范围留档验证完成。
- [ ] prose-links v2、必填 scope、概念定位、精确技能投影及当前 v1 标注迁移完成。
- [ ] read 替代旧工具，双偏移、容量、next_call、错误与预算契约全覆盖，PLK-1 按规则收束。
- [ ] read/RAG 实际范围与对象送达接通 trace、records、meta/report、inputs、snapshot，历史缺字段和旧名称兼容通过。
- [ ] expandFulltext 默认关闭及显式回退有效，必要 ID 优先，原有 query facts 附带契约保持。
- [ ] injectKeywordCatalog 默认关闭，CLI/fallback/目录生成及三处配置留档同步，未应用压缩 stash。
- [ ] 全部延后项转绿：gold 定位分离与 26 键迁移、白名单/完整性断言、目录一致性和两份基线用途/口径处置完成。
- [ ] 指定散文试点与组合小节审阅、精确关联及概念标注完成，gold/spec/目录随批更新并记录范围变化。
- [ ] pnpm run typecheck、全套 pnpm run test、reference-projection、prose-terms、catalog --check、validate、gold 校验和 dry 全部通过。
- [ ] 零费用端到端契约、分阶段 hitrate 和一轮真实模型观测完成，费用授权与结果记录完整，不设质量达标线。
- [ ] 文档结构/引用审查完成，临时产物按 scripts/INDEX.md 处理；验收清单全部勾选后执行 release/archive-plan 归档本计划，再运行 node scripts/verify.mjs merge -- --base main。

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
