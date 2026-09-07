import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import type { DocChunk, ToolCall } from '../src/types.js'
import { createKnowledgeToolExecutor, serializeToolResult, toolSchemaMetadata, toolsForRetriever } from '../src/tool-executor.js'

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

function call(id: string, name: string, params: unknown): ToolCall {
  return { id, name, arguments: JSON.stringify(params) }
}

describe('独立函数工具 schema', () => {
  it.each([
    ['bm25', ['rag_search']],
    ['grep', ['grep_search']],
    ['both', ['rag_search', 'grep_search']],
    ['facts', ['lookup', 'query_operators']],
    ['hybrid', ['rag_search', 'lookup', 'query_operators']],
  ] as const)('%s 只暴露当前模式允许的函数工具', (retriever, names) => {
    const tools = toolsForRetriever(retriever)
    expect(tools.map((tool) => (tool.function as { name: string }).name)).toEqual(names)
    for (const tool of tools) {
      const fn = tool.function as { name: string; parameters: Record<string, unknown> }
      expect(fn.name).not.toBe('knowledge')
      expect(fn.parameters).toMatchObject({ type: 'object', additionalProperties: false })
    }
  })

  it('分类查询 schema 显式使用 anyOf 表达至少一个正向条件', () => {
    const queryOperators = toolsForRetriever('facts')
      .find((tool) => (tool.function as { name: string }).name === 'query_operators')!
    const parameters = queryOperators.function as { parameters: { properties: Record<string, unknown>; anyOf: unknown[] } }
    expect(parameters.parameters.properties).toEqual(expect.objectContaining({
      room: expect.any(Object),
      faction: expect.any(Object),
      profession: expect.any(Object),
      termQuery: expect.any(Object),
      excludeIds: expect.any(Object),
    }))
    expect(parameters.parameters.anyOf).toHaveLength(4)
  })

  it('schema 指纹只由当前实际工具数组决定', () => {
    expect(toolSchemaMetadata('bm25')).toMatchObject({ toolSchemaVersion: 2, toolNames: ['rag_search'] })
    expect(toolSchemaMetadata('bm25').toolSchemaSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(toolSchemaMetadata('bm25').toolSchemaSha256).not.toBe(toolSchemaMetadata('hybrid').toolSchemaSha256)
  })
})

describe('独立函数 executor：按批次预占工具预算', () => {
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

  it('第五次获准调用仍校验并执行，第六次拒绝', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'BATCH-5', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const calls = Array.from({ length: 6 }, (_, i) => call(`call-${i + 1}`, 'rag_search', { query: `查询 ${i + 1}` }))

    const result = await executor.executeBatch(calls)

    expect(result.results.slice(0, 5).every((item) => item.executed)).toBe(true)
    expect(result.results[5]).toMatchObject({ status: 'budget_exhausted', executed: false })
    expect(result.snapshot).toMatchObject({ used: 5, executed: 5, denied: 1 })
    expect(result.results[4]?.message).toContain('依据已有证据作答')
    expect(JSON.parse(serializeToolResult(result.results[4]!))).toMatchObject({ message: expect.stringContaining('依据已有证据作答') })
  })

  it('旧 knowledge 外壳被视为未知工具，不自动解包', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'LEGACY', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const result = await executor.executeBatch([call('legacy', 'knowledge', { operation: 'rag_search', params: { query: '查询' } })])

    expect(result.results[0]).toMatchObject({ operation: 'knowledge', status: 'unknown_operation', executed: false })
    expect(result.snapshot).toMatchObject({ used: 1, executed: 0 })
  })

  it('未知字段、空白、错误类型和只有 excludeIds 都拒绝且不执行底层检索', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'INVALID', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const result = await executor.executeBatch([
      call('a', 'lookup', { term: '   ' }),
      call('b', 'lookup', { term: '刻俄柏', extra: true }),
      call('c', 'query_operators', { excludeIds: ['刻俄柏'] }),
      call('d', 'query_operators', { room: '制造站', excludeIds: [1] }),
    ])

    expect(result.results.map((item) => item.status)).toEqual(['invalid_params', 'invalid_params', 'invalid_params', 'invalid_params'])
    expect(result.results.every((item) => !item.executed)).toBe(true)
    expect(result.snapshot).toMatchObject({ used: 4, executed: 0, denied: 0, remaining: 1 })
    expect(result.results[0]?.data).toContain('term')
  })

  it('重复 call ID 作为协议失败，工具不执行且预算不变', async () => {
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

  it.each([
    ['', '空字符串'],
    ['   ', '空白字符串'],
  ])('%s call ID（%s）作为协议失败，工具不执行且预算不变', async (id) => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'PROTOCOL-EMPTY', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)

    const result = await executor.executeBatch([call(id, 'rag_search', { query: '查询' })])

    expect(result.protocolError).toContain('call ID')
    expect(result.results).toEqual([])
    expect(result.snapshot).toMatchObject({ used: 0, requested: 0, denied: 0, executed: 0 })
  })

  it('缺失 call ID 作为协议失败，工具不执行且预算不变', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'PROTOCOL-MISSING', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)

    const result = await executor.executeBatch([{
      name: 'rag_search',
      arguments: '{"query":"查询"}',
    } as unknown as ToolCall])

    expect(result.protocolError).toContain('call ID')
    expect(result.results).toEqual([])
    expect(result.snapshot).toMatchObject({ used: 0, requested: 0, denied: 0, executed: 0 })
  })

  it('非字符串 call ID 作为协议失败，工具不执行且预算不变', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'PROTOCOL-TYPE', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)

    const result = await executor.executeBatch([{
      id: 123,
      name: 'rag_search',
      arguments: '{"query":"查询"}',
    } as unknown as ToolCall])

    expect(result.protocolError).toContain('必须是字符串')
    expect(result.results).toEqual([])
    expect(result.snapshot).toMatchObject({ used: 0, requested: 0, denied: 0, executed: 0 })
  })
})
