# 实施笔记：R5 事实查询（facts-first：LLM 转录记录卡 + 查询 tool）

> 对应 spec：docs/plan-hybrid-facts.md
> 开始日期：2026-09-03

## 决策偏离
> spec 中没有提到，但在实施中做出的重要决策

### 2026-09-03 — 首切片收敛为「机械字段 + 5 标杆条目」，TDD 先行
- **背景**：plan 步骤 1/2 需「记录卡字段定性」「转录脚本 + references 解析器 + 程序化核对断言 + fixture 单测」。记录卡含机械字段（可程序化断言）与语义字段（需 LLM/人工）两类，后者无法 TDD。
- **选项**：
  - A: 先搭 LLM 转录脚本（含 API 调用）——无法 TDD、依赖密钥、成本不可控；
  - B: 仅做机械字段解析器 + 核对断言 + 首批 5 干员标杆条目（fixture），语义字段由后续 LLM 转录 + 人工抽检接管（推荐）；
  - C: 直接人工转录全量 425 干员卡——工作量越界。
- **决策**：B。用 TDD（先写 fixture 断言）落地 `parseNameRow`（名册行 → 机械字段）与 `verifyMechanicalCard`（0 差异核对），首批 5 个干员作为标杆条目；语义字段（aliases/skillGroups/skills/notes）作为 fixture 基准值一并提供，供 LLM 转录 + 人工抽检对照。符合 plan「记录卡运行时内存生成」「断言单一实现双消费」。
- **影响**：本轮不接入 bench 工具（plan 步骤 5）、不改 `config.corpusDir`（config.ts 的 R5 债务注释仍指向 facts-first 重建）；机制字段类型 `ToolId`/`isRetrievalTool` 未扩展，避免触发 ADR。

### 2026-09-03 — 记录卡字段定稿 + 字段-来源对照表（对应 plan 步骤 1 验收）
- **背景**：plan 步骤 1 要求字段清单 + 字段-来源对照表定稿，作为转录/核对的共同口径。
- **决策**：字段 `canonical / aliases / rarity / class / rooms / groups / skillGroups / skills[]（name / unlockType / target / effectText）/ notes`；机械字段仅 5 项（canonical/rarity/class/rooms/groups）参与 0 差异断言，其余为语义。来源对照如下（只作取数与抽检参考，不落到卡内）：

| 字段 | 来源 | 类别 | 0 差异核对 |
| --- | --- | --- | --- |
| canonical | 名册.md 首列 `- 标准名 | …` | 机械 | 是 |
| rarity | 名册.md 第 2 列（☆N） | 机械 | 是 |
| class | 名册.md 第 3 列（职业） | 机械 | 是 |
| rooms | 名册.md 第 4 列（`、` 分隔） | 机械 | 是 |
| groups | 名册.md 第 5 列（`、` 分隔，可为空） | 机械 | 是 |
| aliases | 歧义.md（子串对/简称合称/含称）+ 俗称（2026-09-03 废弃散文注释） | 语义 | 否（人工抽检） |
| skillGroups | 类别.md「技能组」 | 语义 | 否 |
| skills[].name / unlockType | 技能-*.md `### 干员` 下 `- **解锁方式**「名称」:…` | 机械（可程序化预填） | 本轮 fixture 基准值提供 |
| skills[].target / effectText | 技能分片原文（`〔标签/作用产物〕` 与 `：`后效果句） | 语义（LLM 转录） | 否 |
| notes | 歧义.md + 代偿备注（人工） | 语义 | 否（人工抽检） |

## 实现调整
> spec 中有描述，但实际实现方式不同

### 2026-09-03 — skills[].target 保留原文而非结构化拆分
- **spec 原文**：卡字段 `skills[]（name / unlockType / target / effectText）`，未定义 target 粒度。
- **实际做法**：target 取技能分片行内「〔标签…/作用产物…〕」原文串（如 `通用生产；作用产物：赤金/作战记录/源石碎片`），不拆成结构化键值。
- **原因**：plan 非目标「不做效果字段数值化」；标签与作用产物保原文，避免为 5 个标杆预先设计超过现状的解析。
- **后果**：v3 若做 minEff 数值化再拆分；本轮无下游影响。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项

### 2026-09-03 — 技能字段未程序化解析（fixture 基准值承载）
- **债务**：5 标杆条目的 `skills[].name/unlockType` 为人工从 references 转录的基准值，未实现从技能分片程序化提取与核对；`target/effectText` 属语义本应 LLM 转录，未覆盖。
- **未来偿还**：plan 步骤 2 落地全量转录前，补 `parseSkillRow`（技能分片 → name/unlockType）并纳入机械核对（0 差异），代码处 `TODO(tech-debt) R5-1` 登记，清偿后 fixture 仅留语义基准。

## 意外发现
> 实施中发现的 spec 未覆盖的依赖/边界/风险

### 2026-09-03 — skillGroups 口径存在歧义：「技能组」vs「规则说明」
- **发现**：类别.md 中「自动化·α/·β」只列入「规则说明（25 条）」，不在「技能组（5 条）」；技能联动信息散落两处。
- **影响**：若 `skillGroups` 仅按「技能组」归集会漏掉自动化这类跨干员联动。本轮 fixture 未含此类（森蚺 skillGroups=[]），不影响断言；但 plan 步骤 1 对照表需在 v3 明确口径，或补充「规则说明里的技能联动」。值得回馈 spec。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

- 暂无。

## 进度快照
- 已落地：`bench/src/facts/card.ts`（记录卡类型 + 机械字段常量）、`bench/src/facts/mechanical.ts`（parseNameRow / verifyMechanicalCard）、`bench/src/facts/fixtures.ts`（5 标杆条目）、`bench/tests/facts.test.ts`（TDD）。
- 验证：`pnpm run typecheck` 通过；`pnpm run test` 9 文件 70 用例全通过（含 facts 10 用例）。
- 未做（按用户「不做更多」）：plan 验收清单除步骤 1 部分、步骤 2 解析器/断言/5 fixture 外，其余（转录脚本 LLM 调用、P0.4 参考要点重制、人工抽检、bench 工具接入、评测、结论）均未启动；plan 清单 checkbox 未勾选（避免误标完成）。
