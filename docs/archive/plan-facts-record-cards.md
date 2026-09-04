# facts-first 全量记录卡分批录入计划

> 创建日期：2026-09-03
> 定稿日期：2026-09-04
> 状态：已完成
> 上游：`docs/plan-hybrid-facts.md`（R5 facts-first）；`knowledge/references/`（唯一原始事实源）
> 关系：本计划细化并取代上游计划中“全量记录卡转录、人工抽检与运行时卡数据源”的具体实现；其余评测目标与边界仍以上游计划为准。确定性源解析取代上游的全量 LLM 转录选型，理由与边界见 `docs/adr/ADR-002-facts-record-card-source.md`。

## 目标

把 facts-first 从 16 张 fixture 推进到 425 名干员的全量记录卡：直接解析 `knowledge/references/`，在内存中规范化为“干员定义、技能事实、技能持有关系、类别关系”，叠加独立的人工优化层后，确定性拼装为 `RecordCard[]` 供现有查询 store 使用。机械字段和技能关系由解析器从稳定的 references 格式直接提取；语义判断不在本轮扩张为 LLM 转录链路。

录入和人工优化按设施分批完成；全量最终门禁通过前，运行时继续使用现有 fixture，不让半成品数据进入查询链路。

## 非目标

- 本轮不实现别名、简称、合称、模糊匹配与交互式消歧；`歧义.md` 留待对应查询能力落地时接入。
- 不把技能效果拆成数值、条件树或机制 DSL，不实现效率计算与阵容推荐。
- 不把同效果文本继续抽成独立 `EffectDefinition`；技能名仍是查询身份的一部分，等价关系以 `技能等价组.md` 为准。
- 不接入 Steward JSON、RIIC-Web 等上游；不重建 references 再生脚本。
- 不引入数据库、新第三方依赖、CRUD、版本化资产或跨模块公共接口。
- 人工优化只改善表达、补充已确认说明，不得新增 references 无法支持的事实判断；体系评价继续后置 judgments/散文层。
- 本轮只对当前 references 的明确格式做必要断言并快速失败，不为未出现的格式变体、数据库或通用容错框架预先设计防御；错误消息保持中文。

## 架构分析

### 现状与规模

当前 `RecordCard` 把干员机械字段、技能文本和备注内嵌在同一对象中。全量复制会造成共享技能重复、升级替换关系隐含在字符串里，也无法保证多设施查询的 `room` 与 `termQuery` 命中同一条技能。

对当前 references 的机械盘点结果：

- 名册包含 425 名干员；9 个技能分片覆盖同一批 425 人，无缺失、无孤儿。
- 9 个分片共有 586 个“干员 × 设施”小节、913 条技能持有实例；名册设施集合与分片推导集合逐人 0 差异。
- 913 条技能行均符合统一单行结构，可无损解析解锁文本、技能名、可选 `buffId`、效果原文和方括号注记。
- 以“设施 + 技能名 + 效果原文 + 原始注记”归并得到 705 个查询用技能事实，其中 627 个只被一名干员持有；因此逻辑归一化有价值，但不值得让人工同步维护技能表和引用表。
- 145 条实例显式展示 `buffId`，仅有 76 个不同值，且同一值可被多名干员持有；`buffId` 只能作为持有关系的可选来源字段。
- 有 167 条“提升，替换……”关系；其中丰川祥子、协律、焰影苇草存在同干员、同设施、同技能名但效果不同的升级档，替换边必须指向具体持有实例。
- references 页头所称“747 个技能”是上游技能统计口径，不等同于 913 条持有实例或 705 个查询技能事实，三者分别校验、不得混用。

### 分层原则

```text
references 原文
    ↓ 无损解析与机械核对
OperatorDefinition + SkillFact + OperatorSkillGrant
    ↓ 类别/等价关系拼装
OperatorGroup + SkillCategory + SkillEquivalenceGroup
    ↓ 人工覆盖（独立文件，不改生成事实）
SkillCuration + GrantCuration + OperatorCuration
    ↓ 确定性投影
RecordCard[] → CardStore
```

底层始终保留 references 原文。生产查询视图只输出最终选定文本：有效人工优化存在时使用优化文本，否则回退原文；原文核对和回归测试不受人工优化影响。

### 规范化粒度

```ts
interface OperatorDefinition {
  id: string
  canonical: string
  rarity: string
  profession: string
  declaredRooms: RoomId[]
  factionGroups: string[]
}

interface SkillFact {
  id: string
  room: RoomId
  name: string
  rawEffectText: string
  rawAnnotationText: string
  tags: string[]
  products: string[]
  professions: string[]
  referencedTerms: string[]
}

interface OperatorSkillGrant {
  id: string
  operatorId: string
  skillId: string
  unlockText: string
  unlockKind: 'initial' | 'elite-unlock' | 'level-unlock' | 'upgrade'
  elite?: number
  level?: number
  replacesGrantId?: string
  sourceOrder: number
  sourceBuffId?: string
}
```

`SkillFact` 是“查询所需的技能事实呈现”，不声称还原上游技能实体。ID 与覆盖指纹使用 UTF-8 SHA-256：先按文档声明顺序构造无空格 JSON 数组，再计算哈希；`skillId` 的输入为 `[room, name, rawEffectText, rawAnnotationText]`，`grantId` 的输入为 `[operatorId, skillId, unlockText, unlockKind, elite ?? null, level ?? null, sourceBuffId ?? null]`，`expectedRawHash` / `expectedGrantHash` 使用对应未加前缀的数组哈希。原文或持有关系变化会使 ID/指纹变化并使对应人工覆盖失效，是要求重新复核而非静默沿用旧优化的安全机制。

替换关系属于某干员的升级路径，故使用 `replacesGrantId`，不得用全局 `replacesSkillId`。解析时仅允许指向同干员、同设施、当前位置之前且名称匹配的持有实例。

### 人工优化层

人工优化与自动解析结果分文件维护，避免 references 重解析覆盖人工工作：

```ts
interface SkillCuration {
  skillId: string
  expectedRawHash: string
  effectText?: string
  notes?: string
}

interface GrantCuration {
  grantId: string
  expectedGrantHash: string
  notes?: string
}

interface OperatorCuration {
  operatorId: string
  notes?: string
}
```

- `SkillCuration`：对同一技能事实的所有持有者均成立的表达优化和技能说明。
- `GrantCuration`：仅对某干员的解锁、提升、替换关系成立的说明。
- `OperatorCuration`：干员整体备注；体系评价不进入本层。
- `aliases` 本轮保留兼容字段但不录入、不参与索引；别名、简称、合称和消歧另立方案。
- 优化字段使用 `undefined` 表示未提供；允许的优化文本必须非空，不以真假值隐式判断。
- `expectedRawHash` / `expectedGrantHash` 不匹配时最终门禁失败，要求人工重新核对。

拼装器提供两种确定性模式：

- `raw`：只使用原文，用于真源核对、fixture 回归和问题定位。
- `curated`：有效优化优先、原文兜底，用于生产查询；输出卡无需重复携带原文以控制 token。

### 类别与等价关系

以下关系分别建模，不合并成通用 `groups.ts`：

- `OperatorGroup`：`类别.md` 的 28 个干员组；与名册 `factionGroups` 双向核对。
- `SkillCategory`：`类别.md` 的 5 个技能类别。
- `SkillEquivalenceGroup`：`技能等价组.md` 的 82 个同效不同名集合。

等价组成员必须定位到精确的 `SkillFact`，至少使用设施、技能名、效果与持有者/解锁档位共同消歧；不得只按技能名连接。“澎湃紊流”同时出现在 10% 和 15% 两个等价组，是必须覆盖的回归样例。

### 查询投影

拼装后的兼容 `RecordSkill` 至少携带：

```ts
interface RecordSkill {
  grantId: string
  room: RoomId
  name: string
  unlockType: string
  effectText: string
  target: string
  notes?: string
  replacesGrantId?: string
  skillCategories: string[]
  equivalenceGroupId?: string
  equivalenceSkillNames?: string[]
}
```

`query_operators` 同时带 `room` 与 `termQuery` 时，技能名、效果、标签、技能级备注、技能类别和等价组成员名必须在同一 `RecordSkill` 上满足，不能用干员的 A 设施满足 room、B 设施技能满足关键词；多设施卡的卡级技能组/备注不得绕过该作用域。序列化器按查询条件裁剪到相关设施/技能，避免无关技能占用上下文。

## 实施方案

### 1. 类型、解析器与精确核对

- 定义上述规范化实体、人工覆盖和投影类型。
- 将名册核对从 `includes()` 升级为逐字段及集合完全相等。
- 实现技能分片无损解析：`## 按干员` 下任何 `###` 干员标题或技能 bullet 未消费均立即失败；`## 技能 → 持有者` 是同一文件的生成索引，解析器也必须消费并与前段按“技能名 + buffId + operator + 解锁档位”生成的索引逐项核对，不把索引行重复计入 grant。
- 结构化解锁类型并解析替换边；同时保留 `unlockText` 原文。
- `RecordSkill.target` 直接取技能行方括号内的原文（无方括号时为空），不得由 `tags/products/professions/referencedTerms` 重新拼接。
- 以现有 16 张 fixture 和三组同名升级技能建立 TDD 基线；按“先失败用例、后最小实现、再重构”推进，后续各批次沿用同一回归集。

验收：解析格式 100% 覆盖，原始字段可逐字回渲染；重复、孤儿和歧义替换均给出中文错误。

### 2. 按设施完成九个事实批次

每个批次直接读取对应 references 分片，由同一次解析自动产出 `SkillFact[]` 与 `OperatorSkillGrant[]`；不要求录入者手工维护两张表。

| 批次 | 干员小节 | grant |
|---|---:|---:|
| 办公室 | 32 | 47 |
| 发电站 | 31 | 49 |
| 会客室 | 54 | 91 |
| 加工站 | 78 | 124 |
| 控制中枢 | 65 | 96 |
| 贸易站 | 77 | 120 |
| 宿舍 | 78 | 105 |
| 训练室 | 79 | 135 |
| 制造站 | 92 | 146 |

每批门禁：标题干员全部存在于名册、技能行全部消费、grant 设施等于分片设施、批次 ID 无重复、来源顺序连续、升级替换唯一闭合、原文/注记/显式 `buffId` 可回渲染。批次门禁允许只覆盖部分干员，不执行全局“每卡至少一个技能”。

### 3. 按设施完成人工优化批次

- 为每个设施建立独立 curation 模块，按技能事实维护可选优化文本和技能说明。
- 干员/持有关系备注进入对应独立覆盖表，不回写生成事实。
- 每条人工覆盖记录原文指纹；优化应保持数值、条件、作用对象、叠加/替换语义不变。
- 人工优化允许渐进覆盖，未优化条目在 `curated` 模式下自动回退原文；`aliases` 继续为空，不因本批次引入别名查询。

验收：覆盖无孤儿、无重复、无空文本、指纹全部有效；抽检同时展示原文与优化文本供人工比对。

### 4. 类别与等价关系拼装

- 解析 28 个干员组并与名册中的 193 条阵营成员关系逐项核对。
- 解析 5 个技能类别并连接精确技能事实。
- 解析 82 个技能等价组，利用设施、效果、持有者和解锁档位消歧。

验收：所有成员均有落点，无孤儿或仅凭技能名产生的多义连接。

### 5. RecordCard 投影与查询修正

- 实现 `raw` / `curated` 两种拼装模式。
- `RecordSkill` 增加设施和 grant/替换信息；store 继续消费拼装后的 `RecordCard[]`。
- store 构建前验证 canonical 唯一，禁止 `Map.set` 静默覆盖；等价组成员名展开到同一技能索引，支持按组内任一名称 lookup 全部持有者。
- 修正多设施 `room + termQuery` 串线，并按命中范围序列化技能。
- raw 与现有 fixture 的回归比较只比较兼容字段（含 `target` 原文）；新增 `grantId`、`room`、替换边、类别和等价组字段单独按规范化真源断言，不要求旧 fixture 预先携带新元数据。
- 保持 `lookup` / `query_operators` 对外工具名和 `runQuery` 调用签名不变。

验收：现有测试兼容通过；新增多设施串线、同名升级、等价组多义名、raw/curated 回退测试。

### 6. 全量门禁与运行时切换

只有以下最终门禁全部通过，才将 `getCardStore()` 从 16 张 fixture 切换到全量拼装结果：

- 425 个干员，无缺失、无重复。
- 9 个设施批次齐全，共 586 个干员设施小节、913 条 grant。
- 名册 `declaredRooms` 与 grant 推导设施集合逐人完全相等。
- 167 条替换边全部闭合且无环。
- 28 个干员组、193 条成员关系、5 个技能类别、82 个等价组全部通过核对。
- 所有人工覆盖无孤儿且原文指纹有效。
- 16 张 fixture 与 `raw` 拼装结果的兼容字段在历史 target 缩写、技能名引号差异归一化后逐项一致；全量 raw 仍保留 references 原文，新增元数据按规范化真源单独通过断言，经批准的表达差异只出现在 `curated` 投影。

切换后执行 facts dry run 与事实题回归，确认工具统计、序列化限额和成本口径未被破坏。

## 分阶段过审与提交

每个实施阶段均按以下顺序收束：先补失败测试，再做最小实现；运行该阶段验收命令和全量 `pnpm run typecheck` / `pnpm run test`；由独立只读审查核对实际 diff、测试证据与计划边界；将真实偏离、调整、债务、发现或阻塞追加到实施笔记；最后只暂存本阶段文件并通过 `commit-convention` 创建一个中文约定式提交。审查未通过或测试失败时不提交，修复后重新审查。

## 验收清单

- [x] P1：规范化实体、名册/单设施解析器、技能索引核对与严格机械字段断言落地
- [x] P2：九个设施事实批次统一加载、全量计数与设施/替换门禁落地
- [x] P3：九个独立 curation 模块、原文指纹校验与 raw/curated 回退框架落地
- [x] P4a：28 个干员组、193 条成员关系与 5 个技能类别精确解析并双向核对
- [x] P4b：82 个技能等价组按设施、效果、持有者与解锁档位精确拼装
- [x] P5：RecordCard raw/curated 投影、同设施查询与按命中范围序列化落地
- [x] 规范化实体、人工覆盖和 RecordCard 投影类型落地
- [x] 名册及技能分片解析器完成，原文 100% 消费并可回渲染
- [x] 机械字段逐字段/集合 0 差异核对完成
- [x] 167 条替换关系全部唯一闭合，同名升级回归通过
- [x] 办公室事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 发电站事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 会客室事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 加工站事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 控制中枢事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 贸易站事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 宿舍事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 训练室事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 制造站事实批次与人工优化框架完成（当前人工覆盖 0 条）
- [x] 28 个干员组、193 条成员关系、5 个技能类别、82 个等价组完成精确拼装
- [x] `raw` / `curated` 双模式及优化失效检测完成
- [x] 多设施 `room + termQuery` 串线修复，查询序列化按命中范围裁剪
- [x] P6：全量门禁通过并将 store 从 16 张 fixture 切换至 425 张拼装卡
- [x] facts dry run 与事实题回归通过，结果记入实施笔记
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过

## 关联 ADR

- [x] ADR-002 记录确定性源解析取代全量 LLM 转录的选型与边界
- 关联 ADR：`docs/adr/ADR-002-facts-record-card-source.md`
- 若实施中需要数据库、新依赖、持久化公共技能 ID 或跨模块接口变更，先按 `docs/rules/document-lifecycle.md` 补充 ADR。

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan docs/plan-facts-record-cards.md --apply）时替换此行，标记完成日期 -->

## 实施纪要

# 实施笔记：facts-first 全量记录卡分批录入计划

> 对应 spec：`docs/plan-facts-record-cards.md`
> 开始日期：2026-09-04

## 决策偏离

### 2026-09-04 — 机械事实改用确定性源解析
- **背景**：上游计划原定全量 LLM 转录；当前 references 的 9 个技能分片已提供稳定的干员段落、解锁/替换句式和生成索引，直接解析可覆盖机械关系并保留效果原文。
- **选项**：
  - A: 延续全量 LLM 转录，机械字段再核对。
  - B: 用确定性解析生成机械事实与关系，人工优化只处理表达，不新增事实（采用）。
- **决策**：采用 B，并以 ADR-002 记录为上游选型修订；本轮不引入 LLM 转录链路。
- **影响**：上游 plan 的记录卡实现入口改指向本计划；语义字段只保留原文或独立人工覆盖，别名/消歧后置。

## 实现调整

### 2026-09-04 — 初始解锁档位按索引语义兼容两种写法
- **spec 原文**：结构化解锁类型并解析解锁档位；索引与干员段落按解锁档位逐项核对。
- **实际做法**：`初始解锁` grant 的索引核对同时接受 `精0` 与 `Lv.30`；`精英 N` 和 `等级 N` 的非初始解锁仍严格匹配对应档位。
- **原因**：references 当前生成索引对不同低星/特殊干员混用 `精0` 与 `Lv.30` 表示初始档位（例如制造站分片中的卡缇、克洛丝与 Castle-3），两者在该语义下等价。
- **后果**：保留源索引原文，不强行改写为统一显示；未来若出现新的非初始档位写法，解析器仍会失败并要求补回归用例。

### 2026-09-04 — 明确分片双区段的解析边界
- **spec 原文**：技能分片无损解析，任何 `###` 标题或技能 bullet 未消费即失败。
- **实际做法**：`## 按干员` 作为 grant 唯一来源；`## 技能 → 持有者` 作为生成索引消费并与前段解析结果逐项核对，不重复生成 grant。
- **原因**：同一文件同时包含 913 条持有实例和 747 条上游索引技能统计，两个区段语义不同，必须分别计数。
- **后果**：批次门禁同时报告 grant、索引条目和归并 SkillFact 三种口径；不把 747 误当 grant 数量。

## 债务记录

### 2026-09-04 — 别名与消歧后置
- **债务**：本轮 `aliases` 保留兼容字段但不录入、不索引。
- **编号**：R5-2。
- **未来偿还**：建立独立别名/合称/消歧方案并补充 references 核对口径时偿还；代码落地时登记对应 TODO 编号。

## 意外发现

### 2026-09-04 — 旧 fixture 与新投影字段不对称
- **发现**：新投影需要 grant/room/替换/类别/等价组元数据，而现有 16 张 fixture 只有兼容字段。
- **影响**：raw 回归改为兼容字段子集逐字段比较；新增元数据单独按规范化真源断言，已回馈本计划验收口径。

### 2026-09-04 — 生成索引的初始档位存在两种表示
- **发现**：同一设施分片的“技能 → 持有者”索引既使用 `精0`，也使用 `Lv.30` 表示初始解锁；上游统计的 747 条索引技能不是 grant 数量。
- **影响**：已纳入解析器语义匹配和 TDD 回归；未改变 913 条 grant 的计数口径。

## 阻塞与解决

### 2026-09-04 — 计划基线审查发现选型与口径缺口
- **症状**：独立审查指出上游选型未闭环、双区段解析范围不明、fixture 比较口径冲突、aliases 与非目标矛盾。
- **根因**：细化计划新增了实现粒度，但未同步上游决策、兼容投影和分片索引语义。
- **解决方案**：补 ADR-002；在两份 plan 中明确确定性解析边界；定义技能索引的核对消费方式、raw 兼容字段比较和 aliases 后置边界。
- **预防**：后续阶段提交前同时核对本计划、上游计划、ADR 与测试验收，审查未通过不提交。

## 阶段进度

### 2026-09-04 — P1 类型、解析器与精确核对
- **完成**：新增规范化实体、名册解析、单设施技能分片解析、双区段索引核对、SHA-256 内容指纹、技能行回渲染；名册机械核对改为字段/集合精确比较。
- **证据**：`pnpm run typecheck` 通过；定向测试 12 个通过；全量 `pnpm run test` 共 113 个通过。
- **未完成**：尚未接入全量运行时 store，尚未完成 9 个设施批次、类别/等价关系、curated 覆盖和查询投影。

### 2026-09-04 — P2 九个设施事实批次
- **完成**：新增显式加载器，按固定设施顺序读取名册与 9 个技能分片，统一合并 SkillFact/grant，并执行全量重复、设施集合、替换边闭合/无环门禁。
- **证据**：`pnpm run typecheck` 通过；定向测试 12 个通过；全量事实断言为 425 名干员、586 个干员设施小节、913 条 grant、747 条索引条目、705 个 SkillFact、167 条替换边；每个 grant 均能回渲染命中其分片原文。
- **未完成**：运行时仍使用 16 张 fixture；人工优化、类别/等价关系和 RecordCard 投影尚未接入。

### 2026-09-04 — P3 人工优化框架
- **完成**：新增九个设施独立 curation 模块、统一注册表、SkillFact/grant 原文指纹校验和 raw/curated 文本选择；优化字段明确区分“未提供”与“空文本”。
- **证据**：`pnpm run typecheck` 通过；定向测试 3 个通过；空覆盖批次通过校验，有效覆盖、指纹失效、孤儿和空文本均有测试。
- **真实边界**：当前没有经过人工确认的表达优化素材，九批覆盖表均为空；因此本阶段完成的是可校验框架和安全回退，不宣称人工优化内容已完成。

### 2026-09-04 — P4a 类别与技能类别
- **完成**：新增 `类别.md` 指定区段解析；28 个干员组逐成员核对名册，5 个技能类别按唯一 SkillFact 名称连接并拒绝未知/多义落点。
- **证据**：`pnpm run typecheck` 通过；定向测试 3 个通过；干员组成员合计 193 条，名册阵营字段与类别成员双向一致。

### 2026-09-04 — P4b 技能等价组
- **完成**：新增 `技能等价组.md` 解析；82 组均按设施、效果原文、持有者和解锁档位连接到 SkillFact，等价组 ID 使用稳定指纹。
- **边界调整**：同名同效果但 `buffId` 不同的“作战指导录像”存在两个 SkillFact；持有者列表可解释两者，因此该等价组保留两个精确 SkillFact ID，不把同名强行压成单一落点。“澎湃紊流”的 10% 与 15% 两组保持独立。
- **证据**：`pnpm run typecheck` 通过；定向测试 2 个通过；全量测试 15 个文件、136 个测试通过。

### 2026-09-04 — P5 RecordCard 投影与查询修正
- **完成**：新增确定性 `RecordCard` 投影；raw 使用事实原始注记，curated 使用有效 SkillCuration 并回退原文，grant 的设施、替换边、技能类别和等价组元数据均保留。旧 fixture 字段保持兼容，新元数据字段允许缺省。
- **查询修正**：`room + termQuery` 只在同一设施技能范围内匹配；序列化器新增可选过滤条件，按设施和命中技能裁剪输出；store 构建拒绝重复或空 canonical。兼容旧多设施 fixture 的未标注技能时选择不命中，避免以未知设施归属换取误报，待 P6 全量投影后消除该兼容边界。
- **证据**：`pnpm run typecheck` 通过；全量测试 16 个文件、141 个测试通过。
- **未完成**：运行时仍未切换至全量卡；425 张卡的最终门禁、facts dry run 与事实题回归留在 P6。

### 2026-09-04 — P6 全量门禁与运行时切换
- **完成**：最终门禁核对 425 名干员、9 个设施分片、586 个干员设施小节、913 条 grant、167 条替换边、28 个干员组/193 条成员关系、5 个技能类别和 82 个等价组；raw 对 16 张历史 fixture 做了已声明的 target 缩写/技能名引号兼容归一化，未修改全量原文投影口径。
- **切换**：`getCardStore()` 首次调用执行全量门禁并使用 425 张 curated 卡；fixture 仅用于最终兼容回归。事实工具仍保持 `lookup` / `query_operators` 和 `runQuery` 签名不变。
- **验证**：`pnpm run typecheck` 通过；全量测试 17 个文件、144 个测试通过；`pnpm run build` 通过；facts dry run 执行 `bench/questions.json` 全部 20 题（F01–F10、S01–S08、G01–G02），60 次 dry 调用、0 截断，工具统计为 lookup 20 次、query_operators 20 次，总成本 ¥0.1528（dry 模拟口径）。
- **边界**：上述 dry run 验证的是工具链路、计数和成本管线，不替代 LLM 答案人工核查；上游计划中的 P0.4 参考要点重制与 12+5 题人工判定仍未宣称完成。

### 2026-09-04 — P7 复审问题修复
- **修复**：`SkillCuration.notes` 现在进入 curated `RecordSkill.notes`，raw 仍不携带人工备注；等价组成员名复制到技能索引元数据，`lookup` 可按组内任意技能名返回全部精确持有者。
- **修复**：设施化 `termQuery` 统一通过同设施技能匹配技能类别和技能级备注；多设施卡的卡级 `skillGroups`/`notes` 不再绕过设施作用域，单设施旧 fixture 保留兼容。
- **证据**：新增三类回归覆盖技能备注、`裁缝·β` 四名持有者和类别/备注设施隔离；定向测试 28 个通过，随后执行全量验证。

> ✅ 已完成于 2026-09-04
