# 测试架构草案

> 创建日期：2026-09-12
> 状态：未定稿，范围与方案讨论中
> 需求入口：docs/inbox.md「建立测试架构，约束增量开发漏写/随意测试」

## 目标

为 bench/src 工具链与 scripts 开发脚本建立成文测试约定，使增量开发时「是否需要写测试、写在哪、断言到什么程度」有统一依据，减少 Agent 漏写测试与风格随意。本轮以规则文本为先，不引入新的机械门禁或覆盖率门槛。

## 非目标

- 不引入覆盖率阈值，不新增 src↔test 映射检查或其他测试门禁；merge/release 门禁的命令构成保持不变。
- 不把回答正确率、逐题评分纳入自动门禁，也不据此调整测试断言（沿用 AGENTS.md 核心约束 7/8/9）。
- 不对存量测试做大规模重写或批量迁移；规则自生效起只约束新增与修改。
- 不一次性纳入全部候选条款：条款按「由少到多」分批展开，首批只收有存量实例或直接对应漏写风险的条款，避免规则空转与过度工程。
- 不新建测试用例清单、任务台账或第二份注册表；约定只以 docs/rules/testing.md 单一成文。

## 背景与依据

现状（2026-09-12 确认）：

- 框架：Vitest（^2.1.0），vitest.config.ts 的 include 仅 bench/tests/**/*.test.ts、bench/tests/**/*.test.mjs、scripts 下的测试；无 coverage、setup、timeout 等扩展配置。
- 落位：bench 采用集中式扁平目录 bench/tests/，scripts 采用源文件同目录 scripts/tooling.test.mjs，两套约定并存但均无成文依据。
- 规模：bench/tests 40 个测试文件（486 个用例）；连同 scripts/tooling.test.mjs 后全套件 41 个文件、493 个用例；形态含单元、契约（vi.mock provider）、真实语料读取、数据门禁（final-gate 断言 425 卡 / 913 技能）与快照。
- 门禁：scripts/gates.mjs 的 BASE_STEPS 已含 `pnpm run test`，随 scripts/verify.mjs 的 merge/release profile 执行；AGENTS.md 要求普通改动跑 typecheck + test。
- 规则：docs/rules/ 仅有 document-lifecycle.md 与 rag-prose-terminology.md；AGENTS.md 十条核心约束无一涉及测试；无「改 src 须同步测试」的机制或成文约定。
- 实际未覆盖源码：bench/src/rate-limiter.ts（有运行时逻辑、无测试）、bench/src/cli.ts（入口，仅 cli-args 的参数解析被单测）；bench/src/delivery.ts（纯类型）、bench/src/terms.ts（纯数据）无测试属正常。

治理依据：docs/rules/document-lifecycle.md 的「ADR 判定与维护」将「调整锁或测试策略等横切机制」列为需建 ADR 的变更；本草案定稿落地属该范畴，须在定稿后按判据评估 ADR。

## 候选方案与评估

| 方案 | 内容 | 收益 | 本项目新增负担 | 判断 |
|---|---|---|---|---|
| A 规则文本 | docs/rules/testing.md + AGENTS.md 规则索引 | 覆盖增量开发主要缺口，改动最小 | 仅维护一份规则 | 本轮选定 |
| B 规则 + src↔test 映射检查 | 新增脚本检查 bench/src 可测模块是否有对应测试，并接入门禁 | 机械发现漏写 | 需定义可测模块判定、豁免与误报处理 | 留待后续按证据评估 |
| C 规则 + 覆盖率阈值 | 引入 vitest coverage 并对 bench/src 设阈值 | 量化覆盖 | 存量补齐压力大，易诱发为达标写无意义断言 | 本轮不采用 |

倾向 A：当前缺口是「无成文约定」而非「缺机械检出」。先让新增与修改有据可依，待出现真实的漏写复发再评估 B/C。

## 实施方案（候选）

1. inbox 登记（本草案入口）。
2. 起草 docs/rules/testing.md，frontmatter description 为「新增或修改 bench/src、scripts 下可测代码时生效」。条款按「由少到多」分两批纳入，避免一次上太多规范导致空转与过度工程：首批只收录已有存量实例或直接对应漏写风险的条款，其余记为后续候选，待出现真实需求再展开；每条另标注校验性（可机械校验 / 人工判断），为后续方案 B 预留落点。正文建议包含：
   - 覆盖对象（首批·人工判断）：bench/src 有运行时逻辑的模块（导出函数/类/分支）；scripts/lib 纯逻辑基元与 scripts/tasks 的可测纯函数（注入依赖）；修订既有行为、修复 Bug 时的同步用例；脚本侧判据：可复用的公共行为须覆盖，一次性临时脚本不强制。scripts/lib 当前零测试实例；scripts/tasks 已有 bench/tests/reference-projection.test.mjs 一处跨目录用例，其余仍属新增覆盖方向。
   - 豁免对象（首批·人工判断）：纯类型声明、纯数据常量、入口装配（cli 命令分发）。命中豁免须在提交说明写明理由；纯数据的机械契约（计数、一致性、投影）由 *-gate / *-integrity 类测试兜底；豁免与例外书面化后集中登记在规则正文表格（文件、匹配类型与理由），不建独立清单文件，避免与 scripts/INDEX.md「不维护第二份 manifest」取向冲突；禁止行号或目录级宽泛豁免。
   - 落位与命名（首批·可机械校验）：bench/src → bench/tests/<模块>.test.ts（bench/tests 亦允许 .test.mjs 承载测 scripts 侧任务脚本的用例，存量 reference-projection.test.mjs 即此形态，新增此类文件须在文件头注释注明落位理由）；scripts → 源文件同目录 <name>.test.mjs；行为/契约型补充用 <主题>-<行为>.test.ts；数据门禁用 <域>-gate / <域>-integrity。
   - 分层与断言（首批·人工判断）：单元（纯函数、边界、错误分支）、契约（mock 外部依赖，断言协议/计量/顺序，不触网）、数据门禁（对真源计数/关系硬断言）；断言行为而非实现细节，避免重构即碎。
   - 隔离与状态所有权（首批·可机械校验）：测试不得依赖调用者环境、用例声明顺序或间接导入路径；全局对象与外部替身（如 fetch）经 vi.stubGlobal 安装，并在用例边界以 vi.unstubAllGlobals() 复位（vi.restoreAllMocks 面向 spy，不保证回滚 stubGlobal；存量合规实例见 agent-provider-ledger.test.ts，provider.test.ts 属未追溯差异）；模块级可变状态（如 EXPERIMENT 档位）须在用例内保存前值、用例边界还原，或用最小复位入口处理，不得靠用例顺序保证初始状态；vi.resetModules + 动态 import 仅用于 doMock 后重新导入被测模块，不作为状态复位手段。后续候选（先不展开）：环境变量经 vi.stubEnv 注入且禁止直接赋值 / delete process.env、默认与回退断言显式 stub undefined（暂无存量实例）；带 g/y 标志的共享正则克隆或复位 lastIndex（本仓仅 ref-check.mjs 一处，先作一句提示）。
   - 替身边界（首批·可机械校验）：仅对边界依赖设替身（如 provider 的 callLLM），一律使用工厂式 vi.mock，工厂只列出被测路径所需的导出；禁止对非边界模块整体设替身；替身实现状态由用例显式拥有并在用例边界复位，不依赖前一用例遗留。后续候选：同一用例还需消费该模块其他导出时用 importOriginal 保留真实实现（当前无实例）；替身模拟的签名随真实接口变更同步更新。
   - 文件系统与数据边界（首批·可机械校验）：优先真实临时目录（由测试创建，在用例或文件边界递归清理，finally/afterEach/afterAll 皆可；参照 benchmark-integrity 的「真实夹具复制到临时目录」模式）；区分「版本控制内夹具」（如 knowledge/、bench/questions.json，允许读取）与「运行现场产物」（如 bench-runs/、仓库根 secret.yaml），后者不得作为测试夹具或断言依据；经被测模块间接读取真实 secret.yaml（loadConfig 恒读仓库根文件）属既有设计，测试不得断言其真实值；确需 mock 时按被测路径/方法收窄，保留真实模块其余能力。
   - 独立入口与真实网络测试（首批·人工判断）：默认套件不触网、不调用真实 LLM；不得把环境或全局修改泄漏给同进程其他用例。后续候选：真实网络（如 provider 冒烟）的显式 opt-in 机制（环境变量或独立脚本）目前无实例，待出现需求再定义载体。
   - 增量硬要求（首批·人工判断）：改公共行为须在同一次提交内更新测试；修 Bug 先补可复现该 Bug 的回归测试；新增模块至少配一个测试文件，除非命中豁免并说明理由。
   - 禁止事项（首批·人工判断）：不为通过评测题写特判、注入答案或修改评分口径；不为让测试转绿而放宽断言掩盖失败；不把回答质量做成自动门禁；测试失败输出与落盘产物不得包含真实密钥（涉密断言使用脱敏值）。
   - 范例锚点（首批·人工判断）：在规则中标注 2-3 个存量正面范例（候选：bench/tests/agent.test.ts 的工厂替身与复位、bench/tests/benchmark-integrity.test.ts 的临时目录与清理、scripts/tooling.test.mjs 的子进程黑盒与 try/finally），供增量开发对标风格。
   - 与门禁关系（首批·可机械校验）：`pnpm run test` 已是 merge/release 门禁步骤；普通改动本地跑 typecheck + test，修改测试代码后运行全套 `pnpm run test`。
3. AGENTS.md 规则索引新增一行指向 docs/rules/testing.md；「运行与验证」补充测试代码修改的验证路由，「AI 代理发现流程」注明新增/修改测试前先读该规则。
4. 定稿：草案转 plan，并按 document-lifecycle 判据评估建立 ADR（测试策略属横切机制）。

输入为已确认的现状事实与既有测试风格；输出为规则文档与索引条目；验收以规则可执行、与现有测试惯例一致、doc-check/typecheck/test 全通过为准。

## 待定事项

1. 规则覆盖 bench/src + scripts 全域，还是仅约束新增文件、不追溯存量。
2. 豁免清单的粒度：只按类别（类型/数据/入口）表述，还是在规则中显式列举具体文件。
3. rate-limiter.ts、cli.ts 的存量缺口是否本轮补测试，还是记为技术债后续处理。
4. 是否/何时引入方案 B（映射检查）或 C（覆盖率），触发条件如何界定。
5. 定稿后是否需要 ADR；若需要，ADR 承载「为何采用规则文本先行而非机械门禁」的决策前因。

## 验收清单

以下为首版候选验收项，随草案讨论调整；转 plan 时确定为最终清单。

- [ ] docs/rules/testing.md 成文，按「由少到多」标注首批与后续候选；首批条款（覆盖对象/豁免/落位命名/分层断言/隔离与状态所有权/替身边界/文件系统与数据边界/独立入口/增量要求/禁止事项/范例锚点/门禁关系）齐全，后续候选保持未展开。
- [ ] AGENTS.md 规则索引新增指向 docs/rules/testing.md 的条目，含测试前阅读与测试代码修改的验证说明。
- [ ] 规则与现有测试惯例一致，不追溯改动存量测试。
- [ ] `pnpm run typecheck` 全通过。
- [ ] `pnpm run test` 全通过。
- [ ] `node scripts/doc-check.mjs` 全通过。

## 关联 ADR

- 尚未创建。测试策略属横切机制，定稿落地前按 docs/rules/document-lifecycle.md 判据评估建立 ADR；若最终仅落规则、不建 ADR，须在此写明理由。
