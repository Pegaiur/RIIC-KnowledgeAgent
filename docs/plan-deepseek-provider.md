# DeepSeek 追加试验 provider 适配计划

> 创建日期：2026-09-09
> 状态：施工中

## 目标

支持用户指定 DeepSeek 型号的显式 off 调用与缓存计量，服务[追加试验](archive/exp/exp-deepseek-capability.md)。

## 非目标

不改 Agent loop、检索、语料、评分、默认模型；不扩展图片输入或思考历史协议。

## 架构分析

沿用现有兼容接口；只需注册官方型号、支持缓存字段与 CLI 入口。当前消息历史不回传思考，DeepSeek 暂仅开放本次已授权的 off 模式，避免宣称支持未经验证的思考工具协议。

## 实施方案

注册 DeepSeek 官方端点与 secret/env 映射，显式 disabled 并拒绝未支持模式；兼容官方缓存命中字段，保留未知分项。注册高峰价为保守计价，试验单独核算分时实际估算。协议/计量回归通过后构建、dry，再由 exp 预检与主试验验证。

## 验收清单

- [x] 型号与 off 参数、错误模式拒绝及缓存字段回归通过
- [x] `pnpm run typecheck` 与 `pnpm run test` 通过
- [x] `pnpm run build` 与 DeepSeek dry 通过

## 关联 ADR

无新增：既有 provider 内兼容扩展，无新依赖或模块依赖方向变化。
