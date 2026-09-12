# 测试架构计划

> 创建日期：2026-09-12
> 状态：施工中

## 目标

为 bench/src 工具链与 scripts 开发脚本建立单一成文的测试约定，使增量开发时「是否需要写测试、写在哪、断言到什么程度」有统一依据；本轮只落规则文本与索引、提交技能一致性，不引入新的机械门禁或覆盖率门槛。

## 非目标

- 不引入覆盖率阈值，不新增 src↔test 映射检查或其他测试门禁；merge/release 门禁命令构成不变（scripts/gates.mjs 的 BASE_STEPS 不动）。
- 不把回答正确率、逐题评分纳入自动门禁，也不据此调整测试断言（沿用 AGENTS.md 核心约束 7/8/9）。
- 不批量重写或迁移存量测试；约定自生效起只约束范围内文件的新增与修改行为。
- 本轮仅交付规范，不修改测试或运行时代码，不补 bench/src/rate-limiter.ts、bench/src/cli.ts 的存量缺口；下文存量范例规定规范生效后的处理方式，不是本轮修复清单。
- 不展开后续候选机制（真实网络显式 opt-in、环境变量专用 API 教程、带 g/y 标志正则的 lastIndex 专项治理等）；涉及配置的新增测试仍须控制文件与环境输入，不能以未规定某个 API 为由依赖本机密钥。
- 不新建测试用例清单、任务台账或第二份注册表；约定只以 docs/rules/testing.md 单一成文。

## 架构分析

现状（2026-09-12 实测）：

- 框架：Vitest 2.1.9（^2.1.0）；vitest.config.ts 的 include 为 bench/tests/**/*.test.ts、bench/tests/**/*.test.mjs、scripts/**/*.test.mjs，无 coverage/setup/timeout 扩展配置。
- 规模：`pnpm run test` 41 文件、493 用例全部通过；bench/tests 为集中式扁平目录（40 个文件），scripts 侧为 scripts/tooling.test.mjs 与 bench/tests/reference-projection.test.mjs。
- 门禁：`pnpm run test` 已在 scripts/gates.mjs 的 BASE_STEPS 内，随 scripts/verify.mjs 的 merge/release profile 执行。
- 缺口：docs/rules/ 无测试规则，AGENTS.md 十条核心约束无一涉及测试，无 src↔test 映射；命名、落位、断言风格全靠模仿现有文件，Agent 增量开发缺成文依据。

关键约束：

- 新增 scripts 测试不能与源码同目录：scripts/tooling.mjs 的 listTasks 递归收集 scripts/tasks/** 下全部 .mjs（目录发现即注册），listLibModules 按扩展名把 scripts/lib/ 下全部 .mjs 列为基元，同目录的测试文件会被误收为任务或基元。
- 存量测试有未追溯差异（agent-provider-ledger.test.ts 以 vi.unstubAllGlobals 成对清理 stubGlobal，provider.test.ts 未配；inputs.test.ts 把 EXPERIMENT 写回固定值而非前值）。inputs.test.ts 的 resetModules + doMock 是按场景选择的隔离手段，不能仅因使用该 API 判为违规。当前确认的治理缺口是缺成文约定，尚未证明机械检查能发现哪些真实遗漏，故采用规则文本先行。
- 41 文件、493 用例是转换前的运行记录，不是覆盖率结论或固定验收数量；实施后记录当次实测结果。scripts/lib 没有独立测试文件，但部分基元会被 tooling 测试间接执行，不能称全部未覆盖。

## 实施方案

实施进度以验收清单为准，计划细化不等于交付完成。遗漏与边界调整已记入 docs/plan-testing-architecture-notes.md，后续继续按 docs/templates/notes.md 流式记录实施决策，不恢复原草案。

按依赖顺序，1–4 为文档与技能交付，5 为收尾核验。先确立 ADR 与规则，再同步入口和提交技能；规则、入口、技能组成同一完整行为交付，不能发布相互矛盾的中间状态。涉及文件为本 plan/notes、ADR/INDEX、docs/rules/testing.md、AGENTS.md、scripts/INDEX.md、skills/commit-convention/SKILL.md 和 docs/inbox.md；无须提前创建空的 scripts/tests/ 目录或样板测试。

### 1. 建立 ADR（测试策略属横切机制）

- 输入：本计划的决策（测试约定采用规则文本先行、不引入机械门禁与覆盖率阈值）及已排除的备选（src↔test 映射检查、覆盖率阈值）。
- 动作：按 docs/rules/document-lifecycle.md「ADR 判定与维护」判据，从 docs/adr/INDEX.md 取当前最大编号 +1 新建 `docs/adr/ADR-NNN-testing-convention.md`（参照 docs/templates/adr.md），并在 INDEX.md 追加一行。
- 输出：ADR 文件与 INDEX.md 行；建立时为「已决策」，实施全部完成后两处同步为「已实施」。同步替换本计划验收清单中的编号占位，不改写更早 ADR 来反向引用本决策。
- 验收：ADR 状态与 INDEX 一致（doc-check D2）；只引用更小序号 ADR，无前向引用（doc-check D5）。

### 2. 起草 docs/rules/testing.md（规则本体）

- 落位：新建 docs/rules/testing.md，frontmatter description 为「新增或修改 bench/src、scripts 的运行时行为，或新增、修改、删除相关测试时生效」。测试维护本身也触发规则，不限定为新增源码。
- 分批：只收有存量实例或直接对应漏写风险的条款；后续候选仅留在本文「非目标」，不写成已生效规则。每组注明检查方式：现有门禁检查、人工审查，或未来可部分静态检查（当前仍靠人工）。命名、隔离、覆盖充分性均没有现成机械检查，不能因条文写出 API 或文件模式就标为已自动校验。
- 六组内容要点：
  1. 覆盖对象与豁免（人工审查）：覆盖 bench/src 及 scripts 根入口、lib、tasks 中新增或变化的可观测行为，包括计算、校验、文件写入/删除保护、配置覆盖、失败与取消处理。优先按风险选择正常、边界、错误路径，不要求穷举所有分支；脚本可用临时目录、依赖注入和子进程测试，不限纯函数。纯类型声明、纯数据常量、无独立判断的入口转发装配可豁免新增专属测试，但数据的计数、关系和投影契约仍须由相应测试覆盖。新增行为可由已有用例覆盖，不要求一个源码文件对应一个测试文件；一次性临时脚本不强制配测试。
  2. 落位与命名（人工审查，未来可部分静态检查）：bench 测试沿用 bench/tests/，默认 <模块>.test.ts；重名或跨模块行为使用语义明确的 <主题>-<行为>.test.ts。scripts 新增测试集中 scripts/tests/：根入口对应 scripts/tests/<name>.test.mjs，lib 对应 scripts/tests/lib/<name>.test.mjs，tasks 对应 scripts/tests/tasks/<domain>/<name>.test.mjs。Vitest 现有 include 已覆盖；禁止在 scripts/tasks 或 scripts/lib 放测试造成误发现。既有 scripts/tooling.test.mjs 与 bench/tests/reference-projection.test.mjs 可继续修改和补充，无须迁移或在新目录重复建文件。数据门禁沿用 <域>-gate / <域>-integrity 命名。
  3. 行为与回归断言（人工审查）：单元测试验证结果、边界与错误；契约测试验证真实被测路径的协议、计量、顺序及失败传播；数据门禁校验真源计数和关系。断言公共行为而非私有步骤，不在测试里复写整套生产算法计算预期。改公共行为时相关测试与实现同提交；修 Bug 先运行能复现原错误的回归用例，再修实现、验证转绿。纯重构保留原行为断言，可调整私有导入等测试装配；不要求为已有充分覆盖的改动制造重复测试。
  4. 隔离与替身（人工审查，未来可部分静态检查）：默认套件不触网、不调用真实 LLM；发请求的路径须在调用前替换网络或 provider 边界，合成密钥本身不构成网络隔离。仅替换该用例相对于被测对象的依赖边界，不替换被测行为本身；可用工厂 mock、spyOn、doMock，需消费其他真实导出时允许局部保留，不强制全模块替换。全局替身使用 stubGlobal/unstubAllGlobals 配对，spy 与 vi.fn 的调用记录/实现分别用合适的恢复或复位方法，不能指望一个清理 API 覆盖所有状态。模块可变状态优先保存前值并恢复；需要重新初始化模块时可 resetModules 后动态导入，注意旧静态引用不重建、mock 注册须另行清理。修改 mock 时核对真实接口和返回结构，避免假实现掩盖协议变化。测试不得依赖用例顺序或其他用例提前设置状态；对共享全局/模块状态的用例不使用并发执行。
  5. 数据与断言维护（人工审查）：版本控制内语料可读；写操作使用测试创建的唯一临时目录，成功与失败路径都通过 finally/afterEach/afterAll 清理，先确认待删目标为本测试持有的目录，不能修改真实语料、secret.yaml 或 bench-runs。复制夹具时限定需要的输入，存量整目录复制不因本轮规则制定强制迁移。运行历史读取测试使用临时目录构造最小 records/meta 等输入，不读取本机真实运行目录。密钥测试用合成值或显式缺失值，新增测试若涉及配置优先级/回退，还须控制 secret 文件读取与相关环境变量并恢复；不读取或覆盖用户真实密钥作为测试准备。异步用例须 await/rejects 等待任务收束，再恢复替身和清理目录；用到计时器或取消监听时负责终止与恢复，避免真实短暂等待猜测完成。数据、协议、需求确有变化才同步预期并给出依据；删除/合并用例须证明对应行为已废弃或有等价覆盖。不以当前输出、模型答案或评分替代预期依据；不以放宽断言、skip/todo/only 或筛选重跑掩盖已有失败。
  6. 验证与变更说明（现有门禁检查执行结果，覆盖理由靠人工）：普通代码及测试改动运行 `pnpm run typecheck` 与全套 `pnpm run test`；开发中可先使用 `pnpm run test -- bench/tests/provider.test.ts` 等定向命令，不能替代最终全套验证。纯文档/注释不强制新增用例，按既有文档路由验证。变更说明简述行为、对应测试文件及用例主题、验证结果；无新增测试时指出已有覆盖或类别豁免。观察到失败先区分本次缺陷、测试隔离问题、前置环境与既有失败，保留失败事实；未经消解不得称全通过，重跑通过不抹去偶发失败，也不自动授权模型质量优化。
- 范例：正式规则纳入下节存量处理原则、两段清理示例和六类变更判据；只引用存量文件中明确的局部模式，不宣布整份测试完全合规。API 语义依据 [Vitest 2 模块复位](https://v2.vitest.dev/api/vi#vi-resetmodules) 与 [全局替身还原](https://v2.vitest.dev/api/vi#vi-unstuballglobals)，两者不能替代彼此。
- 验收：六组齐全、检查能力如实标注；默认离线、临时目录、异步收束、断言更新与删除都有可执行动作；不以当前测试全绿证明所有存量已符合新规。

### 3. AGENTS.md 与 scripts 导航、验证路由

- 规则索引表新增一行指向 docs/rules/testing.md。
- 「运行与验证」补充：修改测试代码后运行全套 `pnpm run test`。
- 「AI 代理发现流程」注明新增/修改运行时行为及新增/修改/删除测试前先读该规则，避免只有已经决定写测试时才会读取。
- scripts/INDEX.md 的目录职责追加 scripts/tests/（只在首次新增测试时实际创建），并按名称引用 docs/rules/testing.md；该索引只描述测试目录职责及不参与 task/lib 发现，不复制断言规范或新增注册表。
- 验收：人工确认 AGENTS、scripts/INDEX 到规则的引用存在、触发范围完整；doc-check D4 只覆盖其既有脚本引用范围，不能证明这些 Markdown 引用有效。

### 4. 提交技能一致性修订

- 输入：skills/commit-convention/SKILL.md「多文件提交策略」现要求按数据/测试/表现层拆分，与 testing.md「改公共行为须同一次提交内更新测试」冲突。
- 动作：改为按完整行为分组——相关实现与其回归测试同一原子提交，其余仍按单一关注点分组。
- 技能的「变更分析/验证」步骤按名称引用 docs/rules/testing.md，要求检查行为与测试的对应关系或豁免依据；不复制六组规则，不改独立审查、精准暂存或授权边界。独立审查提示词已有项目规则自发现，无需再复制一套测试条款。
- 验收：技能结构校验（doc-check S）通过；规则与技能无相互矛盾表述。

### 5. 收尾核验

- 先按下文六类场景走查规则，确认每类都能判断覆盖、落位、处置范围和验证方式；记录结论于既有 notes，不新建检查台账，也不为验证文档新增样板测试。
- 实施阶段运行 `pnpm run typecheck`、`pnpm run test`、`node scripts/doc-check.mjs` 与 `git diff --check`，记录实际结果。检查配置与门禁无变化，套件数量按当次结果报告；本计划不要求为凑 493 条而保留或制造用例。
- 施工中的 D1 未勾选提示属于如实记录的未完成状态，不能据此放宽 doc-check 或提前勾选；其他错误仍须逐项检查，不能预先保证“只会有 D1”。交付完成、清单按证据收束后重新运行 doc-check 确认无错误，不把施工期有 D1 的结果报告为全通过。
- ADR/INDEX 改为「已实施」，inbox 对应需求完成后勾选；人工核对旧草案名称不再出现在活动入口。plan/notes 按既有发版归档流程处理，不恢复草案或手动拼接归档。真正提交时执行 commit-convention；本次补全计划不自动提交或发版。
- 合并前依照现有流程完成计划归档和发布准备，再执行 `node scripts/verify.mjs merge -- --base main`；本计划的规则文档验收不能替代完整合并门禁。

## 存量差异的处理原则与范例

“违规”以下按新规范生效后的标准判断，不将尚未生效的约定追溯为历史开发过错。本轮仅交付处理规范，以下均未修改对应代码。

### 处理范围

1. 未触及的旧文件、仅改文字或格式：不顺带全量整改、补测或迁移；说明按增量适用即可，不为每个旧差异增加豁免登记或 TODO。
2. 新增/修改用例或行为：核对该用例、它使用的夹具及共享 hook；若共享状态影响新用例，必须在同一变更内修复该边界，不能用“存量”豁免。修改公共 hook 后跑其影响的整个测试文件，再跑全套；不扩大到无关文件。
3. 删除用例：确认覆盖替代或行为废弃，同时回收仅该用例使用的替身、夹具、辅助函数；不能留下无消费者的测试资源。
4. 发现本次路径之外的问题：不以顺手治理扩大范围。若正式接受为延期技术债，才按 AGENTS.md 的 TODO(tech-debt) 约定落到代码，notes 仅留编号与结论；本节示例不是债务清单。若问题导致本次验证不可信，先消解或如实报告阻塞，不隐瞒或越过门禁。

### A. fetch 替身清理：provider.test.ts

现状：afterEach 仅调用 vi.restoreAllMocks，多处用例调用 vi.stubGlobal('fetch', ...)；后者的全局替换不能靠 restoreAllMocks 撤销。若未来修改这些请求路径用例，或新增用例受该共享 hook 影响，应保留 spy 清理并补充全局还原；仅修改无关说明文字时不要求整改整个文件。局部范例可参考 bench/tests/agent-provider-ledger.test.ts 的 afterEach。

```ts
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
```

对请求用例，在发起调用前安装 fetch 替身并使用合成密钥，等待请求/取消 Promise 完成后才进入清理。以原有请求协议、计量与取消断言验证行为，不新增只检查“调用过 unstubAllGlobals”的测试，也不改 ProviderResult.usage 的当前契约来顺带解决 inbox 中另一项计量需求。

### B. 模块状态恢复：inputs.test.ts

现状：共享 afterEach 把 EXPERIMENT.tokenizer/entityBoost 写成 bigram/0，未恢复每个用例进入前的值。未来修改该 describe 下用例时，检查它依赖的共享清理；由 beforeEach 捕获前值，afterEach 恢复同一对象的已修改字段，保留已有 mockCall.mockReset。不在 describe 声明阶段捕获一次前值，也不以 resetModules 替代旧静态 EXPERIMENT 引用的恢复。

```ts
let previous: Pick<typeof EXPERIMENT, 'tokenizer' | 'entityBoost'>

beforeEach(() => {
  previous = {
    tokenizer: EXPERIMENT.tokenizer,
    entityBoost: EXPERIMENT.entityBoost,
  }
})

afterEach(() => {
  EXPERIMENT.tokenizer = previous.tokenizer
  EXPERIMENT.entityBoost = previous.entityBoost
  mockCall.mockReset()
})
```

实施该修复时同步添加 beforeEach 的 Vitest 导入；若用例还改了其他字段，按实际所有权补充捕获。该示例只针对静态对象；inputs.test.ts 的动态 facts 失败用例仍可 resetModules + doMock，须用 finally/doUnmock 清理各自注册，并在需要真实新实例时重新清缓存、动态导入，不能混用新旧模块状态。没有隔离需求时不为统一风格批量改写动态用例。

### C. 旧落位、CLI 与数据维护

| 已有实例/未来变更 | 应做 | 不应做 |
|---|---|---|
| 修改 scripts/tooling.test.mjs 或 bench/tests/reference-projection.test.mjs 已覆盖的行为 | 在原文件更新或补充相关用例；首次为其他脚本新建文件才走 scripts/tests/ | 强制迁移存量，或复制一套同样用例到新目录 |
| 新增 scripts/tasks 的写入、删除或失败处理 | 在临时根目录验证输出、失败后的状态和路径保护；子进程通过 Node 参数数组启动，Windows 隐藏窗口；清理仅本测试目录。借鉴 tooling.test.mjs 的临时根与 finally 模式 | 以“不是纯函数”为由豁免，或在真实工作区测试删除 |
| 未来修改 cli.ts 的开关校验、配置覆盖、输出行为 | 覆盖发生变化的 CLI 行为；可用隔离子进程或必要时抽出逻辑测试。继续只转发的装配代码可说明豁免 | 只运行 cli-args.test.ts 就声称配置应用与退出码已覆盖，或借此全量补齐 CLI |
| 未来修改 rate-limiter.ts 的耗尽/补充/取消行为 | 围绕此次变更建立令牌与等待/取消断言，采用可控时间并清理计时器；不使用真实长时间等待 | 因目前没有专属测试而豁免本次新增行为，或本轮提前补测 |
| references 真源更新使 final-gate.test.ts 的 425/913 失效 | 依据真源变更确认新数量与关系，再同步相关硬断言；保留关系/投影校验 | 把精确计数改成大于零，仅照实际输出替换数字，或固定旧数量阻止正常数据更新 |
| config/runner 测试涉及缺少密钥或配置回退 | 如 runner.test.ts 验证缺密钥路径时显式设 config.apiKey 为 undefined；回退/优先级测试还须隔离文件读取和相关环境输入。临时夹具和脱敏断言使用合成值 | 以 loadConfig 能读取真实 secret.yaml 为测试前提，或把真实配置对象传入会显示密钥的失败断言 |

## 规则验收走查

以下是人工走查输入与预期判定，实施者将结果写入现有 notes；不新增六个机械测试或逐文件登记表。

| 变更类型 | 规则必须能给出的判定 |
|---|---|
| 新增行为 | 明确可观测契约与主要边界；复用已有测试或按新落位建用例，不以有文件代替有断言 |
| 修改行为 | 实现与相关断言同提交；预期有需求/协议依据，依赖的旧 hook 按存量原则处理 |
| 修 Bug | 先有能复现原错误的回归用例，再修复并验证；不能把模型答错本身当成实现缺陷 |
| 纯重构 | 公共行为不变且现有测试充分时可不新增；更新装配、导入或确属实现细节的断言须保持行为覆盖并说明理由 |
| 数据更新 | 从真源确认计数/关系变化后更新断言；不使用模型回答、评分或当前输出替代依据 |
| 脚本副作用 | 在隔离临时目录覆盖改变的写入/删除/错误行为，确认资源回收和真实工作区无写入；不能套入口或纯函数豁免 |

## 验收清单

- [ ] docs/adr/ADR-NNN-testing-convention.md 建立并在 docs/adr/INDEX.md 登记，状态一致、无前向引用
- [ ] docs/rules/testing.md 成文：六组齐全，覆盖 scripts 副作用及测试维护，检查方式如实标注，不含未生效的候选条款
- [ ] 规则包含默认离线、合成密钥、临时目录与异步资源清理、模块状态与 mock 注册分别复位的执行约定
- [ ] 规则包含存量增量适用边界、fetch/EXPERIMENT 清理范例，以及旧落位和断言更新/删除的处理判据
- [ ] AGENTS.md 与 scripts/INDEX.md 入口、目录职责及验证路由更新到位，人工确认 Markdown 引用有效
- [ ] skills/commit-convention/SKILL.md 按完整行为分组，并在变更分析/验证中引用测试规则，与 testing.md 无冲突
- [ ] 六类变更人工走查完成，结论记入既有 notes，无新增测试台账或逐文件豁免表
- [ ] 未新增机械门禁或覆盖率门槛，scripts/gates.mjs、vitest.config.ts、依赖及运行时/测试代码未改动，无空样板测试
- [ ] ADR/INDEX 状态同步为已实施，inbox 对应需求标记完成，活动入口不残留原草案名称
- [ ] `git diff --check` 全通过
- [ ] `pnpm run typecheck` 全通过
- [ ] `pnpm run test` 全通过
- [ ] `node scripts/doc-check.mjs` 全通过

## 关联 ADR

- 新建 ADR（编号在实施第 1 步按 docs/adr/INDEX.md 当前最大编号 +1 确定）— 记录「测试约定采用规则文本先行、不引入机械门禁与覆盖率阈值」的横切决策；判据见 docs/rules/document-lifecycle.md「ADR 判定与维护」。

---
<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
