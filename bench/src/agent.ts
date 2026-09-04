/**
 * 简化版查询 Agent（参照 Concliude conversationLoop 骨架）
 *
 * 保留要素：轮次预算（maxRounds）× provider 调用 × 工具执行 × 结果回写 messages。
 * 裁掉要素：Guardrail / Hook / 遥测 / 断路器 / subagent。
 */
import { loadConfig, type BenchConfig, type RetrieverId } from './config.js'
import { search, type IndexEntry } from './retriever.js'
import { grepSearch, buildGrepResult } from './grep-retriever.js'
import type { DocChunk } from './types.js'
import { callLLM, type ChatMessage, type ProviderOptions } from './provider.js'
import { computeCosts } from './pricing.js'
import { buildRulesPrefix } from './rules-prefix.js'
import { isRetrievalTool, isFactTool, type BenchQuery, type CostRecord, type ThinkingMode, type ToolId } from './types.js'
import { getCardStore, serializeCards, type OperatorFilters } from './facts/store.js'

export interface AgentResult {
  records: CostRecord[]
  finalAnswer: string | null
  rounds: number
  toolRounds: number
  /** 每轮实际调用的检索工具序列（双工具模式统计，供 answers.md 展示） */
  toolTrace: ToolId[][]
  /** 实际注入上下文的 chunk id（按注入顺序去重；rag 路径按 maxContextChars 截断偏移判定，供注入覆盖率计算） */
  injectedIds: string[]
}

export interface AgentOptions {
  config?: BenchConfig
  thinking: ThinkingMode
  dry: boolean
}

/** 单次查询允许的知识库检索次数上限（system prompt 与 tool 侧共同约束） */
export const MAX_RAG_CALLS = 2

/** 构建系统提示；工具名随检索器切换（双工具模式同时描述两个检索器及其定位） */
export function buildSystemPrompt(retriever: RetrieverId = 'bm25', rulesEnabled = false): string {
  if (retriever === 'facts') {
    const lines = [
      '你是「明日方舟基建」知识库问答助手（事实查询模式），基于干员事实记录卡作答。',
      `你可以调用 lookup（按干员名/技能名/技能组精确查询记录卡，返回记录卡列表）与 query_operators（至少提供一个非空的设施、阵营、职业或关键词，按这些条件分类过滤，支持 termQuery 关键词子串匹配），每次回答最多允许检索 ${MAX_RAG_CALLS} 次，达到上限后请直接基于已返回的记录卡作答。`,
      '所有答案必须严格基于 lookup/query_operators 返回的记录卡；记录卡未覆盖时，明确说明「知识库未查到」，不得凭记忆补全，不得编造数值或机制。',
      '输出使用中文，结构化排版（要点列表/表格）。',
    ]
    return lines.join('\n')
  }
  const tools = retriever === 'both' ? 'rag_search（BM25 相关性排序）与 grep_search（字面命中定位）' : retriever === 'grep' ? 'grep_search' : 'rag_search'
  const lines = [
    '你是「明日方舟基建」知识库问答助手，语料为干员基建技能、体系论证与排班策略。',
    `你可以调用 ${tools} 检索知识库片段，每次回答最多允许检索 ${MAX_RAG_CALLS} 次，达到上限后请直接基于已返回的片段作答。`,
    // 规则开启：检索契约从「严格基于片段」升级为「引导仅用于构造 query、不作依据，答案须引用原文片段」
    rulesEnabled
      ? `所有答案必须严格基于本次 ${retriever === 'both' ? 'rag_search/grep_search' : tools} 返回的语料片段并标注 file#小节；上方检索词引导仅为构造 query 的命中提示、不构成来源；片段未覆盖时明确说明「知识库未查到」，不得凭记忆补全，不得编造数值或机制。`
      : `严禁使用模型自身训练语料中的知识作答：所有答案必须严格基于本次 ${retriever === 'both' ? 'rag_search/grep_search' : tools} 返回的片段；片段未覆盖时明确说明「知识库未查到」，不得凭记忆补全，不得编造数值或机制。`,
    '输出使用中文，结构化排版（要点列表/表格）。',
  ]
  if (retriever === 'both') {
    lines.push(
      '两个检索器的分工：rag_search 按 BM25 相关性返回排序靠前的片段，适合一般性机制/体系查询；grep_search 按字面命中定位，适合精确查找专名、数值、措辞（如某干员名、某百分比、某别名）是否出现在语料。',
      '建议：第一轮先用 rag_search 快速定位主题片段；若后续需核实具体干员/数值/措辞的精确出处，或 rag 结果不足以覆盖，再调用 grep_search 补充。二者可结合使用，但总次数不超过上限。',
    )
  }
  // 规则开启：规则段置顶注入（完全静态，保证前缀缓存命中；规则不构成来源见上方契约）
  const head = rulesEnabled ? `${buildRulesPrefix()}\n\n` : ''
  return head + lines.join('\n')
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
      description: '在明日方舟基建干员事实记录卡中按干员名/技能名/技能组精确查询，返回记录卡列表（≤1KB/卡）',
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
  const records: CostRecord[] = []
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(config.retriever, config.rules) },
    { role: 'user', content: query.question },
  ]
  const providerOpts: ProviderOptions = { config, thinking: opts.thinking, dry: opts.dry }
  const now = new Date().toISOString()

  let finalAnswer: string | null = null
  let toolRounds = 0
  let retrievalCalls = 0
  let rounds = 0
  /** 每轮实际调用的检索工具序列（双工具模式统计；供 answers.md 展示） */
  const toolTrace: ToolId[][] = []
  /** 实际注入上下文的 chunk id（按注入顺序去重；供 R1 注入覆盖率计算） */
  const injectedIds: string[] = []

  for (let round = 1; round <= config.maxRounds + 1; round++) {
    rounds++
    // 超轮次：最后一轮不再暴露检索工具（空工具集），强制模型直接基于已有片段作答，
    // 避免「轮次耗尽仍有 tool use → finalAnswer=null 不落盘」的缺失答案问题。
    const isAnswerFallback = round > config.maxRounds
    const resp = await callLLM(messages, isAnswerFallback ? [] : retrieverTools(config.retriever), providerOpts)
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
      truncated: resp.truncated,
      // 本轮实际调用的检索工具（无工具调用则省略；双工具模式统计）
      tools: usedTools.length > 0 ? usedTools : undefined,
    })
    toolTrace.push(usedTools)

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
        let resultText: string
        if (tc.name === 'rag_search' || tc.name === 'grep_search') {
          if (retrievalCalls >= MAX_RAG_CALLS) {
            resultText = `已达到知识库检索上限（${MAX_RAG_CALLS} 次），请直接基于已返回的片段作答，勿再检索。`
          } else {
            retrievalCalls++
            const q = safeParseQuery(tc.arguments)
            if (tc.name === 'grep_search') {
              const hits = grepSearch(chunks, q ?? query.question, config.topK)
              // grep 结果逐块组装、不整体截断 → 所有命中块均实际注入
              for (const idx of hits) {
                const id = chunks[idx].id
                if (!injectedIds.includes(id)) injectedIds.push(id)
              }
              resultText = buildGrepResult(chunks, hits, q ?? query.question, config.maxContextChars)
            } else {
              const hits = search(index, q ?? query.question, config.topK)
              // rag 结果 join 后整体 slice(maxContextChars)：按块起始偏移是否进入预算判定实际注入
              //（块被截断仍算部分注入；整体被切掉的块不计入）
              let offset = 0
              const parts = hits.map((idx) => {
                const c = chunks[idx]
                if (offset < config.maxContextChars && !injectedIds.includes(c.id)) injectedIds.push(c.id)
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
          } else {
            retrievalCalls++
            if (tc.name === 'query_operators') {
              const filters = safeParseFilters(tc.arguments)
              if (!filters) {
                resultText = '查询参数无效：请至少提供非空的设施、阵营、职业或关键词。'
              } else {
                const store = getCardStore()
                resultText = serializeCards(store.queryOperators(filters), filters)
              }
            } else {
              const store = getCardStore()
              resultText = serializeCards(store.lookup(safeParseTerm(tc.arguments)))
            }
          }
        } else {
          resultText = `未知工具：${tc.name}`
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultText || '（无匹配片段）',
        })
      }
      continue
    }

    // 作答前至少调用一轮检索工具（替换旧「首轮必须 rag_search」规则）：由 config.minRagCalls 驱动，
    // 默认 1 = 必须先调用任意检索工具一次；适用于全部检索器（含 facts）。上限受 MAX_RAG_CALLS 约束；
    // 超轮次兜底轮不在此引导，保证最终答案产出。
    const minRag = Math.min(config.minRagCalls, MAX_RAG_CALLS)
    if (!isAnswerFallback && retrievalCalls < minRag) {
      messages.push({
        role: 'user',
        content: `请先调用知识库检索工具后再作答（当前已检索 ${retrievalCalls} 次，需至少检索 ${minRag} 次）。`,
      })
      continue
    }

    // 无工具调用 → 最终回答（若无内容则产出显式占位，保证 answers.md 落盘）
    finalAnswer = resp.content ?? '（模型未返回最终答案）'
    break
  }

  return { records, finalAnswer, rounds, toolRounds, toolTrace, injectedIds }
}

function safeParseQuery(args: string): string | null {
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    return typeof obj.query === 'string' && obj.query.length > 0 ? obj.query : null
  } catch {
    return null
  }
}

/** 解析 facts lookup 的 term 参数 */
function safeParseTerm(args: string): string {
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    return typeof obj.term === 'string' && obj.term.length > 0 ? obj.term : ''
  } catch {
    return ''
  }
}

/** 解析 facts query_operators 的过滤参数（仅接收权威类型字段，其余忽略） */
function safeParseFilters(args: string): OperatorFilters | null {
  try {
    const obj = JSON.parse(args) as unknown
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
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
    return room || faction || profession || termQuery ? filters : null
  } catch {
    return null
  }
}
