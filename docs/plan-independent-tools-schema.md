# 独立函数工具与扁平参数计划

> 创建日期：2026-09-07
> 状态：施工中

## 目标

将按模式暴露的 `knowledge(operation, params)` 替换为独立函数工具，并以统一 schema、严格本地校验和可复核 meta/trace 降低协议结构错误。

## 非目标

不修改模型、Chat API、auto/并行策略、默认检索模式、5 点预算、取消/费用台账、检索排序、证据压缩、答案风格或游戏事实；不引入新依赖、strict 标志或题集特判；不把一次真实运行成绩当作质量验收。

## 架构分析

旧实现用单一 `knowledge` 函数承载 operation 与 params。hybrid 基线的 12 次参数错误均为缺少 `params`，且 schema 的 oneOf 与 operation 没有判别关联。dry、agent、executor 和文档也都重复维护旧 envelope。新方案用工具定义表派生实际工具数组和模式白名单，执行器保留统一预算门面；直接工具参数由本地严格校验，错误继续通过 tool message 回馈并扣点。

## 实施方案

1. **定稿与来源同步**：建立 ADR-006，保留前置 ADR-005 的 auto/预算等有效契约；将 `knowledge/AGENTS.md` 改为直接函数调用说明，并保留本草案作为前序证据。
2. **统一工具定义**：在 `tool-executor.ts` 建立四个函数的定义表、模式白名单、schema 版本和稳定指纹；返回独立函数数组，覆盖 lookup 当前 canonical/技能名/技能组/等价组索引边界。
3. **执行与校验迁移**：按 `call.name` 派发；严格拒绝 JSON 非对象、缺字段、空白、错误类型、null、未知字段、错误数组元素和只有 `excludeIds` 的请求。预算先预占；缺失/重复 call ID 整批 protocol error，不扣点、不执行、不回写。
4. **agent/provider/trace 迁移**：能力块、请求 tools、dry fixture、requested/toolTrace/trace offeredTools 使用独立函数名；保持混合工具同批、依赖续查、第五次准入、截断、回馈、取消和原生正文行为。
5. **meta/snapshot/report 迁移**：记录 `toolSchemaVersion`、`toolSchemaSha256`、`toolNames`，trace schema 升版；旧快照仍可读。工具批次追加明确命中与命中未知统计，历史缺失字段不回填为无命中。
6. **离线验证与受控测量**：完成边界单测、五模式 dry、build/typecheck、doc-check；在 `dev-temp/work/independent-tools/` 保存实施前/后独立可运行副本、冻结清单指纹和验证结果。真实协议兼容探针与受控对照只使用授权密钥运行，不复制密钥，不重跑既有 BM25/hybrid 基线。

## 验收清单

- [x] ADR-006、plan、实施笔记建立，并同步 ADR 索引与需求入口。
- [x] 五种检索模式只暴露各自独立工具，定义表、executor、agent 和 dry fixture 一致。
- [x] 四个工具的必填字段、未知字段、类型、空白、数组元素和正向条件校验严格一致。
- [x] 合法/非法批次、混合工具并行、预算边界、第五次准入、超额拒绝、缺失/重复 call ID 覆盖测试。
- [x] trace、meta、snapshot、report 记录实际工具名、schema 指纹、提出/准入/执行/命中未知等可复核事实。
- [x] 保留旧快照可读性；旧记录缺少 `hitIds` 相关字段时报告为命中未知。
- [x] 实施前/后独立副本、工具 schema 指纹和验证产物按 `scripts/INDEX.md` 收尾。
- [x] `pnpm run typecheck` 全通过。
- [x] `pnpm run test` 全通过。
- [x] `pnpm run build` 全通过。
- [x] 五模式 dry、文档检查和必要的协议探针完成并记录限制。

## 关联 ADR

- [ADR-006](adr/ADR-006-independent-function-tools.md) — 按检索模式暴露独立函数工具与扁平参数
- [ADR-005](adr/ADR-005-chat-auto-tool-budget.md) — auto 工具循环与每题积分预算（其余契约继续有效）

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->
