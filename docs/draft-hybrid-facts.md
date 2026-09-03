# R5 事实查询（facts-first：LLM 转录记录卡 + 查询 tool，零散文依赖）—— 草案

> 创建日期：2026-09-02
> **v4 重写：2026-09-03**——弃 v1「混合架构」、v2「facts.json 程序直出」、v3「程序化内存解析」，改为 **LLM 转录 `knowledge/references/` → 程序化核对 → 人工终审 → 落盘记录卡资产**，查询工具读落盘资产（运行时不解析 md）
> **v4.1 增补：2026-09-03**——分层落盘（机械层 / 语义层物理分离）+ 资产管理脚本（轻量 CRUD，仅语义层可写）。必要性评估：运行时整载 500KB 级资产无压力，CRUD 需求来自人工终审（425 卡逐卡留痕）与日常维护环节，而非运行时
> **v4.2 修订：2026-09-03**——独立审查（可维护性专项）后修订：语义层分片键改干员 canonical（F-3）、aliases 单一事实源裁定 + 俗称必转（F-10）、字段-来源对照表五列 + assetSchemaVersion + 加字段 SOP（F-1）、终审状态逐卡四元组 + invalidate（F-6/F-11）、转录脚本/解析器/H5 断言定为入库 TS 组件（F-7）、references 更新通路缺失显式登记 + 哈希比对过渡约定（F-5，通路修复后置 v3）、P0.4 升格显式步骤（F-15）、资产入库声明（F-13）、bench 集成细化与 R5/A1 TODO 清算登记（F-17）；AGENTS.md / inbox.md 失同步已修（F-14）
> 状态：草案（draft）——Phase 2/3 启动时转 plan 并进入实施（转换注意见文末）
> 上游：`docs/archive/plan-facts-source-purge.md`（语料事实源清理，已归档完成）；`docs/archive/plan-rules-prefix.md`（R4 检索词引导，根因「语料缺 index 层 → RAG 代偿」）；skill-test 语料实证（2026-09-02 A/B/C 核查）；`docs/spec/rag-answer-baseline.md`（F/G 批参考要点待重制，P0.4）

## 背景

- **语料勘验（本草案决策基础）**：散文层（`arknights-base-vault/docs/`，已整体删除）为早期劣质 AI 总结、与数据层冲突；结论：**散文层整体废弃，数据层（`knowledge/references/`）为唯一真源**；散文（论证层）后续重写补充。清理过程见 `docs/archive/plan-facts-source-purge.md`。
- **2026-09-03 结构重构**：知识库从 `arknights-base-vault/` 迁至 `knowledge/`（数据层 + SKILL.md + 基建物流链.md），散文 / `meta/` / README / TODO 全删除，`bench` 查询工具临时停用（P0.7）。
- **数据前提**：`knowledge/references/` 14 个 md 已完整落盘且为唯一真源（名册 / 技能分片×9 / 类别 / 技能等价组 / 歧义 / 数据源）。**记录卡为派生资产（LLM 转录 + 人工终审 + 落盘），非真源**——与 references 冲突时以 references 为准。上游 Steward JSON / RIIC-Web 不在本方案范围。
- **⚠️ references 更新通路缺口（审查 F-5，修复登记 v3）**：14 个文件头均声明「由 `scripts/build_refs.py` 生成，请勿手改」，但该脚本不在仓库、上游接入又被列为范围外——**references 当前实际为「事实冻结快照」，无合法更新通路**；本方案以哈希比对该状态做防御（见设计「references 版本与更新触发」），通路修复（再生脚本重建）后置 v3。

## 目标

构建**事实查询工具**（零散文依赖）：以 `knowledge/references/` 为源，经 **LLM 转录 + 程序化核对 + 人工终审** 产出**落盘记录卡资产**（名称 / 别名 / 可用设施 / 相关组合 / 技能效果原文 / 代偿备注）；bench 查询工具（lookup / query）读资产作答，在真源数据上量化事实类题（F/G）的命中率、编造率、成本，为「散文重写 + 判断层补充」之后的完整方案（v3）奠定数据地基。

## 非目标

- 不做散文层任何工作：不修补、不索引（search_corpus/read 接口保留但不启用）
- 不做 S 类体系题评测：体系关系（互斥/核心双人/缺人降级）是公孙判断——随判断层/散文重写后置（v3）
- 不做 judgments 层粗标（SKILL.md S3 转录）——判断层后置（如提前转录，仅作 v3 素材）
- 不做 GraphRAG / 免检索门控（沿用 R4 立场）
- **不做效果字段数值化（minEff）**——记录卡只存效果原文，效率数值不参与机器比较
- **不做任何上游接入**（Steward JSON / RIIC-Web）——references 为唯一真源，数据缺口以 `数据源.md` 记录为准
- **不重建 references 再生脚本**（合并/渲染层重写 + 文件头与 `数据源.md` 修订）——与上游接入解耦但不在本范围，登记 v3（见「references 版本与更新触发」）

## 待验证假设

| # | 假设 | 判定指标 |
|---|---|---|
| H1 | 事实查询在事实类题（F01-F10 + G01-G02）正确 ≥ 10/12 且编造 = 0 | 正确数/编造数（真源参考要点判定，P0.4） |
| H2 | 查询返回紧凑记录卡（单次 ≤ 1KB 量级），input 成本可控 | 单题 input tokens / tool 调用次数 / 平均返回字节 |
| H3 | 条件组合查询（faction + room + rarity 等**非数值**字段）正确覆盖盲区题 | 新增 5 题组合题正确率 ≥ 4/5（不含数值 minEff） |
| H4 | 查询结果 100% 标注来源（文件名 + 小节） | 来源合规率（人工核查） |
| H5 | 转录一致性：落盘资产 vs references——机械字段（干员集合/星级/设施/组/技能名/解锁条件/效果原文）程序化核对 0 差异；语义字段（代偿备注/别名链路/相关组合）人工终审通过并留痕 | 程序核对断言 0 差异 + 终审记录落盘 |

## 设计

### 数据管线（Phase 2 产物：记录卡落盘资产）

```
knowledge/references/（唯一真源，14 md；当前为事实冻结快照，见「references 版本与更新触发」）
   │  ① LLM 转录（入库 TS 脚本，可重复执行；机械字段程序预填）
   │     输入：名册 / 9 分片 / 类别 / 等价组 / 歧义（SKILL.md 数据部分 + 基建物流链.md 作代偿备注素材）
   │  ② 程序化核对（断言：机械字段与 references 逐字 0 差异，未过即打回重转录）
   │  ③ 人工终审（语义字段：代偿备注 / 别名归一链路 / 相关组合；终审留痕）
   ▼
记录卡资产（分层落盘：机械层 / 语义层物理分离；入库 git；
   meta：assetSchemaVersion / 转录模型与时间 / references 版本（git 短哈希 + 内容哈希）/ 全局终审进度）
   │
   ▼
bench 查询工具（lookup / query 读资产；运行时不碰 md）
```

- **资产定位（硬性）**：记录卡是 references 的**派生缓存，非真源**——数值、原文、归属一律不得偏离 references；references 变更（经哈希比对发现）后须重跑转录并重新终审。
- **references 版本与更新触发（v4.2 新增）**：references 版本 = **git 短哈希 + 内容哈希双记**；每次转录与 validate 时重算哈希与资产 meta 比对，不一致即判资产过期（受影响卡终审状态失效为「待重审」，见 CRUD `invalidate`）。**更新通路缺口显式登记**：再生脚本（`build_refs.py`）缺失 + 文件头禁改 + 上游接入范围外 ⇒ references 当前为事实冻结快照；若发生勘误只能手改（须同步修订文件头声明与 `数据源.md` 更新方式表述），通路修复登记 v3。
- **分层落盘（硬性，v4.2 修订）**：全量约 400~550KB（references 实测 308KB + JSON 结构开销）——**机械层**（干员/技能/派系等可机械核对字段）与**语义层**（代偿备注 / 别名 / 相关组合 / 终审状态）物理分离。**语义层分片键 = 干员 canonical**（语义字段是干员级事实：跨设施干员如伊内丝〔会客室+办公室〕、凯尔希〔控制中枢+加工站〕归属单卡；俗称/合称等跨干员条目单列 `semantic-aliases` 分片）；与 references 的关系为**同主键**（canonical + `source` 文件#小节），**不承诺目录镜像**——references 技能分片重排/拆合不影响语义层分片键，仅触发受影响干员卡重转录。机械层仅允许转录脚本重生成，不开放手工编辑。**资产目录入库 git**（终审留痕依赖 git 历史；bench-runs 式忽略惯例不适用）。
- **转录纪律（硬性）**：效果原文逐字转录、禁止改写数值；星级 / 解锁条件 / 派系归属 / 等价组只从 references 取；散文/速查表数值一律不采信（散件速查星级错误即为判例）。**转录脚本、references 解析器、H5 断言为一等入库 TS 组件**（与 bench 同栈，禁止 scratch-only / dev-temp——`build_refs.py` 缺失即前车之鉴）；断言单一实现双消费（转录核对 + CRUD validate）。
- **来源标注**：每条记录卡带 `source`（文件名 + 小节，如 `技能-制造站.md#温蒂`）。**aliases 单一事实源 = 资产语义层**（`歧义.md` / `技能等价组.md` 降格为上游素材），并拆两级核对面：歧义子串对 / 等价组派生别名纳入**程序断言**（机械），俗称合称**人工终审**（语义）；aliases 带归一链路（歧义 → canonical）。
- **上游缺口**（补源缺 20 技能 / 10 干员，`数据源.md` 已记录）：不在本方案处理；记录卡仅标注缺口，不补数。另：`歧义.md` 第二节俗称出处散文已删除（德狼/能蕾/银崖/龙门中枢组等），归一链路须终审时人工确认；**俗称转录（歧义.md 第二节合称 + SKILL.md 术语节）首批必转**，不再「可选」。

### 记录卡 schema（落盘，Phase 2 定稿 + 字段-来源对照表）

```jsonc
{
  "canonical": "巫恋", "aliases": [], "rarity": 5, "class": "辅助",
  "rooms": ["贸易站"], "groups": ["叙拉古"],
  "skillGroups": ["裁缝·α"],
  "skills": [{
    "name": "裁缝·α", "unlockType": "初始解锁",
    "target": "贸易站", "effectText": "（原文逐字转录）",
    "source": "技能-贸易站.md#巫恋"
  }],
  "notes": "（代偿备注：现存语料的散文式指引，如温蒂「仿生海龙」替换/孑特例/巫恋归零不影响裁缝等）",
  "source": "名册.md#巫恋"
}
```

- **提取字段（v0 硬性）**：名称 / 别名 / 可用设施 / 相关组合 / 技能效果原文 / 代偿备注。不做数值字段抽取与排序。
- **字段-来源对照表（五列，v4.2 定稿要求）**：`字段 | 层归属（机械/语义）| 来源（references 文件#小节）| 断言方式（逐字断言/人工终审）| 写路径（转录脚本/CRUD set）`——机械/语义边界的**唯一权威载体**，set 白名单、H5 断言、转录脚本三处以它为准。
- **meta 与版本**：资产 meta 含 `assetSchemaVersion`（加字段即递增）与 references 版本（哈希双记）。
- **加字段 SOP（v4.2 新增）**：机械字段 → 改 schema（`assetSchemaVersion`+1）+ 对照表登记 + 重跑转录；语义字段 → 改 schema + CRUD set 白名单扩展 + validate 过断言。新增「层」（如 v3 判断层）不回改 v0 分层边界、独立目录落位。
- **终审留痕（v4.2 拍板）**：**逐卡四元组**（status 待审/已审/过期 · 审阅人 · 日期 · references 版本）；meta 只留全局进度计数；审计链 = git 历史（不重复存历史记录）。
- **逻辑视图 vs 物理存储**：上例为单卡逻辑视图；落盘时机械字段与语义字段分离存储（见数据管线「分层落盘」）。

### 资产管理脚本（轻量 CRUD，v4.1；v4.2 补 invalidate）

- **背景**：运行时整载 500KB 级 JSON 无压力（毫秒级）；真正的编辑需求在人工终审（425 卡逐卡留痕）与日常维护（补别名/改备注）——手编大 JSON 低效且易破坏 schema。
- **原则（硬性）**：CRUD 只覆盖语义层；`set` 写机械字段直接报错（防与 references 漂移在接口层面锁死）。
- **子命令**（Phase 2 定稿）：`get`（读单卡）/ `list`（按字段过滤 + 终审状态）/ `set`（仅语义字段：notes/aliases/相关组合/终审状态）/ `invalidate`（按 references 版本差集将受影响卡置「待重审」；版本变更亦可自动失效）/ `validate`（复用 H5 断言实现，编辑后必须过）/ `stats`（终审进度三态：待审/已审/过期）。
- **写路径冲突兜底**：git 手改绕过 set 的场景，除流程约定（编辑后必过 validate + git diff 审查）外，登记 Phase 3 待办——verify merge 门禁在资产目录变更时前置 validate。
- **留痕与载体**：终审状态字段（逐卡四元组）+ git 提交记录即可审计，不引入数据库；bench 侧一等入库 TS 组件（复用 types/config，约 200~300 行），存放位置 Phase 2 定稿。

### 查询 tool（Phase 3）

```
┌─ lookup_operator(name) / lookup_skill(name) / lookup_entity(term)
│  别名归一（资产语义层 aliases：歧义/等价组派生 + 俗称）→ canonical → 返回记录卡（≤1KB 量级）
├─ query_operators({ room, faction, rarity, profession, excludeIds, termQuery })
│  分类过滤（StructuredRAG 式聚合）——不含数值 minEff / 效率排序
└─ （预留，v0 不启用）search_corpus(text) / read —— 散文重写后接入
```

- 载体：bench 侧本地函数工具验证 → 结论成立后 MCP 化（宿主复用；资产落盘为 MCP 化前提）。
- **bench 集成细化（v4.2）**：新增 facts 工具模块 + **统一 tool registry**（不塞 agent.ts 的检索器 if/else）；系统提示按工具集参数化；runQuery 数据面解耦（ToolContext）；lookup/query 是否计入 MAX_RAG_CALLS 检索预算 Phase 3 定稿；**同步清算 bench 既有 TODO(tech-debt)**——R5（config.ts corpusDir，重启条件即本方案）与 A1（agent.ts 注入语义混合）。
- v0 评测 agent 工具集 = lookup + query；对照组：无工具裸查（同模型同题，对照 H1 归因）。
- **与 R4 关系**：R4 检索词引导（QUERY_GUIDES）在事实层落地后**退役**（工具 schema 即检索指导）；R4 的「成本 +63%」预期由 compact 记录卡（几百字节）替代 read 20k 散文 + glob/grep 解决。

### P0.4：参考要点重制（F/G 批）——v4.2 升格为显式步骤

`docs/spec/rag-answer-baseline.md` 中事实类 12 题（F01-F10/G01/G02）的参考要点**当前全部锚定已删除散文路径**（`0-规则/`、`2-体系/`、`4-散件工具人/`），spec 自承诺「随语料更新同步维护」已被语料删除击穿，处于失效未维护态。P0.4 = 以 references 真源重制 12 题要点（逐题 `文件#小节` 出处，人工终审，spec 版本递进）；S 类 8 题暂缓（待散文重写）。**P0.4 是 H1 判定前提**，列为实施步骤 4（工作量与终审同级，勿低估）。

## 实施步骤

1. 记录卡 schema + **五列字段-来源对照表**定稿（含分层落盘（机械层/语义层，分片键 = 干员 canonical + `semantic-aliases`）、位置、meta（assetSchemaVersion / references 版本）、终审留痕逐卡四元组格式）
2. 转录脚本 + references 解析器 + H5 断言（一等入库 TS 组件，断言单一实现；测试用小型 fixture：名册/分片样例 + golden 记录卡）产出记录卡草稿
3. 资产管理脚本 CRUD（get/list/set/invalidate/validate/stats；仅语义层可写，validate 复用 H5 断言）——服务步骤 5 终审
4. P0.4 参考要点重制（F/G 12 题以 references 重制，逐题 `文件#小节` 出处，人工终审）——H1 判定前提
5. 人工终审（语义字段，经 CRUD 脚本更新留痕）→ 定稿落盘（H5 两道关卡全过）
6. bench 集成：facts 工具模块 + tool registry 注册 lookup/query（读落盘资产）+ 系统提示参数化 + 工具单测（别名命中、分类过滤、来源标注）；清算 R5/A1 TODO
7. 评测：事实 12 题（P0.4 要点判定）+ 新增 5 题组合题（非数值字段组合，样例：「谢拉格派系 + 制造站」；落点 questions.json 扩展或独立文件、gold 口径同步扩展——事实层命中 = `文件#小节`，Phase 3 定稿）——对照组：无工具裸查
8. 结论落盘与登记（含口径说明：转录模型/评测模型分别登记 meta，评测 provider ≠ 项目目标 provider Hy3，结论不外推）

## 评测判据

- **通过标准**：H1-H5 全部满足；具体为 事实题 ≥ 10/12、编造 = 0、组合题 ≥ 4/5、来源合规 100%、转录核对 0 差异 + 终审留痕完整。
- 任一不满足 → 按风险表逐项排查（转录缺字段 / 别名缺失 / 工具描述误导），复测一次。
- 成本预期：评测 12+5 × 2 组（查询/裸查）≈ ¥0.05-0.1（qwen3.7-flash）；另加一次性转录成本（全量语料单轮转录，按 qwen3.7-flash 定价预计 ¥1 量级以内，实施时实测核算）。
- 工具行为记录沿用 skill-test evals 五维判定表（正确性/编造/来源/效率/数据使用），S 类指标栏标注「暂缓」；数值效率（minEff）不在 v0 判据内。

## 风险与对策

| 风险 | 对策 |
|---|---|
| v0 无体系关系数据 → S 类题全部不可答（覆盖率骤降） | 明确范围：v0 只评事实层成色；S 类随判断层/散文重写（v3）——**不把 v0 成绩当全场景结论** |
| 效果数值不数值化 → 组合查询的效率过滤不可靠 | v0 不做 minEff：query 只做分类过滤，效率保留原文；组合题改用非数值字段（faction+room+rarity）；记入 v3 扩展 |
| **LLM 转录幻觉 / 漏录 / 改写数值** | 三道关卡：转录 prompt 硬约束（原文逐字、禁止改写）→ 程序化核对断言（机械字段逐字比对，不过即打回）→ 人工终审（语义字段）+ 终审留痕 |
| **references 更新通路断裂（再生脚本缺失 + 文件头禁改 + 上游排除）→ 勘误只能违规手改，资产过期无从检测** | 过渡防御：references 版本 = git 短哈希 + 内容哈希双记，转录与 validate 时哈希比对，不一致即判资产过期 + invalidate 重置终审；手改勘误须同步修订文件头与 `数据源.md`；**通路修复（再生脚本重建）登记 v3** |
| P0.4 重制工作量被低估（12 题要点全部需从 references 重推，与终审同级） | 已升格显式实施步骤 4；复用 CRUD list 逐卡取证；spec 版本递进留痕 |
| 终审成本（425 卡全量人工过一遍） | 机械字段已由程序核对兜底，人工只审语义字段（notes/aliases/组合）；CRUD 的 list/stats 支持差异定位与进度跟踪（三态：待审/已审/过期）；全量终审一次、后续增量 |
| 手编/误编辑破坏资产 schema 或误改机械字段 | `set` 接口锁机械字段（写即报错）；编辑后必须过 `validate`（复用 H5 断言）；git diff 审查兜底；verify merge 前置 validate 登记 Phase 3 |
| 上游 Steward JSON 缺失 / 数据缺口 | 不在本方案处理；references 为唯一真源，缺口以 `数据源.md` 记录为准，记录卡仅标注、不补数 |
| 别名/俗称覆盖不全 → lookup 脱靶 | aliases 单一事实源 = 资产语义层；歧义/等价组派生别名程序断言，俗称人工终审；**俗称首批必转**（歧义.md 第二节 + SKILL.md 术语节）；H1 失分项定位到具体缺词，补词复测 |
| 查询结果被当「真理」不标来源 | 来源标注字段强制 + H4 人工核查 |
| 散文重写与数据层脱节（重写后仍需校正） | 散文重写侧规则：数据引用一律以记录卡为准（记录卡源自 references） |

## 验收清单（Phase 2/3，待启动）

- [ ] 记录卡 schema + 五列字段-来源对照表定稿（含分层落盘、分片键 = 干员 canonical、位置、meta（assetSchemaVersion / references 版本）、终审留痕逐卡四元组格式）
- [ ] 转录脚本 + references 解析器 + H5 断言入库（TS，含 fixture 单测）+ 程序化核对 0 差异
- [ ] 资产管理脚本 CRUD 实现并过单测（set 锁机械字段、invalidate 失效机制、validate 复用 H5 断言）
- [ ] 资产目录入库 git（终审留痕前提）
- [ ] P0.4 参考要点重制（F/G 批）经人工终审，spec 版本递进
- [ ] 人工终审完成并留痕（H5）
- [ ] facts 工具模块 + tool registry 注册 + 系统提示参数化 + 单测通过；R5/A1 TODO(tech-debt) 清算
- [ ] 评测 12+5 题 ×（查询/裸查）完成 + 人工核查落盘（判定表）
- [ ] 结论与推荐；S 类/散文重写/数值效率（minEff）/references 再生脚本重建 作为 v3 计划登记

## draft → plan 转换注意（v4.2）

- **已否决备选须压缩进 plan「架构分析」节**（每方案 1-2 行否决理由，指向本草案版本头）：v2 程序直出 facts.json（references 无结构化 schema + 数据源.md 缺口致解析不可行）、v3 程序化内存解析（格式硬编码脆弱 + 终审工作流无载体）、方案 A 无 CRUD 手编（425 卡终审状态逐卡更新不现实）、方案 B 单文件全字段 CRUD（diff 噪音/合并冲突/全文件重写）。
- **全部「Phase 2 定稿」开放项必须落为验收清单 checkbox**（当前开放项：资产落盘位置与分片方式、CRUD 脚本存放位置、组合题落点与 gold 口径、lookup/query 检索预算口径）——散文中的开放项会逃逸出 checklist 机械追踪。
- AGENTS.md / inbox.md 与本草案的失同步已于 2026-09-03 修复；doc-check 不覆盖 md→md 悬空引用已按 `TODO(tech-debt)` 登记 `scripts/doc-check.mjs`。

## 关联

- 上游：`docs/archive/plan-facts-source-purge.md`（语料事实源清理，已归档）、`docs/archive/plan-rules-prefix.md`（R4）、`docs/archive/plan-retrieval-experiment.md`（P1-P5）、`docs/archive/plan-retrieval-tuning.md`（R2/R3）
- 参考要点判定：`docs/spec/rag-answer-baseline.md`（F/G 批待 P0.4 重制；当前锚定已删散文路径，处于失效态）
- 数据层：`knowledge/references/`（唯一真源；当前为事实冻结快照，更新通路修复登记 v3）；记录卡资产为其派生缓存；skill-test evals 判定表可复用
- 依据调研：StructuredRAG（聚合查询）、RIIC-Web 解包管线（build_refs.py 生成的 references 呈现层）
- v3 预登记：判断层（SKILL.md S3 转录 + 公孙判断结构化）+ 散文重写（数据引用以记录卡为准）+ S 类评测 + 数值效率（minEff）组合查询扩展 + 上游接入评估 + **references 再生脚本重建**（合并/渲染层 TS 重写 + 14 文件头与 `数据源.md` 修订；与上游接入解耦）+ validate 门禁集成（资产目录变更时 verify merge 前置）
