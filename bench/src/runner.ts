/**
 * 基准运行器：跑问题集 → 写 JSONL 成本记录
 */
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, type BenchConfig } from './config.js'
import { loadCorpus } from './corpus.js'
import { buildIndex } from './retriever.js'
import { loadKnowledgeAgentInstructions, runQuery, type AgentOptions } from './agent.js'
import type { BenchQuery, CostRecord, TerminationReason, ThinkingMode } from './types.js'
import { createQueryTrace, markTraceFailed, serializeTrace } from './trace.js'
import { aggregate } from './report.js'

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
  /** 单题执行记录路径（每题一行，可人工复盘） */
  tracePath: string
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
  status: 'completed' | 'failed' | 'cancelled'
  terminationReason: TerminationReason
  feedbackUsed: boolean
  budgetUsed: number
  budgetRemaining: number
  answer: string | null
}

export async function runBenchmark(
  questions: BenchQuery[],
  opts: { thinking: ThinkingMode; dry: boolean; outDir?: string; config?: BenchConfig },
): Promise<RunOutput> {
  const config = opts.config ?? loadConfig()
  const started = Date.now()
  const agentInstructions = loadKnowledgeAgentInstructions()
  const agentInstructionsSha256 = createHash('sha256').update(agentInstructions).digest('hex')

  // 语料 + 索引（一次构建，全部查询复用；facts 模式不依赖散文语料——语料目录已删除，跳过加载以空占位）
  const chunks = config.retriever === 'facts' ? [] : loadCorpus(config.corpusDir, config.maxContextChars)
  const index = buildIndex(chunks)

  const temperatureTag = config.temperature === undefined ? 'default' : `t${config.temperature}`
  const runTag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${config.provider}-${opts.thinking}-${temperatureTag}`
  const outDir = opts.outDir ?? join(process.cwd(), 'bench-runs')
  const runDir = join(outDir, runTag)
  mkdirSync(runDir, { recursive: true })

  const jsonlPath = join(runDir, 'records.jsonl')
  const metaPath = join(runDir, 'meta.json')
  const tracePath = join(runDir, 'trace.jsonl')
  writeFileSync(tracePath, '', 'utf-8')

  const agentOptsBase: Omit<AgentOptions, 'trace'> = { config, agentInstructions, thinking: opts.thinking, dry: opts.dry }
  const lines: string[] = []
  const answers: AnswerRecord[] = []
  /** 每题实际注入上下文的 chunk id（R1 注入覆盖率判定用） */
  const injectedMap: Record<string, string[]> = {}
  let failed = 0
  let modelSteps = 0
  let toolBatches = 0
  let toolCallsRequested = 0
  let toolCallsGranted = 0
  let toolCallsExecuted = 0
  let toolCallsDenied = 0
  let toolErrors = 0
  let toolResultChars = 0
  let feedbackUsed = 0
  const terminationReasons: Partial<Record<TerminationReason, number>> = {}

  for (const q of questions) {
    const trace = createQueryTrace(q)
    const agentOpts: AgentOptions = { ...agentOptsBase, trace }
    try {
      const result = await runQuery(q, agentOpts, chunks, index)
      for (const r of result.records) lines.push(JSON.stringify(r))
      modelSteps += result.modelSteps
      toolBatches += result.toolRounds
      toolCallsRequested += result.budget.requested
      toolCallsExecuted += result.budget.executed
      toolCallsDenied += result.budget.denied
      feedbackUsed += result.feedbackUsed ? 1 : 0
      terminationReasons[result.terminationReason] = (terminationReasons[result.terminationReason] ?? 0) + 1
      for (const r of result.records) {
        if (r.toolBatch) {
          toolCallsGranted += r.toolBatch.granted
          toolErrors += r.toolBatch.errors
          toolResultChars += r.toolBatch.resultChars
        }
      }
      injectedMap[q.id] = result.injectedIds
      if (result.status === 'completed' && result.finalAnswer != null) {
        answers.push({
          queryId: q.id,
          category: q.category,
          question: q.question,
          rounds: result.rounds,
          toolRounds: result.toolRounds,
          toolTrace: result.toolTrace.flat(),
          status: result.status,
          terminationReason: result.terminationReason,
          feedbackUsed: result.feedbackUsed,
          budgetUsed: result.budget.used,
          budgetRemaining: result.budget.remaining,
          answer: result.finalAnswer,
        })
        process.stderr.write(`问题 ${q.id} 完成：${result.rounds} 轮\n`)
      } else {
        failed++
        const message = result.failure?.message ?? `查询未完成：${result.terminationReason}`
        answers.push({
          queryId: q.id,
          category: q.category,
          question: q.question,
          rounds: result.rounds,
          toolRounds: result.toolRounds,
          toolTrace: result.toolTrace.flat(),
          status: result.status,
          terminationReason: result.terminationReason,
          feedbackUsed: result.feedbackUsed,
          budgetUsed: result.budget.used,
          budgetRemaining: result.budget.remaining,
          answer: `（查询未完成：${message}）`,
        })
        if (result.failure) markTraceFailed(trace, result.failure)
        process.stderr.write(`问题 ${q.id} 未完成：${message}\n`)
      }
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
        status: 'failed',
        terminationReason: 'llm_error',
        feedbackUsed: false,
        budgetUsed: 0,
        budgetRemaining: config.toolBudget,
        answer: `（查询失败：${msg}）`,
      })
      markTraceFailed(trace, {
        stage: trace.failure?.stage ?? 'runner',
        message: msg,
        round: trace.failure?.round,
        toolCallId: trace.failure?.toolCallId,
      })
    }
    appendFileSync(tracePath, `${serializeTrace(trace, [config.apiKey])}\n`, 'utf-8')
  }

  writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8')
  const answersPath = join(runDir, 'answers.md')
  writeFileSync(answersPath, renderAnswers(answers) + '\n', 'utf-8')
  const injectedPath = join(runDir, 'injected.json')
  writeFileSync(injectedPath, JSON.stringify(injectedMap, null, 2) + '\n', 'utf-8')
  const runRecords = lines.map((line) => JSON.parse(line) as CostRecord)
  const runReport = aggregate(runRecords)
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        schemaVersion: 2,
        traceSchemaVersion: 2,
        ts: new Date().toISOString(),
        thinking: opts.thinking,
        dry: opts.dry,
        provider: config.provider,
        model: config.model,
        temperature: config.temperature ?? null,
        baseUrl: config.baseUrl,
        retriever: config.retriever,
        toolBudget: config.toolBudget,
        sessionTimeoutMs: config.sessionTimeoutMs,
        feedbackOnNoToolAnswer: config.feedbackOnNoToolAnswer,
        toolChoice: 'auto',
        parallelToolCalls: config.provider === 'qwen',
        agentInstructionsSha256,
        tokenizer: config.tokenizer,
        entityBoost: config.entityBoost,
        topK: config.topK,
        maxContextChars: config.maxContextChars,
        corpusDir: config.corpusDir,
        chunks: chunks.length,
        questions: questions.length,
        records: lines.length,
        inputTokens: runReport.totalInput,
        outputTokens: runReport.totalOutput,
        inputTokensExact: runReport.totalInputExact,
        outputTokensExact: runReport.totalOutputExact,
        totalCostIn: runReport.totalCostIn,
        totalCostOut: runReport.totalCostOut,
        totalCost: runReport.totalCost,
        costComplete: runReport.costComplete,
        incompleteUsageCalls: runReport.incompleteUsageCalls,
        unknownUsageCalls: runReport.unknownUsageCalls,
        failed,
        modelSteps,
        toolBatches,
        toolCallsRequested,
        toolCallsGranted,
        toolCallsExecuted,
        toolCallsDenied,
        toolErrors,
        toolResultChars,
        httpAttempts: runReport.totalHttpAttempts,
        retryAttempts: runReport.retryAttempts,
        feedbackUsed,
        terminationReasons,
        elapsedMs: Date.now() - started,
      },
      null,
      2,
    ),
    'utf-8',
  )

  return {
    records: runRecords,
    jsonlPath,
    metaPath,
    answersPath,
    injectedPath,
    tracePath,
    elapsedMs: Date.now() - started,
  }
}

/** 渲染回答记录 Markdown（供人工抽查质量，不参与成本评估） */
function renderAnswers(answers: AnswerRecord[]): string {
  const blocks = answers.map((a) => {
    const toolLine = a.toolTrace.length > 0 ? `｜工具序列：${a.toolTrace.join('→')}` : '｜工具序列：无'
    return `## ${a.queryId}（${a.category}）\n\n- 问题：${a.question}\n- 状态：${a.status}｜终止：${a.terminationReason}\n- 模型步骤：${a.rounds}｜工具批次：${a.toolRounds}｜预算：${a.budgetUsed}/${a.budgetUsed + a.budgetRemaining}${toolLine}\n\n${a.answer ?? '（无最终回答）'}`
  })
  return ['# 查询回答记录', '', '> 供人工抽查答案质量，不参与成本评估。', '', ...blocks].join('\n')
}
