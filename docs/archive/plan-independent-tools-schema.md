# 独立函数工具与扁平参数计划

> 创建日期：2026-09-07
> 状态：已完成

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

- [ADR-006](../adr/ADR-006-independent-function-tools.md) — 按检索模式暴露独立函数工具与扁平参数
- [ADR-005](../adr/ADR-005-chat-auto-tool-budget.md) — auto 工具循环与每题积分预算（其余契约继续有效）

<!-- 冻结说明：发版归档（node scripts/tooling.mjs run release/archive-plan -- --plan <path> --apply）时替换此行，标记完成日期 -->

## 实施纪要

# 实施笔记：独立函数工具与扁平参数

> 对应归档计划：docs/archive/plan-independent-tools-schema.md
> 开始日期：2026-09-07

## 决策偏离

### 2026-09-07 — 保留旧草案文件作为前序证据
- **背景**：任务要求保留当前未提交的 `docs/draft-independent-tools.md`，同时需要建立正式 plan。
- **选项**：
  - A: 删除或重命名草案，完全遵循 draft→plan 生命周期。
  - B: 复制定稿内容建立 plan，保留草案作为本轮实施前审查证据。
- **决策**：选择 B；正式施工以 plan/ADR 为准，草案不再作为活跃施工入口。
- **影响**：后续归档只处理正式 plan；草案用途结束后由维护者按文档生命周期另行清理。

## 实现调整

### 2026-09-07 — 用直接工具名替代 envelope
- **spec 原文**：executor 按 `call.name` 校验与调用现有 runOperation，保留统一执行门面。
- **实际做法**：保留 `createKnowledgeToolExecutor` 的模块工厂名称以减少内部迁移面，但它不再生成或接受 `knowledge` wrapper；新增 `toolsForRetriever`、工具名清单和 schema 指纹。
- **原因**：预算与执行实现无需复制，协议边界则必须严格迁移。
- **后果**：旧运行记录只读兼容，新运行的 `knowledge` 调用按未知工具处理。

### 2026-09-07 — 限定根测试收集范围
- **spec 原文**：在 `dev-temp/work/independent-tools/` 保存实施前/后的独立可运行副本。
- **实际做法**：新增 `vitest.config.ts`，只收集正式 `bench/tests` 与 `scripts` 测试，排除 A/B 副本、pnpm store 和构建产物。
- **原因**：Vitest 默认递归发现现场副本，会重复执行测试并混入旧副本的断言结果。
- **后果**：副本仍可在自身目录独立运行，根目录测试结果只代表正式源码集合。

## 债务记录

### 2026-09-07 — 旧草案清理
- **债务**：`docs/draft-independent-tools.md` 保留为前序审查证据，尚未转入归档。
- **未来偿还**：正式 plan 归档且无需继续复核草案后，按文档生命周期清理或归档；代码无新增技术债。

## 意外发现

### 2026-09-07 — 实施后验收：功能通过，效果证据不足

- **验收对象**：`b2de56cdd157`，当前 `feature/independent-tools-schema`；保留前序未提交的基线文档和快照。
- **功能验证**：重新执行 `node scripts/verify.mjs merge -- --base main` 全通过（31 文件 / 274 项测试）；build、基准完整性通过。当前构建五模式各 20 题内存 dry 全完成，另做 11 项无网络参数边界探针，全部按 invalid_params 拒绝、扣 1 点且零底层执行。未发现阻塞工具拆分功能的实现缺陷。
- **效果缺口 1：lookup 没有真实覆盖**。既有 after 20 题 trace 为 rag_search 32 次、query_operators 1 次、lookup 0 次；两题 real-probe 同样仅执行 RAG。33/33 执行及零参数错误是真实观测，但不能证明此前占 11/12 参数错误的 lookup 路径已改善。需要包含具体名称/技能查询的自然问题并核对实际调用，不能通过强制工具或修改默认策略冒充 auto 的成功率。
- **效果缺口 2：样本不是最终提交版本**。after 副本与当前源码存在实质差异：call ID 类型防护、runner 聚合来源、report/snapshot/types 的命中统计，以及查询指令最后残留 operation 措辞修订。样本指令 hash 为 `819acb2fcbbcaeb8c7a831af3757232489093bdfc0696a2add56625281816ee3`，当前为 `11c8039c211b9ac59b00a15b630187b2b91ff637faff0d4bcec79a120eb92e2f`；工具 schema hash 一致，但不能据此称整个运行对应当前 HEAD。必须标记为中间实现样本，最终版本效果需单独取证，不覆盖原件。
- **效果缺口 3：经审查草案的验证尚未完成**。原草案要求冻结留出题、新旧协议各至少三次交错；现有只是历史旧组与一次新组原 20 题运行，没有留出集或重复对照。实施记录已承认单轮限制，但全勾选计划不代表原草案的效果验证完成。不得把“稳定性待授权”解释为已有提升证据。
- **结论**：独立函数暴露、扁平参数及本地协议执行的功能验收通过；“提升 agent 调用成功率”的效果验收仍未完成，也未据回答质量设达标线。先补全最终版本与实际 lookup 覆盖及受控样本，再判断协议包收益。本次未改源码、未付费重跑、未合并或发版。
- **现场去留**：验收门禁现场 `dev-temp/runs/verify/1788780622470-27352-aad890` 保留用于本次验收复核，补证完成且验收结论已保存后可按 tooling 显式清单清理；五模式 dry 和补充参数探针只在内存/终端运行，没有新增临时脚本或 dry 文件。

### 2026-09-07 — 命中状态不能从 status 推断
- **发现**：facts 无匹配时仍可能产生非空序列化提示，且旧记录没有 `hitIds`。
- **影响**：report 新增明确命中与命中未知字段；旧记录统一保留未知，不将 status/data 当命中证据。

### 2026-09-07 — 受控协议包对照结果
- **发现**：旧基线 `2026-09-07T09-55-37-752Z-qwen-off-t0` 为 20/20、65 个模型步骤、58 提出/57 准入/45 执行、12 参数错误、1 拒绝、¥0.044996、213.065 秒；新副本当前协议为 20/20、44 个模型步骤、33 提出/33 准入/33 执行、0 参数错误、0 拒绝、¥0.031748、125.765 秒，命中 33、命中未知 0。
- **影响**：这是协议包整体对照，不归因于纯拆壳；本次只完成一轮当前协议的完整 20 题样本，服务端缓存、延迟和模型采样状态不完全相同，质量未做全量人工核查。旧组原件与新组的受控对照运行目录、快照保留在 `dev-temp/work/independent-tools/` 或既有 `bench/results/`；重复 dry 产物已在收尾时清理，稳定性实验仍待后续明确授权。

## 阻塞与解决

### 2026-09-07 — Git 配置写入受工作区权限限制
- **症状**：按仓库约定首次 git 操作配置编码时，当前受限环境无法锁定 `.git/config`。
- **根因**：`.git` 在本次工作区权限中只读；代码和文档工作目录仍可写。
- **解决方案**：不进行提交或需要配置编码的写操作；继续使用现有分支完成实现与验证，并在交接中记录限制。
- **预防**：提交前在具备 `.git/config` 写权限的环境执行仓库规定的 git 配置与 commit-convention 检查。

> ✅ 已完成于 2026-09-08
