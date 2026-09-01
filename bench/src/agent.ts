/**
 * 简化版查询 Agent（参照 Concliude conversationLoop 骨架）
 *
 * 保留要素：轮次预算（maxRounds）× provider 调用 × 工具执行 × 结果回写 messages。
 * 裁掉要素：Guardrail / Hook / 遥测 / 断路器 / subagent。
 */
import { loadConfig, type BenchConfig, type RetrieverId } from './config.js'
import { buildIndex, search } from './retriever.js'
import { grepSearch, buildGrepResult } from './grep-retriever.js'
import type { DocChunk } from './types.js'
import { callLLM, type ChatMessage, type ProviderOptions } from './provider.js'
import { computeCosts } from './pricing.js'
import type { BenchQuery, CostRecord, ThinkingMode, ToolId } from './types.js'

export interface AgentResult {
  records: CostRecord[]
  finalAnswer: string | null
  rounds: number
  toolRounds: number
  /** 每轮实际调用的检索工具序列（双工具模式统计，供 answers.md 展示） */
  toolTrace: ToolId[][]
}

export interface AgentOptions {
  config?: BenchConfig
  thinking: ThinkingMode
  dry: boolean
  /** 注入已构建的检索索引与分块（runner 复用） */
  chunks?: DocChunk[]
  index?: ReturnType<typeof buildIndex>
}

/** 单次查询允许的知识库检索次数上限（system prompt 与 tool 侧共同约束） */
export const MAX_RAG_CALLS = 2

/** 构建系统提示；工具名随检索器切换（双工具模式同时描述两个检索器及其定位） */
export function buildSystemPrompt(retriever: RetrieverId = 'bm25'): string {
  const tools = retriever === 'both' ? 'rag_search（BM25 相关性排序）与 grep_search（字面命中定位）' : retriever === 'grep' ? 'grep_search' : 'rag_search'
  const lines = [
    '你是「明日方舟基建」知识库问答助手，语料为干员基建技能、体系论证与排班策略。',
    `你可以调用 ${tools} 检索知识库片段，每次回答最多允许检索 ${MAX_RAG_CALLS} 次，达到上限后请直接基于已返回的片段作答。`,
    `严禁使用模型自身训练语料中的知识作答：所有答案必须严格基于本次 ${retriever === 'both' ? 'rag_search/grep_search' : tools} 返回的片段；片段未覆盖时明确说明「知识库未查到」，不得凭记忆补全，不得编造数值或机制。`,
    '输出使用中文，结构化排版（要点列表/表格）。',
  ]
  if (retriever === 'both') {
    lines.push(
      '两个检索器的分工：rag_search 按 BM25 相关性返回排序靠前的片段，适合一般性机制/体系查询；grep_search 按字面命中定位，适合精确查找专名、数值、措辞（如某干员名、某百分比、某别名）是否出现在语料。',
      '建议：第一轮先用 rag_search 快速定位主题片段；若后续需核实具体干员/数值/措辞的精确出处，或 rag 结果不足以覆盖，再调用 grep_search 补充。二者可结合使用，但总次数不超过上限。',
    )
  }
  return lines.join('\n')
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

/** 按检索器选取要暴露给模型的工具集（both 双工具同时暴露，模型可自由选） */
function retrieverTools(retriever: RetrieverId): Record<string, unknown>[] {
  if (retriever === 'both') return [ragSearchTool(), grepSearchTool()]
  return retriever === 'grep' ? [grepSearchTool()] : [ragSearchTool()]
}

/** 执行单次查询，逐轮记录成本 */
export async function runQuery(
  query: BenchQuery,
  opts: AgentOptions,
  chunks: DocChunk[],
  index: ReturnType<typeof buildIndex>,
): Promise<AgentResult> {
  const config = opts.config ?? loadConfig()
  const records: CostRecord[] = []
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(config.retriever) },
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

  for (let round = 1; round <= config.maxRounds + 1; round++) {
    rounds++
    // 超轮次：最后一轮不再暴露检索工具（空工具集），强制模型直接基于已有片段作答，
    // 避免「轮次耗尽仍有 tool use → finalAnswer=null 不落盘」的缺失答案问题。
    const isAnswerFallback = round > config.maxRounds
    const resp = await callLLM(messages, isAnswerFallback ? [] : retrieverTools(config.retriever), providerOpts)
    const costs = computeCosts(resp.usage.input, resp.usage.output, resp.usage.cached, config.prices)
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
      // 本轮实际调用的检索工具（双工具模式统计；无工具调用则省略）
      tools: resp.toolCalls.length > 0 ? (resp.toolCalls.map((tc) => tc.name).filter((n): n is ToolId => n === 'rag_search' || n === 'grep_search')) : undefined,
    })
    toolTrace.push(
      resp.toolCalls.map((tc) => tc.name).filter((n): n is ToolId => n === 'rag_search' || n === 'grep_search'),
    )

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
              resultText = buildGrepResult(chunks, hits, q ?? query.question, config.maxContextChars)
            } else {
              const hits = search(index, q ?? query.question, config.topK)
              resultText = hits
                .map((idx) => {
                  const c = chunks[idx]
                  return `【${c.file} | ${c.heading} | L${c.startLine}-${c.endLine}】\n${c.text}`
                })
                .join('\n\n')
                .slice(0, config.maxContextChars)
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

    // 无工具调用：若强制首检未达成，先引导检索而非直接作答（qwen 检索意愿实验用）
    // 强制次数上限受 MAX_RAG_CALLS 约束，避免 minRagCalls 超上限造成引导死循环至轮次耗尽
    // 注意：超轮次兜底轮不在此引导，直接把已有片段交给模型作答，保证最终答案产出
    const minRag = Math.min(config.minRagCalls, MAX_RAG_CALLS)
    if (!isAnswerFallback && retrievalCalls < minRag) {
      messages.push({
        role: 'user',
        content: `请先调用 rag_search 检索知识库（当前已检索 ${retrievalCalls} 次，需至少检索 ${minRag} 次）后再作答。`,
      })
      continue
    }

    // 无工具调用 → 最终回答（若无内容则产出显式占位，保证 answers.md 落盘）
    finalAnswer = resp.content ?? '（模型未返回最终答案）'
    break
  }

  return { records, finalAnswer, rounds, toolRounds, toolTrace }
}

function safeParseQuery(args: string): string | null {
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    return typeof obj.query === 'string' && obj.query.length > 0 ? obj.query : null
  } catch {
    return null
  }
}
