import { describe, expect, it } from 'vitest'
import type { BenchQuery } from '../src/types.js'
import { createQueryTrace, markTraceFailed, serializeTrace } from '../src/trace.js'

const QUERY: BenchQuery = { id: 'TRACE-UNIT', category: 'fact', question: '测试记录' }

describe('trace 记录模型', () => {
  it('历史 v5 工具消息经实际 trace 序列化与脱敏后保留原版本和路径', () => {
    const trace = createQueryTrace(QUERY)
    const legacy = {
      status: 'success', executed: true, data: '测试正文 sensitive-key', budget_remaining: 4,
      factsResultVersion: 5, matchedCount: 1, returnedCount: 1, complete: true,
      scope: { query: '刻俄柏' },
      resolution: { paths: [{ kind: 'exact', category: 'operator', term: '刻俄柏', memberIds: ['刻俄柏'] }] },
    }
    trace.events.push({
      type: 'tool_call', round: 1, callId: 'legacy', tool: 'facts_search',
      rawArguments: '{"query":"刻俄柏"}', actualParams: { query: '刻俄柏' },
      elapsedMs: 0, status: 'success', executed: true, budgetRemaining: 4,
      hitIds: ['刻俄柏'], injectedIds: ['刻俄柏'], writtenContent: JSON.stringify(legacy),
    })

    const serialized = serializeTrace(trace, ['sensitive-key'])
    const restored = JSON.parse(serialized)
    const message = JSON.parse(restored.events[0].writtenContent)
    expect(message).toEqual({ ...legacy, data: '测试正文 [已遮蔽]' })
    expect(message.resolution).not.toHaveProperty('items')
    expect(restored.events[0]).toMatchObject({
      rawArguments: '{"query":"刻俄柏"}', actualParams: { query: '刻俄柏' },
      hitIds: ['刻俄柏'], injectedIds: ['刻俄柏'],
    })
    expect(serialized).not.toContain('sensitive-key')
    expect(trace.events[0]).toMatchObject({ writtenContent: JSON.stringify(legacy) })
  })

  it('失败时保留第一处阶段定位', () => {
    const trace = createQueryTrace(QUERY)

    markTraceFailed(trace, { stage: 'llm', message: '第一次失败', round: 1 })
    markTraceFailed(trace, { stage: 'runner', message: '兜底失败' })

    expect(trace.status).toBe('failed')
    expect(trace.failure).toEqual({ stage: 'llm', message: '第一次失败', round: 1 })
  })

  it('支持取消状态及终止原因', () => {
    const trace = createQueryTrace(QUERY)

    markTraceFailed(trace, { stage: 'timeout', message: '单题总超时', round: 2 })

    expect(trace.status).toBe('cancelled')
    expect(trace.terminationReason).toBe('timeout')
  })

  it('支持单题可观测性摘要', () => {
    const trace = createQueryTrace(QUERY)
    trace.summary = {
      modelSteps: 3,
      toolBatches: 1,
      toolCallsRequested: 2,
      toolCallsGranted: 2,
      toolCallsExecuted: 1,
      toolCallsDenied: 0,
      toolErrors: 1,
      toolResultChars: 80,
      feedbackUsed: false,
      terminationReason: 'tool_error',
      budget: { successLimit: 5, successUsed: 2, attemptLimit: 10, attemptUsed: 3, requested: 3, denied: 1, executed: 2, remaining: 3 },
    }

    expect(serializeTrace(trace, [])).toContain('"toolBatches":1')
    expect(serializeTrace(trace, [])).toContain('"terminationReason":"tool_error"')
  })

  it('只在序列化写盘副本时遮蔽已知敏感值', () => {
    const trace = createQueryTrace(QUERY)
    trace.events.push({
      type: 'llm_call',
      round: 1,
      offeredTools: ['rag_search'],
      elapsedMs: 1,
      content: '错误 sensitive-key',
      toolCalls: [{ id: 'call_1', name: 'rag_search', arguments: '{"query":"sensitive-key"}' }],
      error: '请求包含 sensitive-key',
    })

    const serialized = serializeTrace(trace, ['sensitive-key'])
    expect(serialized).not.toContain('sensitive-key')
    expect(serialized).toContain('[已遮蔽]')
    expect(trace.events[0]).toMatchObject({ content: '错误 sensitive-key' })
  })
})
