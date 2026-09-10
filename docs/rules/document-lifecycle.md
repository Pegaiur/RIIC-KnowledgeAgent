---
description: 修改文档、操作 ADR、发版、合并分支时生效
---
# 文档生命周期规则

> 此规则在文档/ADR/发版/合并场景下生效，确保文档修改行为一致。

## 文档角色与生命周期

| 文档 | 角色 | 创建时机 | 修改时机 | 删除/冻结时机 |
|------|------|----------|----------|-------------|
| `AGENTS.md` | 入口（规则索引 + 结构导航 + 工作流路由） | 项目初始化 | 随仓库规则演进 | 不删除 |
| `docs/inbox.md` | 收件箱（需求捕获与路由） | 项目初始化 | 每次有新需求/想法时 | 发版时删除 `[x]` 条目 |
| `docs/plan-*.md` | 蓝图（已定稿，仅 checklist `[ ]` → `[x]`） | 立项 | 开发中待办状态变化 | 冻结时全部 `[x]` + 标记完成日期 → 移入 `docs/archive/` |
| `docs/draft-*.md` | 蓝图提案（未定稿，scope 讨论中） | 立项 | 计划定稿前任意修改 | 定稿后重命名为 `plan-*.md` |
| `docs/adr/ADR-*.md` | 决策记录（前因/why） | 架构决策时 | 状态变更时 | 被替代时标 `已废弃` |
| `docs/adr/INDEX.md` | ADR 索引 | 项目初始化 | 新增/修改 ADR | 不删除 |
| `docs/*-notes.md` | 实施笔记（spec→代码的决策/变更/权衡日志） | 开始实施 spec 时 | 流式追加，每完成一个决策/变更立即记录 | 归档时合并到 plan 末尾（新增 `## 实施纪要` 段）→ 删除 notes 文件 |
| `docs/spec/*.md` | 评测/核查规格（判定口径与参考要点等**长期复用资产**，非实施蓝图） | 出现需跨运行复用的核查规格时 | 语料或判定口径演进时同步维护（文内版本递进） | 随语料失效或被替代时移入 `docs/archive/` 或删除 |
| `docs/exp-*.md` | 试验记录（探针、对照、测量、诊断、技术评估、历史运行分析、答案核查） | inbox 路由试验工作时 | 按过程、结果、结论三段记录设计、执行、偏离、更正和审定情况 | 已结束或已取消后迁入 `docs/archive/exp/`；暂缓及待审定保留活动入口 |
| `docs/archive/` | 已冻结计划；`exp/` 子目录存已结束或已取消的试验 | 项目初始化 | plan 经脚本归档并更新 INDEX；exp 直接迁入子目录并同步引用 | 不删除 |
| `docs/CHANGELOG.md` | 更新日志（版本变更事实，与 archive INDEX 分工：INDEX=计划索引） | 首个发版由脚本创建 | 发版收束时追加新版本段 | 只累积、不重写历史 |
| `docs/templates/` | 模板（机械格式） | 一次性创建 | 格式升级 | 不删除 |

> monorepo 可追加 `PACKAGE.md`（子包约定）一行：子包创建时建立、发版前统一更新、不删除。

文档入口见根 `AGENTS.md` 的「文档导航」。draft 仅承载未定稿工程提案，形成实施方案后转 plan；试验工作使用 exp，不为归档虚构 plan，也不另设 report 类型。历史试验迁移保留原事实、撤回及审定边界，不把旧结论改写成当前事实。既有 plan 保持原类型和正文，仅修复迁移导致的可点击链接。

### exp 工作与收尾

依据 [ADR-009](../adr/ADR-009-exp-document-workflow.md)，exp 使用 [唯一模板](../templates/exp.md)，正文仅设「过程」「结果」「结论」三段，可按轮次增加下级小节。过程记录问题、方法、必要版本/配置、实际步骤与偏离，结果保留必要测量、判定、失败及不确定性，结论记录局限、下一步和清理情况。未知条件写未知，不转储整批原始数据。状态为设计中、进行中、暂缓、待审定、已结束或已取消；未执行不得写为完成，负面或证据不足也可结束，待审定不得称最终结果。

exp 不另留数据、原答、trace、截图、数据集、一次性脚本或附件，不建立附属索引/台账，不为试验导出共享快照。执行期间的必要临时文件按 scripts/INDEX.md 落位，在每次任务结束、暂缓或交接前清理；重启时重新取得输入，无法取得时说明限制。既有代码、knowledge 和 spec 可作为来源，但不替代文内必要结果，也不能仅为保留附件将其改称工程资产。试验结果形成正式工程需求时另建 plan，架构决策按既有判据建 ADR；正面结果不自动授权策略修改。

exp 归档与发版解耦，不套用 plan checklist 或冻结标记。已结束/已取消的文档移动到 `docs/archive/exp/` 并同步入链、出链；不新增归档脚本或索引。清理后不得承诺原始运行完整可复现。清理受保护时在结论写明具体对象、阻塞和解除条件，不绕过保护或宣称完成。

现存 v4 审定输入的一次性过渡仅限 [v4 核查试验](../exp-answer-baseline-v4.md) 结论列出的既有 A/B 输入；审定完成或取消即清理，不扩增副本，新 exp 不继承。该过渡不代表其他试验附件可以继续保留。

### Plan 状态与执行顺序

Plan 是供人和 Agent 共同阅读的 Markdown 蓝图，不承载执行器状态、任务 prompt 或调度 DAG，禁止使用 `phases/task_prompt/depends_on` 一类 YAML frontmatter 维护第二份实施方案。实施顺序与真实依赖直接写在正文；施工进度以「验收清单」checkbox 为唯一机械信号，状态行与冻结标记只表示文档生命周期。历史归档保持原貌，不为模板升级批量回写。

## ADR 判定与维护

以下变更需要 ADR：引入或替换架构级第三方依赖、修改跨模块公共接口或依赖方向、拆分/合并子模块、改变构建或分发策略、废弃已生效方案、调整锁或测试策略等横切机制。

Bug 修复、向后兼容的可选字段、单模块内部重构、配置值调整、注释和文档同步不单独创建 ADR。一个 ADR 应覆盖同一主题下的一组关联决策。

新增 ADR 时：

1. 从 `docs/adr/INDEX.md` 获取最大编号并递增，文件名使用 `ADR-NNN-<kebab-case>.md`。
2. 复制 `docs/templates/adr.md` 填写，不在规则或技能中维护模板副本。
3. 同步更新 `docs/adr/INDEX.md`；状态变更时 ADR 文件与 INDEX 必须保持一致。
4. 只引用编号更小的 ADR，不写指向 `docs/inbox.md` 等易失效入口的关联。

ADR 之间的引用方向必须单一：只允许编号更大（后写）的 ADR 引用编号更小的 ADR，禁止前向引用与循环引用，避免被引用 ADR 的状态或结论变更时回改早期文档。关联只保留前置决策、替代范围、实施计划等有信息量的引用，不登记 `docs/inbox.md` 这类随收束清理而失效的入口。既有 ADR 在维护时同步修正违反方向的前向引用；方向由 doc-check D5 机械校验。

## 实施笔记维护

实施笔记（`docs/*-notes.md`）是 spec 到代码的决策/变更/权衡日志，记录 spec 之外的决策、偏离、意外发现与阻塞解决。以下任一场景发生时创建或更新：开始按 spec（`docs/plan-*.md` / `docs/adr/ADR-*.md`）实施编码、做出 spec 未覆盖的决策、实施方式与 spec 不一致、发现 spec 遗漏的依赖/边界/风险、在两个可行方案中做权衡、解决阻塞问题。

新增或更新笔记时：

1. 与对应 spec 同目录，命名 `{spec文件名}-notes.md`（如 `docs/plan-v1-notes.md`）；开始实施 spec 的第一步时创建。
2. **流式追加**：每完成一个决策/变更/权衡立即记录，不批处理攒到最后。
3. 复制 `docs/templates/notes.md` 填写，不在规则中维护模板副本（与 ADR 模板同口径）。
4. **债务条目落位**：可定位到代码的债务 / backlog，同步在对应代码处写 `TODO(tech-debt) <编号>：` 注释（AGENTS.md 编码核心约束 #6），笔记只登记编号、结论与未来偿还条件，不复制注释细节。

归档合并（发版时执行，由 `release/archive-plan` **自动完成**，禁止手动拼接）：

- **触发**：执行 `node scripts/tooling.mjs run release/prepare -- --plan docs/plan-xxx.md --apply`（或单独 `run release/archive-plan`）时，脚本自动推导同目录 `docs/plan-xxx-notes.md`，将其五段（决策偏离、实现调整、债务记录、意外发现、阻塞与解决）作为 `## 实施纪要` 段合并到 plan 末尾（空段跳过），归档后删除 notes 文件，不在 `docs/archive/` 留独立文件。
- **正确姿势**：直接运行脚本归档即可，**不要**预先手动把 notes 内容拼进 plan 或手动删除 notes——那会绕过脚本的 notes 合并逻辑（脚本检测不到 notes 便静默跳过，归档结果看似正确但流程失真，notes 存在性校验失效，且手动拼接与脚本输出格式易漂移）。

notes 中发现的重大架构决策应升级为正式 ADR（见上「ADR 判定与维护」），新需求追加到 `docs/inbox.md`。

常见陷阱：只记成功不记失败、把 notes 写成代码注释替代品、spec 修订后未在 notes 对应条目标注"已回馈 spec"。

## 共享基准快照生命周期

`bench/results/*.json` 是可复核的单次运行事实，不是运行目录或成绩台账。此节仅适用于存在独立非 exp 工程用途的快照；入库前必须在对应 spec、plan 或 notes 中写明真实消费者和用途。不得以历史文档引用、试验对照或待优化为由保留快照；exp 只保留文内过程、结果和结论。工程用途确需的失败对照与稳定性样本按整体保留，不能只挑成绩好的运行；没有足够依据时明确写「当前未指定正式质量基线」，不以一次运行成绩替代答案核查口径。

已入库快照必须有当前非 exp 用途；用途结束后随正常收尾提交移除，不设额外审批、等待周期、最近 N 份或替换状态协议。每次新增或淘汰时同步核对活动文档引用；历史工程记录确需查阅时，使用实际包含该 JSON 的完整提交号和仓库相对路径，并用 `git show <commit>:<path>` 验证可恢复。exp 不以 Git 历史替代文内结果，也不承诺历史完整重放。

快照引用的临时原件清理继续使用既有显式 JSON 清单：只有清单明确依赖的原件才受快照存在、已提交且干净等保护约束。exp 不以先导出快照作为清理前提，也不通过变更理由绕过已有清单保护。已跟踪快照经用途核对后按普通版本控制变更移除，不交给临时清理器。清理器的运行结束、指纹、Git 跟踪、.keep 等保护继续有效。快照淘汰不要求多人证明本机已清理，不把未知本机存量变成永久保留理由，不新增注册表或自动删除机制。

## 合并门槛（gate-check）

合并 feature 分支到主分支前，**必须**通过 `node scripts/verify.mjs merge`（merge profile 唯一入口，命令清单见 `scripts/gates.mjs` 与 `scripts/verify.mjs`，不在此复制底层命令）；其中文档一致性校验由 `node scripts/doc-check.mjs` 承担（verify merge 内含该步骤）：

| 检查项 | 阻塞级 | 说明 |
|--------|:---:|------|
| 活动 plan checklist 全部 `[x]` | ❌ 阻塞 | 活动 plan（`docs/` 下）不能有未勾选条目；archive 内已归档不回溯检查（doc-check D1） |
| 活动 plan 冻结归档 | ❌ 阻塞 | 活动 plan 含冻结标记（`已完成于`）即应已移入 `docs/archive/`（发版 checklist 原子动作，doc-check D1）；已冻结未归档阻塞合并/发版 |
| ADR 状态与 INDEX.md 一致 | ❌ 阻塞 | 两处状态字段必须相同（doc-check D2） |
| 脚本引用路径有效（D4） | ❌ 阻塞 | package scripts / 源码静态 import / spawn 字符串 / docs/rules、docs/templates 引用的 `.mjs` 必须存在 |
| ADR 引用方向单一（D5） | ❌ 阻塞 | ADR 文件只引用编号更小的 ADR，禁止前向/循环引用（doc-check D5） |

**plan 归档判定依据**：验收清单全部 `[x]`（实施完成）的 plan 应在待合并 feature 分支的发布元数据收束阶段，经 `release/archive-plan --apply` 移入 `docs/archive/`，与版本信息一并提交后再执行合并门禁。判定链：施工中（存在 `[ ]`）→ D1 error，阻塞合并与发版（doc-check 规定活动 plan 不得有未勾选条目；release/check P1 对应 warning 不阻塞退出码）；全勾选且含「已完成于」冻结标记 → D1 强制已归档；全勾选未冻结 → P1「已勾选全部条目但未冻结归档」，发版收束时必须归档消解。

## 合并与发版流程

一次发版收敛为：**发布元数据收束 → 合并发布 → 部署（可选）**。

1. **发布元数据收束（feature 分支）**：
   - plan 文档：全部 `[x]` 后经 `node scripts/tooling.mjs run release/prepare -- --plan <path> --apply` 冻结归档（追加 `> ✅ 已完成于 {日期}` → 移入 `docs/archive/` → 更新 archive INDEX）
   - 实施笔记：随归档合并到 plan 末尾（`## 实施纪要` 段），删除 notes 文件
   - inbox.md：删除所有 `[x]` 条目
   - ADR INDEX.md：相关 ADR 状态改为 `已实施`
   - 版本：dry-run 确定根目标版本后，执行 `node scripts/tooling.mjs run release/calculate-version -- --pkg all --apply` 与根版本 `--apply`（单包仓库跳过 --pkg）；核对 changed 子包的包级约定文档（如 PACKAGE.md）
   - 更新日志：执行 `node scripts/tooling.mjs run release/changelog -- --version <根版本> --apply` 追加 docs/CHANGELOG.md 版本段（与版本文件同笔提交）
   - 提交：以上内容作为一笔 `chore(release): 准备 v<根版本>` 提交，不在主分支补交发布元数据
2. **合并发布**：在 feature 最终提交上执行 `node scripts/verify.mjs merge -- --base <主分支>`（覆盖该分支相对主分支的完整变更）→ `--no-ff` 合入主分支 → 在 merge commit 上执行 `node scripts/verify.mjs release` → 给该 merge commit 创建 `v<版本>` tag → push 主分支与 tag → 删除 feature 分支。**verify release 通过前不删除远端分支**。
3. **部署（可选）**：按仓库自身部署流程执行，独立授权动作，与发版门禁分离。
