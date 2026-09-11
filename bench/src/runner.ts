/**
 * 基准运行器：跑问题集 → 写 JSONL 成本记录
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { effectiveAttachFacts, loadConfig, validateBenchConfig, type BenchConfig } from './config.js'
import { loadCorpus } from './corpus.js'
import { buildSectionDirectory } from './sections.js'
import { buildIndex, currentEntityBoost, currentTokenizer } from './retriever.js'
import { buildSystemPrompt, loadKnowledgeAgentInstructions, runQuery, type AgentOptions } from './agent.js'
import type { BenchQuery, CostRecord, TerminationReason, ThinkingMode } from './types.js'
import { createQueryTrace, markTraceFailed, serializeTrace } from './trace.js'
import { aggregate } from './report.js'
import { toolSchemaMetadata, toolsForRetriever } from './tool-executor.js'
import {
  collectSourceMetadata,
  completeRunInputs,
  createRunInputs,
  markFactsCaptured,
  markFactsLoadFailed,
  redactSensitiveText,
  sha256,
  writeRunInputs,
} from './inputs.js'

export interface RunOutput {
  records: CostRecord[]
  /** 原始运行目录；可交给 bench export 转换为共享快照。 */
  runDir: string
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
  /** 非敏感运行输入记录路径 */
  inputsPath: string
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
  /** 成功额度已用（非空执行成功扣点数） */
  budgetUsed: number
  /** 成功额度余额 */
  budgetRemaining: number
  /** 获准尝试已用数 */
  attemptUsed: number
  /** 获准尝试上限 */
  attemptLimit: number
  answer: string | null
}

export async function runBenchmark(
  questions: BenchQuery[],
  opts: { thinking: ThinkingMode; dry: boolean; outDir?: string; questionsPath?: string; config?: BenchConfig },
): Promise<RunOutput> {
  const config = opts.config ?? loadConfig()
  // 程序化入口与 CLI 共用同一份校验，避免在写盘前用失效/未知模式构建工具与 meta。
  validateBenchConfig(config)
  const started = Date.now()
  const agentInstructions = loadKnowledgeAgentInstructions()
  const systemPrompt = buildSystemPrompt(config.retriever, agentInstructions, config.toolBudget, config.toolAttemptLimit)
  const toolSchema = toolSchemaMetadata(config.retriever)
  const toolDefinitions = toolsForRetriever(config.retriever)
  const sourceAtStart = collectSourceMetadata()

  // 语料 + 索引（一次构建，全部查询复用）
  const chunks = loadCorpus(config.corpusDir, config.maxContextChars)
  const index = buildIndex(chunks)
  // 当前全部模式（bm25/hybrid）都开放 read_section，恒构建小节目录；与检索同用白名单原文来源。
  const sections = buildSectionDirectory(config.corpusDir)

  const temperatureTag = config.temperature === undefined ? 'default' : `t${config.temperature}`
  const runTag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${config.provider}-${opts.thinking}-${temperatureTag}`
  const outDir = opts.outDir ?? join(process.cwd(), 'bench-runs')
  const runDir = join(outDir, runTag)
  mkdirSync(runDir, { recursive: true })

  const jsonlPath = join(runDir, 'records.jsonl')
  const metaPath = join(runDir, 'meta.json')
  const tracePath = join(runDir, 'trace.jsonl')
  const inputsPath = join(runDir, 'inputs.json')
  writeFileSync(tracePath, '', 'utf-8')

  const runInputs = createRunInputs({
    config,
    thinking: opts.thinking,
    dry: opts.dry,
    agentInstructions,
    systemPrompt,
    toolSchema,
    toolDefinitions,
    questions,
    chunks,
    sections,
    sourceAtStart,
  })
  // inputs.json 必须在首个 provider 调用前存在；之后只更新同一内存快照的 facts 观测状态。
  writeRunInputs(inputsPath, runInputs)
  let factsObservationFinished = false
  const observeFactsStore = (store: Parameters<typeof markFactsCaptured>[1]): void => {
    if (factsObservationFinished) return
    factsObservationFinished = true
    markFactsCaptured(runInputs, store)
  }
  const observeFactsFailure = (error: unknown): void => {
    if (factsObservationFinished) return
    factsObservationFinished = true
    markFactsLoadFailed(runInputs, error, [config.apiKey])
  }

  const agentOptsBase: Omit<AgentOptions, 'trace'> = {
    config,
    agentInstructions,
    systemPrompt,
    sections,
    onFactsStoreUsed: observeFactsStore,
    onFactsStoreLoadFailed: observeFactsFailure,
    thinking: opts.thinking,
    dry: opts.dry,
  }
  const lines: string[] = []
  const answers: AnswerRecord[] = []
  /** 每题实际注入上下文的 chunk id（R1 注入覆盖率判定用） */
  const injectedMap: Record<string, string[]> = {}
  let failed = 0
  let modelSteps = 0
  let toolBatches = 0
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
      feedbackUsed += result.feedbackUsed ? 1 : 0
      terminationReasons[result.terminationReason] = (terminationReasons[result.terminationReason] ?? 0) + 1
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
          budgetUsed: result.budget.successUsed,
          budgetRemaining: result.budget.remaining,
          attemptUsed: result.budget.attemptUsed,
          attemptLimit: result.budget.attemptLimit,
          answer: result.finalAnswer,
        })
        process.stderr.write(`问题 ${q.id} 完成：${result.rounds} 轮\n`)
      } else {
        failed++
        const message = result.failure?.message ?? `查询未完成：${result.terminationReason}`
        const safeMessage = redactSensitiveText(message, [config.apiKey])
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
          budgetUsed: result.budget.successUsed,
          budgetRemaining: result.budget.remaining,
          attemptUsed: result.budget.attemptUsed,
          attemptLimit: result.budget.attemptLimit,
          answer: `（查询未完成：${safeMessage}）`,
        })
        if (result.failure) markTraceFailed(trace, result.failure)
        process.stderr.write(`问题 ${q.id} 未完成：${safeMessage}\n`)
      }
    } catch (err) {
      // 单题失败不中断整批：记录失败原因，继续下一题
      failed++
      injectedMap[q.id] = []
      const msg = err instanceof Error ? err.message : String(err)
      const safeMessage = redactSensitiveText(msg, [config.apiKey])
      process.stderr.write(`问题 ${q.id} 失败：${safeMessage}\n`)
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
        attemptUsed: 0,
        attemptLimit: config.toolAttemptLimit,
        answer: `（查询失败：${safeMessage}）`,
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
  // 全部题目结束后再落盘最终 inputs.json，保持先于 meta.json 写入的时序。
  completeRunInputs(runInputs)
  writeRunInputs(inputsPath, runInputs)
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        schemaVersion: 2,
        traceSchemaVersion: 3,
        ts: new Date().toISOString(),
        thinking: opts.thinking,
        dry: opts.dry,
        provider: config.provider,
        model: config.model,
        temperature: config.temperature ?? null,
        baseUrl: config.baseUrl,
        retriever: config.retriever,
        includeSkillTables: config.includeSkillTables,
        expandFulltext: config.expandFulltext,
        attachFacts: effectiveAttachFacts(config),
        toolBudget: config.toolBudget,
        toolAttemptLimit: config.toolAttemptLimit,
        sessionTimeoutMs: config.sessionTimeoutMs,
        feedbackOnNoToolAnswer: config.feedbackOnNoToolAnswer,
        toolChoice: 'auto',
        // 宿主未开启并行工具调用：同批按返回顺序逐项串行执行与结算。
        parallelToolCalls: false,
        agentInstructionsSha256: sha256(agentInstructions),
        ...toolSchema,
        maxTokens: config.maxTokens,
        inputsSchemaVersion: runInputs.schemaVersion,
        tokenizer: currentTokenizer(),
        entityBoost: currentEntityBoost(),
        topK: config.topK,
        maxContextChars: config.maxContextChars,
        corpusDir: config.corpusDir,
        chunks: chunks.length,
        questions: questions.length,
        questionIds: questions.map((question) => question.id),
        questionsPath: relativeQuestionPath(opts.questionsPath ?? join(process.cwd(), 'bench', 'questions.json')),
        questionDefinitions: questions.map(({ id, category, question }) => ({ id, category, question })),
        topic: `rag-${config.retriever}`,
        prices: config.prices,
        source: collectSourceMetadata(),
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
        toolCallsRequested: runReport.toolStats.requested,
        toolCallsGranted: runReport.toolStats.granted,
        toolCallsExecuted: runReport.toolStats.executed,
        toolCallsDenied: runReport.toolStats.denied,
        toolErrors: runReport.toolStats.errors,
        toolAttempts: runReport.toolStats.attempts,
        toolSuccesses: runReport.toolStats.successes,
        toolResultChars: runReport.toolStats.resultChars,
        toolHitCount: runReport.toolStats.hitCount,
        toolHitUnknown: runReport.toolStats.hitUnknown,
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
    runDir,
    jsonlPath,
    metaPath,
    answersPath,
    injectedPath,
    tracePath,
    inputsPath,
    elapsedMs: Date.now() - started,
  }
}

/** 渲染回答记录 Markdown（供人工抽查质量，不参与成本评估） */
function renderAnswers(answers: AnswerRecord[]): string {
  const blocks = answers.map((a) => {
    const toolLine = a.toolTrace.length > 0 ? `｜工具序列：${a.toolTrace.join('→')}` : '｜工具序列：无'
    return `## ${a.queryId}（${a.category}）\n\n- 问题：${a.question}\n- 状态：${a.status}｜终止：${a.terminationReason}\n- 模型步骤：${a.rounds}｜工具批次：${a.toolRounds}｜成功额度：${a.budgetUsed}/${a.budgetUsed + a.budgetRemaining}｜获准尝试：${a.attemptUsed}/${a.attemptLimit}${toolLine}\n- 宿主回馈：${a.feedbackUsed ? '是' : '否'}\n\n${a.answer ?? '（无最终回答）'}`
  })
  return ['# 查询回答记录', '', '> 供人工抽查答案质量，不参与成本评估。', '', ...blocks].join('\n')
}

/** 只记录仓库内题集的相对路径；仓库外题集依靠元信息中的嵌入定义导出。 */
function relativeQuestionPath(input: string): string | null {
  const root = resolve(process.cwd())
  const path = resolve(input)
  const rel = relative(root, path).replace(/\\/g, '/')
  return rel && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/') ? rel : null
}
