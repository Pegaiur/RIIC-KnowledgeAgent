/**
 * 基准运行器：跑问题集 → 写 JSONL 成本记录
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, type BenchConfig } from './config.js'
import { loadCorpus } from './corpus.js'
import { buildIndex } from './retriever.js'
import { runQuery, type AgentOptions } from './agent.js'
import type { BenchQuery, CostRecord, ThinkingMode } from './types.js'

export interface RunOutput {
  records: CostRecord[]
  /** JSONL 文件路径 */
  jsonlPath: string
  /** 汇总信息文件路径 */
  metaPath: string
  elapsedMs: number
}

export async function runBenchmark(
  questions: BenchQuery[],
  opts: { thinking: ThinkingMode; dry: boolean; outDir?: string; config?: BenchConfig },
): Promise<RunOutput> {
  const config = opts.config ?? loadConfig()
  const started = Date.now()

  // 语料 + 索引（一次构建，全部查询复用）
  const chunks = loadCorpus(config.corpusDir, config.maxContextChars)
  const index = buildIndex(chunks)

  const runTag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${opts.thinking}`
  const outDir = opts.outDir ?? join(process.cwd(), 'bench', 'runs')
  const runDir = join(outDir, runTag)
  mkdirSync(runDir, { recursive: true })

  const jsonlPath = join(runDir, 'records.jsonl')
  const metaPath = join(runDir, 'meta.json')

  const agentOpts: AgentOptions = { config, thinking: opts.thinking, dry: opts.dry, chunks, index }
  const lines: string[] = []

  for (const q of questions) {
    const result = await runQuery(q, agentOpts, chunks, index)
    for (const r of result.records) lines.push(JSON.stringify(r))
  }

  writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8')
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        thinking: opts.thinking,
        dry: opts.dry,
        model: config.model,
        baseUrl: config.baseUrl,
        corpusDir: config.corpusDir,
        chunks: chunks.length,
        questions: questions.length,
        records: lines.length,
        elapsedMs: Date.now() - started,
      },
      null,
      2,
    ),
    'utf-8',
  )

  return { records: lines.map((l) => JSON.parse(l) as CostRecord), jsonlPath, metaPath, elapsedMs: Date.now() - started }
}
