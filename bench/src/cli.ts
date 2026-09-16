/**
 * CLI 入口
 *
 * 用法：
 *   node dist/cli.js run   [--thinking off|low|high] [--temperature N] [--limit N] [--dry] [--questions <path>] [--out <dir>]
 *   node dist/cli.js export <runDir> [--questions <path>] [--topic <name>] [--out <path>]
 *   node dist/cli.js report <runDir|snapshot> [--out <path>]
 *   node dist/cli.js compare <runDir|snapshot> <runDir|snapshot> [--out <path>]
 *   node dist/cli.js hitrate [--topk 3,5,10] [--gold <path>] [--check-gold] [--out <path>]
 *   node dist/cli.js catalog [--check]
 *   node dist/cli.js validate
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { effectiveAttachFacts, loadConfig, validateBenchConfig } from './config.js'
import { corpusStats, loadCorpus } from './corpus.js'
import { checkGold, loadGold, renderHitrate, runHitrate } from './hitrate.js'
import { CATALOG_RELATIVE_PATH, catalogDifference, generateKeywordCatalogMarkdown } from './catalog.js'
import { buildIndex } from './retriever.js'
import { runBenchmark } from './runner.js'
import { aggregate, aggregateSnapshot, renderCrossProvider, renderCsv, renderMarkdown, runDeclarationFromMeta, type BenchReport, type ReportRunDeclaration } from './report.js'
import type { BenchQuery, CostRecord } from './types.js'
import { validateBenchmarkIntegrity } from './benchmark-integrity.js'
import { ignoredHitrateFlags, parseArgs, retiredFlagError, unsupportedCatalogFlags } from './cli-args.js'
import { readSnapshot, snapshotFromRunDir, writeSnapshot } from './snapshot.js'

/** 散文 RAG 与 hitrate 均直接使用 knowledge/白名单语料，共用 questions 的题号和问题定义。 */

function printUsage(): void {
  process.stdout.write(
    [
      'RIIC-KnowledgeAgent bench —— LLM 查询输出成本基准（GLM-5.3-Flash / Qwen3.7-Flash）',
      '',
      '用法：',
      '  node dist/cli.js run [--provider glm|qwen|hy3|deepseek] [--thinking off|low|high] [--temperature N] [--retriever bm25|hybrid] [--expand-fulltext 0|1] [--attach-facts 0|1] [--tool-budget N] [--tool-attempt-limit N] [--session-timeout-ms N] [--min-rag 0|1] [--limit N] [--dry] [--questions <path>] [--out <dir>]',
      '  说明：默认 provider 为 GLM-5.3-Flash、默认思考档 low（GLM 不支持 off）；DeepSeek 仅支持 off，需显式 --thinking off；Hy3 已退出，仅为历史对照保留。',
      '  检索范围恒为 manifest 登记的 base/guides；--include-skill-tables 已退役，显式传入按参数错误拒绝。',
      '  node dist/cli.js export <runDir> [--questions <path>] [--topic <name>] [--out <path>]',
      '  node dist/cli.js report <runDir|snapshot> [--out <path>]',
      '  node dist/cli.js compare <runDir|snapshot> <runDir|snapshot> [--out <path>]',
      '  node dist/cli.js hitrate [--topk 3,5,10] [--gold <path>] [--check-gold] [--out <path>]',
      '  node dist/cli.js catalog [--check]',
      '  node dist/cli.js validate',
      '',
      '示例：',
      '  node dist/cli.js run --dry --limit 2          # 干跑验证管线（不发请求）',
      '  node dist/cli.js run --provider glm --thinking low   # 默认 provider 真实跑（需 ZAI_API_KEY）',
      '  node dist/cli.js run --provider qwen --thinking off   # Qwen 关闭思考（需 DASHSCOPE_API_KEY）',
      '  node dist/cli.js run --retriever hybrid   # 默认模式：BM25 RAG + facts 混合工具',
      '  node dist/cli.js run --retriever bm25   # 纯 RAG 对照',
      '  node dist/cli.js report bench/results/<run-id>.json        # 从共享快照生成报告',
      '  node dist/cli.js compare bench/results/<glm>.json bench/results/<qwen>.json   # 跨模型对比',
      '  node dist/cli.js hitrate --check-gold         # 仅校验 gold ↔ 语料对应关系',
      '  node dist/cli.js validate                     # 校验 questions / gold / spec / manifest / anchors',
      '  node dist/cli.js catalog                      # 重算并写入 knowledge/关键词目录.md',
      '  node dist/cli.js catalog --check              # 重算并与入库关键词目录比对（不写文件）',
      '  node dist/cli.js hitrate                      # bigram 检索 recall@3/5/10 基线',
      '',
    ].join('\n'),
  )
}

function loadQuestions(path: string): BenchQuery[] {
  const raw = readFileSync(path, 'utf-8')
  const data = JSON.parse(raw) as BenchQuery[]
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`问题集为空或格式错误：${path}`)
  }
  return data
}

function loadRecords(runDir: string): CostRecord[] {
  return readFileSync(join(runDir, 'records.jsonl'), 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CostRecord)
}

/** 开关只接受 0/1；其他取值按中文参数错误拒绝，避免静默按默认运行。 */
function readBinarySwitch(flag: string, value: number): boolean {
  if (value !== 0 && value !== 1) throw new Error(`${flag} 仅支持 0 或 1：${value}`)
  return value === 1
}

function loadReportInput(inputPath: string): BenchReport {
  if (existsSync(inputPath) && statSync(inputPath).isFile()) {
    const snapshot = readSnapshot(inputPath)
    return aggregateSnapshot(snapshot)
  }
  // 运行目录：meta.json 声明该轮下发的工具，决定 read 观测是否可用（缺 meta 时同未观测处理）。
  return aggregate(loadRecords(inputPath), [], loadRunDeclaration(inputPath))
}

/** 读取运行目录 meta.json 的观测声明；快照路径由 snapshot.meta 提供同一信息，缺失或非法时按无法证明处理。 */
function loadRunDeclaration(runDir: string): ReportRunDeclaration {
  const path = join(runDir, 'meta.json')
  if (!existsSync(path)) return {}
  try {
    return runDeclarationFromMeta(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    return {}
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  // 退役参数在任何实际工作（检索、模型调用、写盘、catalog 写入）之前拦截，按既有口径以退出码 1 结束（ADR-021）。
  const retiredError = retiredFlagError(args)
  if (retiredError) throw new Error(retiredError)
  if (args.help || args.command === 'help') {
    printUsage()
    return
  }

  if (args.command === 'run') {
    if (!args.questions) validateBenchmarkIntegrity(process.cwd())
    if (args.retrieverMissingValue) throw new Error('--retriever 缺少取值（可选 bm25 | hybrid）')
    const config = loadConfig(args.provider)
    if (args.retriever !== null) config.retriever = args.retriever
    if (args.expandFulltext !== null) config.expandFulltext = readBinarySwitch('--expand-fulltext', args.expandFulltext)
    if (args.attachFacts !== null) config.attachFacts = readBinarySwitch('--attach-facts', args.attachFacts)
    if (args.toolBudget !== null) config.toolBudget = args.toolBudget
    if (args.toolAttemptLimit !== null) config.toolAttemptLimit = args.toolAttemptLimit
    if (args.sessionTimeoutMs !== null) config.sessionTimeoutMs = args.sessionTimeoutMs
    if (args.minRag !== null) {
      if (args.minRag !== 0 && args.minRag !== 1) {
        throw new Error(`--min-rag 仅支持 0 或 1：${args.minRag}`)
      }
      config.feedbackOnNoToolAnswer = args.minRag === 1
    }
    validateBenchConfig(config)
    if (args.temperature !== null) {
      if (!Number.isFinite(args.temperature) || args.temperature < 0) {
        throw new Error(`temperature 必须是大于等于 0 的数字：${args.temperature}`)
      }
      config.temperature = args.temperature
    }
    const stats = corpusStats(config.corpusDir)
    if (stats.files === 0) {
      throw new Error(`语料目录为空：${config.corpusDir}（相对仓库根运行）`)
    }

    const questionsPath = args.questions ?? join(process.cwd(), 'bench', 'questions.json')
    const questions = loadQuestions(questionsPath)
    const picked = args.limit ? questions.slice(0, args.limit) : questions

    process.stdout.write(
      `Provider：${config.providerLabel}｜语料：${stats.files} 个文件｜问题：${picked.length}/${questions.length}｜档位：${args.thinking}｜temperature：${config.temperature ?? '服务端默认'}｜检索器：${config.retriever}｜检索范围：base/guides（manifest 全部块）｜扩展原文：${config.expandFulltext ? '是' : '否'}｜附带 facts：${effectiveAttachFacts(config) ? '是' : '否'}｜成功额度：${config.toolBudget}｜获准尝试上限：${config.toolAttemptLimit}｜总超时：${config.sessionTimeoutMs}ms｜未调用工具回馈：${config.feedbackOnNoToolAnswer ? '开' : '关'}｜dry：${args.dry}\n`,
    )

    const out = await runBenchmark(picked, {
      thinking: args.thinking,
      dry: args.dry,
      outDir: args.out ?? undefined,
      questionsPath,
      config,
    })
    process.stdout.write(`完成：${out.records.length} 条记录，耗时 ${(out.elapsedMs / 1000).toFixed(1)}s\n`)
    process.stdout.write(`JSONL：${out.jsonlPath}\n`)
    process.stdout.write(`元信息：${out.metaPath}\n`)
    process.stdout.write(`回答：${out.answersPath}\n`)
    process.stdout.write(`注入记录：${out.injectedPath}\n`)
    process.stdout.write(`执行记录：${out.tracePath}\n`)

    const report = aggregate(out.records, [], loadRunDeclaration(out.runDir))
    process.stdout.write(renderMarkdown(report))
    return
  }

  if (args.command === 'hitrate') {
    if (!args.questions && !args.gold) validateBenchmarkIntegrity(process.cwd())
    const config = loadConfig()
    // 显式传入扩展/附带开关时给出提示，避免静默忽略（hitrate 只做检索排序，不执行原文扩展与 facts 附带）。
    const ignored = ignoredHitrateFlags(args)
    if (ignored.length > 0) {
      process.stderr.write(`提示：hitrate 忽略 ${ignored.join('、')}（该命令不执行原文扩展与 facts 附带）\n`)
    }
    const goldPath = args.gold ?? join(process.cwd(), 'bench', 'gold.json')
    const gold = loadGold(goldPath)
    // gold 与 checkGold 一律在完整、未截断的定位目录解析，分母不因检索范围收缩而删减（ADR-013 步骤 5）。
    const directoryChunks = loadCorpus(config.corpusDir)

    if (args.checkGold) {
      const { missing } = checkGold(gold, directoryChunks)
      if (missing.length > 0) {
        process.stderr.write(`gold ↔ 语料校验失败（${missing.length} 项无法解析）：\n`)
        for (const m of missing) process.stderr.write(`  - ${m.queryId}: ${m.key}\n`)
        process.exitCode = 1
        return
      }
      const total = Object.values(gold).reduce((acc, e) => acc + e.golden.length, 0)
      process.stdout.write(`gold ↔ 语料校验通过：${Object.keys(gold).length} 题 / ${total} 项 golden 全部可解析\n`)
      return
    }

    const questionsPath = args.questions ?? join(process.cwd(), 'bench', 'questions.json')
    const questions = loadQuestions(questionsPath)
    // 检索范围与 runner 生产路径一致（同 maxContextChars）：等于 manifest 声明的全部块，无技能表过滤（ADR-021）。
    const retrievalChunks = loadCorpus(config.corpusDir, config.maxContextChars)
    const topKs = (args.topk ?? '3,5,10')
      .split(',')
      .map((s) => Number(s.trim()))
    if (topKs.some((n) => !Number.isInteger(n) || n <= 0)) {
      throw new Error('--topk 格式错误（应为逗号分隔正整数，如 3,5,10）')
    }

    const result = runHitrate(
      buildIndex(retrievalChunks),
      retrievalChunks,
      questions,
      gold,
      topKs,
      { directoryChunks },
    )
    // 落盘/输出携带运行参数上下文，保证 --out 文件可复现（分词器 + 实体加权 + 检索范围）
    const contextLine = `分词器：${config.tokenizer}｜实体加权：${config.entityBoost === 0 ? '关' : `×${config.entityBoost}`}｜检索范围：base/guides（manifest 全部块）｜检索 chunks：${retrievalChunks.length}｜定位目录 chunks：${directoryChunks.length}｜问题：${questions.length}`
    result.note = contextLine
    process.stdout.write(`${contextLine}\n`)
    const md = renderHitrate(result)
    if (args.out) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(args.out, md + '\n', 'utf-8')
      process.stdout.write(`已写入：${args.out}\n`)
    }
    process.stdout.write(md + '\n')
    return
  }

  if (args.command === 'validate') {
    const summary = validateBenchmarkIntegrity(process.cwd())
    process.stdout.write(
      `基准完整性校验通过：${summary.questionCount} 题 / ${summary.goldCount} 个 gold 题号 / ${summary.specCount} 个 spec 题号 / ${summary.corpusFileCount} 个白名单文档 / ${summary.chunkCount} 个切块 / ${summary.snapshotCount} 个共享快照 / ${summary.snapshotBytes} 字节\n`,
    )
    return
  }

  if (args.command === 'catalog') {
    const unsupported = unsupportedCatalogFlags(args)
    if (unsupported.length > 0) throw new Error(`catalog 不支持参数：${unsupported.join('、')}；仅支持 --check`)
    const root = process.cwd()
    const target = join(root, ...CATALOG_RELATIVE_PATH.split('/'))
    const expected = generateKeywordCatalogMarkdown(root)
    if (args.check) {
      if (!existsSync(target)) {
        process.stderr.write(`关键词目录缺失：${CATALOG_RELATIVE_PATH}\n`)
        process.exitCode = 1
        return
      }
      const diff = catalogDifference(expected, readFileSync(target, 'utf-8').replace(/\r\n/g, '\n'))
      if (diff.length > 0) {
        for (const line of diff) process.stderr.write(`${line}\n`)
        process.exitCode = 1
        return
      }
      process.stdout.write(`关键词目录一致：${CATALOG_RELATIVE_PATH}\n`)
      return
    }
    writeFileSync(target, expected, 'utf-8')
    process.stdout.write(`已写入：${CATALOG_RELATIVE_PATH}\n`)
    return
  }

  if (args.command === 'compare') {
    const runDirs = args.runDir ? [args.runDir, ...args.positional] : args.positional
    if (runDirs.length < 2) throw new Error('compare 需要至少 2 个 runDir（bench-runs/<ts>-<provider>-<thinking>）')
    const reports = runDirs.map(loadReportInput)
    const md = renderCrossProvider(reports)
    if (args.out) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(args.out, md + '\n', 'utf-8')
      process.stdout.write(`已写入：${args.out}\n`)
    } else {
      process.stdout.write(md)
    }
    return
  }

  if (args.command === 'report') {
    if (!args.runDir) throw new Error('report 需要 runDir 参数（bench-runs/<ts>-<provider>-<thinking>）')
    const report = loadReportInput(args.runDir)
    const md = renderMarkdown(report)
    if (args.out) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(args.out, md + '\n', 'utf-8')
      writeFileSync(args.out.replace(/\.md$/, '.csv'), renderCsv(report) + '\n', 'utf-8')
      process.stdout.write(`已写入：${args.out}（及同名 .csv）\n`)
    } else {
      process.stdout.write(md)
    }
    return
  }

  if (args.command === 'export') {
    if (!args.runDir) throw new Error('export 需要 runDir 参数（bench-runs/<run-id>）')
    const questions = args.questions ? loadQuestions(args.questions) : undefined
    const snapshot = snapshotFromRunDir(args.runDir, {
      root: process.cwd(),
      questions,
      topic: args.topic ?? undefined,
    })
    const outputPath = args.out ?? join(process.cwd(), 'bench', 'results', `${snapshot.runId}.json`)
    writeSnapshot(outputPath, snapshot)
    process.stdout.write(`共享快照：${outputPath}\n`)
    process.stdout.write(`查询：${snapshot.queries.length}｜记录：${snapshot.records.length}\n`)
    return
  }

  printUsage()
}

/** 入口完成信号，包含错误退出处理；契约测试等待此 Promise 后再恢复进程状态。 */
export const cliCompletion: Promise<void> = main().catch((err: unknown) => {
  process.stderr.write(`错误：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
