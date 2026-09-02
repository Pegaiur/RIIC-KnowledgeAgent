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
  /** 回答记录文件路径（人工抽查质量用） */
  answersPath: string
  /** 注入片段记录路径（queryId → 实际注入 chunk id 列表，R1 注入覆盖率用） */
  injectedPath: string
  elapsedMs: number
}

/** 单题最终回答（供人工抽查质量，不参与成本评估） */
export interface AnswerRecord {
  queryId: string
  category: string
  question: string
  rounds: number
  toolRounds: number
  /** 每轮实际调用的检索工具序列（双工具模式统计；无工具调用为 []） */
  toolTrace: string[]
  answer: string | null
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

  const runTag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${config.provider}-${opts.thinking}`
  const outDir = opts.outDir ?? join(process.cwd(), 'bench', 'runs')
  const runDir = join(outDir, runTag)
  mkdirSync(runDir, { recursive: true })

  const jsonlPath = join(runDir, 'records.jsonl')
  const metaPath = join(runDir, 'meta.json')

  const agentOpts: AgentOptions = { config, thinking: opts.thinking, dry: opts.dry }
  const lines: string[] = []
  const answers: AnswerRecord[] = []
  /** 每题实际注入上下文的 chunk id（R1 注入覆盖率判定用） */
  const injectedMap: Record<string, string[]> = {}
  let failed = 0

  for (const q of questions) {
    try {
      const result = await runQuery(q, agentOpts, chunks, index)
      for (const r of result.records) lines.push(JSON.stringify(r))
      injectedMap[q.id] = result.injectedIds
      if (result.finalAnswer != null) {
        answers.push({
          queryId: q.id,
          category: q.category,
          question: q.question,
          rounds: result.rounds,
          toolRounds: result.toolRounds,
          toolTrace: result.toolTrace.flat(),
          answer: result.finalAnswer,
        })
      }
      process.stderr.write(`问题 ${q.id} 完成：${result.rounds} 轮\n`)
    } catch (err) {
      // 单题失败不中断整批：记录失败原因，继续下一题
      failed++
      injectedMap[q.id] = []
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`问题 ${q.id} 失败：${msg}\n`)
      answers.push({
        queryId: q.id,
        category: q.category,
        question: q.question,
        rounds: 0,
        toolRounds: 0,
        toolTrace: [],
        answer: `（查询失败：${msg}）`,
      })
    }
  }

  writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8')
  const answersPath = join(runDir, 'answers.md')
  writeFileSync(answersPath, renderAnswers(answers) + '\n', 'utf-8')
  const injectedPath = join(runDir, 'injected.json')
  writeFileSync(injectedPath, JSON.stringify(injectedMap, null, 2) + '\n', 'utf-8')
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        thinking: opts.thinking,
        dry: opts.dry,
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        retriever: config.retriever,
        minRagCalls: config.minRagCalls,
        rules: config.rules,
        tokenizer: config.tokenizer,
        entityBoost: config.entityBoost,
        topK: config.topK,
        maxContextChars: config.maxContextChars,
        corpusDir: config.corpusDir,
        chunks: chunks.length,
        questions: questions.length,
        records: lines.length,
        failed,
        elapsedMs: Date.now() - started,
      },
      null,
      2,
    ),
    'utf-8',
  )

  return {
    records: lines.map((l) => JSON.parse(l) as CostRecord),
    jsonlPath,
    metaPath,
    answersPath,
    injectedPath,
    elapsedMs: Date.now() - started,
  }
}

/** 渲染回答记录 Markdown（供人工抽查质量，不参与成本评估） */
function renderAnswers(answers: AnswerRecord[]): string {
  const blocks = answers.map((a) => {
    const toolLine = a.toolTrace.length > 0 ? `｜工具序列：${a.toolTrace.join('→')}` : '｜工具序列：无'
    return `## ${a.queryId}（${a.category}）\n\n- 问题：${a.question}\n- 轮数：${a.rounds}｜检索次数：${a.toolRounds}${toolLine}\n\n${a.answer ?? '（无最终回答）'}`
  })
  return ['# 查询回答记录', '', '> 供人工抽查答案质量，不参与成本评估。', '', ...blocks].join('\n')
}
