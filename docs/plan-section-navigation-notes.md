# 实施笔记：标题上下文与按小节读取优化计划

> 对应 spec：docs/plan-section-navigation.md
> 开始日期：2026-09-08

## 决策偏离
> spec 中没有提到，但在实施中做出的重要决策

### 2026-09-08 — 小节 ID 编码采用哈希前缀
- **背景**：spec 要求「相对文件路径＋完整标题路径＋同路径出现序号的确定性编码」，但未规定具体形式；ID 需唯一、可复制、跨运行稳定。
- **选项**：
  - A: 可读路径编码（如 `file::H1 > H2#2`），便于人工识别，但标题含分隔符时存在歧义。
  - B: 哈希编码 `sec-<sha256 前16位>`，无歧义、长度固定，但不可读。
- **决策**：B。输入为 `file\0标题路径\0出现序号`，取 SHA-256 前 16 位十六进制，前缀 `sec-`。测试通过目录返回的 ID 定位，不依赖可读性。
- **影响**：模型与用户只复制工具返回的 ID；ID 不进入 chunk ID 体系，不承诺跨版本稳定。

### 2026-09-08 — 无标题文档根节点的处理边界
- **背景**：spec 要求「无标题文档提供文档根节点」，但未说明有标题文档的前言（首个标题之前的内容）如何归属。
- **选项**：
  - A: 为所有文档建立根节点，前言归入根节点，H1 作为根节点的子节点。
  - B: 仅无标题文档建立根节点；有标题文档前言不进入小节目录（检索仍由 chunk 覆盖）。
- **决策**：B。避免根节点与 H1 同时作为层级起点造成重复，且前言通常为 frontmatter 或引言，不属于「按小节读取」的目标。
- **影响**：有标题文档的前言不进 read_section；现有 chunk 分块不受影响。

### 2026-09-08 — 小节正文统一按 UTF-16 索引分页
- **背景**：spec 规定 offset 为「正文 JavaScript 字符串的 UTF-16 索引」。
- **决策**：分页与续读全部以 `String.length` / `slice` 的 UTF-16 语义实现，不按字节或码点切分。
- **影响**：next_offset 可能落在代理对中间，由模型按返回的 next_offset 续读，无需自行计算。

## 实现调整
> spec 中有描述，但实际实现方式不同

### 2026-09-08 — RAG 展示的字段落位
- **spec 原文**：「每个命中片段显示 sectionId、完整祖先标题路径、既有来源行号和正文」；「先容纳既有命中正文，再利用剩余空间依次放标题路径、父级引导和导航」。
- **实际做法**：来源头固定为 `【file | heading | Lx-y | sectionId】`（sectionId 计入来源头长度）；标题路径、父级引导与导航合并为命中正文之后的「【小节上下文】」段，仅使用剩余预算，超限时截断末项并标注 `…（截断）`。injectedIds 只记录真实送达的 chunk，不记录目录或上下文。
- **原因**：sectionId 是 read_section 的入口，必须随命中片段稳定送达；标题路径与导航体积可变，按 spec 的优先级降为可选，避免挤占正文。
- **后果**：无目录或预算不足时不出现标题路径/导航，但 sectionId 仍在来源头；模型可据 sectionId 直接 read_section。

### 2026-09-08 — read_section 输出格式与越界 offset 语义
- **spec 原文**：`read_section` 在 data 中以固定格式给出 sectionId、标题路径、实际行范围、offset、next_offset、complete 与原文；offset 大于长度返回 invalid_params。
- **实际做法**：data 前三行固定为 `【read_section】{id}`、`标题路径：…`、`行范围：Lx-y｜offset：n｜next_offset：m|null｜complete：bool`，空行后接原文页；分页按 UTF-16 索引，必要时在行边界截断并由 next_offset 续读。越界 offset 归入 invalid_params，`executed=false`（与解析期参数错误一致），但仍已占用 1 点共享预算。
- **原因**：固定文本行便于模型与离线样例解析，也避免 JSON 转义原文；越界属参数问题而非执行结果，按既有 invalid_params 语义处理。
- **后果**：read_section 的 hitIds/injectedIds 恒为空数组，不进入搜索命中统计；`TOOL_SCHEMA_VERSION` 由 5 递增至 6，report 按 `isObservedTool` 计入 read_section 调用次数。

### 2026-09-08 — 运行接入与 inputs 小节指纹
- **spec 原文**：runner 为使用阅读能力的模式加载目录并传给执行器；inputs 增加可选的小节源内容指纹与目录版本，指纹覆盖本次阅读能返回的原文。
- **实际做法**：runner 仅对 bm25/hybrid/both 调用 `buildSectionDirectory`，同一实例同时传给 `runQuery`（执行器上下文）与 `createRunInputs`；`inputs.sections` 记录 `version`、`sectionCount`、`sectionsSha256`（覆盖目录内全部原文，含长节与被 clamp 的 chunk 之外的正文）、`orderPreserved`。grep/facts 不加载目录，inputs 不含 `sections` 字段。
- **原因**：目录与检索共用白名单来源但各自独立读取一次；指纹单独记录，不保存第二份全库副本，也不改变旧字段含义。
- **后果**：`knowledge/AGENTS.md` 增加一条取证决策；旧 inputs/snapshot 缺少 `sections` 仍可读取。

### 2026-09-08 — 导航生成口径与极端预算兜底
- **spec 原文**：每个命中文档附一次小节导航；read_section 服从 maxContextChars 对工具 data 的上限。
- **实际做法**：同一文件多个命中小节时，导航以该文件首个带小节的命中块生成一次（其直接兄弟与子小节）；read_section 在 `maxContextChars` 小于分页元数据长度时强制至少返回 1 个字符，保证 next_offset 前进、不会死循环，该极端配置下 data 可能略超上限。
- **原因**：导航是「每文档一次」的有限补充，按首个命中小节即可覆盖该文档层级；分页必须保证可续读，避免模型卡死。
- **后果**：默认 `maxContextChars=12000`、页上限 6000，兜底分支不触发；如需严格不超限，可在后续轮次对元数据自身做截断。

### 2026-09-08 — 收束校验记录
- **实际结果**：`pnpm run typecheck`、`pnpm run test`（35 文件 338 例）、`pnpm run build` 全通过；`node dist/cli.js hitrate` 的 recall@3/5/10 = 48.9%/56.2%/64.5%，与实施前一致（检索分词、排序、topK、切块均未改动）；`node scripts/doc-check.mjs` 勾选验收项后无错误；`git diff --check` 无输出。
- **离线样例**：dev-temp/work/section-navigation/offline-sample.mjs 用现有 executor 模拟，无模型调用；4 场景结果——已有证据足够（读 1 页/951 字）、同文档缺一小节（读 1 页/642 字）、长小节续读（干员名册 11343 字/2 页）、具体词条仍走 facts（facts_search success 1 卡；同题另读 16219 字/3 页），全部完整且逐字无损。
- **后果**：验收清单 6 项全部勾选；发版收束时由 `release/archive-plan` 合并本笔记并归档。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项

无。read_section 在极端 maxContextChars 下的 1 字符兜底属有意的可续读安全设计（见「实现调整」），不登记为债务；如后续要求严格不超上限，再单独立项截断元数据。

## 意外发现
> 实施中发现的 spec 未覆盖的依赖/边界/风险

### 2026-09-08 — 有标题文档的前言块无法映射小节
- **发现**：`references/名册.md` 的「（未分段）」前言 chunk 经 `findByChunk` 返回 undefined，RAG 该块的来源头不带 sectionId；这是 Phase 1「仅无标题文档建根节点」决策的必然边界。
- **影响**：前言命中无法直接 read_section，但同文档其它小节仍可读；离线样例改用「文件内正文最长小节」的通用规则，不受影响。无需改 spec。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

无。
