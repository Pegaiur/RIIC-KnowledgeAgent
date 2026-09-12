import { describe, expect, it, beforeEach, vi } from 'vitest'
import { buildSystemPrompt, runQuery } from '../src/agent.js'
import { loadConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import type { DocChunk, ProviderResult } from '../src/types.js'
import { createQueryTrace } from '../src/trace.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

const chunks: DocChunk[] = [
  { id: 'base/制造站.md#效率', file: 'base/制造站.md', heading: '效率', text: '制造站效率由技能决定。', startLine: 1, endLine: 1 },
]

function result(partial: Partial<ProviderResult>): ProviderResult {
  return {
    content: null,
    toolCalls: [],
    usage: { input: 100, output: 50, cached: 0, reasoning: 0 },
    model: 'qwen',
    truncated: false,
    ...partial,
  }
}

function toolCall(id: string, name = 'rag_search', params: Record<string, unknown> = { query: '制造站' }) {
  return { id, name, arguments: JSON.stringify(params) }
}

describe('Agent auto 主循环', () => {
  beforeEach(() => mockCall.mockReset())

  it('能力块只暴露当前独立工具，并描述双上限预算', () => {
    const prompt = buildSystemPrompt('hybrid', '规则', 2)

    expect(prompt).toContain('可用工具：rag_search、facts_search、read_section')
    expect(prompt).toContain('2 点成功额度 + 10 次获准尝试上限')
    expect(prompt).toContain('仅非空执行成功扣 1 点')
    expect(prompt).toContain('每次模型步骤只准入首个工具调用')
    expect(prompt).toContain('同批额外调用只被拒绝并回写')
    expect(prompt).toContain('任一上限用尽后新增调用不会执行')
    expect(prompt).not.toContain('工具调用上限：2 次')
    expect(prompt).not.toContain('同批调用逐项结算')
  })

  it('同批超量：只准入首项，其余按位置拒绝并按原顺序回写', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    config.toolBudget = 2
    const trace = createQueryTrace({ id: 'AUTO-BATCH', category: 'fact', question: '制造站？' })
    mockCall
      .mockResolvedValueOnce(result({ toolCalls: [
        toolCall('a', 'rag_search'),
        toolCall('b', 'read_section', { section_id: 'sec-不存在' }),
        toolCall('c', 'rag_search', { query: '制造站效率' }),
        toolCall('d', 'rag_search', { query: '超额' }),
      ] }))
      .mockResolvedValueOnce(result({ content: '最终答案' }))

    const agentResult = await runQuery(
      { id: 'AUTO-BATCH', category: 'fact', question: '制造站？' },
      { config, thinking: 'off', dry: false, trace },
      chunks,
      buildIndex(chunks),
    )

    expect(agentResult.finalAnswer).toBe('最终答案')
    expect(agentResult.budget).toMatchObject({ successLimit: 2, successUsed: 1, attemptLimit: 10, attemptUsed: 1, requested: 4, denied: 3, executed: 1, remaining: 1 })
    expect(agentResult.records[0]?.toolBatch).toMatchObject({
      requested: 4,
      granted: 1,
      executed: 1,
      denied: 3,
      errors: 0,
      attempts: 1,
      successes: 1,
      budgetBefore: 2,
      budgetAfter: 1,
    })
    expect(trace.summary).toMatchObject({
      modelSteps: 2,
      toolBatches: 1,
      toolCallsRequested: 4,
      toolCallsExecuted: 1,
      toolCallsDenied: 3,
      feedbackUsed: false,
      budget: { successUsed: 1, remaining: 1 },
    })
    expect(agentResult.toolTrace[0]).toEqual(['rag_search'])
    const toolMessages = (mockCall.mock.calls[1]?.[0] as Array<{ role: string; tool_call_id?: string; content: string }>).filter((message) => message.role === 'tool')
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['a', 'b', 'c', 'd'])
    expect(JSON.parse(toolMessages[0]!.content)).toMatchObject({ status: 'success', executed: true })
    expect(JSON.parse(toolMessages[1]!.content)).toMatchObject({ status: 'protocol_rejected', executed: false, budget_remaining: 1 })
    expect(JSON.parse(toolMessages[1]!.content).message).toContain('单调用')
    expect(JSON.parse(toolMessages[1]!.content).message).toContain('在下一步重新提出')
    // trace 仍逐项记录超量项：原 call ID、原参数、拒绝状态与原因，不伪填命中或执行证据。
    const toolEvents = trace.events.filter((event) => event.type === 'tool_call')
    expect(toolEvents.map((event) => [event.callId, event.status, event.executed]))
      .toEqual([['a', 'success', true], ['b', 'protocol_rejected', false], ['c', 'protocol_rejected', false], ['d', 'protocol_rejected', false]])
    const rejectedEvent = toolEvents[1]!
    expect(rejectedEvent.rawArguments).toBe('{"section_id":"sec-不存在"}')
    expect(rejectedEvent.actualParams).toBeUndefined()
    expect(rejectedEvent.hitIds).toBeUndefined()
    expect(rejectedEvent.fulltextRanges).toBeUndefined()
    expect(JSON.parse(rejectedEvent.writtenContent!)).toMatchObject({ status: 'protocol_rejected', executed: false })
    expect(rejectedEvent.reason).toContain('单调用')
  })

  it('允许五次有依赖的工具步骤后由模型作答，不再使用旧 maxRounds 上限', async () => {
    const config = loadConfig()
    config.toolBudget = 5
    const calls = Array.from({ length: 5 }, (_, index) => result({ toolCalls: [toolCall(`step-${index + 1}`)] }))
    mockCall.mockResolvedValueOnce(calls[0])
      .mockResolvedValueOnce(calls[1])
      .mockResolvedValueOnce(calls[2])
      .mockResolvedValueOnce(calls[3])
      .mockResolvedValueOnce(calls[4])
      .mockResolvedValueOnce(result({ content: '五步后的答案' }))

    const agentResult = await runQuery(
      { id: 'AUTO-DEPEND', category: 'fact', question: '依赖查询' },
      { config, thinking: 'off', dry: false },
      chunks,
      buildIndex(chunks),
    )

    expect(agentResult.finalAnswer).toBe('五步后的答案')
    expect(agentResult.modelSteps).toBe(6)
    expect(agentResult.budget).toMatchObject({ successUsed: 5, attemptUsed: 5 })
  })

  it('未调用工具直接作答最多触发一次宿主回馈，再次直接作答标记未完成', async () => {
    const config = loadConfig()
    config.feedbackOnNoToolAnswer = true
    const trace = createQueryTrace({ id: 'AUTO-FEEDBACK', category: 'fact', question: '需要查证' })
    mockCall
      .mockResolvedValueOnce(result({ content: '未经查证的答案' }))
      .mockResolvedValueOnce(result({ content: '仍未查证的答案' }))

    const agentResult = await runQuery(
      { id: 'AUTO-FEEDBACK', category: 'fact', question: '需要查证' },
      { config, thinking: 'off', dry: false, trace },
      chunks,
      buildIndex(chunks),
    )

    expect(agentResult.status).toBe('failed')
    expect(agentResult.terminationReason).toBe('no_tool_after_feedback')
    expect(agentResult.finalAnswer).toBeNull()
    const messages = mockCall.mock.calls[1]?.[0] as Array<{ role: string; content: string }>
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(2)
    expect(messages[2]?.content).toContain('请先调用本次可用的知识库工具查证')
    expect(agentResult.feedbackUsed).toBe(true)
    expect(agentResult.records).toHaveLength(2)
    expect(trace.summary).toMatchObject({ terminationReason: 'no_tool_after_feedback', feedbackUsed: true, toolBatches: 0 })
  })

  it('预算归零后仍继续提供独立工具/auto，模型可基于拒绝结果作答', async () => {
    const config = loadConfig()
    config.toolBudget = 1
    mockCall
      .mockResolvedValueOnce(result({ toolCalls: [toolCall('first')] }))
      .mockResolvedValueOnce(result({ toolCalls: [toolCall('denied')] }))
      .mockResolvedValueOnce(result({ content: '基于已有证据的答案' }))

    const agentResult = await runQuery(
      { id: 'AUTO-EMPTY-BUDGET', category: 'fact', question: '预算边界' },
      { config, thinking: 'off', dry: false },
      chunks,
      buildIndex(chunks),
    )

    expect(agentResult.finalAnswer).toBe('基于已有证据的答案')
    expect((mockCall.mock.calls[1]?.[1] as Array<Record<string, unknown>>)[0]).toMatchObject({ function: { name: 'rag_search' } })
    expect((mockCall.mock.calls[2]?.[1] as Array<Record<string, unknown>>)[0]).toMatchObject({ function: { name: 'rag_search' } })
  })

  it('获准尝试上限耗尽后只拒绝、不新增执行，模型仍可作答', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    config.toolBudget = 5
    config.toolAttemptLimit = 1
    mockCall
      .mockResolvedValueOnce(result({ toolCalls: [toolCall('first')] }))
      .mockResolvedValueOnce(result({ toolCalls: [toolCall('second')] }))
      .mockResolvedValueOnce(result({ content: '基于已有证据的答案' }))

    const agentResult = await runQuery(
      { id: 'AUTO-ATTEMPT-LIMIT', category: 'fact', question: '尝试上限' },
      { config, thinking: 'off', dry: false },
      chunks,
      buildIndex(chunks),
    )

    expect(agentResult.finalAnswer).toBe('基于已有证据的答案')
    expect(agentResult.budget).toMatchObject({ successLimit: 5, successUsed: 1, attemptLimit: 1, attemptUsed: 1, requested: 2, denied: 1, executed: 1 })
    expect(agentResult.records[1]?.toolBatch).toMatchObject({ requested: 1, granted: 0, executed: 0, denied: 1, attempts: 0, successes: 0 })
    const toolMessages = (mockCall.mock.calls[2]?.[0] as Array<{ role: string; tool_call_id?: string; content: string }>)
      .filter((message) => message.role === 'tool' && message.tool_call_id === 'second')
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['second'])
    expect(JSON.parse(toolMessages[0]!.content).status).toBe('budget_exhausted')
    expect(JSON.parse(toolMessages[0]!.content).message).toContain('获准尝试次数已用尽')
  })

  it('批内重复 call ID 直接失败，不回写不完整工具结果', async () => {
    const config = loadConfig()
    mockCall.mockResolvedValueOnce(result({ toolCalls: [toolCall('same'), toolCall('same')] }))

    const agentResult = await runQuery(
      { id: 'AUTO-PROTOCOL', category: 'fact', question: '协议错误' },
      { config, thinking: 'off', dry: false },
      chunks,
      buildIndex(chunks),
    )

    expect(agentResult.status).toBe('failed')
    expect(agentResult.terminationReason).toBe('protocol_error')
    expect(mockCall).toHaveBeenCalledTimes(1)
    expect(agentResult.budget).toMatchObject({ successUsed: 0, attemptUsed: 0 })
  })
})
