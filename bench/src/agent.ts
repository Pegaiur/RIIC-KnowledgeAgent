/**
 * 简化版查询 Agent（参照 Concliude conversationLoop 骨架）
 *
 * 保留要素：轮次预算（maxRounds）× provider 调用 × 工具执行 × 结果回写 messages。
 * 裁掉要素：Guardrail / Hook / 遥测 / 断路器 / subagent。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, validateBenchConfig, type BenchConfig, type RetrieverId } from './config.js'
import { search, type IndexEntry } from './retriever.js'
import { grepSearch, buildGrepResult } from './grep-retriever.js'
import type { DocChunk } from './types.js'
import { callLLM, type ChatMessage, type ProviderOptions } from './provider.js'
import { computeCosts } from './pricing.js'
import {
  isRetrievalTool,
  isFactTool,
  type BenchQuery,
  type CostRecord,
  type TerminationReason,
  type ThinkingMode,
  type ToolId,
} from './types.js'
import { getCardStore, serializeCards, type OperatorFilters } from './facts/store.js'
import { markTraceFailed, type QueryTrace, type TraceFailure, type TraceLlmEvent, type TraceToolEvent } from './trace.js'

export interface AgentResult {
  status: 'completed' | 'failed' | 'cancelled'
  terminationReason: TerminationReason
  failure?: TraceFailure
  records: CostRecord[]
  finalAnswer: string | null
  rounds: number
  toolRounds: number
  /** 每轮实际调用的检索工具序列（双工具模式统计，供 answers.md 展示） */
  toolTrace: ToolId[][]
  /** 实际注入上下文的 chunk id（按注入顺序去重；rag 路径按 maxContextChars 截断偏移判定，供注入覆盖率计算） */
  injectedIds: string[]
  /** 已发起的模型生成步骤数；失败/取消也保留真实值。 */
  modelSteps: number
}

export interface AgentOptions {
  config?: BenchConfig
  /** 单次基准运行固定使用的查询契约快照；未提供时按单次查询读取。 */
  agentInstructions?: string
  /** 可选的单题执行记录；不传入时保持原有调用与结果协议。 */
  trace?: QueryTrace
  thinking: ThinkingMode
  dry: boolean
}

/** 单次查询允许的知识库检索次数上限（system prompt 与 tool 侧共同约束） */
export const MAX_RAG_CALLS = 2

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

/** 构建系统提示；人工规则只来自 AGENTS.md，模式差异由运行时能力块描述。 */
export function buildSystemPrompt(
  retriever: RetrieverId = 'bm25',
  agentInstructions = loadKnowledgeAgentInstructions(),
): string {
  const toolNames = retrieverTools(retriever).map((tool) => {
    const definition = tool.function as { name: string }
    return definition.name
  })
  const runtime = [
    '## 本次运行能力',
    `- 检索模式：${retriever}`,
    `- 可用工具：${toolNames.join('、')}`,
    `- 工具调用上限：${MAX_RAG_CALLS} 次；达到上限后直接根据已有证据作答。`,
  ]
  return `${agentInstructions.trim()}\n\n${runtime.join('\n')}`
}

/** rag_search 工具定义（BM25 检索，OpenAI function calling 格式） */
export function ragSearchTool(): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: 'rag_search',
      description: '在明日方舟基建知识库中按关键词相关性（BM25）检索文档片段，返回 top-k 原文',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词（干员名/机制/体系名）' },
        },
        required: ['query'],
      },
    },
  }
}

/** grep_search 工具定义（字面命中计数检索，P3 对照） */
export function grepSearchTool(): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: 'grep_search',
      description: '在明日方舟基建知识库中按字面命中计数检索文档片段，返回 top-k 原文及命中行明细',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词（干员名/机制/体系名）' },
        },
        required: ['query'],
      },
    },
  }
}

/** lookup 工具定义（facts：按干员名/技能名/技能组精确查询记录卡） */
export function lookupTool(): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: 'lookup',
      description: '在明日方舟基建干员事实记录卡中按干员名/技能名/技能组精确查询，返回紧凑记录卡列表',
      parameters: {
        type: 'object',
        properties: {
          term: { type: 'string', description: '干员标准名/别名/技能名/技能组（精确匹配）' },
        },
        required: ['term'],
      },
    },
  }
}

/** query_operators 工具定义（facts：按设施/阵营/职业分类过滤，含 termQuery 字面子串） */
export function queryOperatorsTool(): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: 'query_operators',
      description:
        '在明日方舟基建干员事实记录卡中按设施/阵营/职业分类过滤（至少提供一个非空条件）；termQuery 对技能名/效果/标签/备注做关键词子串匹配（不含数值效率比较）',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '精确匹配的设施名（如 制造站/贸易站）' },
          faction: { type: 'string', description: '所属阵营组（如 莱茵生命/怪物猎人小队）' },
          profession: { type: 'string', description: '职业（如 近卫/术师）' },
          excludeIds: { type: 'array', items: { type: 'string' }, description: '按标准名排除的干员列表' },
          termQuery: { type: 'string', description: '关键词子串（技能名/效果/标签/备注）' },
        },
      },
    },
  }
}

/** 按检索器选取要暴露给模型的工具集（facts→lookup/query_operators；both 双工具同时暴露） */
function retrieverTools(retriever: RetrieverId): Record<string, unknown>[] {
  if (retriever === 'hybrid') return [ragSearchTool(), lookupTool(), queryOperatorsTool()]
  if (retriever === 'facts') return [lookupTool(), queryOperatorsTool()]
  if (retriever === 'both') return [ragSearchTool(), grepSearchTool()]
  return retriever === 'grep' ? [grepSearchTool()] : [ragSearchTool()]
}

/**
 * 执行单次查询，逐轮记录成本。
 * TODO(tech-debt) A1：本函数体量较大，混合两套注入语义（grep 全量命中实注入 vs rag 按 maxContextChars 预算判定截断块），
 * 重构需先抽检索门面承载差异，中风险，暂缓。
 */
export async function runQuery(
  query: BenchQuery,
  opts: AgentOptions,
  chunks: DocChunk[],
  index: IndexEntry,
): Promise<AgentResult> {
  const config = opts.config ?? loadConfig()
  validateBenchConfig(config)
  const records: CostRecord[] = []
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(config.retriever, opts.agentInstructions ?? loadKnowledgeAgentInstructions()) },
    { role: 'user', content: query.question },
  ]
  const sessionController = new AbortController()
  let timedOut = false
  const timeoutHandle = setTimeout(() => {
    timedOut = true
    sessionController.abort(new Error('单题总超时'))
  }, config.sessionTimeoutMs)
  const providerOpts: ProviderOptions = {
    config,
    thinking: opts.thinking,
    dry: opts.dry,
    signal: sessionController.signal,
  }
  const now = new Date().toISOString()

  let finalAnswer: string | null = null
  let toolRounds = 0
  let retrievalCalls = 0
  let rounds = 0
  /** 每轮实际调用的检索工具序列（双工具模式统计；供 answers.md 展示） */
  const toolTrace: ToolId[][] = []
  /** 实际注入上下文的 chunk id（按注入顺序去重；供 R1 注入覆盖率计算） */
  const injectedIds: string[] = []
  let status: AgentResult['status'] = 'completed'
  let terminationReason: TerminationReason = 'answer'
  let failure: TraceFailure | undefined

  try {
    for (let round = 1; round <= config.maxRounds + 1; round++) {
      if (sessionController.signal.aborted) throw abortErrorForSession(timedOut)
    rounds++
    // 超轮次：最后一轮不再暴露检索工具（空工具集），强制模型直接基于已有片段作答，
    // 避免「轮次耗尽仍有 tool use → finalAnswer=null 不落盘」的缺失答案问题。
    const isAnswerFallback = round > config.maxRounds
    const offeredTools = isAnswerFallback ? [] : retrieverTools(config.retriever)
    const llmEvent: TraceLlmEvent | undefined = opts.trace
      ? {
          type: 'llm_call',
          round,
          offeredTools: offeredTools.map((tool) => (tool.function as { name: string }).name),
          elapsedMs: 0,
        }
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
    // 本轮实际调用的检索工具（双工具模式统计；供 records.tools 与 toolTrace 复用）
    const usedTools = resp.toolCalls.map((tc) => tc.name).filter((n): n is ToolId => isRetrievalTool(n) || isFactTool(n))
    records.push({
      ts: now,
      queryId: query.id,
      category: query.category,
      round,
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
      // 本轮实际调用的检索工具（无工具调用则省略；双工具模式统计）
      tools: usedTools.length > 0 ? usedTools : undefined,
    })
    toolTrace.push(usedTools)

    if (resp.truncated) {
      throw new AgentExecutionError('模型响应被截断，未执行其中的工具调用或接受正文', 'truncated', 'llm')
    }

    if (resp.toolCalls.length > 0 && !isAnswerFallback) {
      toolRounds++
      // 回写 assistant 工具调用消息
      messages.push({
        role: 'assistant',
        content: resp.content ?? '',
        tool_calls: resp.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })
      // 执行工具：rag_search（BM25）与 grep_search（字面命中）分别路由，逐个执行并回写结果
      for (const tc of resp.toolCalls) {
        if (sessionController.signal.aborted) throw abortErrorForSession(timedOut)
        let resultText: string
        const toolEvent: TraceToolEvent | undefined = opts.trace
          ? { type: 'tool_call', round, callId: tc.id, tool: tc.name, rawArguments: tc.arguments, elapsedMs: 0 }
          : undefined
        if (toolEvent) opts.trace?.events.push(toolEvent)
        const toolStarted = Date.now()
        try {
          if (tc.name === 'rag_search' || tc.name === 'grep_search') {
            if (retrievalCalls >= MAX_RAG_CALLS) {
              resultText = `已达到知识库检索上限（${MAX_RAG_CALLS} 次），请直接基于已返回的片段作答，勿再检索。`
              if (toolEvent) toolEvent.reason = '已达到知识库检索上限，未执行检索'
            } else {
              retrievalCalls++
              const parsed = parseQuery(tc.arguments)
              const actualQuery = parsed.value ?? query.question
              if (toolEvent) {
                toolEvent.actualParams = { query: actualQuery }
                toolEvent.hitIds = []
                toolEvent.injectedIds = []
                if (parsed.reason) toolEvent.reason = parsed.reason
              }
              if (tc.name === 'grep_search') {
                const hits = grepSearch(chunks, actualQuery, config.topK)
                const hitIds = hits.map((idx) => chunks[idx].id)
                // grep 结果逐块组装、不整体截断 → 所有命中块均实际注入
                for (const id of hitIds) {
                  if (toolEvent) (toolEvent.injectedIds ??= []).push(id)
                  if (!injectedIds.includes(id)) injectedIds.push(id)
                }
                if (toolEvent) {
                  toolEvent.hitIds = hitIds
                  toolEvent.injectedIds = hitIds
                }
                resultText = buildGrepResult(chunks, hits, actualQuery, config.maxContextChars)
              } else {
                const hits = search(index, actualQuery, config.topK)
                const hitIds = hits.map((idx) => chunks[idx].id)
                if (toolEvent) toolEvent.hitIds = hitIds
                // rag 结果 join 后整体 slice(maxContextChars)：按块起始偏移判定实际注入
                //（块被截断仍算部分注入；整体被切掉的块不计入）
                let offset = 0
                const parts = hits.map((idx) => {
                  const c = chunks[idx]
                  if (offset < config.maxContextChars) {
                    if (toolEvent) (toolEvent.injectedIds ??= []).push(c.id)
                    if (!injectedIds.includes(c.id)) injectedIds.push(c.id)
                  }
                  const block = `【${c.file} | ${c.heading} | L${c.startLine}-${c.endLine}】\n${c.text}`
                  offset += block.length + 2 // '\n\n' 分隔符
                  return block
                })
                resultText = parts.join('\n\n').slice(0, config.maxContextChars)
              }
            }
          } else if (tc.name === 'lookup' || tc.name === 'query_operators') {
            if (retrievalCalls >= MAX_RAG_CALLS) {
              resultText = `已达到知识库检索上限（${MAX_RAG_CALLS} 次），请直接基于已返回的内容作答，勿再检索。`
              if (toolEvent) toolEvent.reason = '已达到知识库检索上限，未执行查询'
            } else {
              retrievalCalls++
              if (tc.name === 'query_operators') {
                const parsed = parseFilters(tc.arguments)
                if (!parsed.value) {
                  resultText = '查询参数无效：请至少提供非空的设施、阵营、职业或关键词。'
                  if (toolEvent) toolEvent.reason = parsed.reason
                } else {
                  if (toolEvent) toolEvent.actualParams = parsed.value
                  const store = getCardStore()
                  const hits = store.queryOperators(parsed.value)
                  if (toolEvent) {
                    toolEvent.hitIds = hits.map((card) => card.canonical)
                    toolEvent.injectedIds = hits.map((card) => card.canonical)
                  }
                  resultText = serializeCards(hits, parsed.value)
                }
              } else {
                const parsed = parseTerm(tc.arguments)
                if (toolEvent) {
                  toolEvent.actualParams = { term: parsed.value }
                  if (parsed.reason) toolEvent.reason = parsed.reason
                }
                const store = getCardStore()
                const hits = store.lookup(parsed.value)
                if (toolEvent) {
                  toolEvent.hitIds = hits.map((card) => card.canonical)
                  toolEvent.injectedIds = hits.map((card) => card.canonical)
                }
                resultText = serializeCards(hits)
              }
            }
          } else {
            resultText = `未知工具：${tc.name}`
            if (toolEvent) toolEvent.reason = '未知工具，未执行调用'
          }
          const writtenContent = resultText || '（无匹配片段）'
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: writtenContent,
          })
          if (toolEvent) {
            toolEvent.elapsedMs = Date.now() - toolStarted
            toolEvent.writtenContent = writtenContent
          }
        } catch (error) {
          if (toolEvent) {
            toolEvent.elapsedMs = Date.now() - toolStarted
            toolEvent.error = errorMessage(error)
          }
          throw new AgentExecutionError(errorMessage(error), timedOut ? 'timeout' : 'tool_error', timedOut ? 'timeout' : 'tool')
        }
      }
      continue
    }

    // 作答前至少调用一轮检索工具（替换旧「首轮必须 rag_search」规则）：由 config.minRagCalls 驱动，
    // 默认 1 = 必须先调用任意检索工具一次；适用于全部检索器（含 facts）。上限受 MAX_RAG_CALLS 约束；
    // 超轮次兜底轮不在此引导，保证最终答案产出。
    const minRag = Math.min(config.minRagCalls, MAX_RAG_CALLS)
    if (!isAnswerFallback && retrievalCalls < minRag) {
      const content = `请先调用知识库检索工具后再作答（当前已检索 ${retrievalCalls} 次，需至少检索 ${minRag} 次）。`
      messages.push({
        role: 'user',
        content,
      })
      opts.trace?.events.push({ type: 'control', round, kind: 'min_retrieval', content })
      continue
    }

    // 无工具调用 → 最终回答（若无内容则产出显式占位，保证 answers.md 落盘）
    if (typeof resp.content !== 'string' || resp.content.trim() === '') {
      throw new AgentExecutionError('模型未返回非空最终答案', 'empty_response', 'llm')
    }
    finalAnswer = resp.content
    break
  }
  } catch (error) {
    status = timedOut ? 'cancelled' : error instanceof AgentExecutionError && (error.reason === 'timeout' || error.reason === 'cancelled') ? 'cancelled' : 'failed'
    terminationReason = timedOut
      ? 'timeout'
      : error instanceof AgentExecutionError
        ? error.reason
        : 'llm_error'
    const stage = timedOut
      ? 'timeout'
      : error instanceof AgentExecutionError
        ? error.stage
        : 'llm'
    failure = {
      stage,
      message: errorMessage(error),
      round: rounds || undefined,
    }
    if (error instanceof AgentExecutionError && error.stage === 'tool' && opts.trace) {
      const lastTool = [...opts.trace.events].reverse().find((event): event is TraceToolEvent => event.type === 'tool_call')
      if (lastTool) failure.toolCallId = lastTool.callId
    }
    if (opts.trace) {
      markTraceFailed(opts.trace, failure)
      // stage 只描述失败位置，精确终止原因来自 Agent 业务判定。
      opts.trace.terminationReason = terminationReason
    }
  } finally {
    clearTimeout(timeoutHandle)
  }

  return { status, terminationReason, failure, records, finalAnswer, rounds, toolRounds, toolTrace, injectedIds, modelSteps: rounds }
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

function parseQuery(args: string): { value: string | null; reason?: string } {
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    if (typeof obj.query === 'string' && obj.query.length > 0) return { value: obj.query }
    return { value: null, reason: 'query 参数无效，已回退为题目原文' }
  } catch {
    return { value: null, reason: 'query 参数不是有效 JSON，已回退为题目原文' }
  }
}

function parseTerm(args: string): { value: string; reason?: string } {
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    if (typeof obj.term === 'string' && obj.term.length > 0) return { value: obj.term }
    return { value: '', reason: 'term 参数无效，实际以空 term 查询' }
  } catch {
    return { value: '', reason: 'term 参数不是有效 JSON，实际以空 term 查询' }
  }
}

function parseFilters(args: string): { value: OperatorFilters | null; reason: string } {
  try {
    const obj = JSON.parse(args) as unknown
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return { value: null, reason: 'query_operators 参数结构无效，未调用 store' }
    }
    const input = obj as Record<string, unknown>
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
      const excludeIds = input.excludeIds
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
      if (excludeIds.length > 0) filters.excludeIds = excludeIds
    }
    return room || faction || profession || termQuery
      ? { value: filters, reason: '' }
      : { value: null, reason: 'query_operators 缺少非空正向条件，未调用 store' }
  } catch {
    return { value: null, reason: 'query_operators 参数不是有效 JSON，未调用 store' }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
