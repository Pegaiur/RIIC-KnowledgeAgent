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
    ['bm25', ['rag_search', 'read_section']],
    ['grep', ['grep_search']],
    ['both', ['rag_search', 'grep_search', 'read_section']],
    ['facts', ['facts_search']],
    ['hybrid', ['rag_search', 'facts_search', 'read_section']],
  ] as const)('%s 只暴露当前模式允许的函数工具', (retriever, names) => {
    const tools = toolsForRetriever(retriever)
    expect(tools.map((tool) => (tool.function as { name: string }).name)).toEqual(names)
    for (const tool of tools) {
      const fn = tool.function as { name: string; parameters: Record<string, unknown> }
      expect(fn.name).not.toBe('knowledge')
      expect(fn.parameters).toMatchObject({ type: 'object', additionalProperties: false })
    }
  })

  it('facts_search schema 只有 query 一个必填字段，不暴露分类或组合参数', () => {
    const facts = toolsForRetriever('facts')[0]!
    const fn = facts.function as { name: string; description: string; parameters: { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean; anyOf?: unknown[] } }
    expect(fn.name).toBe('facts_search')
    expect(fn.description).toContain('完整词条')
    expect(fn.description).toContain('已确认别名')
    expect(fn.description).toContain('同名命中全部返回')
    expect(fn.description).toContain('不支持简写合称')
    expect(fn.parameters.properties).toEqual({ query: expect.any(Object) })
    expect(fn.parameters.required).toEqual(['query'])
    expect(fn.parameters.additionalProperties).toBe(false)
    expect(fn.parameters.anyOf).toBeUndefined()
  })

  it('schema 指纹只由当前实际工具数组决定', () => {
    expect(toolSchemaMetadata('bm25')).toMatchObject({ toolSchemaVersion: 7, toolNames: ['rag_search', 'read_section'] })
    expect(toolSchemaMetadata('bm25').toolSchemaSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(toolSchemaMetadata('bm25').toolSchemaSha256).not.toBe(toolSchemaMetadata('hybrid').toolSchemaSha256)
  })

  it('拼接的多个名称仍是合法 facts_search，未命中时执行为空查并扣点', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({
      config,
      query: { id: 'LOOKUP-CONCAT', category: 'fact', question: '拼接名称边界' },
      chunks: [],
      index: buildIndex([]),
    }, 1)

    const result = await executor.executeBatch([
      call('concat', 'facts_search', { query: '不存在技能甲＝不存在技能乙' }),
    ])

    expect(result.results[0]).toMatchObject({ status: 'empty', executed: true, factsResult: { matchedCount: 0, returnedCount: 0 } })
    expect(result.snapshot).toMatchObject({ used: 1, executed: 1, remaining: 0 })
  })

  it('facts store 只在实际 facts 调用后通知观测回调，RAG 调用不提前加载', async () => {
    const config = loadConfig()
    const used: unknown[] = []
    const failed: unknown[] = []
    config.retriever = 'bm25'
    const rag = createKnowledgeToolExecutor({
      config,
      query: { id: 'OBSERVE-RAG', category: 'fact', question: '检索' },
      chunks,
      index: buildIndex(chunks),
      onFactsStoreUsed: (store) => used.push(store),
      onFactsStoreLoadFailed: (error) => failed.push(error),
    }, 1)
    await rag.executeBatch([call('rag', 'rag_search', { query: '制造站' })])
    expect(used).toHaveLength(0)
    expect(failed).toHaveLength(0)

    config.retriever = 'facts'
    const baseline = createKnowledgeToolExecutor({
      config,
      query: { id: 'OBSERVE-FACTS', category: 'fact', question: '事实' },
      chunks: [],
      index: buildIndex([]),
    }, 1)
    const baselineResult = await baseline.executeBatch([call('facts', 'facts_search', { query: '刻俄柏' })])

    const facts = createKnowledgeToolExecutor({
      config,
      query: { id: 'OBSERVE-FACTS', category: 'fact', question: '事实' },
      chunks: [],
      index: buildIndex([]),
      onFactsStoreUsed: (store) => { used.push(store); throw new Error('观测回调异常') },
      onFactsStoreLoadFailed: (error) => failed.push(error),
    }, 1)
    const observedResult = await facts.executeBatch([call('facts', 'facts_search', { query: '刻俄柏' })])
    expect(used).toHaveLength(1)
    expect(failed).toHaveLength(0)
    expect(observedResult).toEqual(baselineResult)
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

  it('facts 第五次合法空查仍执行，第六次才拒绝，并按卡计数', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'FACTS-BUDGET', category: 'fact', question: '预算边界' }, chunks, index: buildIndex(chunks) }, 5)
    const calls = [
      call('fact-1', 'facts_search', { query: '刻俄柏' }),
      call('fact-2', 'facts_search', { query: '刻俄柏' }),
      call('fact-3', 'facts_search', { query: '刻俄柏' }),
      call('fact-4', 'facts_search', { query: '刻俄柏' }),
      call('fact-5', 'facts_search', { query: '__不存在的规范名_核查__' }),
      call('fact-6', 'facts_search', { query: '制造站' }),
    ]

    const result = await executor.executeBatch(calls)
    expect(result.results.slice(0, 4).every((item) => item.status === 'success' && item.executed)).toBe(true)
    expect(result.results[4]).toMatchObject({ status: 'empty', executed: true, factsResult: { matchedCount: 0, returnedCount: 0, complete: true }, message: expect.stringContaining('依据已有证据作答') })
    expect(result.results[5]).toMatchObject({ status: 'budget_exhausted', executed: false })
    expect(result.results[5]?.factsResult).toBeUndefined()
    expect(result.snapshot).toMatchObject({ used: 5, requested: 6, executed: 5, denied: 1, remaining: 0 })
  })

  it('facts 第五次坏参数消耗准入点但不执行，第六次仍按预算拒绝', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'FACTS-INVALID-BUDGET', category: 'fact', question: '预算参数边界' }, chunks, index: buildIndex(chunks) }, 5)
    const calls = [
      call('invalid-fact-1', 'facts_search', { query: '刻俄柏' }),
      call('invalid-fact-2', 'facts_search', { query: '刻俄柏' }),
      call('invalid-fact-3', 'facts_search', { query: '刻俄柏' }),
      call('invalid-fact-4', 'facts_search', { query: '刻俄柏' }),
      call('invalid-fact-5', 'facts_search', { query: '   ' }),
      call('invalid-fact-6', 'facts_search', { query: '刻俄柏' }),
    ]

    const result = await executor.executeBatch(calls)
    expect(result.results[4]).toMatchObject({ status: 'invalid_params', executed: false })
    expect(result.results[4]?.factsResult).toBeUndefined()
    expect(result.results[5]).toMatchObject({ status: 'budget_exhausted', executed: false })
    expect(result.snapshot).toMatchObject({ used: 5, requested: 6, executed: 4, denied: 1, remaining: 0 })
  })

  it('T12 facts 宽查按完整卡集合返回，计数按卡去重且不套 RAG 字符上限', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'FACTS-WIDE', category: 'fact', question: '进驻设施的干员' }, chunks, index: buildIndex(chunks) }, 5)
    const result = await executor.executeBatch([call('wide', 'facts_search', { query: '制造站' })])
    const item = result.results[0]!
    expect(item.status).toBe('success')
    expect(item.factsResult).toMatchObject({
      matchedCount: item.hitIds?.length,
      returnedCount: item.hitIds?.length,
      complete: true,
      scope: { query: '制造站' },
    })
    expect(new Set(item.hitIds).size).toBe(item.hitIds?.length ?? 0)
    expect(item.data.length).toBeGreaterThan(config.maxContextChars)
  })

  it('facts 结果元数据携带查询级 resolution，序列化与正文保持同源', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'FACTS-RESOLUTION', category: 'fact', question: '别名查询' }, chunks, index: buildIndex(chunks) }, 2)
    const result = await executor.executeBatch([call('alias', 'facts_search', { query: '维娜' })])
    const item = result.results[0]!
    expect(item).toMatchObject({
      status: 'success',
      factsResult: {
        factsResultVersion: 3,
        matchedCount: 1,
        returnedCount: 1,
        complete: true,
        resolution: { paths: [{ kind: 'alias', term: '维娜', targets: ['operator:维娜·维多利亚'] }] },
      },
    })
    const envelope = JSON.parse(serializeToolResult(item)) as Record<string, any>
    expect(envelope).toMatchObject({ factsResultVersion: 3, resolution: { paths: [{ kind: 'alias', term: '维娜' }] } })
    expect(envelope.data).toContain('别名：维娜 → 维娜·维多利亚')
  })

  it('旧 knowledge 外壳被视为未知工具，不自动解包', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'LEGACY', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const result = await executor.executeBatch([call('legacy', 'knowledge', { operation: 'rag_search', params: { query: '查询' } })])

    expect(result.results[0]).toMatchObject({ operation: 'knowledge', status: 'unknown_operation', executed: false })
    expect(result.snapshot).toMatchObject({ used: 1, executed: 0 })
  })

  it.each(['facts', 'hybrid'] as const)('%s 模式收到历史 lookup 或 query_operators 名称时拒绝执行，不暗中转译', async (retriever) => {
    const config = loadConfig()
    config.retriever = retriever
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'LEGACY-FACTS', category: 'fact', question: '历史入口' }, chunks, index: buildIndex(chunks) }, 2)
    const result = await executor.executeBatch([
      call('old-lookup', 'lookup', { term: '刻俄柏' }),
      call('old-query', 'query_operators', { room: '制造站' }),
    ])

    expect(result.results).toMatchObject([
      { operation: 'lookup', status: 'unknown_operation', executed: false },
      { operation: 'query_operators', status: 'unknown_operation', executed: false },
    ])
    expect(result.results.every((item) => item.factsResult === undefined)).toBe(true)
    expect(result.snapshot).toMatchObject({ used: 2, requested: 2, executed: 0, remaining: 0 })
  })

  it('未知字段、空白、错误类型和只有 excludeIds 都拒绝且不执行底层检索', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'INVALID', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const result = await executor.executeBatch([
      call('a', 'facts_search', { query: '   ' }),
      call('b', 'facts_search', { query: '刻俄柏', extra: true }),
      call('c', 'facts_search', { excludeIds: ['刻俄柏'] }),
      call('d', 'facts_search', { query: 1 }),
    ])

    expect(result.results.map((item) => item.status)).toEqual(['invalid_params', 'invalid_params', 'invalid_params', 'invalid_params'])
    expect(result.results.every((item) => !item.executed)).toBe(true)
    expect(result.snapshot).toMatchObject({ used: 4, executed: 0, denied: 0, remaining: 1 })
    expect(result.results[0]?.data).toContain('query')
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
