/**
 * 独立函数工具 schema 与按批次预算执行器。
 * 工具函数名直接完成路由；执行器仍共用一套预算、校验和底层检索门面。
 */
import type { AttachedFactsObservation, FulltextRange, LinkedEntryObservation, LinkedFactsObservation } from './delivery.js'
export type { AttachedFactsObservation, FulltextRange, LinkedEntryObservation, LinkedFactsObservation } from './delivery.js'
import { createHash } from 'node:crypto'
import { effectiveAttachFacts, loadConfig, type BenchConfig, type RetrieverId } from './config.js'
import { isFulltextFile } from './corpus.js'
import { search, type IndexEntry } from './retriever.js'
import type { ProseLinkIndex, ResolvedProseLink } from './prose-links.js'
import type { SectionDirectory, SectionEntry } from './sections.js'
import { isFactTool, type BenchQuery, type DocChunk, type ToolCall } from './types.js'
import type { RecordCard } from './facts/card.js'
import {
  getCardStore,
  serializeCard,
  serializeResolutionPaths,
  type CardStore,
  type FactsEntryDictionary,
  type FactsMatch,
  type FactsMatchCategory,
  type FactsSearchResult,
  type ResolutionPath,
  type TagCardMatch,
} from './facts/store.js'

/** 当前可下发的工具集合；grep_search 等历史名不在其中。 */
export type CurrentToolId = 'rag_search' | 'facts_search' | 'read_section'

/** 工具定义（含描述）变化时递增；快照保留该值供对照分组，指纹随描述变化。 */
export const TOOL_SCHEMA_VERSION = 14 as const

export interface ToolBudgetState {
  /** 非空执行成功额度上限（每题默认 5） */
  successLimit: number
  /** 已扣点的非空执行成功数 */
  successUsed: number
  /** 获准尝试硬上限（每题默认 10） */
  attemptLimit: number
  /** 已获准的尝试数（成功、空结果与失败均占一次） */
  attemptUsed: number
  requested: number
  denied: number
  executed: number
  /** 成功额度余额（successLimit - successUsed） */
  remaining: number
}

export type ToolResultStatus =
  | 'success'
  | 'empty'
  | 'invalid_params'
  | 'unknown_operation'
  | 'error'
  | 'budget_exhausted'
  /** 同一步骤中首项之外的超量调用：未执行、不计额度。 */
  | 'protocol_rejected'

export const FACTS_RESULT_VERSION = 7 as const

/**
 * 单次 tags 反查的固定页上限（记录卡张数）。
 * 宽标签不静默 Top-N 或截断卡片，改用显式分页：每卡仍完整返回，超出部分用 offset 续读。
 * 首版取值 20：覆盖常见来源标签的完整命中集合，同时限制单次工具结果体积。
 */
export const FACTS_TAG_PAGE_CARDS = 20 as const

/**
 * RAG 内部附带 facts 的独立额度（UTF-16 字符，ADR-013 决策 4 定稿）：
 * 在 maxContextChars 之外单独分配，不与之互相回收；以单触发词完整匹配集合为原子单位。
 */
export const RAG_ATTACH_FACTS_QUOTA_CHARS = 4_000 as const

/**
 * TODO(tech-debt) R5-5：协议层直接内嵌 store 的 ResolutionPath 联合类型，路径种类变更会牵动 wire 契约；
 * 待协议与领域类型分层后把该类型下沉到共享 terms 模块（只沉 wire 契约，不沉内部行形状）。
 */
/** v6 逐项结构化记录：与原始 queries 数组一一对应，非法项也占位。 */
export interface FactsResolutionItem {
  /** 原数组零基索引 */
  index: number
  /** 合法词条 trim 后字符串；非法项为 null */
  query: string | null
  status: 'success' | 'empty' | 'invalid'
  /** 该词命中的完整解析路径；invalid 为空 */
  paths: ResolutionPath[]
  /** 该词全部命中 canonical（沿 store 顺序去重，保留跨词重复卡）；empty / invalid 为空 */
  canonicals: string[]
  /** 非法项的中文原因；合法项为 null */
  message: string | null
}

/** tags 路径的分页元数据；queries 路径不携带。 */
export interface FactsTagPage {
  /** 本次请求的起始偏移 */
  offset: number
  /** 固定页上限（记录卡张数） */
  limit: number
  /** 本次标签命中的卡总数（跨标签去重） */
  matchedCount: number
  /** 本页实际返回的卡数 */
  returnedCount: number
  /** 本次匹配的卡是否已在本页读完（不代表标签能力或来源范围穷尽） */
  complete: boolean
  /** 续读偏移；complete=true 时为 null */
  nextOffset: number | null
}

export interface FactsResultMetadata {
  factsResultVersion: typeof FACTS_RESULT_VERSION
  matchedCount: number
  returnedCount: number
  /** tags 路径取 tagPage.complete；queries 路径恒为 true */
  complete: boolean
  scope: Record<string, unknown>
  resolution: { items: FactsResolutionItem[] }
  /** 仅 tags 路径携带的分页信息 */
  tagPage?: FactsTagPage
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
  /** rag_search 原文扩展的实际送达范围；未扩展时为 undefined。 */
  fulltextRanges?: FulltextRange[]
  /** rag_search 内部 facts 附带的触发/匹配/送达观测；无触发词时为 undefined。 */
  attachedFacts?: AttachedFactsObservation[]
  /** rag_search 关联事实入口提示观测（ADR-020）；无提示时省略。 */
  linkedEntries?: LinkedEntryObservation[]
  /** read_section 显式展开关联事实的实际送达观测（ADR-020）；未展开时省略。 */
  linkedFacts?: LinkedFactsObservation
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
  /** 运行级散文小节关联索引；提供时 rag_search 给出可展开入口，read_section 可显式展开。 */
  links?: ProseLinkIndex
  /** 由 Agent 共享的全题注入去重列表。 */
  injectedIds?: string[]
  /** 仅在 facts 工具实际取得 store 后通知 runner；不主动触发惰性加载。 */
  onFactsStoreUsed?: (store: CardStore) => void
  /** facts store 加载失败时通知 runner，随后继续抛出原错误。 */
  onFactsStoreLoadFailed?: (error: unknown) => void
}

export interface KnowledgeToolExecutor {
  executeStep(calls: ToolCall[]): Promise<ToolBatchResult>
  snapshot(): ToolBudgetState
}

const SUCCESS_BUDGET_HINT = '工具成功额度已用尽，请依据已有证据作答；未覆盖部分明确说明。'
const ATTEMPT_BUDGET_HINT = '工具获准尝试次数已用尽，请依据已有证据作答；未覆盖部分明确说明。'

type JsonObject = Record<string, unknown>

/** 与配置无关的静态工具定义；facts_search 的 maxItems 由配置上限派生，见 factsSearchDefinition。 */
const STATIC_TOOL_DEFINITIONS: Record<'rag_search' | 'read_section', JsonObject> = {
  rag_search: {
    type: 'function',
    function: {
      name: 'rag_search',
      description: '检索机制、组合、排班及培养建议，返回知识库片段或原文范围。结果可含供 read_section 使用的小节或范围 ID、分页信息及上级范围入口；登记了关联事实的小节会给出可展开入口（仅导航，不返回事实）；hybrid 模式还可能返回附带事实卡或未附带提示，以实际返回内容为准。',
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
  read_section: {
    type: 'function',
    function: {
      name: 'read_section',
      description: '按已返回的 ID 读取知识库原文小节或范围，可分段续读；ID 可来自检索结果、续读信息或上级范围入口。返回的 complete=false 表示该范围还有后续页，complete=true 仅表示该范围读完，不表示问题已完整解决。可选 linked=true 时改为展开该小节登记关联的事实卡（直接读取登记对象，不走别名/子串/同名集合扩展），不返回原文正文，且与 offset 互斥。',
      parameters: {
        type: 'object',
        properties: {
          section_id: { type: 'string', minLength: 1, description: '工具结果已给出的小节或范围 ID，原样使用。' },
          offset: { type: 'integer', minimum: 0, description: '可选，正文 UTF-16 索引，默认 0；用返回的 next_offset 续读' },
          linked: { type: 'boolean', description: '可选；设为 true 时只展开该小节登记关联的事实卡，不返回原文正文，且不能与 offset 同时使用。' },
        },
        required: ['section_id'],
        additionalProperties: false,
      },
    },
  },
}

/**
 * facts_search 定义：queries 为完整词条数组，maxItems 由 factsQueryListLimit 派生，
 * 使发送给模型的 schema 与运行时校验共用同一配置来源，避免两处上限漂移。
 */
function factsSearchDefinition(factsQueryListLimit: number): JsonObject {
  return {
    type: 'function',
    function: {
      name: 'facts_search',
      description: '用一个或多个完整词条精确查询干员事实卡：干员正式名、技能名、已收录技能组词、设施、阵营或职业；支持已确认别名（干员别名）、已登记子串短名、阵营规范名和搭配规范名。可一次传入多个完整词条，每项仍须是完整词条，数组不是复合过滤语法，单次词条数受运行配置限制；同名命中全部返回并保留命中路径，短名按登记返回全部长名，不做消歧；不支持简写合称，不拆词，不解析句子或多个条件。也可用 tags 按来源标签反查持有者，派生标签 → 设施 → 技能 → grant → 干员，只做 trim 后精确匹配，不做别名、子串或模糊扩展，且不与同名职业/设施/技能组自动合并。queries 与 tags 互斥，至少提供其一；offset 仅在 tags 路径出现（非负整数，默认 0），命中卡按固定页上限分页，每卡完整返回，用结果里的 next_offset 续读。',
      parameters: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            minItems: 1,
            maxItems: factsQueryListLimit,
            items: { type: 'string', minLength: 1, description: '一个完整名称或分类词条；保留名称内部标点。' },
            description: '待查询词条列表，数量上限见 maxItems；与 tags 互斥，至少提供其一。',
          },
          tags: {
            type: 'array',
            minItems: 1,
            maxItems: factsQueryListLimit,
            items: { type: 'string', minLength: 1, description: '一个完整来源标签名；只做 trim 后精确匹配，不做别名、子串或模糊扩展。' },
            description: '待反查的来源标签列表，数量上限见 maxItems；与 queries 互斥，至少提供其一。',
          },
          offset: {
            type: 'integer',
            minimum: 0,
            description: '仅 tags 路径可用：命中卡的分页偏移，默认 0；用结果里的 next_offset 续读。',
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  }
}

/** 按工具名取定义；facts_search 需要配置上限，其余取静态定义。 */
function toolDefinitionFor(name: CurrentToolId, factsQueryListLimit: number): JsonObject {
  return name === 'facts_search' ? factsSearchDefinition(factsQueryListLimit) : STATIC_TOOL_DEFINITIONS[name]
}

function allowedOperations(retriever: RetrieverId): CurrentToolId[] {
  return retriever === 'hybrid'
    ? ['rag_search', 'facts_search', 'read_section']
    : ['rag_search', 'read_section']
}

/** 返回当前模式实际发送的独立函数工具数组；facts maxItems 由调用方传入的配置上限派生。 */
export function toolsForRetriever(retriever: RetrieverId, factsQueryListLimit: number): Record<string, unknown>[] {
  return allowedOperations(retriever).map((name) => cloneJson(toolDefinitionFor(name, factsQueryListLimit)))
}

export function toolNamesForRetriever(retriever: RetrieverId = 'hybrid'): CurrentToolId[] {
  return allowedOperations(retriever)
}

/** 供运行 meta 与离线探针使用的稳定 schema 指纹；上限入参保证与发送给模型的 schema 一致。 */
export function toolSchemaMetadata(retriever: RetrieverId, factsQueryListLimit: number): {
  toolSchemaVersion: number
  toolSchemaSha256: string
  toolNames: CurrentToolId[]
} {
  const tools = toolsForRetriever(retriever, factsQueryListLimit)
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
  successLimit: number,
): KnowledgeToolExecutor {
  const config = context.config ?? loadConfig()
  if (!Number.isInteger(successLimit) || successLimit <= 0) throw new Error(`toolBudget 必须是正整数：${successLimit}`)
  const attemptLimit = config.toolAttemptLimit
  if (!Number.isInteger(attemptLimit) || attemptLimit <= 0) {
    throw new Error(`toolAttemptLimit 必须是正整数：${attemptLimit}`)
  }
  const state: ToolBudgetState = {
    successLimit,
    successUsed: 0,
    attemptLimit,
    attemptUsed: 0,
    requested: 0,
    denied: 0,
    executed: 0,
    remaining: successLimit,
  }
  const allowed = new Set(allowedOperations(config.retriever))

  function snapshot(): ToolBudgetState {
    return { ...state, remaining: state.successLimit - state.successUsed }
  }

  /** 单项结算后的提示：两项同时用尽时优先提示成功额度。 */
  function settledHint(): string | undefined {
    if (state.successUsed >= state.successLimit) return SUCCESS_BUDGET_HINT
    if (state.attemptUsed >= state.attemptLimit) return ATTEMPT_BUDGET_HINT
    return undefined
  }

  async function executeStep(calls: ToolCall[]): Promise<ToolBatchResult> {
    const protocolError = validateCallIds(calls)
    // 缺失或重复 ID 会让宿主无法安全回写；整步不准入、不扣点、不执行。
    if (protocolError) return { results: [], snapshot: snapshot(), protocolError }

    const results: ToolExecutionResult[] = []
    if (calls.length === 0) return { results, snapshot: snapshot() }

    // requested 含所有提出项；每次模型步骤只准入首项，其余调用不递补也不计额度。
    state.requested += calls.length
    const first = calls[0]!
    if (state.attemptUsed >= state.attemptLimit || state.successUsed >= state.successLimit) {
      state.denied++
      results.push(exhaustedResult(first, state))
    } else {
      state.attemptUsed++
      const item = await executeOne(first, allowed, context, config, state)
      if (item.executed && item.status === 'success') state.successUsed++
      state.remaining = state.successLimit - state.successUsed
      item.budgetRemaining = state.remaining
      const hint = settledHint()
      if (hint) item.message = item.message && item.message !== hint ? `${item.message}；${hint}` : hint
      results.push(item)
    }

    // 超量项以本步位置为稳定分类：不解析参数、不执行、不计额度；余额取首项结算后的值。
    const retryAvailable = state.successUsed < state.successLimit && state.attemptUsed < state.attemptLimit
    for (const call of calls.slice(1)) {
      state.denied++
      results.push(protocolRejectedResult(call, state, retryAvailable))
    }
    return { results, snapshot: snapshot() }
  }

  return { executeStep, snapshot }
}

/**
 * 同一步骤中首项之外的超量调用：不解析参数、不执行、不占用获准尝试或成功额度。
 * 仅当成功额度与获准尝试均仍有余额时才提示在下一步重新提出，否则提示依据已有证据作答。
 */
function protocolRejectedResult(call: ToolCall, state: ToolBudgetState, retryAvailable: boolean): ToolExecutionResult {
  const advice = retryAvailable
    ? '若仍缺这项证据，请在下一步重新提出。'
    : '请依据已有证据作答，未覆盖部分明确说明。'
  const message = `本次模型步骤只准入首个工具调用（单调用规则）；该调用未执行（同批超量拒绝）。${advice}`
  return {
    callId: call.id,
    operation: call.name,
    status: 'protocol_rejected',
    executed: false,
    data: message,
    budgetRemaining: state.successLimit - state.successUsed,
    message,
  }
}

/** 超限拒绝结果：不占用获准尝试数，message 区分成功额度用尽与尝试次数用尽。 */
function exhaustedResult(call: ToolCall, state: ToolBudgetState): ToolExecutionResult {
  const successGone = state.successUsed >= state.successLimit
  const message = successGone
    ? '工具成功额度已用尽，未执行调用；请依据已有证据作答。'
    : '工具获准尝试次数已用尽，未执行调用；请依据已有证据作答。'
  return {
    callId: call.id,
    operation: call.name,
    status: 'budget_exhausted',
    executed: false,
    data: message,
    budgetRemaining: state.successLimit - state.successUsed,
    message,
  }
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
  allowed: Set<CurrentToolId>,
  context: KnowledgeToolContext,
  config: BenchConfig,
  state: ToolBudgetState,
): Promise<ToolExecutionResult> {
  if (!allowed.has(call.name as CurrentToolId)) {
    return result(call, call.name, 'unknown_operation', false, `当前检索模式不开放工具：${call.name}`, state)
  }
  const parsed = parseToolParams(call.name as CurrentToolId, call.arguments, config.factsQueryListLimit)
  if (!parsed.value) {
    return result(call, call.name, 'invalid_params', false, parsed.reason, state)
  }

  try {
    const output = runOperation(call.name as CurrentToolId, parsed, context, config)
    const status: ToolResultStatus = output.status
      ?? (isFactTool(call.name)
        ? output.hitIds.length > 0 ? 'success' : 'empty'
        : output.data ? 'success' : 'empty')
    // 上下文相关的参数错误（如 read_section 越界 offset）不计入已执行，但仍占用一次获准尝试。
    const executed = status !== 'invalid_params'
    if (executed) state.executed++
    const factsPage = isFactTool(call.name) ? output.factsPage : undefined
    const factsResult: FactsResultMetadata | undefined = isFactTool(call.name)
      ? {
          factsResultVersion: FACTS_RESULT_VERSION,
          matchedCount: factsPage?.matchedCount ?? output.hitIds.length,
          returnedCount: factsPage?.returnedCount ?? output.hitIds.length,
          complete: factsPage?.complete ?? true,
          scope: parsed.value,
          resolution: { items: output.factsItems ?? [] },
          ...(factsPage?.tagPage === undefined ? {} : { tagPage: factsPage.tagPage }),
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
      fulltextRanges: output.fulltextRanges,
      attachedFacts: output.attachedFacts,
      linkedEntries: output.linkedEntries,
      linkedFacts: output.linkedFacts,
      factsResult,
      // 操作直接返回的 error（如原文扩展容量不足）需带上文本，供 trace.error 与复盘定位；
      // 与 catch 分支的错误口径一致，非 fatal，不扣成功额度。
      ...(status === 'error' ? { message: output.data } : {}),
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

/** facts_search 逐项解析记录：与原始 queries 数组一一对应，非法项也占位。 */
interface FactsParseItem {
  /** 原数组零基索引 */
  index: number
  /** 合法词条 trim 后字符串；非法项为 null */
  query: string | null
  /** 非法项的中文原因；合法项为 null */
  message: string | null
}

interface ParsedToolParams {
  value?: Record<string, unknown>
  reason: string
  /** facts_search 专用：按原数组顺序的逐项解析记录（含非法占位）。 */
  factsItems?: FactsParseItem[]
  /** facts_search 专用：本次走 queries 还是 tags 分支。 */
  factsMode?: 'queries' | 'tags'
}

function parseToolParams(
  tool: CurrentToolId,
  args: string,
  factsQueryListLimit: number,
): ParsedToolParams {
  let raw: unknown
  try {
    raw = JSON.parse(args)
  } catch {
    return { reason: `${tool} 参数不是有效 JSON；参数示例：${exampleFor(tool)}` }
  }
  if (!isObject(raw)) return { reason: `${tool} 参数必须是对象；参数示例：${exampleFor(tool)}` }

  if (tool === 'read_section') return parseReadSectionParams(raw, exampleFor(tool))
  if (tool === 'facts_search') return parseFactsParams(raw, factsQueryListLimit, exampleFor(tool))

  const allowedKeys = ['query']
  const unknownKey = Object.keys(raw).find((key) => !allowedKeys.includes(key))
  if (unknownKey) return { reason: `${tool} 不支持参数字段 ${unknownKey}；参数示例：${exampleFor(tool)}` }

  return parseRequiredString(raw, tool, 'query', exampleFor(tool))
}

/**
 * facts_search 参数：queries 或 tags 二者其一（互斥），offset 仅随 tags。
 * 根级非法（缺两者、两者并存、offset 与 queries 并存、非数组、空数组、额外字段、超过上限）整批判 invalid_params；
 * 元素级非法只记为该元素 invalid，合法元素继续执行；上限按原数组长度检查，不先过滤非法项或去重。
 */
function parseFactsParams(
  input: JsonObject,
  factsQueryListLimit: number,
  example: string,
): ParsedToolParams {
  const allowedKeys = ['queries', 'tags', 'offset']
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.includes(key))
  if (unknownKey) return { reason: `facts_search 不支持参数字段 ${unknownKey}；参数示例：${example}` }

  const hasQueries = input.queries !== undefined
  const hasTags = input.tags !== undefined
  if (!hasQueries && !hasTags) return { reason: `facts_search 需要提供 queries 或 tags 之一；参数示例：${example}` }
  if (hasQueries && hasTags) return { reason: `facts_search 的 queries 与 tags 互斥，只能提供其一；参数示例：${example}` }

  if (hasQueries) {
    if (input.offset !== undefined) return { reason: `facts_search 的 offset 只能与 tags 一起使用；参数示例：${example}` }
    return parseFactsQueries(input.queries, factsQueryListLimit, example)
  }
  return parseFactsTags(input.tags, input.offset, factsQueryListLimit, example)
}

/** queries 分支：非空字符串数组，元素级非法占位。 */
function parseFactsQueries(raw: unknown, limit: number, example: string): ParsedToolParams {
  if (!Array.isArray(raw)) return { reason: `facts_search 的 queries 必须是字符串数组；参数示例：${example}` }
  if (raw.length === 0) return { reason: `facts_search 的 queries 不能为空数组；参数示例：${example}` }
  if (raw.length > limit) return { reason: `facts_search 的 queries 最多 ${limit} 个词条，实际 ${raw.length} 个；参数示例：${example}` }

  const factsItems: FactsParseItem[] = raw.map((value, index) => typeof value === 'string' && value.trim() !== ''
    ? { index, query: value.trim(), message: null }
    : { index, query: null, message: `第 ${index + 1} 项必须是非空字符串` })

  const legalQueries = factsItems.flatMap((item) => (item.query === null ? [] : [item.query]))
  if (legalQueries.length === 0) {
    const detail = factsItems.map((item) => item.message).join('；')
    return { reason: `facts_search 没有可用词条：${detail}；参数示例：${example}` }
  }
  return { value: { queries: legalQueries }, factsItems, factsMode: 'queries', reason: '' }
}

/** tags 分支：非空字符串数组（上限同词条上限）与可选非负整数 offset，元素级非法占位。 */
function parseFactsTags(raw: unknown, rawOffset: unknown, limit: number, example: string): ParsedToolParams {
  if (!Array.isArray(raw)) return { reason: `facts_search 的 tags 必须是字符串数组；参数示例：${example}` }
  if (raw.length === 0) return { reason: `facts_search 的 tags 不能为空数组；参数示例：${example}` }
  if (raw.length > limit) return { reason: `facts_search 的 tags 最多 ${limit} 个标签，实际 ${raw.length} 个；参数示例：${example}` }

  let offset = 0
  if (rawOffset !== undefined) {
    if (typeof rawOffset !== 'number' || !Number.isInteger(rawOffset) || rawOffset < 0) {
      return { reason: `facts_search 的 offset 必须是非负整数；参数示例：${example}` }
    }
    offset = rawOffset
  }

  const factsItems: FactsParseItem[] = raw.map((value, index) => typeof value === 'string' && value.trim() !== ''
    ? { index, query: value.trim(), message: null }
    : { index, query: null, message: `第 ${index + 1} 项必须是非空字符串` })

  const legalTags = factsItems.flatMap((item) => (item.query === null ? [] : [item.query]))
  if (legalTags.length === 0) {
    const detail = factsItems.map((item) => item.message).join('；')
    return { reason: `facts_search 没有可用标签：${detail}；参数示例：${example}` }
  }
  return { value: { tags: legalTags, offset }, factsItems, factsMode: 'tags', reason: '' }
}

/** read_section 参数：section_id 必填非空字符串，offset 可选非负整数，linked 可选布尔（与 offset 互斥），额外字段拒绝。 */
function parseReadSectionParams(
  input: JsonObject,
  example: string,
): { value?: Record<string, unknown>; reason: string } {
  const allowedKeys = ['section_id', 'offset', 'linked']
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.includes(key))
  if (unknownKey) return { reason: `read_section 不支持参数字段 ${unknownKey}；参数示例：${example}` }

  if (typeof input.section_id !== 'string' || input.section_id.trim() === '') {
    return { reason: `read_section 缺少非空字符串 section_id；参数示例：${example}` }
  }
  if (input.linked !== undefined && typeof input.linked !== 'boolean') {
    return { reason: `read_section 的 linked 必须是布尔值；参数示例：${example}` }
  }
  const linked = input.linked === true
  if (linked && input.offset !== undefined) {
    return { reason: `read_section 的 linked 与 offset 互斥；参数示例：${example}` }
  }
  let offset = 0
  if (input.offset !== undefined) {
    if (typeof input.offset !== 'number' || !Number.isInteger(input.offset) || input.offset < 0) {
      return { reason: `read_section 的 offset 必须是非负整数；参数示例：${example}` }
    }
    offset = input.offset
  }
  return { value: { section_id: input.section_id.trim(), offset, ...(linked ? { linked: true } : {}) }, reason: '' }
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

function exampleFor(tool: CurrentToolId): string {
  if (tool === 'read_section') return '{"section_id":"检索结果中的小节 ID"}'
  if (tool === 'facts_search') return '{"queries":["完整词条"]}'
  return '{"query":"查询"}'
}

function runOperation(
  operation: CurrentToolId,
  parsed: ParsedToolParams,
  context: KnowledgeToolContext,
  config: BenchConfig,
): {
  data: string
  hitIds: string[]
  injectedIds: string[]
  factsItems?: FactsResolutionItem[]
  /** tags 路径的分页计数；queries 路径缺省（按 hitIds 完整返回） */
  factsPage?: { matchedCount: number; returnedCount: number; complete: boolean; tagPage?: FactsTagPage }
  fulltextRanges?: FulltextRange[]
  attachedFacts?: AttachedFactsObservation[]
  linkedEntries?: LinkedEntryObservation[]
  linkedFacts?: LinkedFactsObservation
  status?: ToolResultStatus
} {
  if (operation === 'rag_search') return ragSearchOperation(parsed.value!, context, config)
  if (operation === 'read_section') return readSectionOperation(parsed.value!, context, config)
  return factsSearchOperation(parsed, context)
}

/** facts_search 入口：按解析出的分支走 queries 或 tags。 */
function factsSearchOperation(
  parsed: ParsedToolParams,
  context: KnowledgeToolContext,
): {
  data: string
  hitIds: string[]
  injectedIds: string[]
  factsItems: FactsResolutionItem[]
  factsPage?: { matchedCount: number; returnedCount: number; complete: boolean; tagPage?: FactsTagPage }
} {
  return parsed.factsMode === 'tags'
    ? factsSearchTagsOperation(parsed, context)
    : factsSearchQueriesOperation(parsed, context)
}

/**
 * facts_search：按原数组顺序逐项查询并分段返回；非法项占错误提示段。
 * 逐词在本次调用内复用查询结果（重复词不重复查询底层）；跨词命中同一 canonical 时首现段返回完整卡，
 * 后续段只列名称并引用首次段号（去重范围仅限本次调用）。hitIds / injectedIds 取跨词并集、按首次出现顺序排列。
 * 全部结果先在局部组装，任一步 store 抛错整次失败，不留下部分注入记录。
 * 逐项记录（原索引、规范化词条、状态、路径、canonical）经 resolution.items 进入元数据，items 取并集计数。
 * TODO(tech-debt) R5-7：首版按词完整返回，无分页/截断，maxItems 只约束词数、不代表输出容量上限，
 * 宽查单词输出可超过 maxContextChars；重启条件：引入分页或截断时须同时重定义 complete 与 matchedCount/returnedCount 的送达口径。
 */
function factsSearchQueriesOperation(
  parsed: ParsedToolParams,
  context: KnowledgeToolContext,
): {
  data: string
  hitIds: string[]
  injectedIds: string[]
  factsItems: FactsResolutionItem[]
} {
  const store = loadFactsStore(context)
  const entries = parsed.factsItems ?? []
  const cache = new Map<string, FactsSearchResult>()
  // canonical → 首次送达它的段号（1 基），仅本次调用内有效。
  const deliveredAt = new Map<string, number>()
  const items: FactsResolutionItem[] = []
  const segments: string[] = []
  const hitIds: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.query === null) {
      const message = entry.message ?? '参数错误'
      items.push({ index: entry.index, query: null, status: 'invalid', paths: [], canonicals: [], message })
      segments.push(`第 ${entry.index + 1} 段｜参数错误：${message}`)
      continue
    }
    const term = entry.query
    const segmentNumber = entry.index + 1
    let result = cache.get(term)
    if (!result) {
      result = store.factsSearch(term)
      cache.set(term, result)
    }
    const canonicals = dedupeCanonicals(result.matches.map((match) => match.card.canonical))
    items.push({
      index: entry.index,
      query: term,
      status: canonicals.length > 0 ? 'success' : 'empty',
      paths: [...result.paths],
      canonicals: [...canonicals],
      message: null,
    })
    const header = `第 ${segmentNumber} 段｜${term}｜命中 ${canonicals.length} 张`
    const body = canonicals.length === 0
      ? result.paths.length === 0
        ? `未收录精确词条：${term}`
        : '匹配说明：本次路径没有可返回的记录卡。'
      : result.matches.map((match) => {
          const canonical = match.card.canonical
          const firstSegment = deliveredAt.get(canonical)
          if (firstSegment !== undefined) return `${canonical}（已在第 ${firstSegment} 段返回，此处仅列名）`
          deliveredAt.set(canonical, segmentNumber)
          return serializeCard(match.card, {}, match.categories)
        }).join('\n\n')
    const pathText = result.paths.length > 0 ? `\n${serializeResolutionPaths(result.paths)}` : ''
    segments.push(`${header}${pathText}\n${body}`)
    for (const canonical of canonicals) {
      if (seen.has(canonical)) continue
      seen.add(canonical)
      hitIds.push(canonical)
    }
  }
  return { data: segments.join('\n\n'), hitIds, injectedIds: [...hitIds], factsItems: items }
}

/** tags 路径的反查说明；描述与完整效果等价的区别（ADR-019）。 */
const FACTS_TAG_NOTICE = '说明：同标签不等于完整效果等价；已逐条保留持有者、解锁与替换，不计算综合收益。'

/**
 * facts_search 的 tags 路径：标签 → 设施 → 技能 → grant → 干员，卡级去重后按最小设施序稳定排序。
 * 不静默 Top-N、不截断卡片：按 FACTS_TAG_PAGE_CARDS 显式分页，offset 续读；越界返回空页并明确提示。
 * complete=true 仅表示本次匹配的卡已在本页读完，不代表标签能力或来源范围穷尽。
 */
function factsSearchTagsOperation(
  parsed: ParsedToolParams,
  context: KnowledgeToolContext,
): {
  data: string
  hitIds: string[]
  injectedIds: string[]
  factsItems: FactsResolutionItem[]
  factsPage: { matchedCount: number; returnedCount: number; complete: boolean; tagPage: FactsTagPage }
} {
  const store = loadFactsStore(context)
  const entries = parsed.factsItems ?? []
  const offset = typeof parsed.value?.offset === 'number' ? parsed.value.offset : 0
  const legalTags = entries.flatMap((entry) => (entry.query === null ? [] : [entry.query]))
  const result = store.factsSearchByTags(legalTags)

  const matchedCount = result.cards.length
  const page = result.cards.slice(offset, offset + FACTS_TAG_PAGE_CARDS)
  const returnedCount = page.length
  const complete = offset + returnedCount >= matchedCount
  const nextOffset = complete ? null : offset + returnedCount
  const outOfRange = offset > matchedCount
  const tagPage: FactsTagPage = { offset, limit: FACTS_TAG_PAGE_CARDS, matchedCount, returnedCount, complete, nextOffset }

  // 逐标签记录：canonicals 取该标签命中的卡（跨标签共享卡在各标签下都保留）。
  const canonicalsForTag = (tag: string): string[] => dedupeCanonicals(
    result.cards.filter((match) => match.hits.some((hit) => hit.tag === tag)).map((match) => match.card.canonical),
  )
  const items: FactsResolutionItem[] = entries.map((entry) => {
    if (entry.query === null) {
      return { index: entry.index, query: null, status: 'invalid', paths: [], canonicals: [], message: entry.message ?? '参数错误' }
    }
    const canonicals = canonicalsForTag(entry.query)
    return {
      index: entry.index,
      query: entry.query,
      status: canonicals.length > 0 ? 'success' : 'empty',
      paths: [],
      canonicals,
      message: null,
    }
  })

  const summary = [
    `标签反查｜命中总数 ${matchedCount}`,
    `本页返回 ${returnedCount}`,
    `已覆盖全部命中卡：${complete}`,
    complete ? '无续读' : `续读 next_offset=${nextOffset}`,
  ].join('｜')
  const lines = [summary, FACTS_TAG_NOTICE]
  if (result.missingTags.length > 0) lines.push(`未收录标签：${result.missingTags.join('、')}`)
  if (outOfRange) lines.push(`offset 超出命中总数（${matchedCount}）：${offset}`)
  for (const match of page) {
    lines.push(`${serializeTagCard(match)}\n命中依据：${renderTagHitBasis(match)}`)
  }

  const hitIds = page.map((match) => match.card.canonical)
  return {
    data: lines.join('\n\n'),
    hitIds,
    injectedIds: [...hitIds],
    factsItems: items,
    factsPage: { matchedCount, returnedCount, complete, tagPage },
  }
}

/**
 * 命中设施技能前置：命中技能 → 同设施其他技能（含替换关系）→ 其他设施技能；
 * 各组内保持原卡顺序；同卡命中多个设施时这些设施都算命中设施。整卡完整返回，不裁剪。
 */
function serializeTagCard(match: TagCardMatch): string {
  const hitGrantIds = new Set(match.matchedGrantIds)
  const hitSkillKeys = new Set(match.hits.filter((hit) => hit.grantId === undefined).map((hit) => `${hit.room}\u0000${hit.skillName}`))
  const isHit = (skill: { grantId?: string; room?: string; name: string }): boolean => skill.grantId !== undefined
    ? hitGrantIds.has(skill.grantId)
    : hitSkillKeys.has(`${skill.room ?? ''}\u0000${skill.name}`)
  const hitRooms = new Set(match.hits.map((hit) => hit.room))
  const inHitRoom = (skill: { room?: string }): boolean => hitRooms.has(skill.room ?? '')
  const skills = [
    ...match.card.skills.filter(isHit),
    ...match.card.skills.filter((skill) => !isHit(skill) && inHitRoom(skill)),
    ...match.card.skills.filter((skill) => !isHit(skill) && !inHitRoom(skill)),
  ]
  return serializeCard({ ...match.card, skills }, {})
}

/** 每卡一行命中依据：标签、设施、技能名、解锁与替换。 */
function renderTagHitBasis(match: TagCardMatch): string {
  return match.hits.map((hit) => {
    const replaced = hit.replacesGrantId === undefined
      ? undefined
      : match.card.skills.find((skill) => skill.grantId === hit.replacesGrantId)?.name
    const replacement = replaced === undefined ? '' : `，替换「${replaced}」`
    return `标签「${hit.tag}」｜设施：${hit.room || '未知设施'}｜技能「${hit.skillName}」｜解锁：${hit.unlockType}${replacement}`
  }).join('；')
}

/**
 * rag_search：RAG 检索与原文扩展，并在 hybrid 下按 ADR-013 步骤 3 附加内部 facts。
 * 组装为原子过程：全部分支（含 facts store 加载与 factsSearch）算完并确认最终输出后，
 * 才更新共享送达列表并返回；任一步抛错都不留下本次未发送的注入记录。
 */
function ragSearchOperation(
  params: Record<string, unknown>,
  context: KnowledgeToolContext,
  config: BenchConfig,
): {
  data: string
  hitIds: string[]
  injectedIds: string[]
  fulltextRanges: FulltextRange[]
  attachedFacts?: AttachedFactsObservation[]
  linkedEntries?: LinkedEntryObservation[]
  status: ToolResultStatus
} {
  const query = params.query as string
  const hits = search(context.index, query, config.topK)
  const hitIds = hits.map((index) => context.chunks[index]?.id).filter((id): id is string => Boolean(id))
  const built = buildRagData(context.chunks, hits, config.maxContextChars, context.sections, config.expandFulltext, context.links)

  let attachment: FactsAttachment | undefined
  if (effectiveAttachFacts(config)) {
    const store = loadFactsStore(context)
    const triggers = recognizeEntryTriggers(store.entryDictionary, query)
    attachment = buildFactsAttachment(store, triggers, RAG_ATTACH_FACTS_QUOTA_CHARS)
  }

  for (const id of built.injectedIds) {
    if (context.injectedIds && !context.injectedIds.includes(id)) context.injectedIds.push(id)
  }
  // RAG 正文为空时不再前置分区分隔符，避免附带区开头出现空行。
  const data = attachment?.text
    ? built.data ? `${built.data}${FACTS_ATTACH_SEPARATOR}${attachment.text}` : attachment.text
    : built.data
  // 仅有命中编号但未送达任何正文证据时判空；极小上限放不下必要元数据时报容量错误。
  // RAG 与内部 facts 任一部分实际送达非空证据即计成功；提示与路径元数据本身不算证据。
  const delivered = built.delivered || Boolean(attachment?.delivered)
  const status: ToolResultStatus = built.capacityError ? 'error' : delivered ? 'success' : 'empty'
  return {
    data,
    hitIds,
    injectedIds: built.injectedIds,
    fulltextRanges: built.fulltextRanges,
    attachedFacts: attachment && attachment.observations.length > 0 ? attachment.observations : undefined,
    linkedEntries: built.linkedEntries.length > 0 ? built.linkedEntries : undefined,
    status,
  }
}

/** 取运行时 facts store；加载失败沿用工具执行错误的 fatal 语义，不静默降级，也不增加隐式重试。 */
function loadFactsStore(context: KnowledgeToolContext): CardStore {
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
  return store
}

interface RagBlock {
  chunk: DocChunk
  section?: SectionEntry
}

/** 父级引导展示上限；超出时截断并标注。 */
const PARENT_LEAD_LIMIT = 300
/** 每个命中文档的小节导航上限。 */
const NAVIGATION_LIMIT = 8

interface BuiltRagData {
  data: string
  injectedIds: string[]
  delivered: boolean
  capacityError: boolean
  fulltextRanges: FulltextRange[]
  /** 关联事实入口提示观测；无提示时为空数组。 */
  linkedEntries: LinkedEntryObservation[]
}

/**
 * 组装 RAG 命中正文（ADR-013）：
 *   - 关闭原文扩展或没有小节目录时，沿用既有「按命中块拼接 + 硬截断」行为；
 *   - 开启扩展时，base/guides 命中按文件去重并扩展到原文文档范围（运行级快照），references 仍按块返回；
 *     容量不足时按可续读的连续原文范围送达并给出元数据，极小上限放不下必要元数据时报容量错误。
 */
function buildRagData(
  chunks: DocChunk[],
  hits: number[],
  maxChars: number,
  sections: SectionDirectory | undefined,
  expandFulltext: boolean,
  links: ProseLinkIndex | undefined,
): BuiltRagData {
  const blocks: RagBlock[] = hits.map((index) => {
    const chunk = chunks[index]!
    return { chunk, section: sections?.findByChunk(chunk.file, chunk.heading, chunk.startLine) }
  })

  if (!expandFulltext || !sections) {
    return { ...buildRagDataLegacy(blocks, maxChars, sections, links), capacityError: false, fulltextRanges: [] }
  }
  return buildExpandedRagData(blocks, maxChars, sections, links)
}

/** 既有行为：按 topK 顺序拼接命中块，整段硬截断到 maxChars，再按剩余空间附加小节上下文。 */
function buildRagDataLegacy(
  blocks: RagBlock[],
  maxChars: number,
  sections: SectionDirectory | undefined,
  links: ProseLinkIndex | undefined,
): { data: string; injectedIds: string[]; delivered: boolean; linkedEntries: LinkedEntryObservation[] } {
  let body = ''
  const injectedIds: string[] = []
  for (const block of blocks) {
    const separator = body ? '\n\n' : ''
    body += `${separator}${renderRagHeader(block)}\n${block.chunk.text}`
    // 只有该块正文（头部之后的文本）至少一个字符进入送达前缀，才算正文证据真实送达。
    const textStart = body.length - block.chunk.text.length
    if (Math.min(maxChars, body.length) > textStart) injectedIds.push(block.chunk.id)
  }
  let data = body.slice(0, maxChars)
  let linkedEntries: LinkedEntryObservation[] = []
  if (sections && data.length < maxChars && blocks.some((block) => block.section)) {
    const context = buildSectionContext(sections, blocks, new Set(injectedIds), links)
    data = appendSectionContext(data, context.lines, maxChars)
    linkedEntries = observeLinkedEntries(context.offers, data)
  }
  return { data, injectedIds, delivered: injectedIds.length > 0, linkedEntries }
}

type FulltextBlockAddition =
  | { kind: 'complete' | 'partial'; text: string; range: FulltextRange }
  | { kind: 'tooSmall' }

/** base/guides 命中扩展到整篇原文；放不下时按行边界送达可续读前缀，再放不下则停在此块。 */
function buildExpandedRagData(blocks: RagBlock[], maxChars: number, sections: SectionDirectory, links: ProseLinkIndex | undefined): BuiltRagData {
  let body = ''
  const injectedIds: string[] = []
  const fulltextRanges: FulltextRange[] = []
  const deliveredFiles = new Set<string>()
  let stopped = false
  let capacityError = false

  for (const block of blocks) {
    if (stopped) break
    const separator = body ? '\n\n' : ''
    const doc = isFulltextFile(block.chunk.file) ? sections.documentRange(block.chunk.file) : undefined
    if (doc) {
      // 同文件多命中去重：只按首次命中位置送达一次整篇原文。
      if (deliveredFiles.has(block.chunk.file)) continue
      const addition = appendFulltextBlock(body, separator, doc, maxChars)
      if (addition.kind === 'tooSmall') {
        if (body.length === 0) {
          // 极小上限：连必要元数据加一个正文字符都放不下 → 明确容量错误，不伪装 empty 或扩容。
          capacityError = true
          body = renderFulltextCapacityError(doc.file, maxChars)
        } else {
          stopped = true
        }
        break
      }
      body = addition.text
      deliveredFiles.add(block.chunk.file)
      injectedIds.push(block.chunk.id)
      fulltextRanges.push(addition.range)
      if (addition.kind === 'partial') stopped = true
      continue
    }
    // references（或无文档范围）：沿用原块，按行边界送达；放不下即停止，不伪造后续证据。
    const header = renderRagHeader(block)
    const room = maxChars - body.length - separator.length - header.length - 1
    if (room <= 0) { stopped = true; break }
    const page = block.chunk.text.length <= room ? block.chunk.text : safeCutAtLine(block.chunk.text.slice(0, room))
    if (page.length === 0) { stopped = true; break }
    body += `${separator}${header}\n${page}`
    injectedIds.push(block.chunk.id)
    if (page.length < block.chunk.text.length) stopped = true
  }

  let data = body
  let linkedEntries: LinkedEntryObservation[] = []
  if (!stopped && !capacityError && data.length < maxChars && blocks.some((block) => block.section)) {
    const context = buildSectionContext(sections, blocks, new Set(injectedIds), links)
    data = appendSectionContext(data, context.lines, maxChars)
    linkedEntries = observeLinkedEntries(context.offers, data)
  }
  return { data, injectedIds, delivered: injectedIds.length > 0, capacityError, fulltextRanges, linkedEntries }
}

/** 单个文档范围的送达：整篇放得下则 complete，否则元数据先留位、按行边界送达可续读前缀。 */
function appendFulltextBlock(body: string, separator: string, doc: SectionEntry, maxChars: number): FulltextBlockAddition {
  const header = `【${doc.file}｜原文扩展｜L${doc.startLine}-${doc.endLine}】`
  const prefix = `${separator}${header}\n`
  const remaining = maxChars - body.length - prefix.length
  if (remaining >= doc.body.length) {
    return {
      kind: 'complete',
      text: `${body}${prefix}${doc.body}`,
      range: {
        file: doc.file,
        docId: doc.sectionId,
        offset: 0,
        endOffset: doc.body.length,
        startLine: doc.startLine,
        endLine: doc.endLine,
        complete: true,
        nextOffset: null,
      },
    }
  }
  // 元数据先留位：用最长可能的 next_offset 估计其长度，实际元数据不会超过预留。
  const metaReserve = renderFulltextContinuation(doc, 0, doc.body.length, doc.body.length).length
  const room = remaining - metaReserve - 1
  if (room < 1) return { kind: 'tooSmall' }
  const page = safeCutAtLine(doc.body.slice(0, room))
  if (page.length === 0) return { kind: 'tooSmall' }
  const nextOffset = page.length
  const meta = renderFulltextContinuation(doc, 0, nextOffset, doc.body.length)
  const endLine = doc.startLine + countNewlines(page)
  return {
    kind: 'partial',
    text: `${body}${prefix}${page}\n${meta}`,
    range: {
      file: doc.file,
      docId: doc.sectionId,
      offset: 0,
      endOffset: nextOffset,
      startLine: doc.startLine,
      endLine,
      complete: false,
      nextOffset,
    },
  }
}

/** 续读元数据行；含可复用文档范围 ID，可用 read_section(section_id=ID, offset=next_offset) 续读。 */
function renderFulltextContinuation(doc: SectionEntry, offset: number, nextOffset: number, totalChars: number): string {
  return `续读：ID ${doc.sectionId}｜offset ${offset}｜next_offset ${nextOffset}｜complete false｜正文 ${totalChars} 字符`
}

function renderFulltextCapacityError(file: string, maxChars: number): string {
  return `rag_search 无法在 maxContextChars=${maxChars} 内返回原文扩展（必要元数据放不下）：${file}。请提高 maxContextChars 后重试。`
}

/** 行边界截断，并避免截断 UTF-16 代理对（非 BMP 字符）。 */
function safeCutAtLine(text: string): string {
  const cut = cutAtLine(text)
  if (cut.length === 0) return cut
  const last = cut.charCodeAt(cut.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

// ── RAG 内部 facts 附带（ADR-013 步骤 3） ─────────────────────────────

/** 多关键词分支准入类别：≥2 字的干员名、技能名、技能组、阵营（入口规则 5）。 */
const MULTI_TERM_CATEGORIES: ReadonlySet<FactsMatchCategory> = new Set(['operator', 'skill', 'skillGroup', 'faction'])

/** 完整词边界判定：字符串首尾或 JavaScript \s 空白（入口规则 4）。 */
function isEntryBoundary(ch: string | undefined): boolean {
  return ch === undefined || /\s/.test(ch)
}

/** 识别到的完整登记触发词及其在原 query 中的 UTF-16 区间。 */
export interface EntryTrigger {
  term: string
  /** 传入 query 中的起点（识别函数按未 trim 输入校正首尾空白偏移）。 */
  start: number
  /** 传入 query 中的终点（不含）。 */
  end: number
}

/**
 * 识别 rag_search 的 query 中可触发内部 facts 查询的完整登记词（ADR-013 步骤 3 入口规则）。
 *
 * 规则 3：只 trim 首尾后整条精确匹配优先，任意类别与单字正式名均可触发；成立即不扫描内部短词。
 * 规则 4：否则按空白边界从左到右取最长登记完整词；已消费范围不重复触发，非重叠词按出现顺序去重。
 * 规则 5：多关键词分支只接纳 ≥2 字的干员/技能/技能组/阵营或任一人工作入口；未准入也不拆其内部短词。
 * 规则 6：不解析未分隔自然句，不把逗号/加号当分隔符，不做近义改写或任意子串扫描。
 * 只使用只读词典做候选识别，不对未准入词执行任何 factsSearch。
 */
export function recognizeEntryTriggers(dictionary: FactsEntryDictionary, query: string): EntryTrigger[] {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []
  const first = query.length - query.trimStart().length
  const last = query.trimEnd().length
  if (dictionary.terms.has(trimmed)) return [{ term: trimmed, start: first, end: last }]

  const triggers: EntryTrigger[] = []
  const seen = new Set<string>()
  let i = first
  while (i < last) {
    if (i === first || isEntryBoundary(query[i - 1])) {
      const term = longestEntryAt(dictionary, query, i, last)
      if (term !== undefined) {
        // 同起点先按长度确定完整词边界；未准入也不拆其内部短词，整体跳过。
        if (!seen.has(term) && isAdmittedMultiTerm(dictionary, term)) {
          seen.add(term)
          triggers.push({ term, start: i, end: i + term.length })
        }
        i += term.length
        continue
      }
    }
    i++
  }
  return triggers
}

/** 从 i 起、以 trimmed 末尾或 \s 空白结尾的最长登记词；无则 undefined（同起点按长度取最长）。 */
function longestEntryAt(dictionary: FactsEntryDictionary, query: string, i: number, last: number): string | undefined {
  let best: string | undefined
  for (const term of dictionary.terms) {
    if (best !== undefined && term.length <= best.length) continue
    const end = i + term.length
    if (end > last || !query.startsWith(term, i)) continue
    if (end === last || isEntryBoundary(query[end])) best = term
  }
  return best
}

/** 规则 5：多关键词分支只接纳 ≥2 字的干员/技能/技能组/阵营，或任一人工登记入口。 */
function isAdmittedMultiTerm(dictionary: FactsEntryDictionary, term: string): boolean {
  if (term.length < 2) return false
  if (dictionary.isCuratedEntry(term)) return true
  return dictionary.categoriesOf(term).some((category) => MULTI_TERM_CATEGORIES.has(category))
}

const FACTS_ATTACH_HEADER = '【RAG 附带事实卡｜hybrid 自动附带】'
/** 附带分区与 RAG 正文之间的分隔符；计入 facts 额度，保证合并 data 不超过 maxContextChars + 额度。 */
const FACTS_ATTACH_SEPARATOR = '\n\n'

interface FactsAttachment {
  /** 附带分区正文；无触发词或额度放不下分区头时为空字符串。 */
  text: string
  observations: AttachedFactsObservation[]
  deliveredCanonicals: string[]
  delivered: boolean
}

/**
 * 组装 RAG 内部 facts 附带（ADR-013 决策 4）：以单个触发词的完整匹配集合为原子单位，
 * 整组放入剩余额度才附带；放不下整组不附带并返回可复制的词条与原因；卡正文按 canonical 跨词去重。
 */
export function buildFactsAttachment(store: CardStore, triggers: readonly EntryTrigger[], quota: number): FactsAttachment {
  const observations: AttachedFactsObservation[] = []
  const deliveredCanonicals: string[] = []
  // 额度含分区前分隔符：attachment.text 以分区头开头，拼接进 RAG data 时另加同样长度的分隔符。
  const budget = quota - FACTS_ATTACH_SEPARATOR.length
  if (triggers.length === 0 || budget <= FACTS_ATTACH_HEADER.length) {
    return { text: '', observations, deliveredCanonicals, delivered: false }
  }
  const deliveredSet = new Set<string>()
  let text = FACTS_ATTACH_HEADER
  for (const trigger of triggers) {
    const started = Date.now()
    const result = store.factsSearch(trigger.term)
    const elapsedMs = Date.now() - started
    const matched = dedupeCanonicals(result.matches.map((match) => match.card.canonical))
    if (matched.length === 0) {
      observations.push({ ...trigger, paths: result.paths, matched, delivered: [], omittedReason: '未命中登记卡', chars: 0, elapsedMs })
      continue
    }
    // 跨词已送达的共享卡不再重复渲染，但该词自身成员与路径未齐时不标记完整。
    const newMatches = result.matches.filter((match) => !deliveredSet.has(match.card.canonical))
    const block = renderAttachedWordBlock(trigger.term, result.paths, matched.length, newMatches)
    if (text.length + FACTS_ATTACH_SEPARATOR.length + block.length <= budget) {
      text += `${FACTS_ATTACH_SEPARATOR}${block}`
      for (const match of newMatches) {
        if (deliveredSet.has(match.card.canonical)) continue
        deliveredSet.add(match.card.canonical)
        deliveredCanonicals.push(match.card.canonical)
      }
      observations.push({ ...trigger, paths: result.paths, matched, delivered: [...matched], omittedReason: null, chars: block.length, elapsedMs })
      continue
    }
    const remaining = budget - text.length
    const omission = renderOmittedWordLine(trigger.term, matched.length, block.length, remaining)
    // 提示行也放不下时不写入；chars 只记实际写入的字符数，避免虚报附带量。
    const omissionWritten = text.length + 1 + omission.length <= budget
    if (omissionWritten) text += `\n${omission}`
    observations.push({
      ...trigger,
      paths: result.paths,
      matched,
      delivered: [],
      omittedReason: `整组 ${block.length} 字符未放入剩余附带额度 ${remaining}`,
      chars: omissionWritten ? omission.length : 0,
      elapsedMs,
    })
  }
  // 连未附带提示都放不下时不写入只含分区头的截断词条，避免制造无内容的分区。
  if (text === FACTS_ATTACH_HEADER) return { text: '', observations, deliveredCanonicals, delivered: deliveredCanonicals.length > 0 }
  return { text, observations, deliveredCanonicals, delivered: deliveredCanonicals.length > 0 }
}

/** 附带块：触发词行 + 该词解析路径；正文只渲染本次尚未送达（含跨词共享）的新卡。 */
function renderAttachedWordBlock(
  term: string,
  paths: readonly ResolutionPath[],
  matchedCount: number,
  newMatches: readonly FactsMatch[],
): string {
  const lines = [`- 触发词：${term}｜命中 ${matchedCount} 张记录卡｜已附带（本次新增 ${newMatches.length} 张）`]
  if (paths.length > 0) lines.push(indentBlock(serializeResolutionPaths(paths)))
  const cards = newMatches.map((match) => serializeCard(match.card, {}, match.categories)).join('\n\n')
  return cards ? `${lines.join('\n')}\n\n${cards}` : lines.join('\n')
}

/** 未附带提示行：完整可复制的词条与原因（整组所需与剩余额度），供必要时显式 facts_search。 */
function renderOmittedWordLine(term: string, matchedCount: number, groupChars: number, remaining: number): string {
  return `- 触发词：${term}｜命中 ${matchedCount} 张记录卡｜未附带：整组 ${groupChars} 字符未放入剩余附带额度 ${remaining}；如需请显式 facts_search。`
}

function indentBlock(text: string): string {
  return text.split('\n').map((line) => `  ${line}`).join('\n')
}

function dedupeCanonicals(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

/** 来源头保持既有格式；新增小节信息一律放到正文之后，只用剩余预算，避免挤占原正文送达。 */
function renderRagHeader(block: RagBlock): string {
  const { chunk } = block
  return `【${chunk.file} | ${chunk.heading} | L${chunk.startLine}-${chunk.endLine}】`
}

/** 含可调用小节 ID 的行必须整行放入；空间不足时省略，绝不输出被截断的 ID。 */
interface SectionContextLine {
  text: string
  atomic?: boolean
}

/** 一条关联事实入口提示：记录可复制的整行文本，供送达观测按行核对是否实际写入。 */
interface LinkedOffer {
  sectionId: string
  file: string
  objectCount: number
  line: string
}

/** 关联事实入口行：完整可复制 ID、文件、标题路径与对象数。 */
function renderLinkedEntryLine(link: ResolvedProseLink): string {
  const path = link.headingPath.length > 0 ? link.headingPath.join(' > ') : '（文档根节点）'
  return `- ${link.sectionId}｜${link.file}｜标题路径：${path}｜关联 ${link.objects.length} 个对象`
}

/** 提示行按整行是否出现在最终正文判定 written，避免把「已生成」误当「已送达」。 */
function observeLinkedEntries(offers: readonly LinkedOffer[], data: string): LinkedEntryObservation[] {
  return offers.map((offer) => ({
    sectionId: offer.sectionId,
    file: offer.file,
    objectCount: offer.objectCount,
    written: data.includes(offer.line),
  }))
}

/**
 * 组装小节上下文，顺序固定为：当前小节标识 → 上级范围入口 → 既有父级引导 → 兄弟导航 → 关联事实入口。
 * 上级范围入口只针对实际送达的命中小节，复用 parentId/get，不虚造无父级入口；
 * 关联事实入口只列出命中小节所属文件中登记了非空关联的小节，仅导航、不返回事实，且只用既有上下文之后的剩余预算。
 */
function buildSectionContext(
  sections: SectionDirectory,
  blocks: RagBlock[],
  delivered: Set<string>,
  links: ProseLinkIndex | undefined,
): { lines: SectionContextLine[]; offers: LinkedOffer[] } {
  const unique: Array<{ block: RagBlock; section: SectionEntry }> = []
  const seenSections = new Set<string>()
  for (const block of blocks) {
    const section = block.section
    if (!section || seenSections.has(section.sectionId)) continue
    seenSections.add(section.sectionId)
    unique.push({ block, section })
  }

  const lines: SectionContextLine[] = [{ text: '【小节上下文】' }]
  for (const { block, section } of unique) {
    const context = sections.contextFor(section.sectionId)
    const path = context && context.headingPath.length > 0 ? context.headingPath.join(' > ') : '（文档根节点）'
    lines.push({ text: `- ${section.sectionId}｜${block.chunk.file}｜标题路径：${path}`, atomic: true })
  }

  const parentLines: SectionContextLine[] = []
  const seenParents = new Set<string>()
  for (const { block, section } of unique) {
    if (!delivered.has(block.chunk.id) || !section.parentId || seenParents.has(section.parentId)) continue
    const parent = sections.get(section.parentId)
    if (!parent) continue
    seenParents.add(parent.sectionId)
    parentLines.push({ text: renderParentRangeEntry(parent), atomic: true })
  }
  if (parentLines.length > 0) {
    lines.push({ text: '【上级范围入口】以下为包含下级小节的原文范围，不等同于符合问题条件的完整答案集。' })
    lines.push(...parentLines)
  }

  for (const { section } of unique) {
    const context = sections.contextFor(section.sectionId)
    if (context?.parentLead) {
      lines.push({ text: `  父级引导（L${context.parentLead.startLine}-${context.parentLead.endLine}）：${truncateLead(context.parentLead.text)}` })
    }
  }

  for (const file of [...new Set(unique.map(({ block }) => block.chunk.file))]) {
    const first = unique.find(({ block }) => block.chunk.file === file)
    if (!first) continue
    const navigation = sections.navigationFor(first.section.sectionId, NAVIGATION_LIMIT)
    lines.push({ text: `【小节导航】${file}` })
    for (const item of navigation.items) lines.push({ text: `- ${item.sectionId}｜${item.heading}`, atomic: true })
    if (navigation.omitted > 0) lines.push({ text: `（省略 ${navigation.omitted} 项）` })
  }

  // 关联事实入口（ADR-020 决策 3）：按命中文件列出登记了非空关联的小节，逐小节给出可复制 ID；
  // 仅导航，不自动返回关联事实，也不并入命中小节。放在既有上下文之后，只用剩余预算。
  const offers: LinkedOffer[] = []
  if (links) {
    const offerLines: SectionContextLine[] = []
    for (const file of [...new Set(unique.map(({ block }) => block.chunk.file))]) {
      for (const link of links.links) {
        if (link.file !== file || link.objects.length === 0) continue
        const line = renderLinkedEntryLine(link)
        offerLines.push({ text: line, atomic: true })
        offers.push({ sectionId: link.sectionId, file: link.file, objectCount: link.objects.length, line })
      }
    }
    if (offerLines.length > 0) {
      lines.push({ text: '【关联事实入口】以下小节登记了可展开的关联事实；提示只做导航，用 read_section 的 linked 选择展开：' })
      lines.push(...offerLines)
    }
  }

  return { lines, offers }
}

/** 上级范围入口行：完整可复制 ID、文件、标题路径与正文 UTF-16 字符数。 */
function renderParentRangeEntry(parent: SectionEntry): string {
  const path = parent.level === 0 ? '（文档根节点）' : [...parent.ancestors, parent.heading].join(' > ')
  return `- ${parent.sectionId}｜${parent.file}｜标题路径：${path}｜正文 ${parent.body.length} 字符`
}

function truncateLead(text: string): string {
  return text.length <= PARENT_LEAD_LIMIT ? text : `${text.slice(0, PARENT_LEAD_LIMIT)}…（截断）`
}

/** 按行追加小节上下文；含 ID 的行只整行放入或省略，普通引导文字仍按既有方式截断。 */
function appendSectionContext(data: string, lines: SectionContextLine[], maxChars: number): string {
  let out = data
  lines.forEach((line, index) => {
    if (out.length >= maxChars) return
    const separator = index === 0 ? '\n\n' : '\n'
    if (out.length + separator.length + line.text.length <= maxChars) {
      out += `${separator}${line.text}`
      return
    }
    if (line.atomic) return
    const marker = '…（截断）'
    const room = maxChars - out.length - separator.length - marker.length
    if (room > 0) out += `${separator}${line.text.slice(0, room)}${marker}`
  })
  return out
}

/** 单次 read_section 的正文页上限（UTF-16 字符）。 */
const READ_SECTION_PAGE_CHARS = 6000

function readSectionOperation(
  params: Record<string, unknown>,
  context: KnowledgeToolContext,
  config: BenchConfig,
): { data: string; hitIds: string[]; injectedIds: string[]; status: ToolResultStatus; linkedFacts?: LinkedFactsObservation } {
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
  if (params.linked === true) return readLinkedFactsOperation(section, context)
  if (offset > section.body.length) {
    return {
      data: `read_section 的 offset 超出小节正文长度（${section.body.length}）：${offset}`,
      hitIds: [],
      injectedIds: [],
      status: 'invalid_params',
    }
  }
  const remaining = section.body.length - offset
  const metaLength = sectionMetaLength(section, offset)
  // 元数据无法容纳，或剩余正文连一个字符都放不下时，明确报错，不静默放宽上限。
  if (metaLength > config.maxContextChars || (remaining > 0 && metaLength + 1 > config.maxContextChars)) {
    return {
      data: `read_section 无法在 maxContextChars=${config.maxContextChars} 内返回正文：分页元数据已占约 ${metaLength} 字符。请提高 maxContextChars 后重试。`,
      hitIds: [],
      injectedIds: [],
      status: 'error',
    }
  }
  // 末尾读取（offset 恰等于正文长度）或空小节正文只返回分页元数据，按非空证据判定为 empty，不扣成功额度。
  return {
    data: renderSectionPage(section, offset, config.maxContextChars, directory),
    hitIds: [],
    injectedIds: [],
    status: remaining > 0 ? 'success' : 'empty',
  }
}

/**
 * read_section 的 linked 展开（ADR-020 决策 4）：直接按人工登记引用读取记录卡，
 * 不经过别名、子串或同名全部返回入口，也不递归扩大对象集合；返回范围即登记对象。
 * 校验不扩展到散文数值抽取、阈值与练度断言。
 * TODO(tech-debt) PLK-1：关联载荷首版不设分页或截断（plan 非目标），结果体积可能超过 maxContextChars；
 * 重启条件：引入分页或体积优化时须同时重定义 complete 与命中/送达口径。
 */
function readLinkedFactsOperation(
  section: SectionEntry,
  context: KnowledgeToolContext,
): { data: string; hitIds: string[]; injectedIds: string[]; status: ToolResultStatus; linkedFacts: LinkedFactsObservation } {
  const link = context.links?.bySection.get(section.sectionId)
  if (!link || link.objects.length === 0) {
    return {
      data: `该小节没有登记可展开的关联事实：${section.sectionId}。不会改为模糊搜索或别名展开。`,
      hitIds: [],
      injectedIds: [],
      status: 'empty',
      linkedFacts: { sectionId: section.sectionId, requested: [], delivered: [], omitted: [] },
    }
  }

  const store = loadFactsStore(context)
  const requested: string[] = []
  const delivered: string[] = []
  const omitted: Array<{ ref: string; reason: string }> = []
  const cards: RecordCard[] = []
  const seen = new Set<string>()
  const refLines: string[] = []
  for (const object of link.objects) {
    requested.push(object.ref)
    if (seen.has(object.canonical)) {
      refLines.push(`- ${object.ref}（与已返回卡同卡，去重）`)
      continue
    }
    const card = store.byCanonical.get(object.canonical)
    if (!card) {
      omitted.push({ ref: object.ref, reason: '记录卡未找到' })
      continue
    }
    seen.add(object.canonical)
    delivered.push(object.canonical)
    cards.push(card)
    refLines.push(`- ${object.ref} → ${object.canonical}`)
  }

  const path = section.level === 0 ? '（文档根节点）' : [...section.ancestors, section.heading].join(' > ')
  const lines = [
    `【read_section｜关联事实】${section.sectionId}`,
    `标题路径：${path}`,
    `关联对象：${requested.length} 个｜已返回记录卡：${delivered.length} 张`,
    '说明：直接按人工登记引用读取，不经过别名、子串或同名集合扩展；范围即登记对象。',
    ...refLines,
  ]
  if (omitted.length > 0) lines.push(`未返回：${omitted.map((item) => `${item.ref}（${item.reason}）`).join('；')}`)
  const body = cards.map((card) => serializeCard(card, {})).join('\n\n')
  return {
    data: body ? `${lines.join('\n')}\n\n${body}` : lines.join('\n'),
    hitIds: delivered,
    injectedIds: [...delivered],
    status: delivered.length > 0 ? 'success' : 'empty',
    linkedFacts: { sectionId: section.sectionId, requested, delivered, omitted },
  }
}

/** 分页元数据（含与正文之间的空行）的保守长度，用于先扣除元数据预算。 */
function sectionMetaLength(section: SectionEntry, offset: number): number {
  return sectionMetaPrefix(section, offset, '', Number.MAX_SAFE_INTEGER, false).length + 2
}

/** 固定格式的分页元数据；正文页决定实际行范围。 */
function sectionMetaPrefix(
  section: SectionEntry,
  offset: number,
  page: string,
  nextOffset: number | null,
  complete: boolean,
): string {
  const path = section.level === 0 ? '（文档根节点）' : [...section.ancestors, section.heading].join(' > ')
  const startLine = section.startLine + countNewlines(section.body.slice(0, offset))
  const endLine = page.length === 0 ? startLine - 1 : startLine + countNewlines(page)
  return [
    `【read_section】${section.sectionId}`,
    `标题路径：${path}`,
    `行范围：L${startLine}-${endLine}｜offset：${offset}｜next_offset：${nextOffset === null ? 'null' : nextOffset}｜complete：${complete}`,
  ].join('\n')
}

/** 渲染一页原文；元数据先占预算，必要时在行边界缩短，保证可续读且不丢中段。 */
function renderSectionPage(section: SectionEntry, offset: number, maxContextChars: number, directory?: SectionDirectory): string {
  const remaining = section.body.length - offset
  const budget = Math.min(READ_SECTION_PAGE_CHARS, remaining, Math.max(0, maxContextChars - sectionMetaLength(section, offset)))
  let page = section.body.slice(offset, offset + budget)
  if (offset + page.length < section.body.length) page = cutAtLine(page)
  const nextOffset = offset + page.length
  const complete = nextOffset >= section.body.length
  const core = `${sectionMetaPrefix(section, offset, page, complete ? null : nextOffset, complete)}\n\n${page}`
  const parentLine = renderSectionParentLine(section, directory)
  // 先按原算法确定正文页、next_offset 与 complete；仅在剩余空间足够时附加完整父级行，不重切正文。
  if (!parentLine || core.length + 1 + parentLine.length > maxContextChars) return core
  const separator = core.indexOf('\n\n')
  return separator < 0 ? `${core}\n${parentLine}` : `${core.slice(0, separator)}\n${parentLine}${core.slice(separator)}`
}

/** 直接父级行：完整 ID、文件、标题路径与正文长度；无父级返回 null，不虚造。 */
function renderSectionParentLine(section: SectionEntry, directory?: SectionDirectory): string | null {
  if (!directory || !section.parentId) return null
  const parent = directory.get(section.parentId)
  if (!parent) return null
  const path = parent.level === 0 ? '（文档根节点）' : [...parent.ancestors, parent.heading].join(' > ')
  return `父级范围：${parent.sectionId}｜${parent.file}｜标题路径：${path}｜正文 ${parent.body.length} 字符（包含下级小节的原文范围）`
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
