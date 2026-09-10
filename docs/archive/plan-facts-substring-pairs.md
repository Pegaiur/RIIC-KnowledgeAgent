# facts 子串对（短→长）登记计划

> 创建日期：2026-09-10
> 状态：已完成

## 目标

让 `facts_search` 对已确认的干员子串对做确定性查询：查询词恰好等于某个已登记短名时，同时返回短名自身与全部已登记长名；短→长单向、全量返回，不做消歧、不反问。补齐 [facts 别名与集合词条真源计划](plan-facts-term-alias.md) 中明确后置的 31 组子串对，并据此二次修订 [ADR-010](../adr/ADR-010-facts-alias-disambiguation.md)。

## 非目标

- 双向匹配：查长名不反查短名。
- 任意子串扫描、按字符串包含关系自动扩候选，以及历史 lookup 的模糊与合称解析。
- 按设施或上下文择一、反问、指代确认提示及相关回归；不修改 `knowledge/AGENTS.md` 与 [歧义](../../knowledge/references/歧义.md) 正文。
- 技能、阵营、设施、职业名的子串对；简写合称（德狼、能蕾、银崖、孑拉德）。
- RAG 排序、切块、预算、提示词与 agent loop；付费运行；新增哈希字段。

## 架构分析

[歧义](../../knowledge/references/歧义.md) 第一节的 31 组「短名 ⊂ 长名」由 `scripts/build_refs.py` 生成，是**过滤子集**而非名册包含全集——名册中 `陈`、`阿`、`红` 等同样存在名称包含关系，却未列入。该文件为生成物，只能作为名称证据线索，不作运行时源。

`facts_search` 现有的 `ResolutionPath` 已有 exact / alias / combo / legacy / rejected 五类；[store](../../bench/src/facts/store.ts) 顶部明确「不做模糊或子串兜底」。子串对需要一个显式的、可校验的登记入口作为新路径类别接入，而不是放宽为任意子串匹配。同时，部分长名可能已被既有阵营精确命中覆盖（`能天使`、`嘉维尔` 的官方术语组包含其长名），需要产出条件避免冗余路径。

> 注（2026-09-10）：`legacy` / `rejected` 两类路径已由 [facts legacy 实现清理计划](plan-facts-legacy-purge.md) 删除，当前 `ResolutionPath` 为 exact / alias / substring / combo 四类；本文其余处对旧路径顺序的描述保留当时实施记录。

## 实施方案

按依赖顺序执行；每步写清输入、输出与验收。

### 步骤1：登记类型与校验

- 输入：现有 [terms.ts](../../bench/src/facts/terms.ts) 类型与校验器。
- 产出：新增 `SubstringEntry { text; targets; evidence }`，`TermCurations` 增加 `substrings`；同步 `EMPTY_TERM_CURATIONS` 与数组存在性校验；新增校验：`text` 已 trim 且命中 canonical 干员；`targets` 为非空数组，各项均为存在的 `operator:<canonical>`，先去掉 `operator:` 前缀取得 `targetCanonical`，再校验 `targetCanonical.includes(text) && targetCanonical !== text`；`text` 仅在 `substrings` 内唯一，条目内 targets 不重复；`evidence` 至少一条，沿用既有来源路径与小节校验。
- 验收：违规登记按中文消息失败；允许跨索引同名。

### 步骤2：具名登记 31 条

- 产出：在 [curation/terms.ts](../../bench/src/facts/curation/terms.ts) 登记「子串对核对清单」的 31 组，evidence 统一指向 `knowledge/references/歧义.md` 第一节。
- 验收：31 条与清单逐条一致；不录设施列，不录「可判断 / 必须反问」策略文字。

### 步骤3：索引、查询路径与产出条件

- 产出：`ResolutionPath` 增 `{ kind: 'substring'; term; targets; memberIds; evidence }`；建 `substringsByTerm` 索引；路径顺序固定为 `exact → alias → substring → combo → legacy → rejected`。
- 规则：查询词 trim 后恰等于 `text` 才命中；长名查询不反查短名；短名本身经 exact operator 路径返回。先收集同查询全部非 substring 路径，以其 `memberIds` 并集判断覆盖，包含最终展示顺序位于 substring 之后的 combo / legacy 路径；若该条目所有目标 canonical 均被覆盖，则省略 substring 路径（`能天使`、`嘉维尔` 因此不产出）。否则保留该条目完整 `targets` 与全部目标的 `memberIds`，部分覆盖时也不裁剪为差集；`memberIds` 按输入 cards 顺序排列。判定完成后按固定路径顺序输出；substring 不贡献 `categories`，全局卡片沿用现有去重。
- 验收：31 组命中正确；未登记子串与长名不扩展；产出条件生效。

### 步骤4：序列化与版本

- 产出：`renderResolutionPath` 改 `switch` + `never` 兜底并新增子串分支（形如 `- 子串：临光 → 耀骑士临光；来源：…；命中 N 张记录卡`）；`TOOL_SCHEMA_VERSION` 7→8、`FACTS_RESULT_VERSION` 3→4；工具描述补「短名按登记返回全部长名，不做消歧」；同步修订 [store.ts](../../bench/src/facts/store.ts) 顶部说明与 `TODO(tech-debt) R5-2` 注释。
- 验收：`resolution` 元数据、`matchedCount` / `returnedCount`、`complete`、`hitIds` / `injectedIds`、trace 与落盘一致。

### 步骤5：回归与维护校验

- 测试：31 组逐条正例；未登记子串负例（使用纯未登记串，不用 `骑士`）；长名不反查；`能天使` / `嘉维尔` 不产出子串路径；校验异常；协议与版本；将 `substrings` 纳入 evidence 核验迭代；测试侧固化 31 条清单并做集合相等断言。
- 合成回归：一短对应两个长名；仅一个目标被其他路径覆盖；全部目标被同名 combo 或 legacy 路径覆盖；同词 alias 与 substring 合法重叠。分别断言完整成员、路径保留或省略、固定输出顺序、卡片去重与计数；空 targets 和短名自指目标必须校验失败。
- 迁移：补 `substrings` 到构造 `TermCurations` 字面量的测试，并同步版本断言的全部调用点。
- 验收：`pnpm run typecheck`、`pnpm run test` 通过；待办完成后 `node scripts/doc-check.mjs` 通过；合并前 `node scripts/verify.mjs merge -- --base main`。

## 子串对核对清单（31 组）

锁定实施与验收对象，不把生成文件当运行时事实。短名与长名均须为名册中的 canonical 干员。

| # | 短名 | 长名 |
|---:|---|---|
| 1 | 临光 | 耀骑士临光 |
| 2 | 克洛丝 | 寒芒克洛丝 |
| 3 | 凛冬 | 怒潮凛冬 |
| 4 | 凯尔希 | 凯尔希·思衡托 |
| 5 | 初雪 | 圣聆初雪 |
| 6 | 嘉维尔 | 百炼嘉维尔 |
| 7 | 夜刀 | 麒麟R夜刀 |
| 8 | 安洁莉娜 | 予愿安洁莉娜 |
| 9 | 幽灵鲨 | 归溟幽灵鲨 |
| 10 | 德克萨斯 | 缄默德克萨斯 |
| 11 | 惊蛰 | 司霆惊蛰 |
| 12 | 拉普兰德 | 荒芜拉普兰德 |
| 13 | 斯卡蒂 | 浊心斯卡蒂 |
| 14 | 星源 | 溯光星源 |
| 15 | 星熊 | 斩业星熊 |
| 16 | 杰西卡 | 涤火杰西卡 |
| 17 | 格雷伊 | 承曦格雷伊 |
| 18 | 梓兰 | 焰狐龙梓兰 |
| 19 | 棘刺 | 引星棘刺 |
| 20 | 炎熔 | 炎狱炎熔 |
| 21 | 空爆 | 雷狼龙S空爆 |
| 22 | 能天使 | 新约能天使 |
| 23 | 艾雅法拉 | 纯烬艾雅法拉 |
| 24 | 芙蓉 | 濯尘芙蓉 |
| 25 | 苇草 | 焰影苇草 |
| 26 | 诗怀雅 | 琳琅诗怀雅 |
| 27 | 调香师 | 撷英调香师 |
| 28 | 赫默 | 淬羽赫默 |
| 29 | 送葬人 | 圣约送葬人 |
| 30 | 银灰 | 凛御银灰 |
| 31 | 黑角 | 火龙S黑角 |

## 验证矩阵

| 用例 | 输入及数据 | 必须观察到的结果 |
|---|---|---|
| S1 | 真实「临光」 | exact operator 路径（临光）+ substring 路径（耀骑士临光）；共 2 卡 |
| S2 | 真实「耀骑士临光」 | 仅该长名命中；不反查短名 |
| S3 | 真实「能天使」 | 阵营精确路径含新约能天使；不产出 substring 路径 |
| S4 | 真实「嘉维尔」 | 同上；不产出 substring 路径 |
| S5 | 「光」「德狼」等未登记串 | 不命中长名；未收录或仅既有合法命中 |
| S6 | 合成短名「测试甲」登记「长测试甲」「测试甲乙」，无其他路径覆盖长名 | exact 返回短名，substring 保留两个目标及其全部 memberIds；共 3 卡，按输入卡序输出 |
| S7 | S6 数据，同名 alias 仅覆盖「长测试甲」 | 顺序 exact → alias → substring；substring 仍保留两个目标及完整 memberIds；共 3 张去重卡 |
| S8 | S6 数据，同名 combo 覆盖两个长名；另设同名 legacy 重定向搭配覆盖两个长名的独立用例 | 两个用例均省略 substring 路径，保留 exact 与 combo 或 legacy；共 3 张去重卡 |
| V1 | text 非 canonical、空 targets、目标 canonical 不包含 text、自指目标（临光 → operator:临光）、重复、悬空、缺 evidence | 校验失败，中文消息；text 仅在 substrings 内唯一，跨索引同名合法 |
| P1 | 序列化与 envelope | substring 路径、计数、complete、hitIds/injectedIds 一致；版本 8 / 4 |

## 验收清单

- [x] 登记类型、`substrings` 必填迁移与新增校验完成
- [x] 31 组具名登记与来源核对完成，未登记子串不扩展
- [x] 查询路径、产出条件与卡片去重按契约实现
- [x] 序列化 switch 化、双版本号与工具描述同步
- [x] store 顶部说明与 `TODO(tech-debt) R5-2` 注释同步修订
- [x] 正负例、重叠、异常与协议回归通过
- [x] `pnpm run typecheck` 全通过
- [x] `pnpm run test` 全通过
- [x] `node scripts/doc-check.mjs` 全通过

## 关联 ADR

- [ADR-010](../adr/ADR-010-facts-alias-disambiguation.md) — facts 别名、集合词条真源与同名全部返回契约（本次二次修订纳入子串对）

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->

## 实施纪要

# 实施笔记：facts 子串对（短→长）登记计划

> 对应 spec：docs/plan-facts-substring-pairs.md
> 开始日期：2026-09-10

## 决策偏离
> spec 中没有提到，但在实施中做出的重要决策

### 2026-09-10 — ADR 修订方式
- **背景**：子串条款需要废弃 ADR-010 中「不登记 31 组子串对」的既有决策。
- **选项**：
  - A: 新开一条 ADR（状态「提议」）显式替代 ADR-010 子串条款，ADR-010 保留「已实施」。
  - B: 就地修订 ADR-010，状态暂标「已实施（子串条款待实施）」。
- **决策**：用户裁决采用 B，就地修订 ADR-010。
- **影响**：ADR-010 需同步修订状态行、范围与真源、同名返回、查询级结果、版本边界与备选方案等多处；实现完成后撤销状态括注。独立审查曾倾向 A（避免已实施 ADR 混入未实施条款），此处以用户裁决为准。

### 2026-09-10 — 冗余子串路径处置
- **背景**：`能天使`、`嘉维尔` 的长名已被同查询的阵营精确路径返回，substring 路径卡片去重后无新增成员。
- **选项**：
  - A: 保留路径、卡片去重，仅多一行路径说明。
  - B: 无新增成员则不产出该路径。
- **决策**：用户裁决采用 B。
- **影响**：substring 路径产出前需与同查询其它路径求差集；对 31 组真实数据（1 短 ↔ 1 长）不产生歧义。

### 2026-09-10 — 完整性基准
- **背景**：`scripts/build_refs.py` 不在仓库，歧义.md 为生成物且是过滤子集，无法自动对齐来源。
- **选项**：
  - A: 测试侧固化 31 条期望清单并做集合相等断言。
  - B: 先恢复生成源再自动对齐。
- **决策**：用户裁决采用 A。
- **影响**：名册变动时该清单需人工复核；不得用名册包含关系派生（会误纳 `陈`、`阿`、`红`）。

## 实现调整
> spec 中有描述，但实际实现方式不同

### 2026-09-10 — phase 1 类型与校验（步骤1）
- **spec 原文**：新增 `SubstringEntry { text; targets; evidence }`，`TermCurations` 增加 `substrings`；同步 `EMPTY_TERM_CURATIONS` 与数组存在性校验；新增 text 命中 canonical、targets 非空且去前缀后为真子串、substrings 内名称唯一、条目内 targets 不重复、evidence 至少一条等校验；允许跨索引同名。
- **实际做法**：按 TDD 先在 `bench/tests/facts-terms.test.ts` 补 9 条负例与跨索引同名正例（红），再实现 `terms.ts` 校验分支（绿）；`substrings` 定为必填字段后，同批迁移 4 处 `TermCurations` 字面量（`curation/terms.ts`、`facts-search-resolution.test.ts`、`facts-resolution-executor.test.ts`、`facts-terms.test.ts`），生产登记暂以空数组占位。
- **原因**：必填字段可让后续遗漏登记在编译期暴露；本 phase 只固定数据契约，运行时索引留到 phase 3。
- **后果**：phase 2 只需填充 `TERM_CURATIONS.substrings`；phase 3 按 `SubstringEntry` 契约建索引与产出条件，不需再改类型。
- **验证**：`pnpm run typecheck` 通过；`facts-terms.test.ts` 24 通过；相关 5 个测试文件 125 通过。

### 2026-09-10 — phase 2 具名登记 31 条（步骤2）
- **spec 原文**：在 `curation/terms.ts` 登记核对清单的 31 组，evidence 统一指向 `knowledge/references/歧义.md` 第一节；不录设施列，不录「可判断 / 必须反问」策略文字。
- **实际做法**：新增 `substring` 构造助手与 `substringSection` 常量，按清单顺序登记 31 条；测试侧固化独立的 `EXPECTED_SUBSTRINGS` 做集合相等断言，并把 `substrings` 纳入既有 evidence 文件/小节核验迭代。
- **原因**：完整性以测试侧显式清单为准（名册包含关系会误纳 `陈`、`阿`、`红`），来源小节统一为歧义.md 第一节。
- **后果**：phase 3 的索引直接消费 `TERM_CURATIONS.substrings`，登记数据无需再改。
- **验证**：`pnpm run typecheck` 通过；`facts-curation.test.ts` 28 通过、`facts-terms.test.ts` 24 通过。

### 2026-09-10 — phase 3 索引、查询路径与产出条件（步骤3）
- **spec 原文**：`ResolutionPath` 增 `substring`；建 `substringsByTerm` 索引；路径顺序固定为 exact → alias → substring → combo → legacy → rejected；先收集同查询全部非 substring 路径，以其成员并集判定覆盖，全部目标被覆盖则省略 substring，部分覆盖仍保留完整 targets 与 memberIds。
- **实际做法**：`factsSearch` 由顺序 push 改为分组收集（exact / alias / combo / legacy / rejected）后统一组装，`rejected` 从原 legacy 循环末尾拆出并排到 legacy 之后；以非 substring 路径 memberIds 并集判定覆盖。另因 `substring` 变体加入后 `renderResolutionPath` 的兜底分支会读取 `path.reason`（`substring` 无该字段）导致编译失败，本 phase 顺带加入 substring 渲染分支，switch 化留到 phase 4。
- **原因**：覆盖判定需要看到最终顺序中位于 substring 之后的 combo / legacy，必须先收集再判定；同时保持每阶段可编译。
- **后果**：phase 4 仅需把 `renderResolutionPath` 改为 switch + never、升双版本号、更新工具描述与 store 顶部说明及 `TODO(tech-debt) R5-2` 注释。
- **验证**：`pnpm run typecheck` 通过；facts 相关 6 个测试文件 155 通过。

### 2026-09-10 — phase 4 序列化 switch、双版本号与工具描述（步骤4）
- **spec 原文**：`renderResolutionPath` 改 switch + never 兜底并新增子串分支；`TOOL_SCHEMA_VERSION` 7→8、`FACTS_RESULT_VERSION` 3→4；工具描述补「短名按登记返回全部长名，不做消歧」；同步修订 store 顶部说明与 `TODO(tech-debt) R5-2` 注释。
- **实际做法**：switch + `never` 兜底，别名与子串共用 `renderNamedTargetPath`；双版本号与工具描述同步升级；store 顶部说明区分「不做模糊兜底」与「子串仅按人工登记做确定性展开」；R5-2 注释改写为「子串已按登记恢复、合称与模糊未恢复」。新增真实「临光」executor 回归，验证 substring 路径进入 `resolution`、正文与计数。
- **原因**：版本升级与调用链迁移同批完成，消除阶段间协议版本不一致窗口；用真实数据覆盖序列化链路。
- **后果**：phase 5 补齐 S1–S5 其余真实/负例、协议与版本回归，并完成维护门禁与计划收尾。
- **验证**：`pnpm run typecheck` 通过；7 个测试文件 158 通过。

### 2026-09-10 — phase 5 回归、维护校验与收尾（步骤5）
- **spec 原文**：31 组逐条正例、未登记子串负例、长名不反查、`能天使`/`嘉维尔` 不产出子串路径、校验异常、协议与版本、evidence 核验迭代、测试侧固化 31 条清单；`pnpm run typecheck`、`pnpm run test`、`node scripts/doc-check.mjs` 通过，合并前 `node scripts/verify.mjs merge -- --base main`。
- **实际做法**：`facts-curation.test.ts` 增加真实记录卡上 31 组短名→长名循环正例（`能天使`/`嘉维尔` 断言由阵营精确路径覆盖而不产出子串）与未登记子串（`耀骑士`、`光`）负例；`facts-resolution-executor.test.ts` 增加 `能天使`/`嘉维尔` 的 executor 覆盖条件回归；同步勾选计划验收清单、计划状态改为「已完成（待发布元数据收束）」、ADR-010 撤销「子串条款待实施」括注并更新 §5/§6 与后果叙述、更新 ADR INDEX 与 inbox 条目。
- **原因**：以真实数据与 executor 链路验证契约，不以名册包含关系派生清单，也不针对评测问法添加特判。
- **后果**：计划尚未冻结归档，发布元数据收束（冻结、版本、变更日志）按发版流程另执行。
- **验证**：`pnpm run typecheck` 通过；全量 `pnpm run test` 39 个文件 432 通过；`node scripts/doc-check.mjs` 通过；`node scripts/verify.mjs merge -- --base main` 五项门禁通过。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项

（无）

## 意外发现
> 实施中发现的 spec 未覆盖的依赖/边界/风险

### 2026-09-10 — 独立审查纠正的三处前提错误
- **发现**：初稿称「反转现有 E1 用例」，但 `bench/tests` 无 `临光`、`耀骑士` 断言（现有子串负例均为合成名），应改为新增用例；负例示例 `骑士` 实为阵营名、会命中 faction，应换纯未登记串；`能天使` 冗余路径的机理是阵营精确路径已含长名而非 operator 路径，且 `嘉维尔` 是同类第二例。
- **影响**：已回馈 spec 的测试计划与验证矩阵。

### 2026-09-10 — 真源为过滤子集且生成器缺位
- **发现**：歧义.md 第一节的 31 组是过滤后子集（`陈`、`阿`、`红` 等包含关系未列入）；生成脚本 `scripts/build_refs.py` 不在仓库，漂移不可审计。
- **影响**：完整性只能以测试侧显式清单为准；已在 spec 非目标与校验步骤中写明，未新建生成器。

### 2026-09-10 — 文档评估修订
- **发现**：校验表达式未区分带身份前缀的 target 与 canonical，会放过短名自指；ADR 的包含方向文字写反；既有验证矩阵未覆盖一短多长、部分覆盖和后续 combo / legacy 路径覆盖；计划中的 8 处链接多退了一层目录。
- **影响**：已回馈 spec 与 ADR：明确去前缀后校验真子串、targets 非空与 substrings 内名称唯一；补充全部其他路径收集后判定、部分覆盖保留完整成员的契约及 S6–S8 合成回归，并修复链接。本轮只修订文档，实施验收项保持未勾选。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

（暂无）

> ✅ 已完成于 2026-09-10
