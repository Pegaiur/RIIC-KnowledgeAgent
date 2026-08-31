# 实施笔记：Hy3 查询输出成本基准

> 对应草案：docs/draft-hy3-rag-bench.md
> 开始日期：2026-08-31

## 决策偏离
> plan 中没有提到，但在实施中做出的重要决策

### 2026-08-31 — 检索方案采用 BM25（bigram）而非简化关键词匹配
- **背景**：草案中「关键词/BM25」未定死；实施时发现纯词重叠排序对中文语料区分度低。
- **选项**：
  - A: 纯词频重叠打分（最简单，~20 行）
  - B: BM25（经典 k1=1.5/b=0.75，中文 bigram 分词，~80 行）
  - C: 向量检索（需 embedding 依赖，违背零依赖简化目标）
- **决策**：B。成本基准不追求检索精度，但排序质量过低会让「轮数分布」失真；BM25 无外部依赖，可测可回归。
- **影响**：retriever.ts 的 bigram 分词同时服务中文/拉丁词元，后续如需向量化只需替换 buildIndex/search 两函数。

### 2026-08-31 — tsc 配置拆分 base/build 两份
- **背景**：typecheck（noEmit，含测试）与可执行 CLI 编译（outDir dist）目标不同。
- **决策**：tsconfig.json 仅 typecheck（tests 纳入），tsconfig.build.json 仅编译 src；CLI 通过 `pnpm run build && node dist/cli.js` 运行。
- **影响**：无运行时依赖，dist/ 不进版本控制。

## 实现调整
> plan 中有描述，但实际实现方式不同

### 2026-08-31 — 真实探针与全量运行延期
- **plan 原文**：验收清单含「真实探针校准 usage」与「全量 60 次查询」。
- **实际做法**：本轮仅完成 dry run 管线验证；环境未配置 `TOKENHUB_API_KEY`，真实调用留待密钥就绪后执行（命令已就绪：`pnpm run build && node dist/cli.js run --thinking off|low|high`）。
- **原因**：无密钥时无法发起 TokenHub 请求；成本评估方案的「探针校准」步骤依赖真实 usage 字段。
- **后果**：plan 验收清单两项保持 `[ ]`，后续补跑。

## 债务记录
> 遗留的技术债、被牺牲的改进与延期偿还事项

### 2026-08-31 — BM25 检索质量未与向量检索对比
- **债务**：中文 bigram BM25 对同义/近义改写检索鲁棒性未知；基准不测答案质量，无法感知检索失效对轮数分布的影响。
- **未来偿还**：若后续引入「检索质量」评估维度，再引入 embedding（sqlite-vec / 本地模型）并二分对比。

### 2026-08-31 — 执行环境的 PowerShell 包装问题
- **债务**：本机 bash 工具经 PowerShell 5.1 包装（`&&` 不可用、CLIXML 吞并 stderr、pnpm 退出码误报），验证输出需重定向文件中转。
- **未来偿还**：CI/脚本环境与本地不一致风险；后续可考虑在 dev-temp 脚本中固化「tsc → vitest → dry run」检查链（tooling task），减少手工中转。

## 意外发现
> 实施中发现的 plan 未覆盖的依赖/边界/风险

### 2026-08-31 — JSDoc 注释中 `docs/**/*.md` 提前终止块注释
- **发现**：corpus.ts 头部注释包含 `**/*.md`，其中 `*/` 子串使 tsc 在第 4 行报 TS1109/TS1127（注释被截断）。
- **影响**：已改写注释规避；同类风险存在于其他含通配符注释（已 grep 排查，仅 corpus.ts 一处）。建议后续注释里避免 `**` 后跟 `/`。

### 2026-08-31 — rag-test 原为非 git 仓库
- **发现**：rag-test 此前未初始化 git（模板的合并门禁/发版流程无法生效）。
- **影响**：已 `git init -b main` 并配置中文编码；过程管理模板的 verify merge 流程自本次提交起可用。

### 2026-08-31 — pnpm install 在本机 PowerShell 包装下退出码误报 1
- **发现**：`pnpm install` 实际成功（node_modules 与 pnpm-lock.yaml 均生成），但外层 PowerShell 包装返回退出码 1。
- **影响**：验证命令以 `node ./node_modules/...` 直调代替 pnpm wrapper 以获得可靠退出码。

## 阻塞与解决
> 遇到的阻塞问题及解决方案

### 2026-08-31 — bash 工具拒绝在未初始化的 git 仓库执行
- **症状**：`git init` 命令被拒（「仓库路径不存在或不是 git 仓库」），原因：bash 工作目录必须为已注册且已 init 的 git 仓库。
- **根因**：rag-test 初始无 git 仓库，而 git init 工具缺失，形成鸡生蛋。
- **解决方案**：以已注册的 repo-template 为 cwd，用 `node -e`（child_process.execSync）对 rag-test 执行 `git init` 与 git config。
- **预防**：新仓库初始化类操作统一走「合规仓库内 node 脚本对目标路径执行」的方式。
