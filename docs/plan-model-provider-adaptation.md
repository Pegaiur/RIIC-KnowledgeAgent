# 三模型试验 provider 适配计划

> 创建日期：2026-09-09
> 状态：施工中

## 目标

让既有 harness 支持 GLM-5.3-Flash low、Hy3 off、Qwen3.7-Flash off 的显式调用并准确记录计量边界，服务 [对比试验](archive/exp/exp-model-capability-comparison.md)。

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
