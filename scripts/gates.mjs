/**
 * 门禁命令清单配置（verify 引擎的唯一适配层）
 *
 * 设计（「单入口 + profile」模式）：
 *   - scripts/verify.mjs 是门禁执行引擎，只依赖本文件导出的清单，不含任何具体命令；
 *   - 所有调用方（AGENTS.md、skills、CI）只引用 `node scripts/verify.mjs <profile>`，
 *     不复制底层命令——换技术栈只改本文件；
 *   - 路由表或命令构成变化时，递增 lib/verify-profile.mjs 的 PROFILE_VERSION。
 *
 * rag-test 适配：单仓（pnpm 根包），门禁 = references 投影 + typecheck + test + build + 基准完整性 + doc-check。
 * 回答质量、逐题人工评分和真实 LLM 对照不是自动门禁；本门禁只校验功能、协议、计量、facts 完整性与文档一致性。
 */

/** @typedef {{ id: string, label: string, command: string[] }} StepDef */
/** @typedef {{ id: string, label: string, globs: string[], steps: StepDef[] }} RouteGroup */

/**
 * merge profile 基础命令：始终执行，固定顺序，失败即停。
 */
export const BASE_STEPS = [
  { id: 'prose-terms', label: 'RAG 散文术语', command: ['pnpm', 'run', 'check:prose-terms'] },
  { id: 'reference-projection', label: 'references 公共练度投影', command: ['pnpm', 'run', 'check:reference-projection'] },
  { id: 'typecheck', label: '类型检查', command: ['pnpm', 'run', 'typecheck'] },
  { id: 'test', label: '测试', command: ['pnpm', 'run', 'test'] },
  // 构建产物是 CLI 基准完整性校验（dist/cli.js validate）的前置；先构建再校验
  { id: 'build', label: '构建', command: ['pnpm', 'run', 'build'] },
  { id: 'bench-validate', label: '基准完整性', command: ['node', 'dist/cli.js', 'validate'] },
  // 文档一致性校验（plan checklist / ADR 索引 / 引用路径 / skills 结构），路径相对仓库根
  { id: 'doc-check', label: '文档一致性', command: ['node', 'scripts/doc-check.mjs'] },
  // 发版准备态检查（活动 plan 冻结/归档、notes、inbox、archive INDEX）；P1「全勾选未冻结」为阻塞项
  { id: 'release-check', label: '发版准备态', command: ['node', 'scripts/tooling.mjs', 'run', 'release/check'] },
]

/**
 * 路由组：变更文件命中 globs 时，merge profile 追加对应 steps（release profile 无条件全量）。
 * rag-test 为单仓，无独立模块门禁，置空。
 */
export const ROUTE_GROUPS = []

/**
 * 失败关闭（fail-closed）：单仓无未知跨模块路径场景，置空。
 */
export const FAILOVER_ROOTS = []
export const FAILOVER_ROUTE_IDS = []
