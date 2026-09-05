/**
 * 简化版查询 Agent。
 *
 * 真实用户问题只进入 messages 一次；模型可通过固定 auto 的 knowledge 工具循环取证，
 * 宿主只负责协议校验、批次预算和结果回写。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, validateBenchConfig, type BenchConfig, type RetrieverId } from './config.js'
import type { IndexEntry } from './retriever.js'
import type { DocChunk, BenchQuery, CostRecord, TerminationReason, ThinkingMode, ToolId } from './types.js'
import { callLLM, type ChatMessage, type ProviderOptions } from './provider.js'
import { computeCosts } from './pricing.js'
import { isRetrievalTool, isFactTool } from './types.js'
import { markTraceFailed, type QueryTrace, type TraceFailure, type TraceLlmEvent, type TraceToolEvent } from './trace.js'
import {
  createKnowledgeToolExecutor,
  knowledgeTool,
  serializeToolResult,
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
  /** 每个模型步骤中解析出的 operation 序列。 */
  toolTrace: ToolId[][]
  /** 实际注入上下文的 chunk id（按注入顺序去重）。 */
  injectedIds: string[]
  /** 已发起的模型生成步骤数；失败/取消也保留真实值。 */
  modelSteps: number
  /** 单题工具积分账本；成功、失败和取消均保留。 */
  budget: ToolBudgetState
  /** 未调用工具直接作答的宿主回馈是否已使用。 */
  feedbackUsed: boolean
}

export interface AgentOptions {
  config?: BenchConfig
  /** 单次基准运行固定使用的查询契约快照；未提供时按单次查询读取。 */
  agentInstructions?: string
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

/** 构建系统提示；人工规则只来自 AGENTS.md，模式差异由实际 knowledge schema 描述。 */
export function buildSystemPrompt(
  retriever: RetrieverId = 'bm25',
  agentInstructions = loadKnowledgeAgentInstructions(),
  toolBudget = 5,
): string {
  const definition = knowledgeTool(retriever).function as {
    name: string
    parameters: { properties: { operation: { enum: string[] } } }
  }
  const operations = definition.parameters.properties.operation.enum
  const runtime = [
    '## 本次运行能力',
    `- 检索模式：${retriever}`,
    `- 可用工具：${definition.name}`,
    `- knowledge operation：${operations.join('、')}`,
    `- 工具积分预算：${toolBudget} 点；余额耗尽后仍可调用工具，但宿主会返回预算耗尽提示。`,
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
  const executor = createKnowledgeToolExecutor({ config, query, chunks, index, injectedIds }, config.toolBudget)
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(config.retriever, opts.agentInstructions ?? loadKnowledgeAgentInstructions(), config.toolBudget) },
    { role: 'user', content: query.question },
  ]
  const sessionController = new AbortController()
  let timedOut = false
  const timeoutHandle = setTimeout(() => {
    timedOut = true
    sessionController.abort(new Error('单题总超时'))
  }, config.sessionTimeoutMs)
  const providerOpts: ProviderOptions = { config, thinking: opts.thinking, dry: opts.dry, signal: sessionController.signal }
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
      const offeredTools = [knowledgeTool(config.retriever)]
      const llmEvent: TraceLlmEvent | undefined = opts.trace
        ? { type: 'llm_call', round: rounds, offeredTools: ['knowledge'], elapsedMs: 0 }
        : undefined
      if (llmEvent) opts.trace?.events.push(llmEvent)
      const llmStarted = Date.now()
      let resp
      try {
        resp = await awaitWithAbort(callLLM(messages, offeredTools, providerOpts), sessionController.signal)
      } catch (error) {
        if (llmEvent) {
          llmEvent.elapsedMs = Date.now() - llmStarted
          llmEvent.error = errorMessage(error)
        }
        const reason = timedOut ? 'timeout' : 'llm_error'
        throw new AgentExecutionError(errorMessage(error), reason, timedOut ? 'timeout' : 'llm')
      }
      if (llmEvent) {
        llmEvent.elapsedMs = Date.now() - llmStarted
        llmEvent.usage = resp.usage
        llmEvent.truncated = resp.truncated
        llmEvent.content = resp.content
        llmEvent.toolCalls = resp.toolCalls
      }

      const costs = computeCosts(resp.usage.input, resp.usage.output, resp.usage.cached, config.prices)
      const requestedTools = resp.toolCalls
        .map((tc) => operationFromCall(tc))
        .filter((name): name is ToolId => typeof name === 'string' && (isRetrievalTool(name) || isFactTool(name)))
      records.push({
        ts: now,
        queryId: query.id,
        category: query.category,
        round: rounds,
        thinking: opts.thinking,
        provider: config.provider,
        model: resp.model,
        input: resp.usage.input,
        output: resp.usage.output,
        cached: resp.usage.cached,
        reasoning: resp.usage.reasoning,
        costIn: costs.costIn,
        costOut: costs.costOut,
        costTotal: costs.costTotal,
        usageCompleteness: resp.usage.completeness,
        truncated: resp.truncated,
        tools: requestedTools.length > 0 ? requestedTools : undefined,
      })

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
        const batch = await awaitWithAbort(executor.executeBatch(executorCalls), sessionController.signal)
        if (batch.protocolError) throw new AgentExecutionError(batch.protocolError, 'protocol_error', 'runner')

        const pendingMessages: ChatMessage[] = []
        let fatalResult: ToolExecutionResult | undefined
        for (const [resultIndex, item] of batch.results.entries()) {
          const tc = executorCalls[resultIndex]
          const toolEvent: TraceToolEvent | undefined = opts.trace
            ? {
                type: 'tool_call',
                round: rounds,
                callId: item.callId,
                tool: item.operation ?? tc?.name ?? 'knowledge',
                rawArguments: tc?.arguments ?? '',
                elapsedMs: 0,
              }
            : undefined
          const writtenContent = serializeToolResult(item)
          if (toolEvent) {
            toolEvent.actualParams = item.actualParams
            toolEvent.hitIds = item.hitIds
            toolEvent.injectedIds = item.injectedIds
            toolEvent.writtenContent = writtenContent
            toolEvent.reason = item.message
            if (item.status === 'error') toolEvent.error = item.message
            opts.trace?.events.push(toolEvent)
          }
          pendingMessages.push({ role: 'tool', tool_call_id: item.callId, content: writtenContent })
          if (item.fatal) fatalResult = item
        }
        toolTrace.push(batch.results
          .map((item) => item.operation)
          .filter((name): name is ToolId => typeof name === 'string' && (isRetrievalTool(name) || isFactTool(name))))
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
        opts.trace?.events.push({ type: 'control', round: rounds, kind: 'no_tool_answer_feedback', content })
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
    budget: executor.snapshot(),
    feedbackUsed,
  }
}

function operationFromCall(call: { name: string; arguments: string }): string | undefined {
  if (call.name !== 'knowledge') return undefined
  try {
    const raw = JSON.parse(call.arguments) as Record<string, unknown>
    return typeof raw.operation === 'string' ? raw.operation : undefined
  } catch {
    return undefined
  }
}

function abortErrorForSession(timedOut: boolean): AgentExecutionError {
  return timedOut
    ? new AgentExecutionError('单题总超时', 'timeout', 'timeout')
    : new AgentExecutionError('任务已取消', 'cancelled', 'cancelled')
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
