import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  buildSystemPrompt,
  loadKnowledgeAgentInstructions,
  runQuery,
} from '../src/agent.js'
import { buildIndex } from '../src/retriever.js'
import { loadConfig } from '../src/config.js'
import { toolsForRetriever } from '../src/tool-executor.js'
import type { ProviderResult } from '../src/types.js'
import type { DocChunk } from '../src/types.js'
import { createQueryTrace } from '../src/trace.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

describe('agent：独立函数工具 schema', () => {
  it('按模式直接暴露独立函数工具', () => {
    expect(toolsForRetriever('hybrid', 3).map((tool) => (tool.function as { name: string }).name))
      .toEqual(['rag_search', 'facts_search', 'read_section'])
  })

  it('所有模式注入同一份决策契约，工具名随检索器切换', () => {
    expect(buildSystemPrompt('hybrid')).toContain('facts_search')
    expect(buildSystemPrompt('bm25')).toContain('rag_search')
    expect(buildSystemPrompt('hybrid')).toContain('明日方舟基建查询 Agent 决策契约')
    expect(buildSystemPrompt('hybrid')).toContain('5 点成功额度 + 10 次获准尝试上限')
  })

  it('决策契约说明 facts_search 可传多个完整词条且不硬编码上限', () => {
    const prompt = buildSystemPrompt('hybrid')
    expect(prompt).toContain('可一次传入多个完整词条')
    expect(prompt).toContain('数组不是复合过滤语法')
    expect(prompt).not.toContain('只接受一个完整词条')
    expect(prompt).not.toMatch(/最多\s*\d+\s*个/)
  })

  it.each([
    ['bm25', 'rag_search、read_section'],
    ['hybrid', 'rag_search、facts_search、read_section'],
  ] as const)('%s 模式的能力块精确列出工具名', (retriever, expectedTools) => {
    const prompt = buildSystemPrompt(retriever, '唯一规则正文')
    const capabilityBlock = prompt.split('## 本次运行能力\n')[1]
    expect(capabilityBlock).toContain(`- 可用工具：${expectedTools}\n`)
  })

  it('hybrid 模式：系统提示同时描述 RAG 与 facts 两个工具', () => {
    const prompt = buildSystemPrompt('hybrid')
    expect(prompt).toContain('明日方舟基建查询 Agent 决策契约')
    expect(prompt).toContain('保留原文条件与限定')
    expect(prompt).toContain('rag_search')
    expect(prompt).toContain('facts_search')
    expect(prompt).toContain('可用工具：rag_search、facts_search、read_section')
  })

  it('系统提示使用实际配置的成功额度与获准尝试上限', () => {
    const prompt = buildSystemPrompt('bm25', '规则', 3, 4)

    expect(prompt).toContain('3 点成功额度 + 4 次获准尝试上限')
  })

  it('人工契约保留通用证据边界，不注入基线题号或固定答案', () => {
    const prompt = buildSystemPrompt('bm25')
    expect(prompt).toContain('冲突时以更直接、对象更明确的记录为准')
    expect(prompt).toContain('保留原文条件与限定')
    expect(prompt).not.toMatch(/\b[FGS]\d{2}\b/)
    expect(prompt).not.toContain('最终答案必须逐项原样出现')
  })

  it('人工规则只从调用方提供的 AGENTS 内容注入一次', () => {
    const prompt = buildSystemPrompt('hybrid', '唯一规则正文')
    expect(prompt.match(/唯一规则正文/g)).toHaveLength(1)
    expect(prompt).toContain('可用工具：rag_search、facts_search、read_section')
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

  it('未提供 systemPrompt 时按实际配置构建双上限提示', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    config.toolBudget = 2
    config.toolAttemptLimit = 6
    config.feedbackOnNoToolAnswer = false
    mockCall.mockResolvedValueOnce(providerResult({ content: '答案' }))

    await runQuery(
      { id: 'PROMPT-DEFAULT', category: 'fact', question: '提示构建' },
      { config, thinking: 'off', dry: false },
      chunks,
      buildIndex(chunks),
    )

    const messages = mockCall.mock.calls[0]?.[0] as Array<{ role: string; content: string }>
    expect(messages[0]?.content).toContain('2 点成功额度 + 6 次获准尝试上限')
  })

  it('工具预算内模型持续请求工具，预算归零后仍暴露工具并产出最终答案', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    config.toolBudget = 5
    const index = buildIndex(chunks)

    // 前 3 轮均返回工具调用；第 4 轮仍暴露独立工具，返回最终回答
    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('rag_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('rag_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('rag_search') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '灰毫 126% 最终答案' }))

    const result = await runQuery(
      { id: 'T01', category: 'fact', question: '红松林经验多少？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('灰毫 126% 最终答案')
    expect(result.rounds).toBe(4)
    const fallbackArgs = mockCall.mock.calls[3]?.[1] ?? null
    expect((fallbackArgs as Array<{ function: { name: string } }>).map((tool) => tool.function.name))
      .toEqual(['rag_search', 'read_section'])
    expect(result.injectedIds).toEqual(['2-体系/红松林经验.md#制造站'])
  })

  it('模型在某轮直接作答（无工具调用），不会多余跑兜底轮', async () => {
    const config = loadConfig()
    config.toolBudget = 5
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
    config.retriever = 'bm25'
    config.toolBudget = 5
    const query = { id: 'TRACE-1', category: 'fact' as const, question: '原始问题' }
    const trace = createQueryTrace(query)
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'call_trace', name: 'rag_search', arguments: '{}' }] }))
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
    expect(llmEvent).toMatchObject({ type: 'llm_call', round: 1, offeredTools: ['rag_search', 'read_section'], content: null })
    const toolEvent = trace.events[1]
    expect(toolEvent).toMatchObject({
      type: 'tool_call',
      round: 1,
      callId: 'call_trace',
      tool: 'rag_search',
      rawArguments: '{}',
      actualParams: undefined,
      reason: expect.stringContaining('rag_search'),
    })
    expect(JSON.parse((toolEvent as { writtenContent: string }).writtenContent)).toMatchObject({ status: 'invalid_params', executed: false })
    expect(trace.events[2]).toMatchObject({ type: 'llm_call', round: 2, content: '最终答案' })
  })

  it('记录最少检索约束追加的 control 事件', async () => {
    const config = loadConfig()
    config.toolBudget = 5
    const query = { id: 'TRACE-2', category: 'fact' as const, question: '需要先检索' }
    const trace = createQueryTrace(query)
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ content: '被约束的提前回答' }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'control-call', name: 'rag_search', arguments: '{"query":"需要先检索"}' }] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, index)

    expect(trace.events.map((event) => event.type)).toEqual(['llm_call', 'control', 'llm_call', 'tool_call', 'llm_call'])
    expect(trace.events[1]).toMatchObject({ type: 'control', round: 1, kind: 'no_tool_answer_feedback' })
  })

  it('provider 在已有模型响应后失败时返回失败结果并保留前面记录', async () => {
    const config = loadConfig()
    config.toolBudget = 5
    const query = { id: 'FAIL-KEEP-1', category: 'fact' as const, question: '保留前序记录' }
    const trace = createQueryTrace(query)
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ content: '第一步暂不作答' }))
      .mockRejectedValueOnce(new Error('第二次请求失败'))

    const result = await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, index)

    expect(result.status).toBe('failed')
    expect(result.terminationReason).toBe('llm_error')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]?.output).toBe(50)
    expect(trace.status).toBe('failed')
    expect(trace.events.map((event) => event.type)).toEqual(['llm_call', 'control', 'llm_call'])
  })

  it('provider 协议失败已观察 usage 时也写入失败记录和 HTTP 台账', async () => {
    const config = loadConfig()
    const query = { id: 'FAIL-USAGE-1', category: 'fact' as const, question: '协议失败保留用量' }
    const trace = createQueryTrace(query)
    const failure = Object.assign(new Error('响应无 choices'), {
      providerFailure: true,
      usage: { input: 123, output: 45, cached: 0, reasoning: 0, completeness: 'complete' as const },
      model: 'qwen',
      httpAttempts: [{
        attempt: 1,
        status: 200,
        outcome: 'accepted' as const,
        usage: { input: 123, output: 45, cached: 0, reasoning: 0, completeness: 'complete' as const },
      }],
    })
    mockCall.mockRejectedValueOnce(failure)

    const result = await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, buildIndex(chunks))

    expect(result.status).toBe('failed')
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({ input: 123, output: 45, httpAttempts: [{ attempt: 1, status: 200 }] })
    expect(trace.events[0]).toMatchObject({ usage: { input: 123, output: 45 }, httpAttempts: [{ attempt: 1 }] })
  })

  it('工具批次统计不依赖 trace，参数错误也计入 errors', async () => {
    const config = loadConfig()
    config.feedbackOnNoToolAnswer = false
    const query = { id: 'METRIC-NO-TRACE', category: 'fact' as const, question: '统计不依赖 trace' }
    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'invalid', name: 'rag_search', arguments: '{}' }] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    const result = await runQuery(query, { config, thinking: 'off', dry: false }, chunks, buildIndex(chunks))
    const batch = result.records[0]?.toolBatch

    expect(batch?.errors).toBe(1)
    expect(batch?.resultChars).toBeGreaterThan(0)
  })

  it('单题总超时返回 cancelled，不启动新的模型步骤', async () => {
    const config = loadConfig()
    config.toolBudget = 5
    config.sessionTimeoutMs = 5
    const query = { id: 'TIMEOUT-1', category: 'fact' as const, question: '超时测试' }
    const trace = createQueryTrace(query)
    const index = buildIndex(chunks)

    mockCall.mockImplementation(() => new Promise<ProviderResult>((resolve) => {
      setTimeout(() => resolve(providerResult({ content: '过晚的回答' })), 50)
    }))

    const result = await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, index)

    expect(result.status).toBe('cancelled')
    expect(result.terminationReason).toBe('timeout')
    expect(result.finalAnswer).toBeNull()
    expect(mockCall).toHaveBeenCalledTimes(1)
    expect(trace.failure?.stage).toBe('timeout')
  })
})
