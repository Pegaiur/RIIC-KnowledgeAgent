# 三模型试验 provider 适配计划

> 创建日期：2026-09-09
> 状态：已完成

## 目标

让既有 harness 支持 GLM-5.3-Flash low、Hy3 off、Qwen3.7-Flash off 的显式调用并准确记录计量边界，服务 [对比试验](exp/exp-model-capability-comparison.md)。

## 非目标

不改变检索、Agent 策略、知识库、题集、评分、默认模型或资源预算；不自动提交、合并或发版。

## 架构分析

现有 provider 注册表仅含 Hy3/Qwen，Hy3 off 省略参数；GLM 可沿用 OpenAI 兼容调用。通过增量注册和参数校验实现，不引入依赖或改变模块依赖方向。计费只沿用已核验端点价格，不把缺失思考 token 解释为零。

## 实施方案

先确认密钥对应官方平台与计价，增加 GLM 注册与显式参数校验；Hy3 off 显式 disabled，GLM off 拒绝，low/high 显式 enabled。检查 usage 兼容并保留未知项。CLI 同步可用型号，模型选择不可静默回退。添加协议和计量回归后运行 typecheck/test/build 及无付费干跑。真实预检与试验结果仅记 exp。

## 验收清单

- [x] GLM 注册及 CLI 入口与端点、价格契约一致
- [x] Hy3 off、GLM low 显式映射及错误模式拒绝
- [x] usage 与请求契约回归通过
- [x] `pnpm run typecheck` 通过
- [x] `pnpm run test` 通过
- [x] `pnpm run build` 与三模型 dry 验证通过

## 关联 ADR

无新增 ADR：本轮为既有 provider 扩展与兼容性修正，无新依赖或模块依赖方向变更。

---

<!-- 冻结说明：发版归档时按仓库脚本处理。 -->

## 实施纪要

# 实施笔记：三模型试验 provider 适配

> 对应 spec：[provider 适配计划](plan-model-provider-adaptation.md)
> 开始日期：2026-09-09

## 决策偏离

沿用现有 OpenAI 兼容 provider 与 runner，不重写 Agent loop；用户执行请求覆盖 exp 的先前“仅设计”边界。采用方案中的预检 2 元与主试验 20 元软预算，遇未知计费或协议问题暂停。

## 实现调整

用户确认密钥来自智谱国内站，GLM 注册到 open.bigmodel.cn；标准价采用输入/输出/缓存 0.8/2.8/0.23 元每百万 token，试验按当日官方页面五折 0.4/1.4/0.115 显式覆盖。未新增 SDK。provider 对 GLM off 快速拒绝，Hy3 off 显式 disabled。

usage 原先把缺失 reasoning_tokens 补为 0；GLM 官方响应示例没有该分项，因此改为 null。已知 completion_tokens 总量仍可计费，完整性仅在分项显式无效或必要计费字段缺失时降级；不以分项未知声称无思考。

报告聚合与渲染同步保留思考分项未知，避免 Qwen 未提供该字段时再次变成 0；属于同一计量错误修正。新增回归验证未知值穿过查询、思考档位与 provider 三类聚合后仍为未知。

百炼官方 qwen3.7-flash 价格存在按输入长度升档，原固定低档会在长多轮上下文低估费用。按官方 32K/256K 档补充可选 inputTiers，每次 HTTP 独立选档；输入未知或超出已知档位时费用未知。边界回归通过。最终类型检查、352 项测试与构建通过。

## 债务记录

尚无新增。

## 意外发现

secret 中 GLM 字段为 zai-api-key；仅检查字段名，未回显密钥。最初等待平台澄清，用户随后确认智谱国内站后才发请求。

## 阻塞与解决

提交独立审查发现 unknownUsage 的网络失败/取消路径仍把思考分项补零；修正为 null，并增强正文挂起取消测试，核验在途、异常 HTTP 尝试和聚合台账均保留未知。同步记录字段注释及报告对未传 parallel_tool_calls 的表述；历史成功运行数据与判定不变。该修复属于计量契约，不涉及答题优化。

用户已确认智谱国内站，端点歧义解除。预检与三方主试验均正常完成，实际运行结果仅记 [模型能力对比试验](exp/exp-model-capability-comparison.md)。工程计划已全项验收，尚未提交、合并或执行发版归档。

> ✅ 已完成于 2026-09-09
