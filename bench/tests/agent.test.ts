import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  buildSystemPrompt,
  grepSearchTool,
  MAX_RAG_CALLS,
  ragSearchTool,
  runQuery,
} from '../src/agent.js'
import { buildIndex } from '../src/retriever.js'
import { loadConfig } from '../src/config.js'
import type { ProviderResult } from '../src/types.js'
import type { DocChunk } from '../src/types.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

/** 取工具函数名（OpenAI function calling 的 function.name） */
function toolName(tool: Record<string, unknown>): string {
  const fn = tool.function as { name: string }
  return fn.name
}

describe('agent：grep/rag 检索工具 schema 拆分', () => {
  it('rag_search 与 grep_search 为两个独立 schema（函数名不同）', () => {
    expect(toolName(ragSearchTool())).toBe('rag_search')
    expect(toolName(grepSearchTool())).toBe('grep_search')
  })

  it('两个工具均暴露统一的 query 参数结构', () => {
    for (const tool of [ragSearchTool(), grepSearchTool()]) {
      const fn = tool.function as { parameters: { required: string[]; properties: Record<string, unknown> } }
      expect(fn.parameters.required).toEqual(['query'])
      expect(fn.parameters.properties.query).toBeDefined()
    }
  })

  it('系统提示的工具名随检索器切换，且含检索上限', () => {
    expect(buildSystemPrompt('grep')).toContain('grep_search')
    expect(buildSystemPrompt('bm25')).toContain('rag_search')
    expect(buildSystemPrompt('grep')).toContain(`最多允许检索 ${MAX_RAG_CALLS} 次`)
  })

  it('both 模式：系统提示同时描述两个工具及分工定位', () => {
    const prompt = buildSystemPrompt('both')
    expect(prompt).toContain('rag_search')
    expect(prompt).toContain('grep_search')
    expect(prompt).toContain('第一轮先用 rag_search')
    expect(prompt).toContain('分工')
    expect(prompt).toContain('按字面命中定位')
  })
})

describe('runQuery：轮次耗尽兜底（末位强制作答轮）', () => {
  const chunks: DocChunk[] = [
    { id: '2-体系/红松林经验.md#制造站', file: '2-体系/红松林经验.md', heading: '制造站', text: '灰毫 远牙 野鬃 红松林经验 126%', startLine: 1, endLine: 1 },
  ]

  function toolCall(name: string, args = '{"query":"红松林 经验"}') {
    return { id: 'call_1', type: 'function', function: { name, arguments: args } }
  }

  function providerResult(partial: Partial<ProviderResult>): ProviderResult {
    return {
      content: null,
      toolCalls: [],
      usage: { input: 100, output: 50, cached: 0, reasoning: 0 },
      model: 'qwen',
      truncated: false,
      ...partial,
    }
  }

  beforeEach(() => mockCall.mockReset())

  it('maxRounds 轮内模型持续请求工具，末位兜底轮不再暴露工具并产出最终答案', async () => {
    const config = loadConfig()
    config.maxRounds = 3
    const index = buildIndex(chunks)

    // 前 3 轮均返回工具调用；第 4 轮（兜底，空工具集）返回最终回答
    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('rag_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('grep_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('rag_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '灰毫 126% 最终答案' }))

    const result = await runQuery(
      { id: 'T01', category: 'fact', question: '红松林经验多少？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    // 兜底轮收到空工具集（不再暴露 rag/grep），必然产出文本答案 → finalAnswer 必非 null
    expect(result.finalAnswer).toBe('灰毫 126% 最终答案')
    expect(result.rounds).toBe(4) // 3 检索轮 + 1 兜底轮
    // 兜底轮请求时 tools 应为空数组
    const fallbackArgs = mockCall.mock.calls[3]?.[1] ?? null
    expect(fallbackArgs).toEqual([])
  })

  it('模型在某轮直接作答（无工具调用），不会多余跑兜底轮', async () => {
    const config = loadConfig()
    config.maxRounds = 3
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('rag_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '直接作答' }))

    const result = await runQuery(
      { id: 'T02', category: 'fact', question: '红松林经验多少？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('直接作答')
    expect(result.rounds).toBe(2) // 第 2 轮作答即结束，不触发兜底
  })
})
