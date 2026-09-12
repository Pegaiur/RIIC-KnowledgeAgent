# WebUI 与 LLM Agent 框架接入草案

> 创建日期：2026-09-12
> 状态：未定稿，范围与技术选型讨论中
> 需求入口：docs/inbox.md「新增简易 WebUI（查询排障、API Key 与策略/模型设置）」

## 目标

为本机查询提供友好的 WebUI，支持发起查询、查看工具调用与实际送达证据、停止执行，以及设置 API Key、模型和检索策略；明确 Vercel AI SDK 等框架的接入收益与边界，为后续工程定稿提供依据。

本文承载待讨论的工程方案，技术选型和阶段范围尚未定稿。以下架构分析来自代码与官方资料阅读；尚未实施 WebUI、安装框架、执行兼容性 PoC 或付费对照，不代表兼容性已经验证。

## 非目标

- 不因增加界面而调整检索、提示词、工具策略或回答核查口径，不将答案正确率设为本工程验收门槛。
- 首版不默认包含多人协作、公网部署、长期记忆、工作流断点恢复或多 Agent 编排。
- 不将 AI Gateway 或 Vercel 托管作为 AI SDK 接入前提，不默认迁移现有供应商端点。
- 不把完整 Agent 框架替换作为首版交付前置条件；后续阶段是否纳入工程范围仍待定稿。

## 架构分析

“Vercel API”按 Vercel AI SDK 理解，同时单独评估 AI Gateway 的边界。比较现有 Agent 加界面、分层接入 AI SDK、替换为 ToolLoopAgent、Mastra 与 LangGraph JS。资料查阅日期为 2026-09-12；官方页面、搜索索引与主干源码存在版本差异，本轮不指定安装版本，也不将主干 API 视作已发布版本保证。实施前需锁定互相兼容的包版本及 Node 要求。

代码依据为 bench/src/agent.ts、provider.ts、tool-executor.ts、trace.ts、runner.ts、config.ts、pricing.ts 及相关 tests；语义依据包括 ADR-012、ADR-013。外部能力依据为下文官方文档与 vercel/ai 官方仓库资料。

### 现有实现与 WebUI 缺口

| 代码中已具备的能力 | 对 WebUI 的价值与缺口 |
|---|---|
| runQuery 接受配置、语料索引与可选 trace，返回回答、费用记录与终止原因 | 可以成为 CLI/WebUI 共同执行入口，不必为界面新建一套 Agent |
| provider 非流式调用，具备限流、重试、请求超时与 HTTP 尝试台账 | 可先显示模型步骤进度；逐 token 输出仍需新增流式传输与结算适配 |
| Agent 有内部整题 AbortController，但 AgentOptions 没有外部取消信号 | “停止”按钮需要贯通请求取消、限流等待和台账收束，关闭前端流本身不代表服务端停止 |
| trace 记录 rawArguments、actualParams、writtenContent、hitIds、injectedIds、fulltextRanges、attachedFacts | 能解释参数、命中和实际送达的差异，价值高于只显示工具名称；通用调试器不能自动解释这些业务字段 |
| trace 在内存累积，runner 每题结束写 trace.jsonl | 尚无实时事件订阅；部分事件会原地补写，直接监听数组新增会漏掉更新。工具事件 elapsedMs 当前填 0，不能当成实测耗时 |
| 成功额度默认 5、获准尝试上限默认 10；同批逐项串行结算 | 这两个数均不是模型步骤上限。耗尽后保留工具、回写拒绝，直到回答或整题超时，不能直接映射为框架 stopWhen |
| config 支持 Qwen、Hy3、GLM、DeepSeek，各有端点/思考约束 | 有统一接入基础，但“兼容 OpenAI”不证明所有流式、思考、usage 字段语义相同 |
| API Key 从 secret.yaml 优先读取，环境变量兜底；trace 写盘做已知密钥遮蔽 | 可复用配置来源和脱敏能力，仍需新增安全的设置写入接口与浏览器输出边界 |

### 框架带来的实际收益

以下收益和成本为结合本仓库的工程判断，未测量工时、运行开销或排障提速比例。

| 方案 | 主要收益 | 本项目新增负担 | 适用判断 |
|---|---|---|---|
| 现有 Agent + 轻量本地 WebUI | 最直接展示现有证据和计量；复用 CLI 执行逻辑 | 查询 API、事件推送、取消、设置与页面需自行实现 | 首版可行性高，迁移成本最低 |
| AI SDK UI + 自有后端 | 复用聊天状态、流协议与工具消息交互 | 需要把自有事件映射为 UI 协议；领域调试页面仍需写 | 若确定需要聊天式流界面，优先考虑 |
| AI SDK Core/Provider + 现有循环 | 标准化模型调用与流式解析，接入 SDK 调试工具 | 保留底层 HTTP 尝试、原始 usage 与 provider 私有参数的适配工作 | 中期收益较高，先做小范围兼容验证 |
| ToolLoopAgent 替代循环 | 复用工具循环与生命周期接口，减少通用编排代码 | 预算、批次准入、错误回馈、回答判定、重试计费均需迁移 | 技术可行，但仅为首版 WebUI 收益不足 |
| Mastra + Studio | 现成 Agent 对话、模型设置、工具独立运行、工作流及 trace 界面 | 接入其 Agent/工具/存储体系，保留领域证据展示与基准输出；可能重复维护两套运行表示 | 若优先要现成综合调试台，是最值得试用的完整框架候选 |
| LangGraph JS | 显式状态图、checkpoint、暂停恢复和从历史状态分支调试 | 状态建模、持久化、重放语义及 UI/观测接入 | 有长流程、人工介入、恢复执行需求时收益明显；当前需求尚不充分 |

AI SDK 的 UI 协议允许自定义后端，因此使用 useChat 并不要求迁移到 ToolLoopAgent；工具状态与自定义数据可以映射到界面。仅接 UI 层不会自动获得模型调用 DevTools，后者需要 SDK 调用链的观测接入。[AI SDK Stream Protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)

AI SDK 提供 TypeScript 模型与流式调用抽象。AI SDK 与 AI Gateway、Vercel 托管是不同选择：可以显式构造直连 provider，继续使用本机 Node 和现有供应商密钥；官方文档中的模型字符串简写默认会走 Gateway，不能不加区分地复制到当前基准。[AI SDK](https://vercel.com/ai-sdk)、[Gateway 默认 Provider](https://vercel.com/docs/ai-gateway/models-and-providers)

官方 OpenAI Compatible Provider 主干支持 baseURL、apiKey、自定义 fetch、流式 includeUsage、请求体转换和 metadata 提取。这为 Qwen 的 enable_thinking、Hy3 的请求字段及自有 usage 适配提供接入空间；仍需以选定发布版本验证，不能据此宣称当前四个端点已兼容。[官方 Provider 源码](https://github.com/vercel/ai/blob/main/packages/openai-compatible/src/openai-compatible-provider.ts)

ToolLoopAgent 有 stopWhen、prepareStep 等扩展点，但自然结束条件和默认步骤限制与本项目有差异。尤其“未调用工具直接回答时回馈一次”的逻辑，不能假定仅设置 stopWhen 就能继续执行。[官方循环控制文档](https://github.com/vercel/ai/blob/main/content/docs/03-agents/04-loop-control.mdx)

AI SDK DevTools 可查看输入输出、工具调用、token 与步骤信息；所查文档将其列为实验性的本地开发工具，并说明会把交互数据明文写入本地文件。因此它适合作为补充调试器，不能直接替代 inbox 要求的密钥设置、检索设置和领域送达视图。启用前需核对所选版本的捕获内容和脱敏位置，现有 serializeTrace 不会自动保护旁路日志。[AI SDK DevTools](https://ai-sdk.dev/docs/ai-sdk-core/devtools)

Mastra Studio 官方文档明确支持本地交互、模型参数调整、工具独立调试、工作流视图和观测；对“尽快获得现成调试台”的目标，它比单独 AI SDK 更直接。自有 runQuery 即使整体包装成一个工具，也只会得到外层观察，内部细节仍须埋点和映射，不能把这种包装当成完整集成。[Mastra Studio](https://mastra.ai/docs/studio/overview)

LangGraph JS 的重点是状态化编排；checkpoint 支持暂停恢复、历史状态回放和分支。界面与 tracing 属于另一个集成层，采用图运行时本身不会完成本项目的 WebUI。已有 trace 的只读回看也不等于从 checkpoint 重新执行；后者可能再次发出模型请求，需要单独界定费用和重放范围。[LangGraph JS](https://docs.langchain.com/oss/javascript/langgraph/overview)、[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)

### 迁移必须保留的契约

1. **工具批次语义**：缺失或重复 call ID 的整批拒绝；按返回顺序准入、执行、结算；所有调用按 ID 回写结果。不要把工具直接交给默认调度后假定仍满足这些条件。
2. **双预算与终止**：success/empty/invalid_params/error 的扣账不同，超限拒绝不增加获准尝试。模型步骤、HTTP 尝试、工具尝试分别记录；保留现有超时、空回答、截断和无工具回馈行为。
3. **消息原貌**：既有工具 schema 和 serializeToolResult 生成的模型可见正文应保持可比；避免 SDK 自动参数修复、schema 校验或对象序列化无意改变错误回馈与送达文本。
4. **真实费用**：重试只能由明确的一层负责。SDK 成功步骤 usage 不足以代替 HttpAttempt 台账，失败和取消请求也可能产生费用。缓存、reasoning 分项缺失保留未知，按每次请求输入档位计价，不能先汇总 token 再套一档价格。
5. **流式结算**：增量只供展示；最终 usage 缺失、途中断线、已显示正文但最终截断时，不能按完整成功记录。部分输出不自动成为 finalAnswer。
6. **送达事实**：保存实际写入模型的 writtenContent 与送达范围；命中、附带尝试、成功送达分别呈现。trace 不展示 hidden reasoning，不把通用 UI 的推理面板当成本项目要求。
7. **历史与基准**：CLI/WebUI 共用同一领域执行逻辑。WebUI 的会话设置和历史对话不隐式进入正式 bench；历史记录不补造缺失值，也不以框架估算费用覆盖现有计量。

## 实施方案

以下按依赖顺序给出候选实施路径，各阶段均尚未实施。首版以第一阶段为建议范围，第二、三阶段为后续可选演进，不默认全部纳入计划。

### 第一阶段：本地查询服务与调试界面

第一阶段建立本地查询服务，复用 runQuery、配置校验、语料加载与脱敏 trace；WebUI 展示回答、模型步骤、工具参数/结果、送达证据和费用完整度。优先做真实步骤进度，再决定是否需要 token 流；当前 provider 非流式，不能把完整结果拆字发送冒充模型实时生成。新增事件出口需不影响执行语义，并为开始、完成、失败和取消提供明确状态。前端是聊天页还是调试面板，不应决定底层循环是否迁移。

输入为现有执行入口、配置与 trace 契约；输出为本地服务、查询页面、证据视图和设置页面。建议先确定事件与取消接口，再实现服务端与界面消费者。验收以同一输入下 CLI/WebUI 的工具结果、预算和计量口径一致，以及查询、取消、设置行为可验证为准，不要求随机模型回答逐字相同。

建议设置规则作为后续方案输入，尚未实施：

- 密钥设置保存到既有 secret.yaml 对应 provider 字段，不再增加浏览器持久化密钥库；界面读取只返回“已配置/未配置”和来源。服务端只更新目标字段，采用原子写入并处理文件并发修改。
- 密钥优先级继续是 secret.yaml > provider 环境变量；删除文件配置后如有 env 兜底，界面须显示真实生效来源。提交密钥只走本地服务端，错误、事件和下载记录均在输出前脱敏。
- 非密钥配置建议“本次显式设置 > WebUI 本地预设 > loadConfig 默认值”，由服务端校验并在查询开始冻结；CLI 不读 WebUI 预设，不修改 EXPERIMENT 作为临时调试方式。持久化位置在后续 ADR/plan 中确定。
- 模型与价格绑定配置；自定义模型没有已核验价格时显示费用未知，不能沿用原模型价格。思考档位必须符合各 provider 约束。
- 本机服务默认仅监听回环地址，设置写入与查询接口检查 Origin/Host，避免任意网页操作本地密钥或触发请求；浏览器不直连模型供应商。
- 首版每次查询独立，若未来增加连续对话，另行定义历史输入和预算重置语义。手动调试结果独立于正式基准记录，明确记录实际非密钥参数。

### 第二阶段：可选的 AI SDK Provider 接入

在需要 token 流或维护更多 provider 时，对 AI SDK Provider 做隔离兼容性验证。输入为锁定版本的 SDK 与既有请求/响应契约；输出为可供现有 Agent 调用的适配层及验证结果。继续让现有 Agent 掌握工具批次和计量，SDK 负责单次模型调用；协议收益足够再替换 provider。若为保持台账必须重写 SDK 大部分传输层，说明此层迁移收益不足，可以继续只用 UI 层。

验收须覆盖下文 Provider、预算、重试、取消和流式结算项目，并确认仍可读取历史记录；真实端点兼容性在约定付费范围内另行验证。未通过前不替换正式基准调用路径。

### 第三阶段：按需求选择完整框架

仅在出现具体需求后比较整体框架：需要现成统一工作台时验证 Mastra；需要持久化、人工暂停、状态分支和长流程恢复时验证 LangGraph；当自有循环大部分已被 SDK 的稳定接口覆盖且兼容层较少时，再评估 ToolLoopAgent。输入为明确的新增需求和前述兼容性证据，输出为独立的框架取舍及迁移范围；验收重点是所需新能力能否交付、既有契约能否保留及适配维护成本是否值得。实际引入架构依赖、变更公共接口或部署策略时建立 ADR，并形成工程 plan；本文不代表选型已被采纳。

### 验证设计（尚未执行）

| 验证对象 | 需要观察的证据 |
|---|---|
| 发布版本与构建 | 锁定 ai、UI、provider、DevTools 的兼容版本，验证 NodeNext/ESM 与 Windows 构建；不复制不同大版本示例混用 |
| Provider 请求/响应 | 使用脱敏合成响应覆盖工具、多调用、参数错误、截断、缓存/思考字段；逐字段比较出站请求与既有适配 |
| 预算和协议 | 最后一点额度前遇到错误再遇到成功、重复 ID、超限拒绝、无工具回馈；比对消息和账本而非答案措辞 |
| 重试与取消 | 可重试状态、Retry-After、响应体中断、重试等待中取消、usage 缺失；每次 HTTP 尝试可追踪，未知不变零 |
| UI 和设置 | 断线重连不重复发起查询；停止传播；配置在运行中保持冻结；密钥不回显，恶意来源写入被拒绝 |
| 真实端点 | 后续单独界定付费范围后，验证 Qwen、Hy3 及需要继续支持的 GLM/DeepSeek 流式兼容，不以品牌协议兼容代替实测 |
| 收益是否兑现 | 记录搭建复杂度、仍需维护的适配代码，以及定位同类问题所需操作；未实测前不承诺提速比例 |

工程验证优先复用现有 provider、usage、agent-auto-loop、agent-provider-ledger、tool-executor、trace、pricing、runner 和 snapshot 测试。代码变更按仓库规则执行 typecheck/test；原生 Windows 首次 Playwright/Chromium E2E 按 AGENTS.md 先请求 sandbox escalation。质量变化只作为观测，不设答案达标线或针对当前题集追分。

## 待定事项

建议分层引入：首版 WebUI 共用现有 Agent 和领域 trace；需要成熟聊天流界面时可采用 AI SDK UI，Provider 层经契约验证后再替换。完整框架技术上可行，但仅凭当前“查询排障、密钥和参数设置”需求，尚不足以抵消循环迁移与基准语义维护成本。Mastra 是偏向现成调试台的备选，LangGraph 是偏向状态恢复与复杂编排的备选。

预期收益集中在操作便利、调试可见性与减少通用接入代码；没有证据表明框架会提高 RAG 正确率、降低 token 费用或加速模型推理。AI Gateway 的统一路由属于独立网络/供应商/计费选择，当前直连基准没有引入它的必要。

定稿前需收口以下问题：

1. 首版采用自有调试页面还是 AI SDK UI；前端与本地 HTTP 服务的具体依赖、构建和启动方式。
2. 首版是否包含逐 token 输出，还是先交付模型步骤与工具事件进度；事件更新、断线重连和外部取消的公共接口。
3. 非密钥预设的存储位置、允许修改的参数集合及 API Key 文件并发更新方式。
4. 历史运行查看和调试结果保存的范围，以及与既有 bench 目录和格式的关系。
5. 第二、三阶段是否立项；若需要框架兼容性验证，明确发布版本、端点集合、付费范围与停止条件。

本草案未经独立复核，兼容性和实际收益仍待验证。需求继续由 docs/inbox.md 承接；范围与方案确认后转为 docs/plan-*.md，按架构变更判据补 ADR。当前不启动实施。

## 验收清单

以下为首版候选验收项，随草案讨论调整；转为 plan 时确定最终清单。可选框架迁移的验收项仅在对应阶段获纳入范围后加入。

- [ ] 可以在本地界面发起独立查询，看到回答、步骤进度和完成/失败/取消状态。
- [ ] 可以检查工具参数、实际结果与送达正文，区分命中和送达，不把未测耗时显示为实测值。
- [ ] 停止查询能传播到服务端执行，取消与失败仍保留已发生的请求台账，重连不会重复触发查询。
- [ ] 可以设置 API Key、模型和检索策略，遵循确定的来源优先级、运行配置冻结及密钥脱敏规则。
- [ ] CLI 与 WebUI 共用领域执行逻辑，双预算、工具协议、费用未知值和正式基准输入边界得到保留。
- [ ] 本地服务访问边界、配置并发写入和浏览器交互通过相应验证。
- [ ] `pnpm run typecheck`、`pnpm run test` 与 `node scripts/doc-check.mjs` 通过。

## 关联 ADR

- ADR-012 — 已有工具双预算与批内串行结算约束。
- ADR-013 — 已有原文送达范围、facts 附带及观测约束。
- WebUI 依赖、公共接口与可选框架接入的 ADR 尚未创建，待本草案选型与范围收口后按判据建立。
