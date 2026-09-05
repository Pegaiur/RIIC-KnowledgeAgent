# 实施笔记：Agent 单题执行记录

> 对应 spec：docs/plan-agent-trace-observability.md
> 开始日期：2026-09-05

## 决策偏离
> spec 中没有提到，但在实施中做出的重要决策

### 2026-09-05 — 采用可选 trace 采集器
- **背景**：计划要求记录通过 `AgentOptions` 传入，同时要求未传入记录对象时保持既有调用行为。
- **选项**：
  - A: 在 `runQuery` 内部始终创建并返回 trace。
  - B: 由 runner 创建每题记录，经可选字段传入，单测可继续只断言 `AgentResult`。
- **决策**：采用 B；trace 是 runner 的落盘能力，Agent 的既有结果形状不被扩展。
- **影响**：采集代码必须对缺省 trace 做空操作；runner 负责成功与失败记录的最终状态和逐行写盘。

## 实现调整
> spec 中有描述，但实际实现方式不同

### 2026-09-05 — 抽出独立 trace 模块并扩展运行输出
- **spec 原文**：在现有调用位置采集，由 runner 为每题创建记录对象并逐题写入 `trace.jsonl`。
- **实际做法**：新增 `bench/src/trace.ts` 承载记录模型、失败定位和写盘脱敏；`runQuery` 只接收可选 `AgentOptions.trace`，runner 每题创建并追加，`RunOutput` 与 CLI 同步暴露 `tracePath`。
- **原因**：将 JSON 结构和敏感值处理从 Agent 路由逻辑中分离，便于固定 mock 单测；不改变 `AgentResult` 和无 trace 调用者。
- **后果**：trace 的内存对象保留原始局部事实，只有 runner 序列化写盘时遮蔽已知 API Key；单测可直接核对未脱敏的事件字段。

### 2026-09-05 — 以实际 tool message 作为写回证据
- **spec 原文**：写回文本取实际追加的 tool message content，除敏感值遮蔽外不再截断。
- **实际做法**：所有工具分支统一在 `messages.push` 前形成 `writtenContent`，并把同一字符串写入 `TraceToolEvent.writtenContent`；空字符串沿用现有 `（无匹配片段）` 占位。
- **原因**：避免从候选结果重新拼装导致 trace 与模型实际看到的文本不一致。
- **后果**：facts 全量记录卡结果会使 trace 行较长，这是首版可读性优先的有意取舍。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项（纯权衡取舍、无遗留债务的决策记入「决策偏离」）
> 可定位到代码的债务须在代码处写 `TODO(tech-debt) <编号>：` 注释（AGENTS.md 编码核心约束 #6），此处只记编号、结论与未来偿还条件

### 2026-09-05 — 无新增债务
- **债务**：本次没有新增可定位到代码的延期项；既有 Agent 重构债务 A1 保持原状。
- **未来偿还**：无。

## 意外发现
> 实施中发现的 spec 未覆盖的依赖/边界/风险

### 2026-09-05 — PowerShell 下应经 package script 启动 Vitest
- **发现**：直接使用 `pnpm exec vitest` 在当前 Windows shell 中未识别命令，但 `pnpm run test -- <文件>` 能正常启动同一版本 Vitest。
- **影响**：不影响代码或依赖；后续验证沿用仓库 package script，计划无需调整。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

### 2026-09-05 — 初次 trace 测试暴露空结果字段缺省
- **症状**：RAG 无命中时 `injectedIds` 没有落在 tool 事件中，且 control 测试 mock 少一轮响应。
- **根因**：实现初版只在首次 push 时创建注入数组，测试场景未覆盖零命中；control 约束会继续进入下一轮，原测试只准备了两次响应。
- **解决方案**：执行过检索的 RAG/grep 事件始终初始化 `hitIds`/`injectedIds` 空数组；补齐 control 场景的 mock 轮次并重新运行全量测试。
- **预防**：将零命中、约束追加和事件顺序作为固定 mock 回归断言。
