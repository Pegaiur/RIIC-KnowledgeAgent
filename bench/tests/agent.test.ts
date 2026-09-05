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
import { knowledgeTool } from '../src/tool-executor.js'
import type { ProviderResult } from '../src/types.js'
import type { DocChunk } from '../src/types.js'
import { createQueryTrace } from '../src/trace.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

describe('agent：统一 knowledge 工具 schema', () => {
  it('只暴露 knowledge，并由 operation 枚举模式能力', () => {
    const fn = knowledgeTool('hybrid').function as {
      name: string
      parameters: { required: string[]; properties: { operation: { enum: string[] }; params: unknown } }
    }
    expect(fn.name).toBe('knowledge')
    expect(fn.parameters.required).toEqual(['operation', 'params'])
    expect(fn.parameters.properties.operation.enum).toEqual(['rag_search', 'lookup', 'query_operators'])
  })

  it('所有模式注入同一份决策契约，工具名随检索器切换', () => {
    expect(buildSystemPrompt('grep')).toContain('grep_search')
    expect(buildSystemPrompt('bm25')).toContain('rag_search')
    expect(buildSystemPrompt('grep')).toContain('明日方舟基建查询 Agent 决策契约')
    expect(buildSystemPrompt('grep')).toContain('工具积分预算：5 点')
  })

  it.each([
    ['bm25', 'rag_search'],
    ['grep', 'grep_search'],
    ['both', 'rag_search、grep_search'],
    ['facts', 'lookup、query_operators'],
    ['hybrid', 'rag_search、lookup、query_operators'],
  ] as const)('%s 模式的能力块精确列出 operation', (retriever, expectedTools) => {
    const prompt = buildSystemPrompt(retriever, '唯一规则正文')
    const capabilityBlock = prompt.split('## 本次运行能力\n')[1]
    expect(capabilityBlock).toContain('- 可用工具：knowledge\n')
    expect(capabilityBlock).toContain(`- knowledge operation：${expectedTools}\n`)
  })

  it('both 模式：运行时能力块列出实际暴露的两个工具', () => {
    const prompt = buildSystemPrompt('both')
    expect(prompt).toContain('rag_search')
    expect(prompt).toContain('grep_search')
    expect(prompt).toContain('可用工具：knowledge')
    expect(prompt).toContain('knowledge operation：rag_search、grep_search')
  })

  it('hybrid 模式：系统提示同时描述 RAG 与 facts 三个工具', () => {
    const prompt = buildSystemPrompt('hybrid')
    expect(prompt).toContain('明日方舟基建查询 Agent 决策契约')
    expect(prompt).toContain('技能的解锁与提升')
    expect(prompt).toContain('rag_search')
    expect(prompt).toContain('lookup')
    expect(prompt).toContain('query_operators')
    expect(prompt).toContain('可用工具：knowledge')
    expect(prompt).toContain('knowledge operation：rag_search、lookup、query_operators')
  })

  it('人工契约明确记录验收中的设施与组合术语边界', () => {
    const prompt = buildSystemPrompt('bm25')
    expect(prompt).toContain('4:00 是允许补充的每日发放时点')
    expect(prompt).toContain('琴柳当前是控制中枢/宿舍侧干员')
    expect(prompt).toContain('裂响当前是制造站经验散件')
    expect(prompt).toContain('称为“龙舌兰组”')
    expect(prompt).toContain('特殊订单边界')
    expect(prompt).toContain('每一笔订单分别判断')
    expect(prompt).toContain('不写成游戏会自动把干员调离工作设施')
    expect(prompt).toContain('禁止输出 5%/10%/45%/90% 等固定效率')
    expect(prompt).toContain('维娜·维多利亚是可选增强')
    expect(prompt).toContain('禁止补塞雷娅、星熊等额外成员')
    expect(prompt).toContain('S02 只有火龙 S 黑角与麒麟 R 夜刀进驻控制中枢时才读取控制中枢技能')
    expect(prompt).toContain('S07 焰尾与薇薇安娜属于中枢侧')
  })

  it('人工规则只从调用方提供的 AGENTS 内容注入一次', () => {
    const prompt = buildSystemPrompt('facts', '唯一规则正文')
    expect(prompt.match(/唯一规则正文/g)).toHaveLength(1)
    expect(prompt).toContain('可用工具：knowledge')
    expect(prompt).toContain('knowledge operation：lookup、query_operators')
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
    let params: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(args) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) params = parsed as Record<string, unknown>
    } catch {
      // 保留空参数，让统一执行器返回结构化参数错误。
    }
    return { id: 'call_1', name: 'knowledge', arguments: JSON.stringify({ operation: name, params }) }
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

  it('工具预算内模型持续请求工具，预算归零后仍暴露 knowledge 并产出最终答案', async () => {
    const config = loadConfig()
    config.toolBudget = 5
    const index = buildIndex(chunks)

    // 前 3 轮均返回工具调用；第 4 轮仍暴露 knowledge，返回最终回答
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

    expect(result.finalAnswer).toBe('灰毫 126% 最终答案')
    expect(result.rounds).toBe(4)
    const fallbackArgs = mockCall.mock.calls[3]?.[1] ?? null
    expect(fallbackArgs).toMatchObject([{ function: { name: 'knowledge' } }])
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
    let params: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(args) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) params = parsed as Record<string, unknown>
    } catch {
      // 保留空参数，让统一执行器返回结构化参数错误。
    }
    return { id: 'call_1', name: 'knowledge', arguments: JSON.stringify({ operation: name, params }) }
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
    config.toolBudget = 5
    const query = { id: 'TRACE-1', category: 'fact' as const, question: '原始问题' }
    const trace = createQueryTrace(query)
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'call_trace', name: 'knowledge', arguments: '{"operation":"rag_search","params":{}}' }] }))
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
    expect(llmEvent).toMatchObject({ type: 'llm_call', round: 1, offeredTools: ['knowledge'], content: null })
    const toolEvent = trace.events[1]
    expect(toolEvent).toMatchObject({
      type: 'tool_call',
      round: 1,
      callId: 'call_trace',
      tool: 'rag_search',
      rawArguments: '{"operation":"rag_search","params":{}}',
      actualParams: undefined,
      reason: 'rag_search 的 query 必须是非空字符串',
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
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'control-call', name: 'knowledge', arguments: '{"operation":"rag_search","params":{"query":"需要先检索"}}' }] }))
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
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'invalid', name: 'knowledge', arguments: '{"operation":"rag_search","params":{}}' }] }))
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
