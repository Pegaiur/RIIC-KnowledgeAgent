# 实施笔记：Qwen3.7-Flash 候选模型接入

> 对应草案：docs/draft-qwen37-flash-bench.md
> 开始日期：2026-08-31

## 决策偏离
> plan 中没有提到，但在实施中做出的重要决策

### 2026-08-31 — Provider 参数化采用注册表而非抽象接口
- **背景**：草案要接入 qwen，需多 provider 共存；方案是"参数化"。
- **选项**：
  - A: 抽象 `Provider` 接口 + 多实现类（面向未来扩展，但增加文件/抽象）
  - B: `config.ts` 内 `PROVIDERS` 注册表 + `provider.ts` 单一 `callLLM` 按 `config.provider` 分支（最小侵入，贴合"简单架构"）
- **决策**：B。当前仅 2 个 provider，接口抽象是过度设计；注册表把端点/模型/定价/密钥 env 集中，`callLLM` 内只分支 thinking 参数与 chat 路径。
- **影响**：新增 provider 只需在注册表加一行 + provider.ts 加参数分支，不重构循环/检索/报告。

### 2026-08-31 — qwen 的 thinking 档位映射先不细分
- **背景**：Hy3 有 `reasoning_effort: low/medium/high` 细档；Qwen3.7 用 `enable_thinking` 布尔控制，草案注明"是否支持 reasoning_effort 细档待探针确认"。
- **决策**：qwen 侧 `enable_thinking = thinking !== 'off'`（off 显式 false，low/high 均 true），暂不细分 `reasoning_effort`。探针确认服务端接受该布尔字段；细档留待全量 120 次前再核。
- **影响**：qwen 的 low/high 目前等价（同为开启思考），跨模型"档位对比"需注意此差异。

### 2026-08-31 — qwen 缓存字段缺失按 0 处理
- **背景**：草案注明 qwen 的 `prompt_tokens_details.cached_tokens` 可能不支持，需确认。
- **决策**：探针实测 qwen 返回 `cached=0`（隐式缓存字段未走 `prompt_tokens_details.cached_tokens` 口径），`parseUsage` 读不到则按 0，计费保守（不享受缓存折扣）。
- **影响**：qwen 侧成本按"全量输入计费"，无缓存折扣；与 Hy3 的缓存命中计价口径不同，跨模型对比需知悉。

## 实现调整
> plan 中有描述，但实际实现方式不同

### 2026-08-31 — 报告标题与跨模型聚合的通用化
- **plan 原文**：报告仍写"Hy3 查询输出成本基准报告"。
- **实际做法**：改为"LLM 查询输出成本基准报告"；`aggregate` 增 `byProvider` 分组，`renderCrossProvider` 渲染对比表；新增 CLI `compare <runDir1> <runDir2>` 子命令。
- **原因**：单一模型报告标题在 qwen 接入后失准；跨模型对比需要合并多个 runDir。
- **兼容**：早期 hy3 运行记录无 `provider` 字段，`aggregate` 用 `r.provider ?? r.model` 回退标识。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项

### 2026-08-31 — qwen 的 low/high 档未细分
- **债务**：qwen 侧 `enable_thinking` 布尔控制，low/high 当前等价；无法与 Hy3 的 reasoning_effort 细档完全对齐。
- **未来偿还**：确认 qwen 是否支持 `reasoning_effort`/思考预算参数后再映射，或接受"档位对齐不完整"作为已知局限。

## 意外发现
> 实施中发现的 plan 未覆盖的依赖/边界/风险

### 2026-08-31 — qwen 检索更少、编造倾向更强（成本-可靠性权衡）
- **发现**：同问题集，hy3 平均 2.50 轮，qwen 2.10 轮（F04 甚至 1 轮 0 次检索即作答）。逐条核查（对比 hy3）显示：
  - hy3：仅 3 处"漏检类"疑点，且倾向诚实标注"无法确认/片段未提供"。
  - qwen：13 题有疑、4 题明显编造（S07 数值编造 +1200%/-900%、干员"灰喉"实为灰毫；S02 虚构"苍角/调香师/挂票"；S05 编造"叙拉古书呆子"；S08 把可露希尔机制误归推王、干员 Lappland/德克萨斯无据）。
- **影响**：qwen 便宜 80%（输出单价 4→0.8 元/M）的代价是检索更少、编造倾向更强。"成本基准"之外，若后续看重答案可靠性，需权衡是否提高 qwen 的检索上限或强制至少 1 次检索。
- **风险**：qwen 跳过检索直接作答，若用于生产会输出与知识库冲突的内容。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

### 2026-08-31 — secret.yaml 双密钥管理
- **症状**：hy3 与 qwen 各需一个 key，`secret.yaml` 内已有 `hy3-api-key` 与 `qwen-api-key`。
- **解决**：config 注册表按 `apiKeyEnv` 读取（hy3→`TOKENHUB_API_KEY`，qwen→`DASHSCOPE_API_KEY`），运行前从 `secret.yaml` 导入到对应环境变量。密钥仍不入库（gitignore 已忽略 secret.yaml）。

### 2026-08-31 — 跨模型对比中旧运行无 provider 字段
- **症状**：hy3 早期运行记录无 `provider` 字段，`aggregate` 按 `r.provider` 分组会得到 undefined。
- **解决**：`aggregate` 用 `r.provider ?? r.model` 回退，旧记录以 model（hy3）标识。
