# 测试架构计划

> 创建日期：2026-09-12
> 状态：施工中

## 目标

为 bench/src 工具链与 scripts 开发脚本建立单一成文的测试约定，使增量开发时「是否需要写测试、写在哪、断言到什么程度」有统一依据；本轮只落规则文本与索引、提交技能一致性，不引入新的机械门禁或覆盖率门槛。

## 非目标

- 不引入覆盖率阈值，不新增 src↔test 映射检查或其他测试门禁；merge/release 门禁命令构成不变（scripts/gates.mjs 的 BASE_STEPS 不动）。
- 不把回答正确率、逐题评分纳入自动门禁，也不据此调整测试断言（沿用 AGENTS.md 核心约束 7/8/9）。
- 不批量重写或迁移存量测试；约定自生效起只约束范围内文件的新增与修改行为。
- 不补 bench/src/rate-limiter.ts、bench/src/cli.ts 的存量缺口测试；不展开无存量实例的后续候选条款（真实网络显式 opt-in、vi.stubEnv 注入、带 g/y 标志正则的 lastIndex 复位等）。
- 不新建测试用例清单、任务台账或第二份注册表；约定只以 docs/rules/testing.md 单一成文。

## 架构分析

现状（2026-09-12 实测）：

- 框架：Vitest 2.1.9（^2.1.0）；vitest.config.ts 的 include 为 bench/tests/**/*.test.ts、bench/tests/**/*.test.mjs、scripts/**/*.test.mjs，无 coverage/setup/timeout 扩展配置。
- 规模：`pnpm run test` 41 文件、493 用例全部通过；bench/tests 为集中式扁平目录（40 个文件），scripts 侧为 scripts/tooling.test.mjs 与 bench/tests/reference-projection.test.mjs。
- 门禁：`pnpm run test` 已在 scripts/gates.mjs 的 BASE_STEPS 内，随 scripts/verify.mjs 的 merge/release profile 执行。
- 缺口：docs/rules/ 无测试规则，AGENTS.md 十条核心约束无一涉及测试，无 src↔test 映射；命名、落位、断言风格全靠模仿现有文件，Agent 增量开发缺成文依据。

关键约束：

- 新增 scripts 测试不能与源码同目录：scripts/tooling.mjs 的 listTasks 递归收集 scripts/tasks/** 下全部 .mjs（目录发现即注册），listLibModules 按扩展名把 scripts/lib/ 下全部 .mjs 列为基元，同目录的测试文件会被误收为任务或基元。
- 存量测试有未追溯差异（agent-provider-ledger.test.ts 以 vi.unstubAllGlobals 成对清理 stubGlobal，provider.test.ts 未配；inputs.test.ts 用 resetModules + doMock，并把 EXPERIMENT 写回固定值而非前值）。缺口是「无成文约定」而非「缺机械检出」，故采用规则文本先行，先在规则中写明状态所有权与成对清理。

## 实施方案

按依赖顺序。1–4 为文档与技能变更，5 为收尾核验。

### 1. 建立 ADR（测试策略属横切机制）

- 输入：本计划的决策（测试约定采用规则文本先行、不引入机械门禁与覆盖率阈值）及已排除的备选（src↔test 映射检查、覆盖率阈值）。
- 动作：按 docs/rules/document-lifecycle.md「ADR 判定与维护」判据，从 docs/adr/INDEX.md 取当前最大编号 +1 新建 `docs/adr/ADR-NNN-testing-convention.md`（参照 docs/templates/adr.md），并在 INDEX.md 追加一行。
- 输出：ADR 文件与 INDEX.md 行。
- 验收：ADR 状态与 INDEX 一致（doc-check D2）；只引用更小序号 ADR，无前向引用（doc-check D5）。

### 2. 起草 docs/rules/testing.md（规则本体）

- 落位：新建 docs/rules/testing.md，frontmatter description 为「新增或修改 bench/src、scripts 下可测代码时生效」。
- 分批：只收有存量实例或直接对应漏写风险的条款，每条标注校验性（可机械校验 / 人工判断）；无存量实例的条款本轮不纳入，仅在本文「非目标」登记名称，不写成规则条文，避免规则正文承载未生效条款。
- 六组内容要点：
  1. 覆盖对象与豁免（人工判断）：bench/src 有运行时逻辑的模块、scripts/lib 纯逻辑基元与 scripts/tasks 可测纯函数、修订既有行为与修 Bug 的同步用例须覆盖；纯类型声明、纯数据常量、无独立判断的入口转发装配可豁免，命中豁免须在提交说明写明理由，不设逐文件豁免表。
  2. 落位与命名（可机械校验）：bench/src → bench/tests/<模块>.test.ts；scripts 新增测试集中 scripts/tests/（按 lib/tasks 相对结构组织，vitest include 已覆盖，无需改配置），既有 scripts/tooling.test.mjs 与 bench/tests/reference-projection.test.mjs 原地保留；行为/契约型补充用 <主题>-<行为>.test.*，数据门禁用 <域>-gate / <域>-integrity。
  3. 行为与回归断言（人工判断）：分层为单元、契约、数据门禁；断言行为而非实现细节，避免重构即碎；改公共行为须在同一次提交内更新测试；修 Bug 先补可复现该 Bug 的回归测试。
  4. 隔离与替身（可机械校验）：测试不依赖调用者环境、用例顺序或间接导入路径；全局与外部替身经 vi.stubGlobal 安装并在用例边界以 vi.unstubAllGlobals 成对复位（vi.restoreAllMocks 面向 spy，不保证回滚 stubGlobal），正面范例 agent-provider-ledger.test.ts；模块级可变状态保存前值并在边界还原，不得靠用例顺序保证初始状态；仅对边界依赖用工厂式 vi.mock，允许按边界选择 spyOn/doMock；resetModules 仅用于 doMock 后重新导入被测模块，不作状态复位手段。
  5. 数据与断言维护（人工判断）：版本控制内夹具（knowledge/、bench/questions.json）可读，运行现场产物（bench-runs/、仓库根 secret.yaml）不得作夹具或断言依据；密钥测试用合成值，不断言真实值；真实数据、协议或需求确已变化时同步断言并在变更说明给出依据；禁止仅以实际输出作为新预期，禁止为转绿放宽断言或跳过失败用例。
  6. 验证与变更说明（可机械校验）：`pnpm run test` 已是 merge/release 门禁步骤；普通改动本地跑 typecheck + test，修改测试代码后跑全套 `pnpm run test`；新增或修改的行为须有对应断言，无新增测试时在变更说明指出既有覆盖或类别豁免。
- 验收：六组齐全、后续候选未展开、每条有校验性标注、无与存量事实冲突的表述。

### 3. AGENTS.md 索引与验证路由

- 规则索引表新增一行指向 docs/rules/testing.md。
- 「运行与验证」补充：修改测试代码后运行全套 `pnpm run test`。
- 「AI 代理发现流程」注明新增/修改测试前先读该规则。
- 验收：doc-check D4（rules/templates 引用路径）通过。

### 4. 提交技能一致性修订

- 输入：skills/commit-convention/SKILL.md「多文件提交策略」现要求按数据/测试/表现层拆分，与 testing.md「改公共行为须同一次提交内更新测试」冲突。
- 动作：改为按完整行为分组——相关实现与其回归测试同一原子提交，其余仍按单一关注点分组。
- 验收：技能结构校验（doc-check S）通过；规则与技能无相互矛盾表述。

### 5. 收尾核验

- 实施完成后由 `pnpm run typecheck`、`pnpm run test`、`node scripts/doc-check.mjs` 全通过；合并前按既有门禁 `node scripts/verify.mjs merge -- --base main`。
- 计划创建阶段 doc-check 会且仅会报告本计划未勾选条目的 D1（施工中如实保留，不提前勾选）；实施完成、清单全部勾选后消解。

## 验收清单

- [ ] docs/adr/ADR-NNN-testing-convention.md 建立并在 docs/adr/INDEX.md 登记，状态一致、无前向引用
- [ ] docs/rules/testing.md 成文：六组齐全、每条标注校验性、不含未生效的候选条款
- [ ] AGENTS.md 规则索引与验证路由更新到位
- [ ] skills/commit-convention/SKILL.md「多文件提交策略」改为按完整行为分组，与 testing.md 无冲突
- [ ] 未新增机械门禁或覆盖率门槛，scripts/gates.mjs 命令构成未变
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过
- [ ] `node scripts/doc-check.mjs` 全通过

## 关联 ADR

- 新建 ADR（编号在实施第 1 步按 docs/adr/INDEX.md 当前最大编号 +1 确定）— 记录「测试约定采用规则文本先行、不引入机械门禁与覆盖率阈值」的横切决策；判据见 docs/rules/document-lifecycle.md「ADR 判定与维护」。

---
<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
