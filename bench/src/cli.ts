/**
 * CLI 入口
 *
 * 用法：
 *   node dist/cli.js run   [--thinking off|low|high] [--limit N] [--dry] [--questions <path>] [--out <dir>]
 *   node dist/cli.js report <runDir> [--out <path>]
 *   node dist/cli.js hitrate [--topk 3,5,10] [--gold <path>] [--check-gold] [--out <path>]
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, type RetrieverId } from './config.js'
import { corpusStats, loadCorpus } from './corpus.js'
import { checkGold, loadGold, renderHitrate, runHitrate } from './hitrate.js'
import { buildIndex } from './retriever.js'
import { runBenchmark } from './runner.js'
import { aggregate, renderCrossProvider, renderCsv, renderMarkdown, type BenchReport } from './report.js'
import type { BenchQuery, CostRecord, ProviderId, ThinkingMode } from './types.js'

/**
 * RAG 查询工具临时停用（P0.7）。
 * 散文语料已废弃（P0.1，2026-09-03），facts-first（记录卡资产 + lookup/query 工具）重建前不可用；
 * report/compare 仅读历史运行结果、不依赖语料，保留可用。
 * TODO(tech-debt) R5：facts-first 重建（记录卡资产 + lookup/query 工具接入）后移除 RAG_TOOL_SUSPENDED 守卫，恢复 run/hitrate。
 */
const RAG_TOOL_SUSPENDED = true

function assertRagToolAvailable(): void {
  if (!RAG_TOOL_SUSPENDED) return
  throw new Error(
    'RAG 查询工具已临时停用：散文语料已废弃（2026-09-03）。待 facts-first 重建（记录卡资产 + lookup/query 工具，见 docs/draft-hybrid-facts.md）后恢复。',
  )
}

interface ParsedArgs {
  command: string
  thinking: ThinkingMode
  /** provider：未显式传 --provider 时为 undefined，回落 EXPERIMENT.provider（config 集中默认） */
  provider: ProviderId | undefined
  limit: number | null
  dry: boolean
  questions: string | null
  out: string | null
  runDir: string | null
  /** 检索器（bm25 | grep） */
  retriever: RetrieverId | null
  /** 强制首检次数 */
  minRag: number | null
  /** hitrate：topK 列表（逗号分隔，如 3,5,10） */
  topk: string | null
  /** hitrate：gold.json 路径 */
  gold: string | null
  /** hitrate：仅校验 gold ↔ 语料对应关系 */
  checkGold: boolean
  /** 位置参数（compare 收集多个 runDir） */
  positional: string[]
  help: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: argv[0] ?? 'help',
    thinking: 'off',
    provider: undefined,
    limit: null,
    dry: false,
    questions: null,
    out: null,
    runDir: null,
    retriever: null,
    minRag: null,
    topk: null,
    gold: null,
    checkGold: false,
    positional: [],
    help: false,
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') parsed.help = true
    else if (a === '--dry') parsed.dry = true
    else if (a === '--check-gold') parsed.checkGold = true
    else if (a === '--topk') parsed.topk = argv[++i] ?? null
    else if (a === '--gold') parsed.gold = argv[++i] ?? null
    else if (a === '--provider') parsed.provider = argv[++i] as ProviderId | undefined
    else if (a === '--thinking') parsed.thinking = (argv[++i] as ThinkingMode) ?? 'off'
    else if (a === '--retriever') parsed.retriever = (argv[++i] as RetrieverId) ?? null
    else if (a === '--min-rag') parsed.minRag = Number(argv[++i]) || null
    else if (a === '--limit') parsed.limit = Number(argv[++i]) || null
    else if (a === '--questions') parsed.questions = argv[++i] ?? null
    else if (a === '--out') parsed.out = argv[++i] ?? null
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
      '  node dist/cli.js run [--provider hy3|qwen] [--thinking off|low|high] [--retriever bm25|grep] [--min-rag N] [--limit N] [--dry] [--questions <path>] [--out <dir>]',
      '  node dist/cli.js report <runDir> [--out <path>]',
      '  node dist/cli.js compare <runDir1> <runDir2> [--out <path>]',
      '  node dist/cli.js hitrate [--topk 3,5,10] [--gold <path>] [--check-gold] [--out <path>]',
      '',
      '示例：',
      '  node dist/cli.js run --dry --limit 2          # 干跑验证管线（不发请求）',
      '  node dist/cli.js run --provider qwen --thinking low   # 真实跑（需 DASHSCOPE_API_KEY）',
      '  node dist/cli.js run --provider qwen --thinking low --retriever grep --min-rag 1   # grep 对照（P3）',
      '  node dist/cli.js report bench-runs/xxx        # 聚合最近一次运行',
      '  node dist/cli.js compare bench-runs/<hy3> bench-runs/<qwen>   # 跨模型对比',
      '  node dist/cli.js hitrate --check-gold         # 仅校验 gold ↔ 语料对应关系',
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

function loadReport(runDir: string): BenchReport {
  return aggregate(loadRecords(runDir))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.command === 'help') {
    printUsage()
    return
  }

  if (args.command === 'run') {
    assertRagToolAvailable()
    const config = loadConfig(args.provider)
    if (args.retriever) config.retriever = args.retriever
    if (args.minRag !== null) config.minRagCalls = args.minRag
    const stats = corpusStats(config.corpusDir)
    if (stats.files === 0) {
      throw new Error(`语料目录为空：${config.corpusDir}（相对仓库根运行）`)
    }

    const questionsPath = args.questions ?? join(process.cwd(), 'bench', 'questions.json')
    const questions = loadQuestions(questionsPath)
    const picked = args.limit ? questions.slice(0, args.limit) : questions

    process.stdout.write(
      `Provider：${config.providerLabel}｜语料：${stats.files} 个文件｜问题：${picked.length}/${questions.length}｜档位：${args.thinking}｜检索器：${config.retriever}｜强制首检：${config.minRagCalls}｜dry：${args.dry}\n`,
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

    const report = aggregate(out.records)
    process.stdout.write(renderMarkdown(report))
    return
  }

  if (args.command === 'hitrate') {
    assertRagToolAvailable()
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

  if (args.command === 'compare') {
    const runDirs = args.runDir ? [args.runDir, ...args.positional] : args.positional
    if (runDirs.length < 2) throw new Error('compare 需要至少 2 个 runDir（bench-runs/<ts>-<provider>-<thinking>）')
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
    if (!args.runDir) throw new Error('report 需要 runDir 参数（bench-runs/<ts>-<provider>-<thinking>）')
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
