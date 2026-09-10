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
