# facts 子串对（短→长）登记计划

> 创建日期：2026-09-10
> 状态：已完成（待发布元数据收束）

## 目标

让 `facts_search` 对已确认的干员子串对做确定性查询：查询词恰好等于某个已登记短名时，同时返回短名自身与全部已登记长名；短→长单向、全量返回，不做消歧、不反问。补齐 [facts 别名与集合词条真源计划](plan-facts-term-alias.md) 中明确后置的 31 组子串对，并据此二次修订 [ADR-010](adr/ADR-010-facts-alias-disambiguation.md)。

## 非目标

- 双向匹配：查长名不反查短名。
- 任意子串扫描、按字符串包含关系自动扩候选，以及历史 lookup 的模糊与合称解析。
- 按设施或上下文择一、反问、指代确认提示及相关回归；不修改 `knowledge/AGENTS.md` 与 [歧义](../knowledge/references/歧义.md) 正文。
- 技能、阵营、设施、职业名的子串对；简写合称（德狼、能蕾、银崖、孑拉德）。
- RAG 排序、切块、预算、提示词与 agent loop；付费运行；新增哈希字段。

## 架构分析

[歧义](../knowledge/references/歧义.md) 第一节的 31 组「短名 ⊂ 长名」由 `scripts/build_refs.py` 生成，是**过滤子集**而非名册包含全集——名册中 `陈`、`阿`、`红` 等同样存在名称包含关系，却未列入。该文件为生成物，只能作为名称证据线索，不作运行时源。

`facts_search` 现有的 `ResolutionPath` 已有 exact / alias / combo / legacy / rejected 五类；[store](../bench/src/facts/store.ts) 顶部明确「不做模糊或子串兜底」。子串对需要一个显式的、可校验的登记入口作为新路径类别接入，而不是放宽为任意子串匹配。同时，部分长名可能已被既有阵营精确命中覆盖（`能天使`、`嘉维尔` 的官方术语组包含其长名），需要产出条件避免冗余路径。

## 实施方案

按依赖顺序执行；每步写清输入、输出与验收。

### 步骤1：登记类型与校验

- 输入：现有 [terms.ts](../bench/src/facts/terms.ts) 类型与校验器。
- 产出：新增 `SubstringEntry { text; targets; evidence }`，`TermCurations` 增加 `substrings`；同步 `EMPTY_TERM_CURATIONS` 与数组存在性校验；新增校验：`text` 已 trim 且命中 canonical 干员；`targets` 为非空数组，各项均为存在的 `operator:<canonical>`，先去掉 `operator:` 前缀取得 `targetCanonical`，再校验 `targetCanonical.includes(text) && targetCanonical !== text`；`text` 仅在 `substrings` 内唯一，条目内 targets 不重复；`evidence` 至少一条，沿用既有来源路径与小节校验。
- 验收：违规登记按中文消息失败；允许跨索引同名。

### 步骤2：具名登记 31 条

- 产出：在 [curation/terms.ts](../bench/src/facts/curation/terms.ts) 登记「子串对核对清单」的 31 组，evidence 统一指向 `knowledge/references/歧义.md` 第一节。
- 验收：31 条与清单逐条一致；不录设施列，不录「可判断 / 必须反问」策略文字。

### 步骤3：索引、查询路径与产出条件

- 产出：`ResolutionPath` 增 `{ kind: 'substring'; term; targets; memberIds; evidence }`；建 `substringsByTerm` 索引；路径顺序固定为 `exact → alias → substring → combo → legacy → rejected`。
- 规则：查询词 trim 后恰等于 `text` 才命中；长名查询不反查短名；短名本身经 exact operator 路径返回。先收集同查询全部非 substring 路径，以其 `memberIds` 并集判断覆盖，包含最终展示顺序位于 substring 之后的 combo / legacy 路径；若该条目所有目标 canonical 均被覆盖，则省略 substring 路径（`能天使`、`嘉维尔` 因此不产出）。否则保留该条目完整 `targets` 与全部目标的 `memberIds`，部分覆盖时也不裁剪为差集；`memberIds` 按输入 cards 顺序排列。判定完成后按固定路径顺序输出；substring 不贡献 `categories`，全局卡片沿用现有去重。
- 验收：31 组命中正确；未登记子串与长名不扩展；产出条件生效。

### 步骤4：序列化与版本

- 产出：`renderResolutionPath` 改 `switch` + `never` 兜底并新增子串分支（形如 `- 子串：临光 → 耀骑士临光；来源：…；命中 N 张记录卡`）；`TOOL_SCHEMA_VERSION` 7→8、`FACTS_RESULT_VERSION` 3→4；工具描述补「短名按登记返回全部长名，不做消歧」；同步修订 [store.ts](../bench/src/facts/store.ts) 顶部说明与 `TODO(tech-debt) R5-2` 注释。
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

- [ADR-010](adr/ADR-010-facts-alias-disambiguation.md) — facts 别名、集合词条真源与同名全部返回契约（本次二次修订纳入子串对）

---

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
