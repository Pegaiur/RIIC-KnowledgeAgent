# 实施笔记：单工具调用准入与具名取证提示计划

> 对应 plan：docs/plan-single-tool-call-and-facts-evidence.md
> 开始日期：2026-09-12

## 决策偏离
> plan 中没有提到，但在实施中做出的重要决策

### 2026-09-12 — 提示层先行落地，宿主与能力块留待同批同步
- **背景**：方案定案为「提示引导 + 宿主保留首个、其余回写 protocol_rejected」。编码前先按用户要求把禁止并行的语义写入 knowledge/AGENTS.md，用于观察模型服从性；宿主实现尚未开始。
- **选项**：
  - A: 等宿主实现完成后与提示同批一次提交；
  - B: 提示层先行提交，宿主随后与能力块、测试同批同步。
- **决策**：采用 B。已提交 65d4588（knowledge/AGENTS.md 第 4 条与当时的草案）。
- **影响**：形成过渡态——同一 system prompt 内 knowledge/AGENTS.md 禁止同批，而 agent.ts 运行时能力块仍写「同批调用逐项结算」，宿主仍整批逐项执行。须在计划步骤 1–5 的同一变更内同步，不留长期不一致；偿还前不得以该提示断言宿主行为。

### 2026-09-12 — 探针观察从草案迁出为 exp
- **背景**：草案内嵌 GLM 端点探针（参数接受性与指令服从性）观察结果；转为实施计划后，plan 不应承载观察结果。
- **选项**：
  - A: 观察结果留在 plan；
  - B: 迁入独立 exp，按 ADR-009 归口，plan 只引用结论。
- **决策**：采用 B，迁入 docs/exp/exp-single-tool-call-probe.md（状态：已结束）。
- **影响**：plan 第 36 行据此把「参数无效」收窄为「该配置下观察未阻止多调用，不推断其他模型或端点」；单次小样本、脚本未入库等局限随 exp 保留。

### 2026-09-12 — L34 语义收口为按对象与事实缺口查证
- **背景**：inbox 原口径要求具名干员至少显式调用一次 facts_search；但 hybrid 下 rag_search 会自动附带事实卡，强制显式调用会重复取证，并与单调用约束叠加消耗预算。
- **选项**：
  - A: 严格按原口径要求显式调用一次；
  - B: 实际送达且覆盖对象的附带卡可替代，其余用 facts_search 补查；
  - C: 要求每个对象分别调用一次。
- **决策**：采用 B。不要求逐对象分别调用，不把一次成功视为全部对象覆盖，无对应工具或无预算时说明缺口。
- **影响**：plan 目标与验收第 10 项按此措辞；离线统计只度量「正式名命中对象的事实卡送达」，不称完整服从率，也不判断事实卡是否足以支撑最终结论。

## 实现调整
> plan 中有描述，但实际实现方式不同

### 2026-09-12 — 步骤 1 与步骤 2 在 agent.ts 上交叠，先交付宿主侧计量口径
- **plan 原文**：步骤 1 只做单调用准入与异常边界；requested/denied、granted/attempts、resultChars、toolTrace/ragDelivery 口径与报告标签列在步骤 2。
- **实际做法**：步骤 1 的提交同时改了 agent.ts 的 toolBatch 计数（denied 含 protocol_rejected、granted/attempts 排除它）、toolTrace 与 ragDelivery 过滤；报告/answers.md/快照等消费者留待步骤 2。
- **原因**：宿主计数与 executor 返回状态属于同一可观测行为；若步骤 1 只改 executor，agent 层会把 protocol_rejected 计成获准/执行，中间提交出现与 ADR-016 决策 4 冲突的过渡态，新用例无法转绿。
- **后果**：步骤 2 收敛为报告、answers.md、历史读取与文档标签的消费者改动，无重复实现。

### 2026-09-12 — executeBatch 调用点实际多于初次统计
- **plan 原文**：迁移 executeBatch 调用点，正常先后查询改多次 executeStep，同批用例断言首项准入。
- **实际做法**：除 tool-executor/agent-auto-loop/facts-attach/facts-resolution-executor/inputs 外，facts-tools、section-navigation、fulltext-expansion 也含调用点；同批语义用例（facts 双空查、read_section 空/正文、非法参数多项、rag+facts 混合）改为逐步调用，单调用用例仅改方法名。
- **原因**：初次全仓替换点检索被输出截断遗漏，typecheck 暴露后补齐。
- **后果**：全仓 `executeBatch` 已无残留（文档中的历史说明不受影响）。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项（纯权衡取舍、无遗留债务的决策记入「决策偏离」）
> 可定位到代码的债务须在代码处写 `TODO(tech-debt) <编号>：` 注释（AGENTS.md 编码核心约束 #5），此处只记编号、结论与未来偿还条件

### 2026-09-12 — 新 ADR 未建（计划前置阻塞项）
- **债务**：局部替代 ADR-012「同次响应按顺序执行整批」及其备选方案条目的新 ADR 尚未建立，也未登记 docs/adr/INDEX.md。
- **未来偿还**：无。2026-09-12 已建立 ADR-016 并登记 docs/adr/INDEX.md（状态「已决策」，实施完成后改「已实施」）。

### 2026-09-12 — 提示层与宿主、能力块不一致的过渡态
- **债务**：knowledge/AGENTS.md 已声明「同批额外调用不会被执行、只会被拒绝并回写」，宿主仍整批逐项执行；agent.ts 能力块与 bench/tests/agent-auto-loop.test.ts 的「同批调用逐项结算」断言未同步。
- **未来偿还**：无。2026-09-12 步骤 1 在同一变更内同步了 executor 准入、agent.ts 能力块与计数、provider/inputs/runner 注释及 agent-auto-loop 断言；全仓 `executeBatch` 调用点已迁移为 `executeStep`。

## 意外发现
> 实施中发现的 plan 未覆盖的依赖/边界/风险

### 2026-09-12 — 既有测试断言与提示层新口径直接冲突
- **发现**：bench/tests/agent-auto-loop.test.ts 断言系统提示包含「同批调用逐项结算」；同步能力块文案时若不改该断言会红。plan 步骤 5 只写了「口径一致」，未逐字点名该测试。
- **影响**：实施步骤 1/5 需一并迁移该断言；属已知耦合点，不涉及架构决策，无需新建 ADR。

### 2026-09-12 — doc-check D1 对施工中 plan 的未勾选门禁
- **发现**：doc-check D1 把 docs/ 下的 plan-*.md 一律视为活动计划，存在未勾选验收项即报 error；本计划定稿时验收项必然全未勾选。
- **影响**：文档校验会如实报 D1 error，属计划预期（plan 步骤 5 已写明不为文档检查提前打勾或修改门禁）。合并前按合并门槛处理，不在本笔记或提示层绕过。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

暂无计划相关的实现阻塞；2026-09-12 已完成 ADR-016 与步骤 1（单调用准入），步骤 2–5 待续。
