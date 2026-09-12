import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import type { DocChunk, ToolCall } from '../src/types.js'
import { getCardStore } from '../src/facts/store.js'
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

/** facts 词条上限的测试取值；断言 schema maxItems 由该上限派生。 */
const FACTS_LIMIT = 3

describe('独立函数工具 schema', () => {
  it.each([
    ['bm25', ['rag_search', 'read_section']],
    ['hybrid', ['rag_search', 'facts_search', 'read_section']],
  ] as const)('%s 只暴露当前模式允许的函数工具', (retriever, names) => {
    const tools = toolsForRetriever(retriever, FACTS_LIMIT)
    expect(tools.map((tool) => (tool.function as { name: string }).name)).toEqual(names)
    for (const tool of tools) {
      const fn = tool.function as { name: string; parameters: Record<string, unknown> }
      expect(fn.name).not.toBe('knowledge')
      expect(fn.parameters).toMatchObject({ type: 'object', additionalProperties: false })
    }
  })

  it('facts_search schema 以 queries 数组为唯一必填字段，maxItems 由配置上限派生', () => {
    const facts = toolsForRetriever('hybrid', FACTS_LIMIT).find((tool) => (tool.function as { name: string }).name === 'facts_search')!
    const fn = facts.function as { name: string; description: string; parameters: { properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: boolean; anyOf?: unknown[] } }
    expect(fn.name).toBe('facts_search')
    expect(fn.description).toContain('完整词条')
    expect(fn.description).toContain('已确认别名')
    expect(fn.description).toContain('同名命中全部返回')
    expect(fn.description).toContain('短名按登记返回全部长名，不做消歧')
    expect(fn.description).toContain('不支持简写合称')
    expect(fn.description).toContain('可一次传入多个完整词条')
    expect(fn.description).toContain('数组不是复合过滤语法')
    expect(fn.description).not.toMatch(/最多\s*\d+\s*个/)
    expect(Object.keys(fn.parameters.properties)).toEqual(['queries'])
    expect(fn.parameters.properties.queries).toMatchObject({ type: 'array', minItems: 1, maxItems: FACTS_LIMIT, items: { type: 'string' } })
    expect(fn.parameters.required).toEqual(['queries'])
    expect(fn.parameters.additionalProperties).toBe(false)
    expect(fn.parameters.anyOf).toBeUndefined()
  })

  it('facts schema 的 maxItems 随配置上限变化且先后生成互不污染', () => {
    const maxItemsFor = (limit: number): number => {
      const facts = toolsForRetriever('hybrid', limit).find((tool) => (tool.function as { name: string }).name === 'facts_search')!
      const params = (facts.function as { parameters: { properties: { queries: { maxItems: number } } } }).parameters
      return params.properties.queries.maxItems
    }

    expect(maxItemsFor(2)).toBe(2)
    expect(maxItemsFor(5)).toBe(5)
    // 再次以同一上限生成应与首次一致，证明无跨配置缓存残留。
    expect(maxItemsFor(2)).toBe(2)
    expect(toolSchemaMetadata('hybrid', 2).toolSchemaSha256).not.toBe(toolSchemaMetadata('hybrid', 5).toolSchemaSha256)
  })

  it('参数错误示例推荐 queries 数组，rag_search 示例保持 query', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    const executor = createKnowledgeToolExecutor({
      config,
      query: { id: 'EXAMPLE', category: 'fact', question: '示例迁移' },
      chunks,
      index: buildIndex(chunks),
    }, 5)

    const result = await executor.executeBatch([
      call('facts-bad', 'facts_search', {}),
      call('rag-bad', 'rag_search', {}),
      call('read-bad', 'read_section', {}),
    ])

    expect(result.results[0]?.data).toContain('{"queries":["完整词条"]}')
    expect(result.results[0]?.data).not.toContain('{"query":"查询"}')
    expect(result.results[1]?.data).toContain('{"query":"查询"}')
    expect(result.results[2]?.data).toContain('{"section_id":"检索结果中的小节 ID"}')
  })

  it('schema 指纹只由当前实际工具数组决定', () => {
    expect(toolSchemaMetadata('bm25', FACTS_LIMIT)).toMatchObject({ toolSchemaVersion: 11, toolNames: ['rag_search', 'read_section'] })
    expect(toolSchemaMetadata('bm25', FACTS_LIMIT).toolSchemaSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(toolSchemaMetadata('bm25', FACTS_LIMIT).toolSchemaSha256).not.toBe(toolSchemaMetadata('hybrid', FACTS_LIMIT).toolSchemaSha256)
  })

  it('拼接的多个名称仍是合法 facts_search，未命中时执行为空查并扣点', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    const executor = createKnowledgeToolExecutor({
      config,
      query: { id: 'LOOKUP-CONCAT', category: 'fact', question: '拼接名称边界' },
      chunks: [],
      index: buildIndex([]),
    }, 1)

    const result = await executor.executeBatch([
      call('concat', 'facts_search', { queries: ['不存在技能甲＝不存在技能乙'] }),
    ])

    expect(result.results[0]).toMatchObject({ status: 'empty', executed: true, factsResult: { matchedCount: 0, returnedCount: 0 } })
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 1, executed: 1, remaining: 1 })
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

    config.retriever = 'hybrid'
    const baseline = createKnowledgeToolExecutor({
      config,
      query: { id: 'OBSERVE-FACTS', category: 'fact', question: '事实' },
      chunks: [],
      index: buildIndex([]),
    }, 1)
    const baselineResult = await baseline.executeBatch([call('facts', 'facts_search', { queries: ['刻俄柏'] })])

    const facts = createKnowledgeToolExecutor({
      config,
      query: { id: 'OBSERVE-FACTS', category: 'fact', question: '事实' },
      chunks: [],
      index: buildIndex([]),
      onFactsStoreUsed: (store) => { used.push(store); throw new Error('观测回调异常') },
      onFactsStoreLoadFailed: (error) => failed.push(error),
    }, 1)
    const observedResult = await facts.executeBatch([call('facts', 'facts_search', { queries: ['刻俄柏'] })])
    expect(used).toHaveLength(1)
    expect(failed).toHaveLength(0)
    expect(observedResult).toEqual(baselineResult)
  })
})

describe('独立函数 executor：逐项结算双上限预算', () => {
  it('空结果与参数错误不扣成功额度，仅非空成功扣点，超限后按成功额度拒绝', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'SETTLE', category: 'fact', question: '制造站效率？' }, chunks, index: buildIndex(chunks) }, 2)

    const result = await executor.executeBatch([
      call('a', 'rag_search', {}),
      call('b', 'rag_search', { query: '制造站效率' }),
      call('c', 'rag_search', { query: '不存在的词条' }),
      call('d', 'rag_search', { query: '制造站效率' }),
      call('e', 'rag_search', { query: '制造站效率' }),
    ])

    expect(result.results.map((item) => item.status)).toEqual(['invalid_params', 'success', 'empty', 'success', 'budget_exhausted'])
    expect(result.results.map((item) => item.executed)).toEqual([false, true, true, true, false])
    expect(result.results[4]?.message).toContain('成功额度已用尽')
    expect(result.results[4]?.factsResult).toBeUndefined()
    expect(result.snapshot).toMatchObject({ successLimit: 2, successUsed: 2, attemptLimit: 10, attemptUsed: 4, requested: 5, denied: 1, executed: 3, remaining: 0 })
  })

  it('RAG 未送达正文证据（仅截断头部）判空并免扣成功额度，不拒绝后续调用', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    config.maxContextChars = 1
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'RAG-NO-BODY', category: 'fact', question: '制造站效率？' }, chunks, index: buildIndex(chunks) }, 1)

    const result = await executor.executeBatch([
      call('a', 'rag_search', { query: '制造站效率' }),
      call('b', 'rag_search', { query: '制造站效率' }),
    ])

    expect(result.results.map((item) => item.status)).toEqual(['empty', 'empty'])
    expect(result.results.every((item) => item.executed)).toBe(true)
    expect(result.results[0]?.injectedIds).toEqual([])
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 2, denied: 0, executed: 2, remaining: 1 })
  })

  it('尝试次数上限与成败无关：连续失败占满后拒绝，成功余额仍在', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    config.toolAttemptLimit = 3
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'ATTEMPT', category: 'fact', question: '参数试错' }, chunks, index: buildIndex(chunks) }, 5)
    const calls = Array.from({ length: 5 }, (_, i) => call(`bad-${i + 1}`, 'rag_search', {}))

    const result = await executor.executeBatch(calls)

    expect(result.results.map((item) => item.status)).toEqual(['invalid_params', 'invalid_params', 'invalid_params', 'budget_exhausted', 'budget_exhausted'])
    expect(result.results[2]?.message).toContain('获准尝试次数已用尽')
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 3, attemptLimit: 3, requested: 5, denied: 2, executed: 0, remaining: 5 })
  })

  it('两项上限同时用尽时优先提示成功额度', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    config.toolAttemptLimit = 1
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'BOTH', category: 'fact', question: '双限' }, chunks, index: buildIndex(chunks) }, 1)

    const result = await executor.executeBatch([
      call('a', 'rag_search', { query: '制造站效率' }),
      call('b', 'rag_search', { query: '制造站效率' }),
    ])

    expect(result.results[0]).toMatchObject({ status: 'success' })
    expect(result.results[0]?.message).toContain('成功额度已用尽')
    expect(result.results[1]).toMatchObject({ status: 'budget_exhausted' })
    expect(result.results[1]?.message).toContain('成功额度已用尽')
    expect(result.snapshot).toMatchObject({ successLimit: 1, successUsed: 1, attemptLimit: 1, attemptUsed: 1, denied: 1, remaining: 0 })
  })

  it('最后一次获准尝试耗尽尝试次数时提示尝试次数已用尽，即使成功余额大于零', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    config.toolAttemptLimit = 2
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'LAST-ATTEMPT', category: 'fact', question: '空结果边界' }, chunks, index: buildIndex(chunks) }, 5)

    const result = await executor.executeBatch([
      call('a', 'rag_search', { query: '不存在的词条甲' }),
      call('b', 'rag_search', { query: '不存在的词条乙' }),
    ])

    expect(result.results.every((item) => item.status === 'empty')).toBe(true)
    expect(result.results[1]?.message).toContain('获准尝试次数已用尽')
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 2, attemptLimit: 2, remaining: 5 })
  })

  it('批内顺序结算：前一项参数错误不阻止后一项使用最后一个成功额度', async () => {
    const config = loadConfig()
    config.retriever = 'bm25'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'ORDER', category: 'fact', question: '逐项结算' }, chunks, index: buildIndex(chunks) }, 1)

    const result = await executor.executeBatch([
      call('a', 'rag_search', {}),
      call('b', 'rag_search', { query: '制造站效率' }),
      call('c', 'rag_search', { query: '制造站效率' }),
    ])

    expect(result.results.map((item) => item.status)).toEqual(['invalid_params', 'success', 'budget_exhausted'])
    expect(result.snapshot).toMatchObject({ successUsed: 1, attemptUsed: 2, requested: 3, denied: 1 })
  })

  it('第五次成功扣点后拒绝第六次，每项余额按结算后状态生成', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'BATCH-5', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const calls = Array.from({ length: 6 }, (_, i) => call(`call-${i + 1}`, 'rag_search', { query: '制造站效率' }))

    const result = await executor.executeBatch(calls)

    expect(result.results.slice(0, 5).every((item) => item.status === 'success' && item.executed)).toBe(true)
    expect(result.results.map((item) => item.budgetRemaining)).toEqual([4, 3, 2, 1, 0, 0])
    expect(result.results[5]).toMatchObject({ status: 'budget_exhausted', executed: false })
    expect(result.results[4]?.message).toContain('成功额度已用尽')
    expect(JSON.parse(serializeToolResult(result.results[4]!))).toMatchObject({ message: expect.stringContaining('依据已有证据作答') })
    expect(result.snapshot).toMatchObject({ successUsed: 5, attemptUsed: 5, executed: 5, denied: 1 })
  })

  it('facts 空查不扣成功额度，后续合法调用仍执行', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'FACTS-BUDGET', category: 'fact', question: '预算边界' }, chunks, index: buildIndex(chunks) }, 5)
    const calls = [
      call('fact-1', 'facts_search', { queries: ['刻俄柏'] }),
      call('fact-2', 'facts_search', { queries: ['__不存在的规范名_核查__'] }),
      call('fact-3', 'facts_search', { queries: ['制造站'] }),
    ]

    const result = await executor.executeBatch(calls)
    expect(result.results[0]).toMatchObject({ status: 'success', executed: true })
    expect(result.results[1]).toMatchObject({ status: 'empty', executed: true, factsResult: { matchedCount: 0, returnedCount: 0, complete: true } })
    expect(result.results[2]).toMatchObject({ status: 'success', executed: true })
    expect(result.snapshot).toMatchObject({ successUsed: 2, attemptUsed: 3, requested: 3, denied: 0, executed: 3, remaining: 3 })
  })

  it('T12 facts 宽查按完整卡集合返回，计数按卡去重且不套 RAG 字符上限', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'FACTS-WIDE', category: 'fact', question: '进驻设施的干员' }, chunks, index: buildIndex(chunks) }, 5)
    const result = await executor.executeBatch([call('wide', 'facts_search', { queries: ['制造站'] })])
    const item = result.results[0]!
    expect(item.status).toBe('success')
    expect(item.factsResult).toMatchObject({
      matchedCount: item.hitIds?.length,
      returnedCount: item.hitIds?.length,
      complete: true,
      scope: { queries: ['制造站'] },
    })
    expect(new Set(item.hitIds).size).toBe(item.hitIds?.length ?? 0)
    expect(item.data.length).toBeGreaterThan(config.maxContextChars)
  })

  it('facts 结果元数据携带查询级 resolution，序列化与正文保持同源', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'FACTS-RESOLUTION', category: 'fact', question: '别名查询' }, chunks, index: buildIndex(chunks) }, 2)
    const result = await executor.executeBatch([call('alias', 'facts_search', { queries: ['维娜'] })])
    const item = result.results[0]!
    expect(item).toMatchObject({
      status: 'success',
      factsResult: {
        factsResultVersion: 6,
        matchedCount: 1,
        returnedCount: 1,
        complete: true,
        resolution: { items: [{ index: 0, query: '维娜', status: 'success', canonicals: ['维娜·维多利亚'], message: null, paths: [{ kind: 'alias', term: '维娜', targets: ['operator:维娜·维多利亚'] }] }] },
      },
    })
    const envelope = JSON.parse(serializeToolResult(item)) as Record<string, any>
    expect(envelope).toMatchObject({ factsResultVersion: 6, resolution: { items: [{ index: 0, status: 'success', paths: [{ kind: 'alias', term: '维娜' }] }] } })
    expect(envelope.data).toContain('别名：维娜 → 维娜·维多利亚')
  })

  it('旧 knowledge 外壳被视为未知工具，不自动解包', async () => {
    const config = loadConfig()
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'LEGACY', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const result = await executor.executeBatch([call('legacy', 'knowledge', { operation: 'rag_search', params: { query: '查询' } })])

    expect(result.results[0]).toMatchObject({ operation: 'knowledge', status: 'unknown_operation', executed: false })
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 1, executed: 0 })
  })

  it.each(['hybrid'] as const)('%s 模式收到历史 lookup 或 query_operators 名称时拒绝执行，不暗中转译', async (retriever) => {
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
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 2, requested: 2, executed: 0, remaining: 2 })
  })

  it('未知字段、空白、错误类型和只有 excludeIds 都拒绝且不执行底层检索', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    const executor = createKnowledgeToolExecutor({ config, query: { id: 'INVALID', category: 'fact', question: '查询' }, chunks, index: buildIndex(chunks) }, 5)
    const result = await executor.executeBatch([
      call('a', 'facts_search', { query: '   ' }),
      call('b', 'facts_search', { query: '刻俄柏', extra: true }),
      call('c', 'facts_search', { excludeIds: ['刻俄柏'] }),
      call('d', 'facts_search', { query: 1 }),
    ])

    expect(result.results.map((item) => item.status)).toEqual(['invalid_params', 'invalid_params', 'invalid_params', 'invalid_params'])
    expect(result.results.every((item) => !item.executed)).toBe(true)
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 4, executed: 0, denied: 0, remaining: 5 })
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
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 0, requested: 0, denied: 0, executed: 0 })
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
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 0, requested: 0, denied: 0, executed: 0 })
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
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 0, requested: 0, denied: 0, executed: 0 })
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
    expect(result.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 0, requested: 0, denied: 0, executed: 0 })
  })
})

describe('facts_search 多词分段、去重与原子性', () => {
  afterEach(() => vi.restoreAllMocks())

  function multiExecutor(injectedIds?: string[]) {
    const config = loadConfig()
    config.retriever = 'hybrid'
    return createKnowledgeToolExecutor({
      config,
      query: { id: 'MULTI', category: 'fact', question: '多词条分段' },
      chunks: [],
      index: buildIndex([]),
      injectedIds,
    }, 5)
  }

  it('重复词保留各自分段，正文只首现一次，底层只查询一次', async () => {
    const spy = vi.spyOn(getCardStore(), 'factsSearch')
    const batch = await multiExecutor().executeBatch([call('dup', 'facts_search', { queries: ['刻俄柏', '刻俄柏'] })])
    const item = batch.results[0]!
    expect(item.status).toBe('success')
    expect(item.factsResult?.scope).toEqual({ queries: ['刻俄柏', '刻俄柏'] })
    expect(item.factsResult).toMatchObject({ factsResultVersion: 6, matchedCount: 1, returnedCount: 1, complete: true })
    expect(item.factsResult?.resolution.items).toEqual([
      { index: 0, query: '刻俄柏', status: 'success', paths: expect.any(Array), canonicals: ['刻俄柏'], message: null },
      { index: 1, query: '刻俄柏', status: 'success', paths: expect.any(Array), canonicals: ['刻俄柏'], message: null },
    ])
    expect(item.data).toContain('第 1 段｜刻俄柏')
    expect(item.data).toContain('第 2 段｜刻俄柏')
    expect(item.data).toContain('刻俄柏（已在第 1 段返回，此处仅列名）')
    expect(item.data.match(/【刻俄柏】/gu) ?? []).toHaveLength(1)
    expect(spy.mock.calls.filter(([term]) => term === '刻俄柏')).toHaveLength(1)
  })

  it('别名重叠按首次出现段保留完整卡，后续段仅列名并引用首次段号', async () => {
    const batch = await multiExecutor().executeBatch([call('overlap', 'facts_search', { queries: ['推王', '推进之王'] })])
    const item = batch.results[0]!
    expect(item.hitIds).toEqual(['推进之王', '维娜·维多利亚'])
    expect(item.data).toContain('第 1 段｜推王')
    expect(item.data).toContain('第 2 段｜推进之王')
    expect(item.data).toContain('推进之王（已在第 1 段返回，此处仅列名）')
    expect(item.data.match(/【推进之王】/gu) ?? []).toHaveLength(1)
  })

  it('去重仅限本次调用：另一次 facts_search 仍返回完整卡', async () => {
    const executor = multiExecutor()
    const first = await executor.executeBatch([call('re-1', 'facts_search', { queries: ['刻俄柏'] })])
    const second = await executor.executeBatch([call('re-2', 'facts_search', { queries: ['刻俄柏'] })])
    expect(first.results[0]?.data).toContain('【刻俄柏】')
    expect(second.results[0]?.data).toContain('【刻俄柏】')
    expect(second.results[0]?.data).not.toContain('已在第')
  })

  it('中途 store 抛错整次 error + fatal，无部分注入、不扣成功额度、占一次获准尝试', async () => {
    const store = getCardStore()
    const original = store.factsSearch.bind(store)
    vi.spyOn(store, 'factsSearch').mockImplementation((term: string) => {
      if (term === '制造站') throw new Error('中途 store 抛错')
      return original(term)
    })
    const sharedInjected: string[] = []
    const batch = await multiExecutor(sharedInjected).executeBatch([call('boom', 'facts_search', { queries: ['刻俄柏', '制造站'] })])
    const item = batch.results[0]!
    expect(item).toMatchObject({ status: 'error', executed: true, fatal: true })
    expect(item.message).toBe('中途 store 抛错')
    expect(item.data).not.toContain('第 1 段')
    expect(item.factsResult).toBeUndefined()
    expect(sharedInjected).toEqual([])
    expect(batch.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 1, executed: 1, denied: 0, remaining: 5 })
  })

  it('含非法项或重复项的超限数组仍整批拒绝且不查询 store', async () => {
    const spy = vi.spyOn(getCardStore(), 'factsSearch')
    const batch = await multiExecutor().executeBatch([call('over', 'facts_search', { queries: [1, '刻俄柏', '刻俄柏', '制造站'] })])
    const item = batch.results[0]!
    expect(item).toMatchObject({ status: 'invalid_params', executed: false })
    expect(item.factsResult).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('恰好等于上限的数组被接受，逐项执行且空查不扣点', async () => {
    const spy = vi.spyOn(getCardStore(), 'factsSearch')
    const batch = await multiExecutor().executeBatch([call('exact', 'facts_search', { queries: ['__不存在甲__', '__不存在乙__', '__不存在丙__'] })])
    const item = batch.results[0]!
    expect(item).toMatchObject({ status: 'empty', executed: true })
    expect(item.factsResult?.resolution.items).toHaveLength(3)
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('非法段占位后，后续重复词的引用仍指向首次出现的段号', async () => {
    const batch = await multiExecutor().executeBatch([call('gap', 'facts_search', { queries: ['刻俄柏', 1, '刻俄柏'] })])
    const item = batch.results[0]!
    expect(item.data).toContain('第 2 段｜参数错误：第 2 项必须是非空字符串')
    expect(item.data).toContain('第 3 段｜刻俄柏')
    expect(item.data).toContain('刻俄柏（已在第 1 段返回，此处仅列名）')
  })

  it('v6 输出只携带 resolution.items，不同时携带 v5 的 resolution.paths', async () => {
    const batch = await multiExecutor().executeBatch([call('shape', 'facts_search', { queries: ['刻俄柏'] })])
    const envelope = JSON.parse(serializeToolResult(batch.results[0]!)) as { factsResultVersion: number; resolution: Record<string, unknown> }
    expect(envelope.factsResultVersion).toBe(6)
    expect(envelope.resolution).toHaveProperty('items')
    expect(envelope.resolution).not.toHaveProperty('paths')
  })

  it('历史 v5 结果仍按原版本与 paths 结构读取，不混入 v6 items', () => {
    const legacy = JSON.parse('{"factsResultVersion":5,"matchedCount":1,"returnedCount":1,"complete":true,"scope":{"query":"刻俄柏"},"resolution":{"paths":[{"kind":"exact","category":"operator","term":"刻俄柏","memberIds":["刻俄柏"]}]}}') as {
      factsResultVersion: number
      resolution: { paths: unknown[] }
    }
    expect(legacy.factsResultVersion).toBe(5)
    expect(legacy.resolution.paths).toHaveLength(1)
  })
})
