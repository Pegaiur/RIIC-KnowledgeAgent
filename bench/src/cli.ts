/**
 * CLI 入口
 *
 * 用法：
 *   node dist/cli.js run   [--thinking off|low|high] [--limit N] [--dry] [--questions <path>] [--out <dir>]
 *   node dist/cli.js report <runDir> [--out <path>]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.js'
import { corpusStats } from './corpus.js'
import { runBenchmark } from './runner.js'
import { aggregate, renderCrossProvider, renderCsv, renderMarkdown } from './report.js'
import type { BenchQuery, CostRecord, ProviderId, ThinkingMode } from './types.js'

interface ParsedArgs {
  command: string
  thinking: ThinkingMode
  provider: ProviderId
  limit: number | null
  dry: boolean
  questions: string | null
  out: string | null
  runDir: string | null
  /** 位置参数（compare 收集多个 runDir） */
  positional: string[]
  help: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: argv[0] ?? 'help',
    thinking: 'off',
    provider: 'hy3',
    limit: null,
    dry: false,
    questions: null,
    out: null,
    runDir: null,
    positional: [],
    help: false,
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') parsed.help = true
    else if (a === '--dry') parsed.dry = true
    else if (a === '--provider') parsed.provider = (argv[++i] as ProviderId) ?? 'hy3'
    else if (a === '--thinking') parsed.thinking = (argv[++i] as ThinkingMode) ?? 'off'
    else if (a === '--limit') parsed.limit = Number(argv[++i]) || null
    else if (a === '--questions') parsed.questions = argv[++i] ?? null
    else if (a === '--out' && parsed.command === 'run') parsed.out = argv[++i] ?? null
    else if (a === '--out' && parsed.command === 'report') parsed.out = argv[++i] ?? null
    else if (a === '--out' && parsed.command === 'compare') parsed.out = argv[++i] ?? null
    else if (!parsed.runDir && !a.startsWith('-')) parsed.runDir = a
    else if (!a.startsWith('-')) parsed.positional.push(a)
  }
  return parsed
}

function printUsage(): void {
  process.stdout.write(
    [
      'rag-test bench —— LLM 查询输出成本基准（Hy3 / Qwen3.7-Flash）',
      '',
      '用法：',
      '  node dist/cli.js run [--provider hy3|qwen] [--thinking off|low|high] [--limit N] [--dry] [--questions <path>] [--out <dir>]',
      '  node dist/cli.js report <runDir> [--out <path>]',
      '  node dist/cli.js compare <runDir1> <runDir2> [--out <path>]',
      '',
      '示例：',
      '  node dist/cli.js run --dry --limit 2          # 干跑验证管线（不发请求）',
      '  node dist/cli.js run --provider qwen --thinking low   # 真实跑（需 DASHSCOPE_API_KEY）',
      '  node dist/cli.js report bench/runs/xxx        # 聚合最近一次运行',
      '  node dist/cli.js compare bench/runs/<hy3> bench/runs/<qwen>   # 跨模型对比',
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

function loadReport(runDir: string): ReturnType<typeof aggregate> {
  return aggregate(loadRecords(runDir))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.command === 'help') {
    printUsage()
    return
  }

  if (args.command === 'run') {
    const config = loadConfig(args.provider)
    const stats = corpusStats(config.corpusDir)
    if (stats.files === 0) {
      throw new Error(`语料目录为空：${config.corpusDir}（相对仓库根运行）`)
    }

    const questionsPath = args.questions ?? join(process.cwd(), 'bench', 'questions.json')
    const questions = loadQuestions(questionsPath)
    const picked = args.limit ? questions.slice(0, args.limit) : questions

    process.stdout.write(
      `Provider：${config.providerLabel}｜语料：${stats.files} 个文件｜问题：${picked.length}/${questions.length}｜档位：${args.thinking}｜dry：${args.dry}\n`,
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

    const report = aggregate(out.records)
    process.stdout.write(renderMarkdown(report))
    return
  }

  if (args.command === 'compare') {
    const runDirs = args.runDir ? [args.runDir, ...args.positional] : args.positional
    if (runDirs.length < 2) throw new Error('compare 需要至少 2 个 runDir（bench/runs/<ts>-<provider>-<thinking>）')
    const reports = runDirs.map(loadReport)
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
    if (!args.runDir) throw new Error('report 需要 runDir 参数（bench/runs/<ts>-<provider>-<thinking>）')
    const report = aggregate(loadRecords(args.runDir))
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

  printUsage()
}

main().catch((err: unknown) => {
  process.stderr.write(`错误：${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
