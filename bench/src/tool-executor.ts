/**
 * 独立函数工具 schema 与按批次预算执行器。
 * 工具函数名直接完成路由；执行器仍共用一套预算、校验和底层检索门面。
 */
import type { AttachedFactsObservation, FragmentRange, FulltextRange, LinkedEntryObservation, ReadDeliveryRecord } from './delivery.js'
export type { AttachedFactsObservation, FragmentRange, FulltextRange, LinkedEntryObservation, ReadDeliveryRecord } from './delivery.js'
import { createHash } from 'node:crypto'
import { effectiveAttachFacts, loadConfig, type BenchConfig, type RetrieverId } from './config.js'
import { isFulltextFile } from './corpus.js'
import { search, type IndexEntry } from './retriever.js'
import { readObjectsFor, type ProseLinkIndex } from './prose-links.js'
import { buildReadPage, type ReadPageDelivery } from './read.js'
import type { SectionDirectory, SectionEntry } from './sections.js'
import { isFactTool, type BenchQuery, type DocChunk, type ToolCall } from './types.js'
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
export type CurrentToolId = 'rag_search' | 'facts_search' | 'read'

/** 工具定义（含描述）变化时递增；快照保留该值供对照分组，指纹随描述变化。 */
export const TOOL_SCHEMA_VERSION = 15 as const

/** 旧原文读取工具名退役提示（ADR-022 决策 1）：按未知工具拒绝，不静默改译。 */
export const RETIRED_READ_SECTION_MESSAGE = 'read_section 已退役；请改用 read（参数：section_id、offset、facts_offset），原文与关联事实在同一次读取中返回；本次调用未执行。'
const RETIRED_READ_SECTION_TOOL = 'read_section'

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

/** facts 结果卡版本：v8 起卡面渲染作用产物/作用职业/引用术语、原始注记与同描述依据（ADR-021 决策 3、4）。 */
export const FACTS_RESULT_VERSION = 8 as const

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
  /** rag_search 命中块与父级引导的连续正文片段（ADR-022 决策 7）；全文扩展模式为空数组。 */
  fragmentRanges?: FragmentRange[]
  /** rag_search 内部 facts 附带的触发/匹配/送达观测；无触发词时为 undefined。 */
  attachedFacts?: AttachedFactsObservation[]
  /** rag_search 关联事实入口提示观测（ADR-020）；无提示时省略。 */
  linkedEntries?: LinkedEntryObservation[]
  /** read 的单次送达台账（ADR-022 决策 6）；非 read 调用或未识别时省略。 */
  readDelivery?: ReadDeliveryRecord
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
  /** 运行级原文小节目录；仅开放阅读能力的模式提供，用于展示上下文与 read。 */
  sections?: SectionDirectory
  /** 运行级散文小节关联索引；提供时 rag_search 给出可展开入口，read 按该索引返回登记事实。 */
  links?: ProseLinkIndex
  /** 由 Agent 共享的全题注入去重列表。 */
  injectedIds?: string[]
  /** 仅在 facts 工具实际取得 store 后通知 runner；不主动触发惰性加载。 */
  onFactsStoreUsed?: (store: CardStore) => void
  /** facts store 加载失败时通知 runner，随后继续抛出原错误。 */
  onFactsStoreLoadFailed?: (error: unknown) => void
  /**
   * 运行级 facts 卡片快照提供者（ADR-022 决策 6）：由 runner 装配并注入，
   * 供 facts 工具与 read 共用同一份实例；缺省时按模块级单例惰性加载。
   */
  factsStore?: () => CardStore
}

export interface KnowledgeToolExecutor {
  executeStep(calls: ToolCall[]): Promise<ToolBatchResult>
  snapshot(): ToolBudgetState
}

const SUCCESS_BUDGET_HINT = '工具成功额度已用尽，请依据已有证据作答；未覆盖部分明确说明。'
const ATTEMPT_BUDGET_HINT = '工具获准尝试次数已用尽，请依据已有证据作答；未覆盖部分明确说明。'

type JsonObject = Record<string, unknown>

/** 与配置无关的静态工具定义；facts_search 的 maxItems 由配置上限派生，见 factsSearchDefinition。 */
const STATIC_TOOL_DEFINITIONS: Record<'rag_search' | 'read', JsonObject> = {
  rag_search: {
    type: 'function',
    function: {
      name: 'rag_search',
      description: '检索机制、组合、排班及培养建议，返回知识库片段或原文范围。结果可含供 read 使用的小节或范围 ID、分页信息及上级范围入口；登记了关联事实的小节会给出可展开入口（仅导航，不返回事实）；hybrid 模式还可能返回附带事实卡或未附带提示，以实际返回内容为准。',
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
  read: {
    type: 'function',
    function: {
      name: 'read',
      description: '按已返回的 ID 读取知识库原文与明确登记关联的事实，两者各有独立偏移、可分别分段续读；ID 可来自检索结果、分页信息或上级范围入口。offset 续读原文正文，facts_offset 续读关联事实；返回的 complete=false 表示该范围还有后续页，complete=true 仅表示该范围读完，不表示问题已完整解决。',
      parameters: {
        type: 'object',
        properties: {
          section_id: { type: 'string', minLength: 1, description: '工具结果已给出的小节或范围 ID，原样使用。' },
          offset: { type: 'integer', minimum: 0, description: '可选，原文正文 UTF-16 索引，默认 0；用返回的 next_offset 续读' },
          facts_offset: { type: 'integer', minimum: 0, description: '可选，关联事实对象序号，默认 0；用返回的 next_facts_offset 续读' },
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
    ? ['rag_search', 'facts_search', 'read']
    : ['rag_search', 'read']
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
    // 被拒绝的 read 没有解析参数也不进入执行：仍按契约留下 sectionId=null 的不可送达台账（ADR-022 决策 6）。
    ...(call.name === 'read'
      ? {
          readDelivery: {
            callId: call.id,
            status: 'budget_exhausted',
            sectionId: null,
            factsResultVersion: FACTS_RESULT_VERSION,
            resultChars: message.length,
          },
        }
      : {}),
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
  // 旧原文读取工具名按未知工具规则拒绝并给出新工具名；不静默改译，也不记为新 read 台账。
  if (call.name === RETIRED_READ_SECTION_TOOL) {
    return result(call, call.name, 'unknown_operation', false, RETIRED_READ_SECTION_MESSAGE, state)
  }
  if (!allowed.has(call.name as CurrentToolId)) {
    return result(call, call.name, 'unknown_operation', false, `当前检索模式不开放工具：${call.name}`, state)
  }
  const parsed = parseToolParams(call.name as CurrentToolId, call.arguments, config.factsQueryListLimit)
  if (!parsed.value) {
    return result(
      call,
      call.name,
      'invalid_params',
      false,
      parsed.reason,
      state,
      undefined,
      false,
      readDeliveryFor(call, 'invalid_params', parsed.readSectionId ?? null, undefined, parsed.reason.length),
    )
  }

  try {
    const output = runOperation(call.name as CurrentToolId, parsed, context, config)
    const status: ToolResultStatus = output.status
      ?? (isFactTool(call.name)
        ? output.hitIds.length > 0 ? 'success' : 'empty'
        : output.data ? 'success' : 'empty')
    // 上下文相关的参数错误（如 read 越界 offset）不计入已执行，但仍占用一次获准 attempt。
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
    const data = output.data || '（无匹配结果）'
    const readDelivery = call.name === 'read'
      ? readDeliveryFor(call, status, parsed.value.section_id as string, output.readDelivery, data.length)
      : undefined
    return {
      callId: call.id,
      operation: call.name,
      status,
      executed,
      data,
      budgetRemaining: state.remaining,
      actualParams: parsed.value,
      hitIds: output.hitIds,
      injectedIds: output.injectedIds,
      fulltextRanges: output.fulltextRanges,
      fragmentRanges: output.fragmentRanges,
      attachedFacts: output.attachedFacts,
      linkedEntries: output.linkedEntries,
      readDelivery,
      factsResult,
      ...(output.fatal === undefined ? {} : { fatal: output.fatal }),
      // 操作返回的 error 带上文本供 trace.error 定位；容量错误非 fatal，加载或投影异常保留 fatal。
      ...(status === 'error' ? { message: output.data } : {}),
    }
  } catch (error) {
    state.executed++
    const message = error instanceof Error ? error.message : String(error)
    return result(
      call,
      call.name,
      'error',
      true,
      message,
      state,
      parsed.value,
      true,
      readDeliveryFor(call, 'error', parsed.value.section_id as string, undefined, message.length),
    )
  }
}

/**
 * read 台账（ADR-022 决策 6）：只有识别到的新 read 调用才记录；失败在送达前不写实际范围，
 * resultChars 取最终回写文本长度。旧 read_section 调用不进入本台账。
 */
function readDeliveryFor(
  call: ToolCall,
  status: ToolResultStatus,
  sectionId: string | null,
  observed: ReadPageDelivery | undefined,
  resultChars: number,
): ReadDeliveryRecord | undefined {
  if (call.name !== 'read') return undefined
  return {
    callId: call.id,
    status,
    sectionId,
    factsResultVersion: FACTS_RESULT_VERSION,
    ...(observed?.bodyRange === undefined ? {} : { bodyRange: observed.bodyRange }),
    ...(observed?.factsPage === undefined ? {} : { factsPage: observed.factsPage }),
    ...(observed?.deliveredObjects === undefined ? {} : { deliveredObjects: observed.deliveredObjects }),
    resultChars,
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
  readDelivery?: ReadDeliveryRecord,
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
    ...(readDelivery === undefined ? {} : { readDelivery }),
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
  /** read 专用：参数整体非法时仍可识别的 section_id；无法识别为 null。 */
  readSectionId?: string | null
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

  if (tool === 'read') return parseReadParams(raw, exampleFor(tool))
  if (tool === 'facts_search') return parseFactsParams(raw, factsQueryListLimit, exampleFor(tool))

  const allowedKeys = ['query']
  const unknownKey = Object.keys(raw).find((key) => !allowedKeys.includes(key))
  if (unknownKey !== undefined) return { reason: `${tool} 不支持参数字段 ${unknownKey}；参数示例：${exampleFor(tool)}` }

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
  if (unknownKey !== undefined) return { reason: `facts_search 不支持参数字段 ${unknownKey}；参数示例：${example}` }

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

/**
 * read 参数：section_id 必填非空字符串，offset 与 facts_offset 可选非负安全整数，额外字段（含旧 linked）拒绝。
 * 参数整体非法时仍尽力识别 section_id，供 readDelivery 记录；不因任何非法参数执行读取。
 */
function parseReadParams(
  input: JsonObject,
  example: string,
): ParsedToolParams {
  const sectionId = typeof input.section_id === 'string' && input.section_id.trim() !== ''
    ? input.section_id.trim()
    : null
  const reject = (reason: string): ParsedToolParams => ({ reason, readSectionId: sectionId })

  const allowedKeys = ['section_id', 'offset', 'facts_offset']
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.includes(key))
  if (unknownKey !== undefined) return reject(`read 不支持参数字段 ${unknownKey}；参数示例：${example}`)
  if (sectionId === null) return reject(`read 缺少非空字符串 section_id；参数示例：${example}`)

  const offsets: Record<string, number> = { offset: 0, facts_offset: 0 }
  for (const field of ['offset', 'facts_offset'] as const) {
    const raw = input[field]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
      return reject(`read 的 ${field} 必须是非负安全整数；参数示例：${example}`)
    }
    offsets[field] = raw
  }
  return {
    value: { section_id: sectionId, offset: offsets.offset!, facts_offset: offsets.facts_offset! },
    reason: '',
  }
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
  if (tool === 'read') return '{"section_id":"检索结果中的小节 ID"}'
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
  fragmentRanges?: FragmentRange[]
  attachedFacts?: AttachedFactsObservation[]
  linkedEntries?: LinkedEntryObservation[]
  readDelivery?: ReadPageDelivery
  status?: ToolResultStatus
  fatal?: boolean
} {
  if (operation === 'rag_search') return ragSearchOperation(parsed.value!, context, config)
  if (operation === 'read') return readOperation(parsed.value!, context, config)
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
  fragmentRanges: FragmentRange[]
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
  const status: ToolResultStatus = delivered ? 'success' : built.capacityError ? 'error' : 'empty'
  return {
    data,
    hitIds,
    injectedIds: built.injectedIds,
    fulltextRanges: built.fulltextRanges,
    fragmentRanges: built.fragmentRanges,
    attachedFacts: attachment && attachment.observations.length > 0 ? attachment.observations : undefined,
    linkedEntries: built.linkedEntries.length > 0 ? built.linkedEntries : undefined,
    status,
  }
}

/** 取运行时 facts store；加载失败沿用工具执行错误的 fatal 语义，不静默降级，也不增加隐式重试。 */
function loadFactsStore(context: KnowledgeToolContext): CardStore {
  let store: CardStore
  try {
    store = context.factsStore ? context.factsStore() : getCardStore()
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
  /** 实际送达的连续正文片段；全文扩展模式不重复登记。 */
  fragmentRanges: FragmentRange[]
  /** 关联事实入口提示观测；无提示时为空数组。 */
  linkedEntries: LinkedEntryObservation[]
}

/**
 * 组装 RAG 送达正文（ADR-022 决策 7）：
 *   - 默认只送达命中的 H2/H3 块：块头含小节 ID、来源与原文范围，正文取该块在同一原文快照中的行范围
 *     （止于下一个 H2/H3 边界），超出预算时连续截取并给可复制的 read 续读入口；
 *   - 显式 expandFulltext=1 时沿用 ADR-013 的按文件整篇扩展（base/guides 去重），续读指向 read；
 *   - 默认路径缺少可定位原文时明确失败，避免送达没有阅读 ID 和连续范围的正文。
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

  if (!expandFulltext) return buildHitBlockData(blocks, maxChars, sections, links)
  if (!sections) {
    return { ...buildRagDataLegacy(blocks, maxChars, undefined, links), capacityError: false, fulltextRanges: [], fragmentRanges: [] }
  }
  return { ...buildExpandedRagData(blocks, maxChars, sections, links), fragmentRanges: [] }
}

/** 命中块在原文快照中的连续行范围及其坐标；用于正文送达、续读偏移与片段登记。 */
interface HitBlockSlice {
  text: string
  /** 块首行在所属小节 body 中的 UTF-16 偏移（read 续读基准）。 */
  bodyOffset: number
  /** 块正文相对同运行 documentRange.body 的 UTF-16 半开区间。 */
  docOffset: number
  startLine: number
}

/** 取 [fromLine, toLine] 行区间在同一原文快照中的连续正文；行超出快照时不伪造。 */
function snapshotLines(bodyLines: string[], bodyStartLine: number, fromLine: number, toLine: number): string | undefined {
  const start = fromLine - bodyStartLine
  const end = toLine - bodyStartLine
  if (start < 0 || end < start || end >= bodyLines.length) return undefined
  return bodyLines.slice(start, end + 1).join('\n')
}

/** 某一行在给定正文中的起始 UTF-16 偏移；行超出范围时返回 null。 */
function lineStartOffset(bodyLines: string[], bodyStartLine: number, line: number): number | null {
  const index = line - bodyStartLine
  if (index < 0 || index > bodyLines.length) return null
  return index === 0 ? 0 : bodyLines.slice(0, index).join('\n').length + 1
}

/** 命中块的原文切片；行错位或与目标正文不同源时返回 undefined，由装配方报错。 */
function hitBlockSlice(chunk: DocChunk, target: SectionEntry, doc: SectionEntry): HitBlockSlice | undefined {
  const docLines = doc.body.split('\n')
  const text = snapshotLines(docLines, doc.startLine, chunk.startLine, chunk.endLine)
  const docOffset = lineStartOffset(docLines, doc.startLine, chunk.startLine)
  const bodyOffset = lineStartOffset(target.body.split('\n'), target.startLine, chunk.startLine)
  if (text === undefined || text.length === 0 || docOffset === null || bodyOffset === null) return undefined
  if (docOffset + text.length > doc.body.length) return undefined
  if (target.body.slice(bodyOffset, bodyOffset + text.length) !== text) return undefined
  return { text, bodyOffset, docOffset, startLine: chunk.startLine }
}

/** 命中块续读元数据行：给出可直接复制的 read 调用，用 offset 续读同一阅读范围的后续原文。 */
function renderBlockContinuation(target: SectionEntry, nextOffset: number): string {
  return `续读：read(section_id="${target.sectionId}", offset=${nextOffset})｜complete false｜正文 ${target.body.length} 字符`
}

function renderHitCapacityError(maxChars: number): string {
  return `rag_search 无法在 maxContextChars=${maxChars} 内返回命中块（必要元数据加正文放不下）：请提高 maxContextChars 后重试。`
}

/**
 * 默认送达：按检索顺序逐块送达命中块原文。必要元数据（小节 ID、来源、原文范围）优先于正文，
 * 元数据加一单位证据都放不下时不发送该块，也不在省略后重新检索补满 topK。
 */
function buildHitBlockData(
  blocks: RagBlock[],
  maxChars: number,
  sections: SectionDirectory | undefined,
  links: ProseLinkIndex | undefined,
): BuiltRagData {
  let body = ''
  const injectedIds: string[] = []
  const fragmentRanges: FragmentRange[] = []
  let capacityBlocked = false

  for (const block of blocks) {
    const { chunk } = block
    const doc = sections?.documentRange(chunk.file)
    // 命中块优先映射到小节；标题前首部（无对应小节）以同文件的文档范围为阅读入口。
    const target = block.section ?? doc
    const slice = doc && target ? hitBlockSlice(chunk, target, doc) : undefined
    if (!slice || !target) {
      throw new Error(`rag_search 无法定位命中块的原文阅读范围：${chunk.file}（L${chunk.startLine}-${chunk.endLine}）；请提供同一运行的小节目录。`)
    }

    const separator = body ? '\n\n' : ''
    const header = renderRagHeader(block, target.sectionId)
    const remaining = maxChars - body.length - separator.length - header.length - 1
    if (remaining < 1) {
      capacityBlocked = true
      continue
    }
    // 截断时先为完整续读元数据留位；两者都放不下则跳过该块，不发送只有元数据或半段正文的结果。
    const room = slice.text.length > remaining
      ? remaining - renderBlockContinuation(target, target.body.length).length - 1
      : remaining
    if (room < 1) {
      capacityBlocked = true
      continue
    }
    const page = slice.text.length <= room ? slice.text : safeCutAtLine(slice.text.slice(0, room))
    if (page.length === 0) {
      capacityBlocked = true
      continue
    }
    const complete = page.length === slice.text.length
    body += `${separator}${header}\n${page}`
    if (!complete) body += `\n${renderBlockContinuation(target, slice.bodyOffset + page.length)}`
    injectedIds.push(chunk.id)
    fragmentRanges.push({
      kind: 'hit',
      file: chunk.file,
      sectionId: target.sectionId,
      chunkId: chunk.id,
      docOffset: slice.docOffset,
      docEndOffset: slice.docOffset + page.length,
      startLine: slice.startLine,
      endLine: slice.startLine + countNewlines(page),
    })
  }

  if (injectedIds.length === 0 && capacityBlocked) {
    return {
      data: renderHitCapacityError(maxChars),
      injectedIds: [],
      delivered: false,
      capacityError: true,
      fulltextRanges: [],
      fragmentRanges: [],
      linkedEntries: [],
    }
  }

  let data = body
  let linkedEntries: LinkedEntryObservation[] = []
  if (sections && data.length < maxChars && blocks.some((block) => block.section)) {
    const context = buildSectionContext(sections, blocks, new Set(injectedIds), links)
    data = appendSectionContext(data, context.lines, maxChars)
    linkedEntries = observeLinkedEntries(context.offers, data)
    fragmentRanges.push(...parentLeadFragments(context.parentLeads, sections, data))
  }
  return {
    data,
    injectedIds,
    delivered: injectedIds.length > 0,
    capacityError: false,
    fulltextRanges: [],
    fragmentRanges,
    linkedEntries,
  }
}

/** 父级引导只在整行实际写入时登记连续范围，不把被截断的展示当成完整正文送达；同范围只登记一次。 */
function parentLeadFragments(leads: readonly ParentLeadOffer[], sections: SectionDirectory, data: string): FragmentRange[] {
  const ranges: FragmentRange[] = []
  const seen = new Set<string>()
  for (const lead of leads) {
    if (!data.includes(lead.line)) continue
    const doc = sections.documentRange(lead.parent.file)
    if (!doc) continue
    const docOffset = lineStartOffset(doc.body.split('\n'), doc.startLine, lead.startLine)
    if (docOffset === null) continue
    const key = `${lead.parent.sectionId}\u0000${docOffset}`
    if (seen.has(key)) continue
    seen.add(key)
    ranges.push({
      kind: 'parent_lead',
      file: lead.parent.file,
      sectionId: lead.parent.sectionId,
      docOffset,
      docEndOffset: docOffset + lead.text.length,
      startLine: lead.startLine,
      endLine: lead.endLine,
    })
  }
  return ranges
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
function buildExpandedRagData(blocks: RagBlock[], maxChars: number, sections: SectionDirectory, links: ProseLinkIndex | undefined): Omit<BuiltRagData, 'fragmentRanges'> {
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
    // 目录中无该文件文档范围的块（当前语料不含，防御分支）：沿用原块，按行边界送达；放不下即停止，不伪造后续证据。
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

/** 续读元数据行；给出可直接复制的 read 调用，用 offset 续读同一范围的原文。 */
function renderFulltextContinuation(doc: SectionEntry, offset: number, nextOffset: number, totalChars: number): string {
  return `续读：read(section_id="${doc.sectionId}", offset=${nextOffset})｜complete false｜正文 ${totalChars} 字符`
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

/** 来源头保持既有格式；命中块给出可调用的小节 ID，新增小节信息一律放到正文之后。 */
function renderRagHeader(block: RagBlock, sectionId?: string): string {
  const { chunk } = block
  const id = sectionId === undefined ? '' : ` | ${sectionId}`
  return `【${chunk.file} | ${chunk.heading} | L${chunk.startLine}-${chunk.endLine}${id}】`
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

/** 一条父级引导展示：记录其原文范围与整行文本，供按实际写入登记片段范围。 */
interface ParentLeadOffer {
  parent: SectionEntry
  text: string
  startLine: number
  endLine: number
  line: string
}

/** 关联事实入口行：完整可复制 ID、文件、标题路径、对象数与可直接复制的 read 示例。 */
function renderLinkedEntryLine(section: SectionEntry, headingPath: readonly string[], objectCount: number): string {
  const path = headingPath.length > 0 ? headingPath.join(' > ') : '（文档根节点）'
  return `- ${section.sectionId}｜${section.file}｜标题路径：${path}｜关联 ${objectCount} 个对象｜示例：read(section_id="${section.sectionId}")`
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
 * 关联事实入口只面向实际显示的命中节点与导航项，按读取范围合并规则判断是否有可展开关联，
 * 只列确实有登记对象的小节（给出对象数与 read 示例），不列出命中文件内其它不相关登记，且只用剩余预算。
 */
function buildSectionContext(
  sections: SectionDirectory,
  blocks: RagBlock[],
  delivered: Set<string>,
  links: ProseLinkIndex | undefined,
): { lines: SectionContextLine[]; offers: LinkedOffer[]; parentLeads: ParentLeadOffer[] } {
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

  // TODO(tech-debt) PD-1：父级引导按命中小节逐行生成、去重只到子小节粒度，同一父级下的多个子小节同时命中时，
  // 同一行会被重复写入 data（相邻「上级范围入口」已按 parentId 去重，两者口径不一致）；parentLeadFragments 又按父级去重登记，
  // 故正文重复不计入 fragmentRanges。实测 2026-09-16 单轮 20 题：正文 79 行对去重 51 种（重复 28 行、2,658 字符）。
  // 重启条件：需要正文展示与送达台账去重口径一致，或要把复读度/预算占用用作对照指标时，按父级去重展示并补「同一父级多子小节命中」用例。
  const parentLeads: ParentLeadOffer[] = []
  for (const { section } of unique) {
    const context = sections.contextFor(section.sectionId)
    if (!context?.parentLead) continue
    const lead = context.parentLead
    const text = lead.text.length <= PARENT_LEAD_LIMIT ? lead.text : safeCutAtLine(lead.text.slice(0, PARENT_LEAD_LIMIT))
    const endLine = lead.startLine + countNewlines(text)
    const marker = text.length < lead.text.length ? '…（截断）' : ''
    const line = `  父级引导（L${lead.startLine}-${endLine}）：${text}${marker}`
    // 可选引导以完整展示单元送达；余量不足时省略，确保范围只登记已返回的连续正文。
    lines.push({ text: line, atomic: true })
    const parent = section.parentId ? sections.get(section.parentId) : undefined
    if (parent) parentLeads.push({ parent, text, startLine: lead.startLine, endLine, line })
  }

  const files = [...new Set(unique.map(({ block }) => block.chunk.file))]
  for (const file of files) {
    const first = unique.find(({ block }) => block.chunk.file === file)
    if (!first) continue
    const navigation = sections.navigationFor(first.section.sectionId, NAVIGATION_LIMIT)
    lines.push({ text: `【小节导航】${file}` })
    for (const item of navigation.items) lines.push({ text: `- ${item.sectionId}｜${item.heading}`, atomic: true })
    if (navigation.omitted > 0) lines.push({ text: `（省略 ${navigation.omitted} 项）` })
  }

  // 关联事实入口（ADR-022 决策 7）：按实际显示的命中节点与导航项逐节点计算可展开关联；
  // 提示只做导航、不自动返回事实，也不并入命中小节。放在既有上下文之后，只用剩余预算。
  const offers: LinkedOffer[] = []
  if (links) {
    const offerLines: SectionContextLine[] = []
    const candidates: SectionEntry[] = []
    const seenCandidates = new Set<string>()
    const addCandidate = (section: SectionEntry | undefined): void => {
      if (!section || seenCandidates.has(section.sectionId)) return
      seenCandidates.add(section.sectionId)
      candidates.push(section)
    }
    for (const { section } of unique) addCandidate(section)
    for (const file of files) {
      const first = unique.find(({ block }) => block.chunk.file === file)
      if (!first) continue
      for (const item of sections.navigationFor(first.section.sectionId, NAVIGATION_LIMIT).items) {
        addCandidate(sections.get(item.sectionId))
      }
    }
    for (const section of candidates) {
      const objects = readObjectsFor(section.sectionId, sections, links)
      if (objects.length === 0) continue
      const line = renderLinkedEntryLine(section, sections.contextFor(section.sectionId)?.headingPath ?? [], objects.length)
      offerLines.push({ text: line, atomic: true })
      offers.push({ sectionId: section.sectionId, file: section.file, objectCount: objects.length, line })
    }
    if (offerLines.length > 0) {
      lines.push({ text: '【关联事实入口】以下小节登记了可展开的关联事实；提示只做导航，用 read 读取该小节即可同时取得原文与登记事实：' })
      lines.push(...offerLines)
    }
  }

  return { lines, offers, parentLeads }
}

/** 上级范围入口行：完整可复制 ID、文件、标题路径与正文 UTF-16 字符数。 */
function renderParentRangeEntry(parent: SectionEntry): string {
  const path = parent.level === 0 ? '（文档根节点）' : [...parent.ancestors, parent.heading].join(' > ')
  return `- ${parent.sectionId}｜${parent.file}｜标题路径：${path}｜正文 ${parent.body.length} 字符`
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

/** 无关联索引时的空索引：read 仍可读取原文，只是没有登记事实可送。 */
const EMPTY_PROSE_LINK_INDEX: ProseLinkIndex = { links: [], bySection: new Map(), issues: [] }

const TRUNCATED_ID_MARKER = '…（已截断）'

/**
 * 回显模型提供的 section_id 的安全提示：整条文本不超过 maxContextChars，
 * 超预算时按字符截断 ID 且不拆 UTF-16 代理对，保证 empty 结果的 data 同样守住预算。
 */
function boundIdMessage(prefix: string, sectionId: string, suffix: string, maxChars: number): string {
  const message = `${prefix}${sectionId}${suffix}`
  if (message.length <= maxChars) return message
  const budget = maxChars - prefix.length - suffix.length - TRUNCATED_ID_MARKER.length
  if (budget <= 0) return message.slice(0, Math.max(0, maxChars))
  const head = sectionId.slice(0, budget)
  const last = head.length === 0 ? 0 : head.charCodeAt(head.length - 1)
  const safeHead = last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head
  return `${prefix}${safeHead}${TRUNCATED_ID_MARKER}${suffix}`
}

/**
 * read（ADR-022 决策 1、4、6）：一次调用同时返回所读范围的原文子树与明确登记关联的事实，
 * 两侧各自分页。本函数只做定位、范围校验与快照装配；内容组装、容量契约与行范围在 read.ts。
 * 未知 ID 返回 empty 并提示使用本次返回的 ID，不做模糊搜索、不访问文件系统。
 */
function readOperation(
  params: Record<string, unknown>,
  context: KnowledgeToolContext,
  config: BenchConfig,
): { data: string; hitIds: string[]; injectedIds: string[]; status: ToolResultStatus; readDelivery: ReadPageDelivery; fatal?: boolean } {
  const sectionId = params.section_id as string
  const directory = context.sections
  if (!directory) {
    return {
      data: boundIdMessage('本运行未启用小节阅读（没有小节目录），无法读取：', sectionId, '。使用当前返回的 ID。', config.maxContextChars),
      hitIds: [],
      injectedIds: [],
      status: 'empty',
      readDelivery: {},
    }
  }
  const section = directory.get(sectionId)
  if (!section) {
    // 模型可能回传任意长度的 ID；回显提示同样受 maxContextChars 约束，不整段超发。
    return {
      data: boundIdMessage('本运行目录中没有该小节：', sectionId, '。不会改为模糊搜索；请使用本次返回的 ID。', config.maxContextChars),
      hitIds: [],
      injectedIds: [],
      status: 'empty',
      readDelivery: {},
    }
  }
  // 关联对象与原文来自同一次运行快照；关联索引损坏时显式报错，不静默降级成空关联。
  const objects = readObjectsFor(section.sectionId, directory, context.links ?? EMPTY_PROSE_LINK_INDEX)
  const factsOffset = params.facts_offset as number
  try {
    const store = objects.some((object) => object.kind === 'card') ? loadFactsStore(context) : undefined
    const page = buildReadPage({
      section,
      directory,
      objects,
      ...(store === undefined ? {} : { store }),
      offset: params.offset as number,
      factsOffset,
      maxChars: config.maxContextChars,
      factsResultVersion: FACTS_RESULT_VERSION,
    })
    return {
      data: page.data,
      hitIds: page.hitIds,
      injectedIds: page.injectedIds,
      status: page.status,
      readDelivery: page.delivery,
    }
  } catch (error) {
    // 已知对象序列与有效偏移仍须留档；实际证据未送达，原有 fatal 错误语义保持。
    return {
      data: error instanceof Error ? error.message : String(error),
      hitIds: [],
      injectedIds: [],
      status: 'error',
      fatal: true,
      readDelivery: factsOffset <= objects.length
        ? { factsPage: { offset: factsOffset, nextOffset: null, total: objects.length, returned: 0, complete: false } }
        : {},
    }
  }
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
