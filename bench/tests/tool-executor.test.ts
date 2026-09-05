import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import type { DocChunk, ToolCall } from '../src/types.js'
import { createKnowledgeToolExecutor, knowledgeTool, serializeToolResult } from '../src/tool-executor.js'

const chunks: DocChunk[] = [
  {
    id: 'base/制造站.md#效率',
    file: 'base/制造站.md',
    heading: '效率',
    text: '制造站效率由干员技能决定。',
    startLine: 1,
    endLine: 1,
  },
]

function call(id: string, operation: string, params: Record<string, unknown>): ToolCall {
  return {
    id,
    name: 'knowledge',
    arguments: JSON.stringify({ operation, params }),
  }
}

describe('knowledge schema', () => {
  it.each([
    ['bm25', ['rag_search']],
    ['grep', ['grep_search']],
    ['both', ['rag_search', 'grep_search']],
    ['facts', ['lookup', 'query_operators']],
    ['hybrid', ['rag_search', 'lookup', 'query_operators']],
  ] as const)('%s 只暴露当前模式允许的 operation', (retriever, operations) => {
    const fn = knowledgeTool(retriever).function as {
      name: string
      parameters: { required: string[]; properties: { operation: { enum: string[] }; params: { oneOf: Array<{ properties?: Record<string, unknown>; required?: string[] }> } } }
    }

    expect(fn.name).toBe('knowledge')
    expect(fn.parameters.required).toEqual(['operation', 'params'])
    expect(fn.parameters.properties.operation.enum).toEqual(operations)
    expect(fn.parameters.properties.params.oneOf.length).toBeGreaterThanOrEqual(operations.length)
  })

  it('分类查询 schema 显式暴露过滤字段与正向条件约束', () => {
    const fn = knowledgeTool('facts').function as {
      parameters: { properties: { params: { oneOf: Array<{ properties: Record<string, unknown>; description: string }> } } }
    }
    const queryOperators = fn.parameters.properties.params.oneOf.find((branch) => branch.description.includes('query_operators'))
    expect(queryOperators?.properties).toEqual(expect.objectContaining({
      room: expect.any(Object),
      faction: expect.any(Object),
      profession: expect.any(Object),
      termQuery: expect.any(Object),
      excludeIds: expect.any(Object),
    }))
    expect(queryOperators?.description).toContain('至少一个正向分类条件')
  })
})

describe('knowledge executor：按批次预占工具预算', () => {
  it('剩余 2 点收到 3 个调用时按响应顺序执行前两个并拒绝第三个', async () => {
    const config = loadConfig()
    config.retriever = 'both'
    const executor = createKnowledgeToolExecutor({
      config,
      query: { id: 'BATCH-2', category: 'fact', question: '制造站效率？' },
      chunks,
      index: buildIndex(chunks),
    }, 2)

    const result = await executor.executeBatch([
      call('a', 'rag_search', { query: '制造站效率' }),
      call('b', 'grep_search', { query: '制造站' }),
      call('c', 'rag_search', { query: '超额查询' }),
    ])

    expect(result.protocolError).toBeUndefined()
    expect(result.results.map((item) => item.callId)).toEqual(['a', 'b', 'c'])
    expect(result.results.map((item) => item.status)).toEqual(['success', 'success', 'budget_exhausted'])
    expect(result.results.map((item) => item.executed)).toEqual([true, true, false])
    expect(result.snapshot).toMatchObject({ limit: 2, used: 2, requested: 3, denied: 1, executed: 2, remaining: 0 })
  })

  it('一批 7 个调用在初始 5 点时保留第 5 个证据并拒绝其余调用', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'BATCH-5', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const calls = Array.from({ length: 7 }, (_, i) => call(`call-${i + 1}`, 'rag_search', { query: `查询 ${i + 1}` }))

    const result = await executor.executeBatch(calls)

    expect(result.results.slice(0, 5).every((item) => item.executed)).toBe(true)
    expect(result.results.slice(5).map((item) => item.status)).toEqual(['budget_exhausted', 'budget_exhausted'])
    expect(result.snapshot.used).toBe(5)
    expect(result.snapshot.executed).toBe(5)
    expect(result.results[4]?.message).toContain('依据已有证据作答')
    expect(JSON.parse(serializeToolResult(result.results[4]!))).toMatchObject({ message: expect.stringContaining('依据已有证据作答') })
  })

  it('未知 operation 和无效参数占用积分但不执行底层检索', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'INVALID', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)

    const result = await executor.executeBatch([
      call('unknown', 'grep_search', { query: '不可用' }),
      call('bad', 'rag_search', {}),
    ])

    expect(result.results.map((item) => item.status)).toEqual(['unknown_operation', 'invalid_params'])
    expect(result.results.every((item) => !item.executed)).toBe(true)
    expect(result.snapshot).toMatchObject({ used: 2, executed: 0, denied: 0, remaining: 3 })
  })

  it('未知函数名也占用尝试积分，但不调用底层检索', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'UNKNOWN-FN', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)

    const result = await executor.executeBatch([{ ...call('unknown-fn', 'rag_search', { query: '查询' }), name: 'legacy_search' }])

    expect(result.results[0]).toMatchObject({ status: 'unknown_operation', executed: false })
    expect(result.snapshot).toMatchObject({ used: 1, executed: 0 })
  })

  it('缺失或重复 call ID 作为协议失败，工具不执行且预算不变', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'PROTOCOL', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)

    const result = await executor.executeBatch([
      call('same', 'rag_search', { query: '甲' }),
      call('same', 'rag_search', { query: '乙' }),
    ])

    expect(result.protocolError).toContain('重复')
    expect(result.results).toEqual([])
    expect(result.snapshot).toMatchObject({ used: 0, requested: 0, denied: 0, executed: 0 })
  })
})
