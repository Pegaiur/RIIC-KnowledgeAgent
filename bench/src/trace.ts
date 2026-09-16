/**
 * Agent 单题执行记录：只承载人工复盘所需的公开调用事实。
 * 不记录 hidden reasoning、请求 headers 或完整运行配置。
 */
import type { BenchQuery, HttpAttempt, LlmUsage, TerminationReason, ToolCall, ToolBatchStats } from './types.js'
import type { AttachedFactsObservation, ToolBudgetState, ToolResultStatus, FulltextRange, LinkedEntryObservation, ReadDeliveryRecord } from './tool-executor.js'

export interface TraceLlmEvent {
  type: 'llm_call'
  round: number
  offeredTools: string[]
  elapsedMs: number
  usage?: LlmUsage
  /** provider 最终响应中的 usage；usage 字段按台账汇总，用于和 records/report 对齐。 */
  responseUsage?: LlmUsage
  usageAggregation?: 'response' | 'http_attempts'
  truncated?: boolean
  content?: string | null
  toolCalls?: ToolCall[]
  httpAttempts?: HttpAttempt[]
  toolBatch?: ToolBatchStats
  error?: string
}

export interface TraceToolEvent {
  type: 'tool_call'
  round: number
  callId: string
  tool: string
  rawArguments: string
  actualParams?: unknown
  hitIds?: string[]
  injectedIds?: string[]
  /** rag_search 原文扩展的实际送达范围（ADR-013）；未扩展时省略。 */
  fulltextRanges?: FulltextRange[]
  /** rag_search 内部 facts 附带的触发词/路径/送达观测（ADR-013 步骤 3）；无触发词时省略。 */
  attachedFacts?: AttachedFactsObservation[]
  /** rag_search 关联事实入口提示观测（ADR-020）；无提示时省略。 */
  linkedEntries?: LinkedEntryObservation[]
  /** read 单次送达台账（ADR-022 决策 6）：单条记录，与 records 中同 callId 项一致；非 read 调用省略。 */
  readDelivery?: ReadDeliveryRecord
  elapsedMs: number
  status: ToolResultStatus
  executed: boolean
  budgetRemaining: number
  writtenContent?: string
  reason?: string
  error?: string
}

export interface TraceControlEvent {
  type: 'control'
  round: number
  kind: 'no_tool_answer_feedback'
  origin: 'host_fallback'
  content: string
}

export type TraceEvent = TraceLlmEvent | TraceToolEvent | TraceControlEvent

export interface TraceFailure {
  stage: 'llm' | 'tool' | 'runner' | 'timeout' | 'cancelled'
  message: string
  round?: number
  toolCallId?: string
}

export interface QueryTrace {
  schemaVersion: 3
  queryId: string
  question: string
  status: 'completed' | 'failed' | 'cancelled'
  terminationReason?: TerminationReason
  events: TraceEvent[]
  failure?: TraceFailure
  summary?: TraceSummary
}

export interface TraceSummary {
  modelSteps: number
  toolBatches: number
  toolCallsRequested: number
  toolCallsGranted: number
  toolCallsExecuted: number
  toolCallsDenied: number
  toolErrors: number
  toolResultChars: number
  feedbackUsed: boolean
  terminationReason: TerminationReason
  budget: ToolBudgetState
}

export function createQueryTrace(query: BenchQuery): QueryTrace {
  return {
    schemaVersion: 3 as const,
    queryId: query.id,
    question: query.question,
    status: 'completed',
    events: [],
  }
}

/** 只保留第一次失败位置，避免 runner 的兜底错误覆盖 Agent 内部定位。 */
export function markTraceFailed(trace: QueryTrace, failure: TraceFailure): void {
  trace.status = failure.stage === 'timeout' || failure.stage === 'cancelled' ? 'cancelled' : 'failed'
  trace.terminationReason = failure.stage === 'timeout'
    ? 'timeout'
    : failure.stage === 'cancelled'
      ? 'cancelled'
      : failure.stage === 'llm'
        ? 'llm_error'
        : failure.stage === 'tool'
          ? 'tool_error'
          : 'protocol_error'
  if (!trace.failure) trace.failure = failure
}

/** 将已知敏感值从写盘副本中遮蔽；不修改传给模型的内存消息。 */
export function serializeTrace(trace: QueryTrace, sensitiveValues: Array<string | undefined> = []): string {
  const values = [...new Set(sensitiveValues.filter((value): value is string => Boolean(value)))].sort(
    (a, b) => b.length - a.length,
  )
  return JSON.stringify(redactTraceValue(trace, values))
}

function redactTraceValue(value: unknown, sensitiveValues: string[]): unknown {
  if (typeof value === 'string') {
    return sensitiveValues.reduce((text, secret) => text.split(secret).join('[已遮蔽]'), value)
  }
  if (Array.isArray(value)) return value.map((item) => redactTraceValue(item, sensitiveValues))
  if (typeof value !== 'object' || value === null) return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, redactTraceValue(item, sensitiveValues)]))
}
