/**
 * 独立函数工具 schema 与按批次预算执行器。
 * 工具函数名直接完成路由；执行器仍共用一套预算、校验和底层检索门面。
 */
import { createHash } from 'node:crypto'
import { loadConfig, type BenchConfig, type RetrieverId } from './config.js'
import { grepSearch, buildGrepResult } from './grep-retriever.js'
import { search, type IndexEntry } from './retriever.js'
import { isFactTool, type BenchQuery, type DocChunk, type ToolCall, type ToolId } from './types.js'
import { getCardStore, serializeFactsMatches, type CardStore } from './facts/store.js'

export type KnowledgeOperation = ToolId

/** 工具 schema 发生协议变化时递增；快照保留该值供对照分组。 */
export const TOOL_SCHEMA_VERSION = 5 as const

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

export const FACTS_RESULT_VERSION = 2 as const

export interface FactsResultMetadata {
  factsResultVersion: typeof FACTS_RESULT_VERSION
  matchedCount: number
  returnedCount: number
  complete: true
  scope: Record<string, unknown>
}

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
  factsResult?: FactsResultMetadata
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
  /** 仅在 facts 工具实际取得 store 后通知 runner；不主动触发惰性加载。 */
  onFactsStoreUsed?: (store: CardStore) => void
  /** facts store 加载失败时通知 runner，随后继续抛出原错误。 */
  onFactsStoreLoadFailed?: (error: unknown) => void
}

export interface KnowledgeToolExecutor {
  executeBatch(calls: ToolCall[]): Promise<ToolBatchResult>
  snapshot(): ToolBudgetState
}

const BUDGET_ANSWER_HINT = '工具预算已用尽，请依据已有证据作答；未覆盖部分明确说明。'

type JsonObject = Record<string, unknown>
type CurrentToolId = Exclude<ToolId, 'lookup' | 'query_operators'>

const TOOL_DEFINITIONS: Record<CurrentToolId, JsonObject> = {
  rag_search: {
    type: 'function',
    function: {
      name: 'rag_search',
      description: '查询机制、组合、排班及培养建议的知识库片段。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: '非空自然语言查询' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  grep_search: {
    type: 'function',
    function: {
      name: 'grep_search',
      description: '按关键词查找知识库原文片段。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: '非空关键词或短语' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  facts_search: {
    type: 'function',
    function: {
      name: 'facts_search',
      description: '用一个完整词条精确查询干员事实卡：干员正式名、技能名、已收录技能组词、设施、阵营或职业。不拆词，不解析句子或多个条件。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: '一个完整名称或分类词条；保留名称内部标点。' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
}

function allowedOperations(retriever: RetrieverId): CurrentToolId[] {
  if (retriever === 'hybrid') return ['rag_search', 'facts_search']
  if (retriever === 'facts') return ['facts_search']
  if (retriever === 'both') return ['rag_search', 'grep_search']
  return retriever === 'grep' ? ['grep_search'] : ['rag_search']
}

/** 返回当前模式实际发送的独立函数工具数组。 */
export function toolsForRetriever(retriever: RetrieverId = 'bm25'): Record<string, unknown>[] {
  return allowedOperations(retriever).map((name) => cloneJson(TOOL_DEFINITIONS[name]))
}

export function toolNamesForRetriever(retriever: RetrieverId = 'bm25'): CurrentToolId[] {
  return allowedOperations(retriever)
}

/** 供运行 meta 与离线探针使用的稳定 schema 指纹。 */
export function toolSchemaMetadata(retriever: RetrieverId = 'bm25'): {
  toolSchemaVersion: number
  toolSchemaSha256: string
  toolNames: CurrentToolId[]
} {
  const tools = toolsForRetriever(retriever)
  const serialized = stableJson(tools)
  return {
    toolSchemaVersion: TOOL_SCHEMA_VERSION,
    toolSchemaSha256: createHash('sha256').update(serialized).digest('hex'),
    toolNames: toolNamesForRetriever(retriever),
  }
}

/**
 * 兼容旧模块名的执行器工厂；新协议不再生成或接受 knowledge 外壳。
 * 保留导出名称只避免内部迁移时复制预算实现。
 */
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
    // 缺失或重复 ID 会让宿主无法安全回写；整批不准入、不扣点、不执行。
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
          operation: call.name,
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

export const createToolExecutor = createKnowledgeToolExecutor

function validateCallIds(calls: ToolCall[]): string | undefined {
  const seen = new Set<string>()
  for (const call of calls) {
    if (typeof call.id !== 'string') return '工具调用的 call ID 必须是字符串'
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
  if (!allowed.has(call.name as KnowledgeOperation)) {
    return result(call, call.name, 'unknown_operation', false, `当前检索模式不开放工具：${call.name}`, state)
  }
  const parsed = parseToolParams(call.name as KnowledgeOperation, call.arguments)
  if (!parsed.value) {
    return result(call, call.name, 'invalid_params', false, parsed.reason, state)
  }

  state.executed++
  try {
    const output = runOperation(call.name as KnowledgeOperation, parsed.value, context, config)
    const status: ToolResultStatus = isFactTool(call.name)
      ? output.hitIds.length > 0 ? 'success' : 'empty'
      : output.data ? 'success' : 'empty'
    const factsResult = isFactTool(call.name)
      ? {
          factsResultVersion: FACTS_RESULT_VERSION,
          matchedCount: output.hitIds.length,
          returnedCount: output.hitIds.length,
          complete: true as const,
          scope: parsed.value,
        }
      : undefined
    return {
      callId: call.id,
      operation: call.name,
      status,
      executed: true,
      data: output.data || '（无匹配结果）',
      budgetRemaining: state.remaining,
      actualParams: parsed.value,
      hitIds: output.hitIds,
      injectedIds: output.injectedIds,
      factsResult,
      message: state.remaining === 0 ? BUDGET_ANSWER_HINT : undefined,
    }
  } catch (error) {
    return result(
      call,
      call.name,
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

function parseToolParams(
  tool: KnowledgeOperation,
  args: string,
): { value?: Record<string, unknown>; reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(args)
  } catch {
    return { reason: `${tool} 参数不是有效 JSON；参数示例：${exampleFor(tool)}` }
  }
  if (!isObject(raw)) return { reason: `${tool} 参数必须是对象；参数示例：${exampleFor(tool)}` }

  const allowedKeys = ['query']
  const unknownKey = Object.keys(raw).find((key) => !allowedKeys.includes(key))
  if (unknownKey) return { reason: `${tool} 不支持参数字段 ${unknownKey}；参数示例：${exampleFor(tool)}` }

  if (tool === 'rag_search' || tool === 'grep_search') {
    return parseRequiredString(raw, tool, 'query', exampleFor(tool))
  }
  return parseRequiredString(raw, tool, 'query', exampleFor(tool))
}

function parseRequiredString(
  input: JsonObject,
  tool: string,
  field: string,
  example: string,
): { value?: Record<string, unknown>; reason: string } {
  if (typeof input[field] !== 'string' || input[field].trim() === '') {
    return { reason: `${tool} 缺少非空字符串 ${field}；参数示例：${example}` }
  }
  return { value: { [field]: (input[field] as string).trim() }, reason: '' }
}

function exampleFor(tool: KnowledgeOperation): string {
  return '{"query":"查询"}'
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
  let store: CardStore
  try {
    store = getCardStore()
  } catch (error) {
    try {
      context.onFactsStoreLoadFailed?.(error)
    } catch {
      // 观测回调不得遮蔽原工具错误。
    }
    throw error
  }
  try {
    context.onFactsStoreUsed?.(store)
  } catch {
    // 观测回调不得改变 facts 工具的执行语义。
  }
  const query = params.query as string
  const matches = store.factsSearch(query)
  const hits = matches.map((match) => match.card)
  return {
    data: serializeFactsMatches(query, matches),
    hitIds: hits.map((card) => card.canonical),
    injectedIds: hits.map((card) => card.canonical),
  }
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
    ...(item.factsResult ?? {}),
    ...(item.message ? { message: item.message } : {}),
  })
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
