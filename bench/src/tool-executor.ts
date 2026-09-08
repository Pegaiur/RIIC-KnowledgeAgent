/**
 * 独立函数工具 schema 与按批次预算执行器。
 * 工具函数名直接完成路由；执行器仍共用一套预算、校验和底层检索门面。
 */
import { createHash } from 'node:crypto'
import { loadConfig, type BenchConfig, type RetrieverId } from './config.js'
import { grepSearch, buildGrepResult } from './grep-retriever.js'
import { search, type IndexEntry } from './retriever.js'
import type { SectionDirectory, SectionEntry } from './sections.js'
import { isFactTool, type BenchQuery, type DocChunk, type ToolCall, type ToolId } from './types.js'
import { getCardStore, serializeFactsMatches, type CardStore } from './facts/store.js'

export type KnowledgeOperation = ToolId

/** 工具 schema 发生协议变化时递增；快照保留该值供对照分组。 */
export const TOOL_SCHEMA_VERSION = 6 as const

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
  /** 运行级原文小节目录；仅开放阅读能力的模式提供，用于展示上下文与 read_section。 */
  sections?: SectionDirectory
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
  read_section: {
    type: 'function',
    function: {
      name: 'read_section',
      description: '按小节 ID 读取知识库原文小节，可分段续读；ID 来自检索结果中的小节标识。',
      parameters: {
        type: 'object',
        properties: {
          section_id: { type: 'string', minLength: 1, description: '检索结果返回的小节 ID' },
          offset: { type: 'integer', minimum: 0, description: '可选，正文 UTF-16 索引，默认 0；用返回的 next_offset 续读' },
        },
        required: ['section_id'],
        additionalProperties: false,
      },
    },
  },
}

function allowedOperations(retriever: RetrieverId): CurrentToolId[] {
  if (retriever === 'hybrid') return ['rag_search', 'facts_search', 'read_section']
  if (retriever === 'facts') return ['facts_search']
  if (retriever === 'both') return ['rag_search', 'grep_search', 'read_section']
  return retriever === 'grep' ? ['grep_search'] : ['rag_search', 'read_section']
}

/** 当前模式是否开放原文小节阅读（bm25 / hybrid / both）。 */
export function supportsReadSection(retriever: RetrieverId): boolean {
  return allowedOperations(retriever).includes('read_section')
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

  try {
    const output = runOperation(call.name as KnowledgeOperation, parsed.value, context, config)
    const status: ToolResultStatus = output.status
      ?? (isFactTool(call.name)
        ? output.hitIds.length > 0 ? 'success' : 'empty'
        : output.data ? 'success' : 'empty')
    // 上下文相关的参数错误（如 read_section 越界 offset）不计入已执行，但仍已占用预算点。
    const executed = status !== 'invalid_params'
    if (executed) state.executed++
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
      executed,
      data: output.data || '（无匹配结果）',
      budgetRemaining: state.remaining,
      actualParams: parsed.value,
      hitIds: output.hitIds,
      injectedIds: output.injectedIds,
      factsResult,
      message: state.remaining === 0 ? BUDGET_ANSWER_HINT : undefined,
    }
  } catch (error) {
    state.executed++
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

  if (tool === 'read_section') return parseReadSectionParams(raw, exampleFor(tool))

  const allowedKeys = ['query']
  const unknownKey = Object.keys(raw).find((key) => !allowedKeys.includes(key))
  if (unknownKey) return { reason: `${tool} 不支持参数字段 ${unknownKey}；参数示例：${exampleFor(tool)}` }

  if (tool === 'rag_search' || tool === 'grep_search') {
    return parseRequiredString(raw, tool, 'query', exampleFor(tool))
  }
  return parseRequiredString(raw, tool, 'query', exampleFor(tool))
}

/** read_section 参数：section_id 必填非空字符串，offset 可选非负整数，额外字段拒绝。 */
function parseReadSectionParams(
  input: JsonObject,
  example: string,
): { value?: Record<string, unknown>; reason: string } {
  const allowedKeys = ['section_id', 'offset']
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.includes(key))
  if (unknownKey) return { reason: `read_section 不支持参数字段 ${unknownKey}；参数示例：${example}` }

  if (typeof input.section_id !== 'string' || input.section_id.trim() === '') {
    return { reason: `read_section 缺少非空字符串 section_id；参数示例：${example}` }
  }
  let offset = 0
  if (input.offset !== undefined) {
    if (typeof input.offset !== 'number' || !Number.isInteger(input.offset) || input.offset < 0) {
      return { reason: `read_section 的 offset 必须是非负整数；参数示例：${example}` }
    }
    offset = input.offset
  }
  return { value: { section_id: input.section_id.trim(), offset }, reason: '' }
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
): { data: string; hitIds: string[]; injectedIds: string[]; status?: ToolResultStatus } {
  if (operation === 'rag_search' || operation === 'grep_search') {
    const query = params.query as string
    const hits = operation === 'grep_search'
      ? grepSearch(context.chunks, query, config.topK)
      : search(context.index, query, config.topK)
    const hitIds = hits.map((index) => context.chunks[index]?.id).filter((id): id is string => Boolean(id))
    let data: string
    let injectedIds: string[]
    if (operation === 'grep_search') {
      // grep 结果格式本轮保持原样，不附加小节上下文。
      data = buildGrepResult(context.chunks, hits, query, config.maxContextChars)
      injectedIds = hitIds
    } else {
      const built = buildRagData(context.chunks, hits, config.maxContextChars, context.sections)
      data = built.data
      injectedIds = built.injectedIds
    }
    for (const id of injectedIds) {
      if (context.injectedIds && !context.injectedIds.includes(id)) context.injectedIds.push(id)
    }
    return { data, hitIds, injectedIds }
  }
  if (operation === 'read_section') return readSectionOperation(params, context, config)
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

interface RagBlock {
  chunk: DocChunk
  section?: SectionEntry
}

/** 父级引导展示上限；超出时截断并标注。 */
const PARENT_LEAD_LIMIT = 300
/** 每个命中文档的小节导航上限。 */
const NAVIGATION_LIMIT = 8

/**
 * 组装 RAG 命中正文，并在预算允许时附加小节上下文与导航。
 * 正文优先送达；标题路径、父级引导和导航只使用剩余空间，injectedIds 只记录真实送达的 chunk。
 */
function buildRagData(
  chunks: DocChunk[],
  hits: number[],
  maxChars: number,
  sections?: SectionDirectory,
): { data: string; injectedIds: string[] } {
  const blocks: RagBlock[] = hits.map((index) => {
    const chunk = chunks[index]!
    return { chunk, section: sections?.findByChunk(chunk.file, chunk.heading, chunk.startLine) }
  })

  let body = ''
  const injectedIds: string[] = []
  for (const block of blocks) {
    if (body.length < maxChars) injectedIds.push(block.chunk.id)
    body += `${body ? '\n\n' : ''}${renderRagHeader(block)}\n${block.chunk.text}`
  }
  let data = body.slice(0, maxChars)
  if (sections && data.length < maxChars && blocks.some((block) => block.section)) {
    data = appendSectionContext(data, buildSectionContext(sections, blocks), maxChars)
  }
  return { data, injectedIds }
}

function renderRagHeader(block: RagBlock): string {
  const { chunk } = block
  const base = `${chunk.file} | ${chunk.heading} | L${chunk.startLine}-${chunk.endLine}`
  return block.section ? `【${base} | ${block.section.sectionId}】` : `【${base}】`
}

function buildSectionContext(sections: SectionDirectory, blocks: RagBlock[]): string[] {
  const lines: string[] = ['【小节上下文】']
  const seenSections = new Set<string>()
  for (const block of blocks) {
    const section = block.section
    if (!section || seenSections.has(section.sectionId)) continue
    seenSections.add(section.sectionId)
    const context = sections.contextFor(section.sectionId)
    const path = context && context.headingPath.length > 0 ? context.headingPath.join(' > ') : '（文档根节点）'
    lines.push(`- ${section.sectionId}｜${block.chunk.file}｜标题路径：${path}`)
    if (context?.parentLead) {
      lines.push(`  父级引导（L${context.parentLead.startLine}-${context.parentLead.endLine}）：${truncateLead(context.parentLead.text)}`)
    }
  }
  for (const file of [...new Set(blocks.map((block) => block.chunk.file))]) {
    const first = blocks.find((block) => block.chunk.file === file && block.section)
    if (!first?.section) continue
    const navigation = sections.navigationFor(first.section.sectionId, NAVIGATION_LIMIT)
    lines.push(`【小节导航】${file}`)
    for (const item of navigation.items) lines.push(`- ${item.sectionId}｜${item.heading}`)
    if (navigation.omitted > 0) lines.push(`（省略 ${navigation.omitted} 项）`)
  }
  return lines
}

function truncateLead(text: string): string {
  return text.length <= PARENT_LEAD_LIMIT ? text : `${text.slice(0, PARENT_LEAD_LIMIT)}…（截断）`
}

/** 按行追加小节上下文；空间不足时截断最后一项并标注。 */
function appendSectionContext(data: string, lines: string[], maxChars: number): string {
  let out = data
  lines.forEach((line, index) => {
    if (out.length >= maxChars) return
    const separator = index === 0 ? '\n\n' : '\n'
    if (out.length + separator.length + line.length <= maxChars) {
      out += `${separator}${line}`
      return
    }
    const marker = '…（截断）'
    const room = maxChars - out.length - separator.length - marker.length
    if (room > 0) out += `${separator}${line.slice(0, room)}${marker}`
  })
  return out
}

/** 单次 read_section 的正文页上限（UTF-16 字符）。 */
const READ_SECTION_PAGE_CHARS = 6000

function readSectionOperation(
  params: Record<string, unknown>,
  context: KnowledgeToolContext,
  config: BenchConfig,
): { data: string; hitIds: string[]; injectedIds: string[]; status: ToolResultStatus } {
  const sectionId = params.section_id as string
  const offset = params.offset as number
  const directory = context.sections
  if (!directory) {
    return { data: `本运行未启用小节阅读（没有小节目录），无法读取：${sectionId}。`, hitIds: [], injectedIds: [], status: 'empty' }
  }
  const section = directory.get(sectionId)
  if (!section) {
    return { data: `本运行目录中没有该小节：${sectionId}。不会改为模糊搜索。`, hitIds: [], injectedIds: [], status: 'empty' }
  }
  if (offset > section.body.length) {
    return {
      data: `read_section 的 offset 超出小节正文长度（${section.body.length}）：${offset}`,
      hitIds: [],
      injectedIds: [],
      status: 'invalid_params',
    }
  }
  return { data: renderSectionPage(section, offset, config.maxContextChars), hitIds: [], injectedIds: [], status: 'success' }
}

/** 渲染一页原文；元数据先占预算，必要时在行边界缩短，保证可续读且不丢中段。 */
function renderSectionPage(section: SectionEntry, offset: number, maxContextChars: number): string {
  const path = section.level === 0 ? '（文档根节点）' : [...section.ancestors, section.heading].join(' > ')
  const build = (page: string, nextOffset: number | null, complete: boolean): string => {
    const startLine = section.startLine + countNewlines(section.body.slice(0, offset))
    const endLine = page.length === 0 ? startLine - 1 : startLine + countNewlines(page)
    return [
      `【read_section】${section.sectionId}`,
      `标题路径：${path}`,
      `行范围：L${startLine}-${endLine}｜offset：${offset}｜next_offset：${nextOffset === null ? 'null' : nextOffset}｜complete：${complete}`,
      '',
      page,
    ].join('\n')
  }

  const remaining = section.body.length - offset
  // 用最宽的分页元数据估算占用，避免正文把总长度顶出上限。
  const metaLength = build('', Number.MAX_SAFE_INTEGER, false).length
  let budget = Math.min(READ_SECTION_PAGE_CHARS, remaining)
  if (metaLength + budget > maxContextChars) {
    budget = Math.max(0, maxContextChars - metaLength)
    if (remaining > 0 && budget < 1) budget = 1
    budget = Math.min(budget, remaining)
  }
  let page = section.body.slice(offset, offset + budget)
  if (offset + page.length < section.body.length) page = cutAtLine(page)
  const nextOffset = offset + page.length
  const complete = nextOffset >= section.body.length
  return build(page, complete ? null : nextOffset, complete)
}

function countNewlines(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  return count
}

/** 在最后一个换行处截断；单行超长时保留原样，避免空页导致无法续读。 */
function cutAtLine(text: string): string {
  const newline = text.lastIndexOf('\n')
  return newline > 0 ? text.slice(0, newline) : text
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
