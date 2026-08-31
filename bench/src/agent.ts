/**
 * 简化版查询 Agent（参照 Concliude conversationLoop 骨架）
 *
 * 保留要素：轮次预算（maxRounds）× provider 调用 × 工具执行 × 结果回写 messages。
 * 裁掉要素：Guardrail / Hook / 遥测 / 断路器 / subagent。
 */
import { loadConfig, type BenchConfig } from './config.js'
import { buildIndex, search } from './retriever.js'
import type { DocChunk } from './types.js'
import { callLLM, type ChatMessage, type ProviderOptions } from './provider.js'
import { computeCosts } from './pricing.js'
import type { BenchQuery, CostRecord, ThinkingMode } from './types.js'

export interface AgentResult {
  records: CostRecord[]
  finalAnswer: string | null
  rounds: number
  toolRounds: number
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

/** 构建系统提示 */
export function buildSystemPrompt(): string {
  return [
    '你是「明日方舟基建」知识库问答助手，语料为干员基建技能、体系论证与排班策略。',
    `你可以调用 rag_search 检索知识库片段，每次回答最多允许检索 ${MAX_RAG_CALLS} 次，达到上限后请直接基于已返回的片段作答。`,
    '回答必须基于检索到的内容，无法确认时明确说明；使用中文，结构化排版（要点列表/表格），不要编造数值。',
  ].join('\n')
}

/** rag_search 工具定义（OpenAI function calling 格式） */
export function ragSearchTool(): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: 'rag_search',
      description: '在明日方舟基建知识库中检索相关文档片段，返回 top-k 原文',
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
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: query.question },
  ]
  const providerOpts: ProviderOptions = { config, thinking: opts.thinking, dry: opts.dry }
  const now = new Date().toISOString()

  let finalAnswer: string | null = null
  let toolRounds = 0
  let ragCalls = 0
  let rounds = 0

  for (let round = 1; round <= config.maxRounds; round++) {
    rounds++
    const resp = await callLLM(messages, [ragSearchTool()], providerOpts)
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
    })

    if (resp.toolCalls.length > 0) {
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
      // 执行工具：本基准仅 rag_search，逐个执行并回写结果
      for (const tc of resp.toolCalls) {
        let resultText: string
        if (tc.name === 'rag_search') {
          if (ragCalls >= MAX_RAG_CALLS) {
            resultText = `已达到知识库检索上限（${MAX_RAG_CALLS} 次），请直接基于已返回的片段作答，勿再检索。`
          } else {
            ragCalls++
            const q = safeParseQuery(tc.arguments)
            const hits = search(index, q ?? query.question, config.topK)
            resultText = hits
              .map((idx) => {
                const c = chunks[idx]
                return `【${c.file} | ${c.heading}】\n${c.text}`
              })
              .join('\n\n')
              .slice(0, config.maxContextChars)
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

    // 无工具调用 → 最终回答
    finalAnswer = resp.content
    break
  }

  return { records, finalAnswer, rounds, toolRounds }
}

function safeParseQuery(args: string): string | null {
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    return typeof obj.query === 'string' && obj.query.length > 0 ? obj.query : null
  } catch {
    return null
  }
}
