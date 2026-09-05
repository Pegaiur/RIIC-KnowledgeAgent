import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  buildSystemPrompt,
  grepSearchTool,
  loadKnowledgeAgentInstructions,
  MAX_RAG_CALLS,
  ragSearchTool,
  runQuery,
} from '../src/agent.js'
import { buildIndex } from '../src/retriever.js'
import { loadConfig } from '../src/config.js'
import type { ProviderResult } from '../src/types.js'
import type { DocChunk } from '../src/types.js'
import { createQueryTrace } from '../src/trace.js'

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

  it('所有模式注入同一份决策契约，工具名随检索器切换', () => {
    expect(buildSystemPrompt('grep')).toContain('grep_search')
    expect(buildSystemPrompt('bm25')).toContain('rag_search')
    expect(buildSystemPrompt('grep')).toContain('明日方舟基建查询 Agent 决策契约')
    expect(buildSystemPrompt('grep')).toContain(`工具调用上限：${MAX_RAG_CALLS} 次`)
  })

  it.each([
    ['bm25', 'rag_search'],
    ['grep', 'grep_search'],
    ['both', 'rag_search、grep_search'],
    ['facts', 'lookup、query_operators'],
    ['hybrid', 'rag_search、lookup、query_operators'],
  ] as const)('%s 模式的能力块精确列出实际工具', (retriever, expectedTools) => {
    const prompt = buildSystemPrompt(retriever, '唯一规则正文')
    const capabilityBlock = prompt.split('## 本次运行能力\n')[1]
    expect(capabilityBlock).toContain(`- 可用工具：${expectedTools}\n`)
  })

  it('both 模式：运行时能力块列出实际暴露的两个工具', () => {
    const prompt = buildSystemPrompt('both')
    expect(prompt).toContain('rag_search')
    expect(prompt).toContain('grep_search')
    expect(prompt).toContain('可用工具：rag_search、grep_search')
  })

  it('hybrid 模式：系统提示同时描述 RAG 与 facts 三个工具', () => {
    const prompt = buildSystemPrompt('hybrid')
    expect(prompt).toContain('明日方舟基建查询 Agent 决策契约')
    expect(prompt).toContain('技能的解锁与提升')
    expect(prompt).toContain('rag_search')
    expect(prompt).toContain('lookup')
    expect(prompt).toContain('query_operators')
    expect(prompt).toContain('可用工具：rag_search、lookup、query_operators')
  })

  it('人工规则只从调用方提供的 AGENTS 内容注入一次', () => {
    const prompt = buildSystemPrompt('facts', '唯一规则正文')
    expect(prompt.match(/唯一规则正文/g)).toHaveLength(1)
    expect(prompt).toContain('可用工具：lookup、query_operators')
    expect(prompt).not.toContain('结构化排版')
  })

  it('AGENTS 文件为空时使用中文错误快速失败', () => {
    const root = mkdtempSync(join(tmpdir(), 'rag-agent-empty-'))
    try {
      mkdirSync(join(root, 'knowledge'))
      writeFileSync(join(root, 'knowledge', 'AGENTS.md'), '  \n', 'utf-8')
      expect(() => loadKnowledgeAgentInstructions(root)).toThrowError('查询 Agent 决策契约为空')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('runQuery：轮次耗尽兜底（末位强制作答轮）', () => {
  const chunks: DocChunk[] = [
    { id: '2-体系/红松林经验.md#制造站', file: '2-体系/红松林经验.md', heading: '制造站', text: '灰毫 远牙 野鬃 红松林经验 126%', startLine: 1, endLine: 1 },
  ]

  function toolCall(name: string, args = '{"query":"红松林 经验"}') {
    // ToolCall 为扁平形状（provider 层已把 OpenAI 原始 function.name 摊平），mock 直接对齐
    return { id: 'call_1', name, arguments: args }
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

  it('优先使用单次基准运行传入的 AGENTS 快照', async () => {
    const config = loadConfig()
    config.minRagCalls = 0
    const index = buildIndex(chunks)
    mockCall.mockResolvedValueOnce(providerResult({ content: '答案' }))

    await runQuery(
      { id: 'T00', category: 'fact', question: '测试问题' },
      { config, agentInstructions: '固定契约快照', thinking: 'off', dry: false },
      chunks,
      index,
    )

    const messages = mockCall.mock.calls[0]?.[0] as Array<{ role: string; content: string }>
    expect(messages[0]?.content).toContain('固定契约快照')
  })

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
    // 注入记录：rag 与 grep 各成功注入同一块（去重），第 3 次检索超上限不注入
    expect(result.injectedIds).toEqual(['2-体系/红松林经验.md#制造站'])
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

describe('runQuery：注入片段记录（injectedIds）', () => {
  function toolCall(name: string, args = '{"query":"甲乙"}') {
    // ToolCall 为扁平形状（provider 层已把 OpenAI 原始 function.name 摊平），mock 直接对齐
    return { id: 'call_1', name, arguments: args }
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

  it('rag 注入按 maxContextChars 预算判定：块起始偏移超预算不计入', async () => {
    const chunks: DocChunk[] = [
      { id: 'a#1', file: 'a.md', heading: '甲乙', text: 'x'.repeat(50), startLine: 1, endLine: 1 },
      { id: 'b#2', file: 'b.md', heading: '乙', text: 'y'.repeat(50), startLine: 1, endLine: 1 },
    ]
    const config = loadConfig()
    config.topK = 2
    // 第一块（头部 ~18 字符 + 50 正文 ≈ 68）起点 0 < 60 计入；第二块起点 ~68 ≥ 60 不计入
    config.maxContextChars = 60
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('rag_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '答案' }))

    const result = await runQuery(
      { id: 'T03', category: 'fact', question: '甲乙是什么？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )
    expect(result.injectedIds).toEqual(['a#1'])
  })

  it('预算充足时全部命中块计入，按注入顺序去重', async () => {
    const chunks: DocChunk[] = [
      { id: 'a#1', file: 'a.md', heading: '甲乙', text: 'x'.repeat(10), startLine: 1, endLine: 1 },
      { id: 'b#2', file: 'b.md', heading: '乙', text: 'y'.repeat(10), startLine: 1, endLine: 1 },
    ]
    const config = loadConfig()
    config.topK = 2
    config.maxContextChars = 12000
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('rag_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '答案' }))

    const result = await runQuery(
      { id: 'T04', category: 'fact', question: '甲乙是什么？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )
    expect(result.injectedIds).toEqual(['a#1', 'b#2'])
  })
})

describe('runQuery：trace 事件记录', () => {
  const chunks: DocChunk[] = []

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

  it('记录 LLM、工具和实际回写文本，并保留参数回退原因', async () => {
    const config = loadConfig()
    config.minRagCalls = 1
    config.maxRounds = 1
    const query = { id: 'TRACE-1', category: 'fact' as const, question: '原始问题' }
    const trace = createQueryTrace(query)
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'call_trace', name: 'rag_search', arguments: '{' }] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    const result = await runQuery(
      query,
      { config, thinking: 'off', dry: false, trace },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('最终答案')
    expect(trace.events.map((event) => event.type)).toEqual(['llm_call', 'tool_call', 'llm_call'])
    const llmEvent = trace.events[0]
    expect(llmEvent).toMatchObject({ type: 'llm_call', round: 1, offeredTools: ['rag_search'], content: null })
    const toolEvent = trace.events[1]
    expect(toolEvent).toMatchObject({
      type: 'tool_call',
      round: 1,
      callId: 'call_trace',
      tool: 'rag_search',
      rawArguments: '{',
      actualParams: { query: '原始问题' },
      hitIds: [],
      injectedIds: [],
      reason: 'query 参数不是有效 JSON，已回退为题目原文',
      writtenContent: '（无匹配片段）',
    })
    expect(trace.events[2]).toMatchObject({ type: 'llm_call', round: 2, content: '最终答案' })
  })

  it('记录最少检索约束追加的 control 事件', async () => {
    const config = loadConfig()
    config.minRagCalls = 1
    config.maxRounds = 2
    const query = { id: 'TRACE-2', category: 'fact' as const, question: '需要先检索' }
    const trace = createQueryTrace(query)
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ content: '被约束的提前回答' }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'control-call', name: 'rag_search', arguments: '{"query":"需要先检索"}' }] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, index)

    expect(trace.events.map((event) => event.type)).toEqual(['llm_call', 'control', 'llm_call', 'tool_call', 'llm_call'])
    expect(trace.events[1]).toMatchObject({ type: 'control', round: 1, kind: 'min_retrieval' })
  })
})
