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

  it('能力块只暴露当前独立工具，并描述工具与积分预算', () => {
    const prompt = buildSystemPrompt('hybrid', '规则', 2)

    expect(prompt).toContain('可用工具：rag_search、facts_search、read_section')
    expect(prompt).toContain('工具积分预算：2 点')
    expect(prompt).toContain('每个准入工具调用占 1 点，参数错误也占点')
    expect(prompt).toContain('同批调用分别计费')
    expect(prompt).toContain('余额用尽后新增调用不会执行')
    expect(prompt).not.toContain('工具调用上限：2 次')
  })

  it('同批 3 个调用只执行预算内的前 2 个，并按原顺序回写结果', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    config.toolBudget = 2
    const trace = createQueryTrace({ id: 'AUTO-BATCH', category: 'fact', question: '制造站？' })
    mockCall
      .mockResolvedValueOnce(result({ toolCalls: [
        toolCall('a', 'rag_search'),
        toolCall('b', 'read_section', { section_id: 'sec-不存在' }),
        toolCall('c', 'rag_search', { query: '超额' }),
      ] }))
      .mockResolvedValueOnce(result({ content: '最终答案' }))

    const agentResult = await runQuery(
      { id: 'AUTO-BATCH', category: 'fact', question: '制造站？' },
      { config, thinking: 'off', dry: false, trace },
      chunks,
      buildIndex(chunks),
    )

    expect(agentResult.finalAnswer).toBe('最终答案')
    expect(agentResult.budget).toMatchObject({ limit: 2, used: 2, requested: 3, denied: 1, executed: 2, remaining: 0 })
    expect(agentResult.records[0]?.toolBatch).toMatchObject({
      requested: 3,
      granted: 2,
      executed: 2,
      denied: 1,
      errors: 0,
      budgetBefore: 2,
      budgetAfter: 0,
    })
    expect(trace.summary).toMatchObject({
      modelSteps: 2,
      toolBatches: 1,
      toolCallsRequested: 3,
      toolCallsExecuted: 2,
      toolCallsDenied: 1,
      feedbackUsed: false,
      budget: { used: 2, remaining: 0 },
    })
    expect(agentResult.toolTrace[0]).toEqual(['rag_search', 'read_section', 'rag_search'])
    const toolMessages = (mockCall.mock.calls[1]?.[0] as Array<{ role: string; tool_call_id?: string; content: string }>).filter((message) => message.role === 'tool')
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['a', 'b', 'c'])
    expect(JSON.parse(toolMessages[2]!.content)).toMatchObject({ status: 'budget_exhausted', executed: false, budget_remaining: 0 })
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
    expect(agentResult.budget.used).toBe(5)
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
    expect(agentResult.budget.used).toBe(0)
  })
})
