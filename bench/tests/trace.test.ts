import { describe, expect, it } from 'vitest'
import type { BenchQuery } from '../src/types.js'
import { createQueryTrace, markTraceFailed, serializeTrace } from '../src/trace.js'

const QUERY: BenchQuery = { id: 'TRACE-UNIT', category: 'fact', question: '测试记录' }

describe('trace 记录模型', () => {
  it('失败时保留第一处阶段定位', () => {
    const trace = createQueryTrace(QUERY)

    markTraceFailed(trace, { stage: 'llm', message: '第一次失败', round: 1 })
    markTraceFailed(trace, { stage: 'runner', message: '兜底失败' })

    expect(trace.status).toBe('failed')
    expect(trace.failure).toEqual({ stage: 'llm', message: '第一次失败', round: 1 })
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
