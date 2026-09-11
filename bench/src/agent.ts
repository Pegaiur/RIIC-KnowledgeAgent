/**
 * 简化版查询 Agent。
 *
 * 真实用户问题只进入 messages 一次；模型可通过固定 auto 的独立函数工具循环取证，
 * 宿主只负责协议校验、批次预算和结果回写。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, validateBenchConfig, type BenchConfig, type RetrieverId } from './config.js'
import type { IndexEntry } from './retriever.js'
import type { DocChunk, BenchQuery, CostRecord, HttpAttempt, LlmUsage, TerminationReason, ThinkingMode, ToolBatchStats, ToolId } from './types.js'
import { callLLM, type ChatMessage, type ProviderCallLedger, type ProviderOptions } from './provider.js'
import { aggregateAttemptCosts, aggregateUsages, computeCosts } from './pricing.js'
import { isObservedTool } from './types.js'
import type { SectionDirectory } from './sections.js'
import { markTraceFailed, type QueryTrace, type TraceFailure, type TraceLlmEvent, type TraceToolEvent } from './trace.js'
import type { CardStore } from './facts/store.js'
import {
  createKnowledgeToolExecutor,
  serializeToolResult,
  toolNamesForRetriever,
  toolsForRetriever,
  type ToolBudgetState,
  type ToolExecutionResult,
} from './tool-executor.js'

export interface AgentResult {
  status: 'completed' | 'failed' | 'cancelled'
  terminationReason: TerminationReason
  failure?: TraceFailure
  records: CostRecord[]
  finalAnswer: string | null
  rounds: number
  toolRounds: number
  /** 每个模型步骤中解析出的独立工具函数序列。 */
  toolTrace: ToolId[][]
  /** 实际注入上下文的 chunk id（按注入顺序去重）。 */
  injectedIds: string[]
  /** 已发起的模型生成步骤数；失败/取消也保留真实值。 */
  modelSteps: number
  /** 单题工具双上限账本（成功额度 + 获准尝试）；成功、失败和取消均保留。 */
  budget: ToolBudgetState
  /** 未调用工具直接作答的宿主回馈是否已使用。 */
  feedbackUsed: boolean
}

export interface AgentOptions {
  config?: BenchConfig
  /** 单次基准运行固定使用的查询契约快照；未提供时按单次查询读取。 */
  agentInstructions?: string
  /** 由 runner 在首个模型请求前捕获的完整 system prompt；避免中途文件变化改写本轮输入。 */
  systemPrompt?: string
  /** facts 工具实际取得 store 后的观测回调；回调失败不应改变工具语义。 */
  onFactsStoreUsed?: (store: CardStore) => void
  /** facts store 加载失败时的观测回调；工具仍返回原有错误。 */
  onFactsStoreLoadFailed?: (error: unknown) => void
  /** 运行级原文小节目录；由 runner 按开放阅读能力的模式提供。 */
  sections?: SectionDirectory
  /** 可选的单题执行记录。 */
  trace?: QueryTrace
  thinking: ThinkingMode
  dry: boolean
}

class AgentExecutionError extends Error {
  constructor(
    message: string,
    readonly reason: TerminationReason,
    readonly stage: 'llm' | 'tool' | 'runner' | 'timeout' | 'cancelled' = 'runner',
  ) {
    super(message)
  }
}

/** 读取查询 Agent 的决策契约；只在构建提示时读取，不产生模块顶层副作用。 */
export function loadKnowledgeAgentInstructions(root = process.cwd()): string {
  let content: string
  try {
    content = readFileSync(join(root, 'knowledge', 'AGENTS.md'), 'utf-8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`读取查询 Agent 决策契约失败：${detail}`)
  }
  const instructions = content.trim()
  if (!instructions) throw new Error('查询 Agent 决策契约为空：knowledge/AGENTS.md')
  return instructions
}

/** 构建系统提示；人工规则只来自 AGENTS.md，模式差异由实际工具 schema 描述。 */
export function buildSystemPrompt(
  retriever: RetrieverId = 'hybrid',
  agentInstructions = loadKnowledgeAgentInstructions(),
  toolBudget = 5,
  toolAttemptLimit = 10,
): string {
  const toolNames = toolNamesForRetriever(retriever)
  const runtime = [
    '## 本次运行能力',
    `- 检索模式：${retriever}`,
    `- 可用工具：${toolNames.join('、')}`,
    `- 工具预算：${toolBudget} 点成功额度 + ${toolAttemptLimit} 次获准尝试上限；仅非空执行成功扣 1 点，空结果、参数错误与执行错误不扣成功额度但各占一次尝试；同批调用逐项结算，任一上限用尽后新增调用不会执行。`,
  ]
  return `${agentInstructions.trim()}\n\n${runtime.join('\n')}`
}

export async function runQuery(
  query: BenchQuery,
  opts: AgentOptions,
  chunks: DocChunk[],
  index: IndexEntry,
): Promise<AgentResult> {
  const config = opts.config ?? loadConfig()
  validateBenchConfig(config)
  const records: CostRecord[] = []
  const injectedIds: string[] = []
  const executor = createKnowledgeToolExecutor({
    config,
    query,
    chunks,
    index,
    sections: opts.sections,
    injectedIds,
    onFactsStoreUsed: opts.onFactsStoreUsed,
    onFactsStoreLoadFailed: opts.onFactsStoreLoadFailed,
  }, config.toolBudget)
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.systemPrompt ?? buildSystemPrompt(config.retriever, opts.agentInstructions ?? loadKnowledgeAgentInstructions(), config.toolBudget, config.toolAttemptLimit) },
    { role: 'user', content: query.question },
  ]
  const sessionController = new AbortController()
  let timedOut = false
  const timeoutHandle = setTimeout(() => {
    timedOut = true
    sessionController.abort(new Error('单题总超时'))
  }, config.sessionTimeoutMs)
  const providerOptsBase: Omit<ProviderOptions, 'ledger'> = { config, thinking: opts.thinking, dry: opts.dry, signal: sessionController.signal }
  const now = new Date().toISOString()

  let finalAnswer: string | null = null
  let toolRounds = 0
  let rounds = 0
  const toolTrace: ToolId[][] = []
  let status: AgentResult['status'] = 'completed'
  let terminationReason: TerminationReason = 'answer'
  let failure: TraceFailure | undefined
  let feedbackUsed = false
  let sawToolCall = false

  try {
    for (;;) {
      if (sessionController.signal.aborted) throw abortErrorForSession(timedOut)
      rounds++
      const offeredTools = toolsForRetriever(config.retriever)
      const llmEvent: TraceLlmEvent | undefined = opts.trace
        ? { type: 'llm_call', round: rounds, offeredTools: toolNamesForRetriever(config.retriever), elapsedMs: 0 }
        : undefined
      if (llmEvent) opts.trace?.events.push(llmEvent)
      const llmStarted = Date.now()
      let resp
      const providerLedger: ProviderCallLedger = { attempts: [] }
      const providerPromise = Promise.resolve().then(() => {
        if (sessionController.signal.aborted) throw abortErrorForSession(timedOut)
        return callLLM(messages, offeredTools, { ...providerOptsBase, ledger: providerLedger })
      })
      try {
        resp = await awaitWithAbort(providerPromise, sessionController.signal)
      } catch (error) {
        const providerFailure = readProviderFailure(error) ?? readProviderLedger(providerLedger, config.model)
        if (llmEvent) {
          llmEvent.elapsedMs = Date.now() - llmStarted
          llmEvent.error = errorMessage(error)
          if (providerFailure) {
            llmEvent.usage = providerFailure.usage
            llmEvent.usageAggregation = providerFailure.httpAttempts.length > 0 ? 'http_attempts' : 'response'
            llmEvent.httpAttempts = providerFailure.httpAttempts
          }
        }
        if (providerFailure && providerFailure.httpAttempts.length > 0) {
          records.push(createCostRecord(
            query,
            rounds,
            opts,
            config,
            providerFailure.usage,
            providerFailure.model,
            false,
            providerFailure.httpAttempts,
          ))
        }
        const reason = timedOut ? 'timeout' : 'llm_error'
        throw new AgentExecutionError(errorMessage(error), reason, timedOut ? 'timeout' : 'llm')
      }
      const httpAttempts = snapshotHttpAttempts(resp.httpAttempts)
      if (llmEvent) {
        llmEvent.elapsedMs = Date.now() - llmStarted
        llmEvent.usage = accountingUsage(resp.usage, httpAttempts)
        llmEvent.responseUsage = resp.usage
        llmEvent.usageAggregation = httpAttempts.length > 0 ? 'http_attempts' : 'response'
        llmEvent.httpAttempts = httpAttempts.length > 0 ? httpAttempts : undefined
        llmEvent.truncated = resp.truncated
        llmEvent.content = resp.content
        llmEvent.toolCalls = resp.toolCalls
      }

      const usage = accountingUsage(resp.usage, httpAttempts)
      const costs = accountingCosts(resp.usage, httpAttempts, config)
      const requestedTools = resp.toolCalls
        .map((tc) => tc.name)
        .filter((name): name is ToolId => isObservedTool(name))
      const record: CostRecord = {
        ts: now,
        queryId: query.id,
        category: query.category,
        round: rounds,
        thinking: opts.thinking,
        provider: config.provider,
        model: resp.model,
        input: usage.input,
        output: usage.output,
        knownInput: usage.knownInput,
        knownOutput: usage.knownOutput,
        cached: usage.cached,
        reasoning: usage.reasoning,
        costIn: costs.costIn,
        costOut: costs.costOut,
        costTotal: costs.costTotal,
        usageCompleteness: usage.completeness,
        usageAggregation: httpAttempts.length > 0 ? 'http_attempts' : 'response',
        truncated: resp.truncated,
        tools: requestedTools.length > 0 ? requestedTools : undefined,
        httpAttempts: httpAttempts.length > 0 ? httpAttempts : undefined,
      }
      records.push(record)

      if (resp.truncated) {
        throw new AgentExecutionError('模型响应被截断，未执行其中的工具调用或接受正文', 'truncated', 'llm')
      }

      if (resp.toolCalls.length > 0) {
        sawToolCall = true
        toolRounds++
        const executorCalls = resp.toolCalls
        messages.push({
          role: 'assistant',
          content: resp.content ?? '',
          tool_calls: executorCalls.map((tc) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } })),
        })
        const budgetBefore = executor.snapshot()
        const batch = await awaitWithAbort(executor.executeBatch(executorCalls), sessionController.signal)
        if (batch.protocolError) {
          const protocolStats: ToolBatchStats = {
            requested: executorCalls.length,
            granted: 0,
            executed: 0,
            denied: 0,
            errors: 1,
            hitCount: 0,
            hitUnknown: 0,
            budgetBefore: budgetBefore.remaining,
            budgetAfter: batch.snapshot.remaining,
            resultChars: 0,
          }
          record.toolBatch = protocolStats
          if (llmEvent) llmEvent.toolBatch = protocolStats
          throw new AgentExecutionError(batch.protocolError, 'protocol_error', 'runner')
        }

        const toolBatch: ToolBatchStats = {
          requested: executorCalls.length,
          granted: batch.results.filter((item) => item.status !== 'budget_exhausted').length,
          executed: batch.results.filter((item) => item.executed).length,
          denied: batch.results.filter((item) => item.status === 'budget_exhausted').length,
          errors: batch.results.filter((item) => isToolErrorStatus(item.status)).length,
          hitCount: batch.results.filter((item) => item.executed && Array.isArray(item.hitIds) && item.hitIds.length > 0).length,
          hitUnknown: batch.results.filter((item) => item.executed && !Array.isArray(item.hitIds)).length,
          budgetBefore: budgetBefore.remaining,
          budgetAfter: batch.snapshot.remaining,
          resultChars: 0,
        }
        record.toolBatch = toolBatch
        if (llmEvent) llmEvent.toolBatch = toolBatch

        const pendingMessages: ChatMessage[] = []
        let fatalResult: ToolExecutionResult | undefined
        for (const [resultIndex, item] of batch.results.entries()) {
          const tc = executorCalls[resultIndex]
          const toolEvent: TraceToolEvent | undefined = opts.trace
            ? {
                type: 'tool_call',
                round: rounds,
                callId: item.callId,
                tool: item.operation ?? tc?.name ?? 'unknown',
                rawArguments: tc?.arguments ?? '',
                elapsedMs: 0,
                status: item.status,
                executed: item.executed,
                budgetRemaining: item.budgetRemaining,
              }
            : undefined
          const writtenContent = serializeToolResult(item)
          toolBatch.resultChars += writtenContent.length
          if (toolEvent) {
            toolEvent.actualParams = item.actualParams
            toolEvent.hitIds = item.hitIds
            toolEvent.injectedIds = item.injectedIds
            toolEvent.writtenContent = writtenContent
            toolEvent.reason = item.message
            if (isToolErrorStatus(item.status)) toolEvent.error = item.message
            opts.trace?.events.push(toolEvent)
          }
          pendingMessages.push({ role: 'tool', tool_call_id: item.callId, content: writtenContent })
          if (item.fatal) fatalResult = item
        }
        toolTrace.push(batch.results
          .map((item) => item.operation)
          .filter((name): name is ToolId => typeof name === 'string' && isObservedTool(name)))
        if (fatalResult) throw new AgentExecutionError(fatalResult.message ?? '工具执行失败', 'tool_error', 'tool')
        messages.push(...pendingMessages)
        continue
      }

      if (typeof resp.content !== 'string' || resp.content.trim() === '') {
        throw new AgentExecutionError('模型未返回非空最终答案', 'empty_response', 'llm')
      }
      if (!sawToolCall && config.feedbackOnNoToolAnswer && !feedbackUsed) {
        feedbackUsed = true
        const content = '请先调用本次可用的知识库工具查证，再依据结果作答。'
        messages.push({ role: 'user', content })
        opts.trace?.events.push({ type: 'control', round: rounds, kind: 'no_tool_answer_feedback', origin: 'host_fallback', content })
        continue
      }
      if (!sawToolCall && feedbackUsed) {
        throw new AgentExecutionError('模型在宿主回馈后仍未调用知识库工具就直接作答', 'no_tool_after_feedback', 'llm')
      }
      finalAnswer = resp.content
      break
    }
  } catch (error) {
    status = timedOut || (error instanceof AgentExecutionError && (error.reason === 'timeout' || error.reason === 'cancelled'))
      ? 'cancelled'
      : 'failed'
    terminationReason = timedOut ? 'timeout' : error instanceof AgentExecutionError ? error.reason : 'llm_error'
    const stage = timedOut ? 'timeout' : error instanceof AgentExecutionError ? error.stage : 'llm'
    failure = { stage, message: errorMessage(error), round: rounds || undefined }
    if (error instanceof AgentExecutionError && error.stage === 'tool' && opts.trace) {
      const lastTool = [...opts.trace.events].reverse().find((event): event is TraceToolEvent => event.type === 'tool_call')
      if (lastTool) failure.toolCallId = lastTool.callId
    }
    if (opts.trace) {
      markTraceFailed(opts.trace, failure)
      opts.trace.terminationReason = terminationReason
    }
  } finally {
    clearTimeout(timeoutHandle)
  }

  const budget = executor.snapshot()
  if (opts.trace) {
    const batches = records.map((record) => record.toolBatch).filter((batch): batch is ToolBatchStats => Boolean(batch))
    opts.trace.terminationReason = terminationReason
    opts.trace.summary = {
      modelSteps: rounds,
      toolBatches: toolRounds,
      toolCallsRequested: batches.reduce((sum, batch) => sum + batch.requested, 0),
      toolCallsGranted: batches.reduce((sum, batch) => sum + batch.granted, 0),
      toolCallsExecuted: batches.reduce((sum, batch) => sum + batch.executed, 0),
      toolCallsDenied: batches.reduce((sum, batch) => sum + batch.denied, 0),
      toolErrors: batches.reduce((sum, batch) => sum + batch.errors, 0),
      toolResultChars: batches.reduce((sum, batch) => sum + batch.resultChars, 0),
      feedbackUsed,
      terminationReason,
      budget,
    }
  }

  return {
    status,
    terminationReason,
    failure,
    records,
    finalAnswer,
    rounds,
    toolRounds,
    toolTrace,
    injectedIds,
    modelSteps: rounds,
    budget,
    feedbackUsed,
  }
}

interface ProviderFailureLike {
  usage: LlmUsage
  model: string
  httpAttempts: HttpAttempt[]
}

function readProviderFailure(error: unknown): ProviderFailureLike | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = error as Partial<ProviderFailureLike> & { providerFailure?: unknown }
  if (value.providerFailure !== true || !value.usage || typeof value.model !== 'string' || !Array.isArray(value.httpAttempts)) {
    return undefined
  }
  const httpAttempts = snapshotHttpAttempts(value.httpAttempts)
  return {
    usage: httpAttempts.length > 0 ? aggregateUsages(attemptUsages(httpAttempts)) : normalizeUsage(value.usage),
    model: value.model,
    httpAttempts,
  }
}

function createCostRecord(
  query: BenchQuery,
  round: number,
  opts: AgentOptions,
  config: BenchConfig,
  usage: LlmUsage,
  model: string,
  truncated: boolean,
  httpAttempts?: HttpAttempt[],
): CostRecord {
  const stableAttempts = snapshotHttpAttempts(httpAttempts)
  const accounting = stableAttempts.length > 0
    ? aggregateUsages(attemptUsages(stableAttempts))
    : normalizeUsage(usage)
  const costs = accountingCosts(usage, stableAttempts, config)
  return {
    ts: new Date().toISOString(),
    queryId: query.id,
    category: query.category,
    round,
    thinking: opts.thinking,
    provider: config.provider,
    model,
    input: accounting.input,
    output: accounting.output,
    knownInput: accounting.knownInput,
    knownOutput: accounting.knownOutput,
    cached: accounting.cached,
    reasoning: accounting.reasoning,
    costIn: costs.costIn,
    costOut: costs.costOut,
    costTotal: costs.costTotal,
    usageCompleteness: accounting.completeness,
    usageAggregation: stableAttempts.length > 0 ? 'http_attempts' : 'response',
    truncated,
    httpAttempts: stableAttempts.length > 0 ? stableAttempts : undefined,
  }
}

function isToolErrorStatus(status: ToolExecutionResult['status']): boolean {
  return status === 'invalid_params' || status === 'unknown_operation' || status === 'error'
}

function abortErrorForSession(timedOut: boolean): AgentExecutionError {
  return timedOut
    ? new AgentExecutionError('单题总超时', 'timeout', 'timeout')
    : new AgentExecutionError('任务已取消', 'cancelled', 'cancelled')
}

function accountingUsage(responseUsage: LlmUsage, httpAttempts?: HttpAttempt[]): LlmUsage {
  return httpAttempts && httpAttempts.length > 0
    ? aggregateUsages(attemptUsages(httpAttempts))
    : normalizeUsage(responseUsage)
}

function accountingCosts(responseUsage: LlmUsage, httpAttempts: HttpAttempt[] | undefined, config: BenchConfig) {
  return httpAttempts && httpAttempts.length > 0
    ? aggregateAttemptCosts(attemptUsages(httpAttempts), config.prices)
    : computeCosts(responseUsage.input, responseUsage.output, responseUsage.cached, config.prices)
}

function attemptUsages(httpAttempts: HttpAttempt[]): LlmUsage[] {
  return httpAttempts.map((attempt) => attempt.usage ?? unknownUsage())
}

function unknownUsage(): LlmUsage {
  return { input: null, output: null, cached: null, reasoning: null, knownInput: null, knownOutput: null, completeness: 'unknown' }
}

function readProviderLedger(ledger: ProviderCallLedger, fallbackModel: string): ProviderFailureLike | undefined {
  const httpAttempts = snapshotHttpAttempts(ledger.attempts)
  if (httpAttempts.length === 0) return undefined
  return {
    usage: aggregateUsages(attemptUsages(httpAttempts)),
    model: ledger.model ?? fallbackModel,
    httpAttempts,
  }
}

function normalizeUsage(usage: LlmUsage): LlmUsage {
  return {
    ...usage,
    knownInput: usage.knownInput ?? usage.input,
    knownOutput: usage.knownOutput ?? usage.output,
  }
}

function snapshotHttpAttempts(httpAttempts: readonly HttpAttempt[] | undefined): HttpAttempt[] {
  return (httpAttempts ?? []).map((attempt) => ({
    ...attempt,
    outcome: attempt.outcome === 'in_flight' ? 'aborted' : attempt.outcome,
    error: attempt.outcome === 'in_flight' && !attempt.error ? '任务已取消，传输结果未结算' : attempt.error,
    usage: { ...(attempt.usage ?? unknownUsage()) },
  }))
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortErrorForSession(true))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('任务已取消'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
