/**
 * 统一 knowledge 工具 schema 与按批次预算执行器。
 * 一次 knowledge 调用只承载一个 operation；并行批次由多个带独立 call ID 的调用组成。
 */
import { loadConfig, type BenchConfig, type RetrieverId } from './config.js'
import { grepSearch, buildGrepResult } from './grep-retriever.js'
import { search, type IndexEntry } from './retriever.js'
import type { BenchQuery, DocChunk, ToolCall, ToolId } from './types.js'
import { getCardStore, serializeCards, type OperatorFilters } from './facts/store.js'

export type KnowledgeOperation = ToolId

export interface ToolBudgetState {
  limit: number
  used: number
  requested: number
  denied: number
  executed: number
  remaining: number
}

export type ToolResultStatus =
  | 'success'
  | 'empty'
  | 'invalid_params'
  | 'unknown_operation'
  | 'error'
  | 'budget_exhausted'

export interface ToolExecutionResult {
  callId: string
  operation?: string
  status: ToolResultStatus
  executed: boolean
  data: string
  budgetRemaining: number
  actualParams?: unknown
  hitIds?: string[]
  injectedIds?: string[]
  message?: string
  fatal?: boolean
}

export interface ToolBatchResult {
  results: ToolExecutionResult[]
  snapshot: ToolBudgetState
  protocolError?: string
}

export interface KnowledgeToolContext {
  config?: BenchConfig
  query: BenchQuery
  chunks: DocChunk[]
  index: IndexEntry
  /** 由 Agent 共享的全题注入去重列表。 */
  injectedIds?: string[]
}

export interface KnowledgeToolExecutor {
  executeBatch(calls: ToolCall[]): Promise<ToolBatchResult>
  snapshot(): ToolBudgetState
}

const BUDGET_ANSWER_HINT = '工具预算已用尽，请依据已有证据作答；未覆盖部分明确说明。'

function allowedOperations(retriever: RetrieverId): KnowledgeOperation[] {
  if (retriever === 'hybrid') return ['rag_search', 'lookup', 'query_operators']
  if (retriever === 'facts') return ['lookup', 'query_operators']
  if (retriever === 'both') return ['rag_search', 'grep_search']
  return retriever === 'grep' ? ['grep_search'] : ['rag_search']
}

/** 生成唯一的 knowledge schema；模式白名单同时用于本地校验。 */
export function knowledgeTool(retriever: RetrieverId = 'bm25'): Record<string, unknown> {
  const operations = allowedOperations(retriever)
  const paramsSchemas = operations.map((operation) => {
    if (operation === 'rag_search' || operation === 'grep_search') {
      return {
        type: 'object',
        description: `${operation}：使用非空自然语言查询检索语料。`,
        properties: { query: { type: 'string', minLength: 1, description: '非空检索词或问题' } },
        required: ['query'],
        additionalProperties: false,
      }
    }
    if (operation === 'lookup') {
      return {
        type: 'object',
        description: 'lookup：按干员、技能或事实卡名称精确查找。',
        properties: { term: { type: 'string', minLength: 1, description: '非空干员、技能或事实卡名称' } },
        required: ['term'],
        additionalProperties: false,
      }
    }
    return {
      type: 'object',
      description: 'query_operators：按至少一个正向分类条件找人，可附带排除 ID。',
      properties: {
        room: { type: 'string', minLength: 1, description: '设施/房间分类，例如制造站、贸易站' },
        faction: { type: 'string', minLength: 1, description: '阵营分类' },
        profession: { type: 'string', minLength: 1, description: '职业分类' },
        termQuery: { type: 'string', minLength: 1, description: '名称或技能关键词' },
        excludeIds: { type: 'array', items: { type: 'string', minLength: 1 }, description: '需要排除的事实卡 canonical ID' },
      },
      additionalProperties: false,
      minProperties: 1,
    }
  })
  return {
    type: 'function',
    function: {
      name: 'knowledge',
      description: '查询明日方舟基建知识库或事实记录卡；一次调用只执行一个 operation，params 必须匹配该 operation 的参数分支。',
      parameters: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: operations },
          params: {
            type: 'object',
            description: 'operation 对应的参数对象；按 operation 选择下方唯一匹配的参数分支。query_operators 至少填写一个正向分类字段。',
            oneOf: paramsSchemas,
          },
        },
        required: ['operation', 'params'],
        additionalProperties: false,
      },
    },
  }
}

export function createKnowledgeToolExecutor(
  context: KnowledgeToolContext,
  limit: number,
): KnowledgeToolExecutor {
  const config = context.config ?? loadConfig()
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`toolBudget 必须是正整数：${limit}`)
  const state: ToolBudgetState = { limit, used: 0, requested: 0, denied: 0, executed: 0, remaining: limit }
  const allowed = new Set(allowedOperations(config.retriever))

  function snapshot(): ToolBudgetState {
    return { ...state, remaining: state.limit - state.used }
  }

  async function executeBatch(calls: ToolCall[]): Promise<ToolBatchResult> {
    const protocolError = validateCallIds(calls)
    if (protocolError) return { results: [], snapshot: snapshot(), protocolError }

    state.requested += calls.length
    const granted = Math.min(calls.length, state.limit - state.used)
    state.used += granted
    state.denied += calls.length - granted
    state.remaining = state.limit - state.used

    const results = await Promise.all(calls.map((call, index) => {
      if (index >= granted) {
        return Promise.resolve<ToolExecutionResult>({
          callId: call.id,
          operation: readOperation(call.arguments),
          status: 'budget_exhausted',
          executed: false,
          data: '请依据已有证据作答，预算已用尽，未覆盖部分明确说明。',
          budgetRemaining: state.remaining,
          message: '工具预算已用尽，未执行调用',
        })
      }
      return executeOne(call, allowed, context, config, state)
    }))
    return { results, snapshot: snapshot() }
  }

  return { executeBatch, snapshot }
}

function validateCallIds(calls: ToolCall[]): string | undefined {
  const seen = new Set<string>()
  for (const call of calls) {
    const id = call.id.trim()
    if (!id) return '工具调用缺少可用于结果关联的 call ID'
    if (seen.has(id)) return `工具调用 call ID 重复：${id}`
    seen.add(id)
  }
  return undefined
}

async function executeOne(
  call: ToolCall,
  allowed: Set<KnowledgeOperation>,
  context: KnowledgeToolContext,
  config: BenchConfig,
  state: ToolBudgetState,
): Promise<ToolExecutionResult> {
  if (call.name !== 'knowledge') {
    return result(call, readOperation(call.arguments), 'unknown_operation', false, `未知工具函数：${call.name}`, state)
  }
  const envelope = parseEnvelope(call.arguments)
  if (!envelope.value) {
    return result(call, undefined, 'invalid_params', false, envelope.reason ?? 'knowledge 参数无效', state)
  }
  const { operation, params } = envelope.value
  if (!allowed.has(operation as KnowledgeOperation)) {
    return result(call, operation, 'unknown_operation', false, `当前检索模式不开放 operation：${operation}`, state)
  }

  const parsed = parseOperationParams(operation, params)
  if (!parsed.value) {
    return result(call, operation, 'invalid_params', false, parsed.reason, state)
  }

  state.executed++
  try {
    const output = runOperation(operation as KnowledgeOperation, parsed.value, context, config)
    const status: ToolResultStatus = output.data ? 'success' : 'empty'
    return {
      callId: call.id,
      operation,
      status,
      executed: true,
          data: output.data || '（无匹配结果）',
          budgetRemaining: state.remaining,
          actualParams: parsed.value,
          hitIds: output.hitIds,
          injectedIds: output.injectedIds,
          message: state.remaining === 0 ? BUDGET_ANSWER_HINT : undefined,
    }
  } catch (error) {
    return result(
      call,
      operation,
      'error',
      true,
      error instanceof Error ? error.message : String(error),
      state,
      parsed.value,
      true,
    )
  }
}

function result(
  call: ToolCall,
  operation: string | undefined,
  status: ToolResultStatus,
  executed: boolean,
  message: string,
  state: ToolBudgetState,
  actualParams?: unknown,
  fatal = false,
): ToolExecutionResult {
  return {
    callId: call.id,
    operation,
    status,
    executed,
    data: message,
    budgetRemaining: state.remaining,
    actualParams,
    message,
    fatal,
  }
}

function parseEnvelope(args: string): { value?: { operation: string; params: Record<string, unknown> }; reason?: string } {
  try {
    const raw = JSON.parse(args) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { reason: 'knowledge 参数必须是对象' }
    const input = raw as Record<string, unknown>
    if (typeof input.operation !== 'string' || !input.operation.trim()) return { reason: '缺少有效 operation' }
    if (typeof input.params !== 'object' || input.params === null || Array.isArray(input.params)) return { reason: 'params 必须是对象' }
    return { value: { operation: input.operation, params: input.params as Record<string, unknown> } }
  } catch {
    return { reason: 'knowledge 参数不是有效 JSON' }
  }
}

function readOperation(args: string): string | undefined {
  try {
    const raw = JSON.parse(args) as Record<string, unknown>
    return typeof raw?.operation === 'string' ? raw.operation : undefined
  } catch {
    return undefined
  }
}

function parseOperationParams(
  operation: string,
  params: Record<string, unknown>,
): { value?: Record<string, unknown>; reason: string } {
  if (operation === 'rag_search' || operation === 'grep_search') {
    const query = typeof params.query === 'string' ? params.query.trim() : ''
    return query ? { value: { query }, reason: '' } : { reason: `${operation} 的 query 必须是非空字符串` }
  }
  if (operation === 'lookup') {
    const term = typeof params.term === 'string' ? params.term.trim() : ''
    return term ? { value: { term }, reason: '' } : { reason: 'lookup 的 term 必须是非空字符串' }
  }
  if (operation === 'query_operators') return parseFilters(params)
  return { reason: `未知 operation：${operation}` }
}

function parseFilters(input: Record<string, unknown>): { value?: Record<string, unknown>; reason: string } {
  const filters: OperatorFilters = {}
  const room = typeof input.room === 'string' ? input.room.trim() : ''
  const faction = typeof input.faction === 'string' ? input.faction.trim() : ''
  const profession = typeof input.profession === 'string' ? input.profession.trim() : ''
  const termQuery = typeof input.termQuery === 'string' ? input.termQuery.trim() : ''
  if (room) filters.room = room
  if (faction) filters.faction = faction
  if (profession) filters.profession = profession
  if (termQuery) filters.termQuery = termQuery
  if (Array.isArray(input.excludeIds)) {
    const excludeIds = input.excludeIds.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    if (excludeIds.length > 0) filters.excludeIds = excludeIds
  }
  const hasPositiveCondition = Boolean(filters.room || filters.faction || filters.profession || filters.termQuery)
  return hasPositiveCondition
    ? { value: filters as Record<string, unknown>, reason: '' }
    : { reason: 'query_operators 至少需要一个非空正向条件' }
}

function runOperation(
  operation: KnowledgeOperation,
  params: Record<string, unknown>,
  context: KnowledgeToolContext,
  config: BenchConfig,
): { data: string; hitIds: string[]; injectedIds: string[] } {
  if (operation === 'rag_search' || operation === 'grep_search') {
    const query = params.query as string
    const hits = operation === 'grep_search'
      ? grepSearch(context.chunks, query, config.topK)
      : search(context.index, query, config.topK)
    const hitIds = hits.map((index) => context.chunks[index]?.id).filter((id): id is string => Boolean(id))
    const injectedIds = operation === 'grep_search'
      ? hitIds
      : ragInjectedIds(context.chunks, hits, config.maxContextChars)
    for (const id of injectedIds) {
      if (context.injectedIds && !context.injectedIds.includes(id)) context.injectedIds.push(id)
    }
    const data = operation === 'grep_search'
      ? buildGrepResult(context.chunks, hits, query, config.maxContextChars)
      : hits.map((index) => {
          const chunk = context.chunks[index]
          return `【${chunk.file} | ${chunk.heading} | L${chunk.startLine}-${chunk.endLine}】\n${chunk.text}`
        }).join('\n\n').slice(0, config.maxContextChars)
    return { data, hitIds, injectedIds }
  }
  const store = getCardStore()
  if (operation === 'lookup') {
    const hits = store.lookup(params.term as string)
    return { data: serializeCards(hits), hitIds: hits.map((card) => card.canonical), injectedIds: hits.map((card) => card.canonical) }
  }
  const filters = params as OperatorFilters
  const hits = store.queryOperators(filters)
  return { data: serializeCards(hits, filters), hitIds: hits.map((card) => card.canonical), injectedIds: hits.map((card) => card.canonical) }
}

function ragInjectedIds(chunks: DocChunk[], hits: number[], maxChars: number): string[] {
  let offset = 0
  const injected: string[] = []
  for (const index of hits) {
    const chunk = chunks[index]
    const block = `【${chunk.file} | ${chunk.heading} | L${chunk.startLine}-${chunk.endLine}】\n${chunk.text}`
    if (offset < maxChars) injected.push(chunk.id)
    offset += block.length + 2
  }
  return injected
}

/** 将执行结果写成 tool message；同一对象同时用于 trace 的 writtenContent。 */
export function serializeToolResult(item: ToolExecutionResult): string {
  return JSON.stringify({
    status: item.status,
    executed: item.executed,
    data: item.data,
    budget_remaining: item.budgetRemaining,
    ...(item.message ? { message: item.message } : {}),
  })
}
