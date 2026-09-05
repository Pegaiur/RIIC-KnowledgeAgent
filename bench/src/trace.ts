/**
 * Agent 单题执行记录：只承载人工复盘所需的公开调用事实。
 * 不记录 hidden reasoning、请求 headers 或完整运行配置。
 */
import type { BenchQuery, LlmUsage, TerminationReason, ToolCall } from './types.js'

export interface TraceLlmEvent {
  type: 'llm_call'
  round: number
  offeredTools: string[]
  elapsedMs: number
  usage?: LlmUsage
  truncated?: boolean
  content?: string | null
  toolCalls?: ToolCall[]
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
  elapsedMs: number
  writtenContent?: string
  reason?: string
  error?: string
}

export interface TraceControlEvent {
  type: 'control'
  round: number
  kind: 'no_tool_answer_feedback'
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
  schemaVersion: 2
  queryId: string
  question: string
  status: 'completed' | 'failed' | 'cancelled'
  terminationReason?: TerminationReason
  events: TraceEvent[]
  failure?: TraceFailure
}

export function createQueryTrace(query: BenchQuery): QueryTrace {
  return {
    schemaVersion: 2 as const,
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
