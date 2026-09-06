/**
 * CLI 入口
 *
 * 用法：
 *   node dist/cli.js run   [--thinking off|low|high] [--temperature N] [--limit N] [--dry] [--questions <path>] [--out <dir>]
 *   node dist/cli.js export <runDir> [--questions <path>] [--topic <name>] [--out <path>]
 *   node dist/cli.js report <runDir|snapshot> [--out <path>]
 *   node dist/cli.js compare <runDir|snapshot> <runDir|snapshot> [--out <path>]
 *   node dist/cli.js hitrate [--topk 3,5,10] [--gold <path>] [--check-gold] [--out <path>]
 *   node dist/cli.js validate
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, validateBenchConfig } from './config.js'
import { corpusStats, loadCorpus } from './corpus.js'
import { checkGold, loadGold, renderHitrate, runHitrate } from './hitrate.js'
import { buildIndex } from './retriever.js'
import { getCardStore } from './facts/store.js'
import { runBenchmark } from './runner.js'
import { aggregate, aggregateSnapshot, renderCrossProvider, renderCsv, renderMarkdown, type BenchReport } from './report.js'
import type { BenchQuery, CostRecord } from './types.js'
import { validateBenchmarkIntegrity } from './benchmark-integrity.js'
import { parseArgs } from './cli-args.js'
import { readSnapshot, snapshotFromRunDir, writeSnapshot } from './snapshot.js'

/**
 * 非 facts 模式的散文 RAG 与 hitrate 均直接使用 knowledge/白名单语料。
 * facts 模式旁路散文加载，使用 lookup/query_operators 读取全量记录卡；
 * 两种模式共用 questions 的题号和问题定义。
 */

function printUsage(): void {
  process.stdout.write(
    [
      'rag-test bench —— LLM 查询输出成本基准（Hy3 / Qwen3.7-Flash）',
      '',
      '用法：',
      '  node dist/cli.js run [--provider hy3|qwen] [--thinking off|low|high] [--temperature N] [--retriever bm25|grep|both|facts|hybrid] [--tool-budget N] [--session-timeout-ms N] [--min-rag 0|1] [--limit N] [--dry] [--questions <path>] [--out <dir>]',
      '  node dist/cli.js export <runDir> [--questions <path>] [--topic <name>] [--out <path>]',
      '  node dist/cli.js report <runDir|snapshot> [--out <path>]',
      '  node dist/cli.js compare <runDir|snapshot> <runDir|snapshot> [--out <path>]',
      '  node dist/cli.js hitrate [--topk 3,5,10] [--gold <path>] [--check-gold] [--out <path>]',
      '  node dist/cli.js validate',
      '',
      '示例：',
      '  node dist/cli.js run --dry --limit 2          # 干跑验证管线（不发请求）',
      '  node dist/cli.js run --provider qwen --thinking low   # 真实跑（需 DASHSCOPE_API_KEY）',
      '  node dist/cli.js run --provider qwen --thinking low --retriever grep --min-rag 1   # grep 对照（P3）',
      '  node dist/cli.js run --retriever hybrid --thinking off   # BM25 RAG + facts 混合工具',
      '  node dist/cli.js report bench/results/<run-id>.json        # 从共享快照生成报告',
      '  node dist/cli.js compare bench/results/<hy3>.json bench/results/<qwen>.json   # 跨模型对比',
      '  node dist/cli.js hitrate --check-gold         # 仅校验 gold ↔ 语料对应关系',
      '  node dist/cli.js validate                     # 校验 questions / gold / spec / manifest / anchors',
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

function loadReportInput(inputPath: string): BenchReport {
  if (existsSync(inputPath) && statSync(inputPath).isFile()) {
    const snapshot = readSnapshot(inputPath)
    return aggregateSnapshot(snapshot)
  }
  return aggregate(loadRecords(inputPath))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.command === 'help') {
    printUsage()
    return
  }

  if (args.command === 'run') {
    if (!args.questions) validateBenchmarkIntegrity(process.cwd())
    const config = loadConfig(args.provider)
    if (args.retriever) config.retriever = args.retriever
    if (args.toolBudget !== null) config.toolBudget = args.toolBudget
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
    const isFacts = config.retriever === 'facts'
    const stats = isFacts ? { files: 0 } : corpusStats(config.corpusDir)
    if (!isFacts && stats.files === 0) {
      throw new Error(`语料目录为空：${config.corpusDir}（相对仓库根运行）`)
    }

    const questionsPath = args.questions ?? join(process.cwd(), 'bench', 'questions.json')
    const questions = loadQuestions(questionsPath)
    const picked = args.limit ? questions.slice(0, args.limit) : questions

    process.stdout.write(
      `Provider：${config.providerLabel}｜语料：${isFacts ? `记录卡 ×${getCardStore().cards.length}` : `${stats.files} 个文件`}｜问题：${picked.length}/${questions.length}｜档位：${args.thinking}｜temperature：${config.temperature ?? '服务端默认'}｜检索器：${config.retriever}｜工具预算：${config.toolBudget}｜总超时：${config.sessionTimeoutMs}ms｜未调用工具回馈：${config.feedbackOnNoToolAnswer ? '开' : '关'}｜dry：${args.dry}\n`,
    )

    const out = await runBenchmark(picked, {
      thinking: args.thinking,
      dry: args.dry,
      outDir: args.out ?? undefined,
      config,
    })
    process.stdout.write(`完成：${out.records.length} 条记录，耗时 ${(out.elapsedMs / 1000).toFixed(1)}s\n`)
    process.stdout.write(`JSONL：${out.jsonlPath}\n`)
    process.stdout.write(`元信息：${out.metaPath}\n`)
    process.stdout.write(`回答：${out.answersPath}\n`)
    process.stdout.write(`注入记录：${out.injectedPath}\n`)
    process.stdout.write(`执行记录：${out.tracePath}\n`)

    const report = aggregate(out.records)
    process.stdout.write(renderMarkdown(report))
    return
  }

  if (args.command === 'hitrate') {
    if (!args.questions && !args.gold) validateBenchmarkIntegrity(process.cwd())
    const config = loadConfig()
    const goldPath = args.gold ?? join(process.cwd(), 'bench', 'gold.json')
    const gold = loadGold(goldPath)
    // 语料加载与 runner 生产路径一致（maxContextChars 同源，当前语料不会触发截断）
    const chunks = loadCorpus(config.corpusDir, config.maxContextChars)

    if (args.checkGold) {
      const { missing } = checkGold(gold, chunks)
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
    const topKs = (args.topk ?? '3,5,10')
      .split(',')
      .map((s) => Number(s.trim()))
    if (topKs.some((n) => !Number.isInteger(n) || n <= 0)) {
      throw new Error('--topk 格式错误（应为逗号分隔正整数，如 3,5,10）')
    }

    const result = runHitrate(
      buildIndex(chunks),
      chunks,
      questions,
      gold,
      topKs,
    )
    // 落盘/输出携带运行参数上下文，保证 --out 文件可复现（分词器 + 实体加权）
    const contextLine = `分词器：${config.tokenizer}｜实体加权：${config.entityBoost === 0 ? '关' : `×${config.entityBoost}`}｜语料 chunks：${chunks.length}｜问题：${questions.length}`
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
      `基准完整性校验通过：${summary.questionCount} 题 / ${summary.goldCount} 个 gold 题号 / ${summary.specCount} 个 spec 题号 / ${summary.corpusFileCount} 个白名单文档 / ${summary.chunkCount} 个切块\n`,
    )
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

main().catch((err: unknown) => {
  process.stderr.write(`错误：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
