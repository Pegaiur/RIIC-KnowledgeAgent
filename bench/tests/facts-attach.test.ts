import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, type BenchConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import { buildCardStore } from '../src/facts/store.js'
import * as stores from '../src/facts/store.js'
import {
  buildFactsAttachment,
  createKnowledgeToolExecutor,
  recognizeEntryTriggers,
} from '../src/tool-executor.js'
import { createQueryTrace } from '../src/trace.js'
import { runQuery } from '../src/agent.js'
import { aggregate, renderMarkdown } from '../src/report.js'
import type { RecordCard } from '../src/facts/card.js'
import type { TermCurations } from '../src/facts/terms.js'
import type { ProviderResult, ToolCall } from '../src/types.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

const evidence = { path: 'knowledge/guides/测试.md', section: '测试组' }

function card(canonical: string, overrides: Partial<RecordCard> = {}): RecordCard {
  return {
    canonical,
    aliases: [],
    rarity: '6',
    class: '近卫',
    rooms: [],
    factionGroups: [],
    skillGroups: [],
    skills: [],
    notes: '',
    ...overrides,
  }
}

const CARDS: RecordCard[] = [
  card('温蒂', {
    rooms: ['制造站'],
    factionGroups: ['测试阵营'],
    skillGroups: ['测试技能组'],
    skills: [{ grantId: 'w', room: '制造站', name: '自动化·β', unlockType: '初始解锁', target: '', effectText: '制造站生产力+10%' }],
    notes: '测试备注',
  }),
  card('令'),
  card('测试甲', { rooms: ['制造站'] }),
  card('测试乙', { class: '医疗', rooms: ['测试区 甲'] }),
  card('测试区'),
]

const TERMS: TermCurations = {
  aliases: [{ text: '温蒂 甲', targets: ['operator:温蒂'], evidence: [evidence] }],
  substrings: [],
  combos: [{
    id: 'combo:自动化组',
    name: '自动化组',
    members: [
      { target: 'operator:温蒂', role: 'core' },
      { target: 'operator:测试甲', role: 'core' },
    ],
    conditions: ['制造站进驻'],
    coverage: 'listed',
    evidence: [evidence],
  }],
}

const STORE = buildCardStore(CARDS, TERMS)
const DICTIONARY = STORE.entryDictionary
const HEADER = '【RAG 附带事实卡｜hybrid 自动附带】'

function call(id: string, name: string, params: unknown): ToolCall {
  return { id, name, arguments: JSON.stringify(params) }
}

function hybridExecutor(query: string, overrides: Partial<BenchConfig> = {}) {
  const config = { ...loadConfig(), retriever: 'hybrid' as const, ...overrides }
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'ATTACH', category: 'fact', question: query },
    chunks: [],
    index: buildIndex([]),
  }, 5)
}

describe('入口识别：整词与空白关键词分支（ADR-013 步骤 3）', () => {
  const triggers = (query: string) => recognizeEntryTriggers(DICTIONARY, query)

  it('整条精确匹配优先：单字正式名、设施与组合都可整词触发', () => {
    expect(triggers('令')).toEqual([{ term: '令', start: 0, end: 1 }])
    expect(triggers('制造站').map((item) => item.term)).toEqual(['制造站'])
    expect(triggers('自动化组').map((item) => item.term)).toEqual(['自动化组'])
  })

  it('整条匹配成立时不再扫描内部短词', () => {
    expect(triggers('温蒂 甲')).toEqual([{ term: '温蒂 甲', start: 0, end: 4 }])
  })

  it('按空白边界取完整登记词，含内部空格长词整体匹配并校正 trim 区间', () => {
    expect(triggers('温蒂 自动化组 第三人')).toEqual([
      { term: '温蒂', start: 0, end: 2 },
      { term: '自动化组', start: 3, end: 7 },
    ])
    expect(triggers('  温蒂  ')).toEqual([{ term: '温蒂', start: 2, end: 4 }])
    expect(triggers('前缀 温蒂 甲 后缀')).toEqual([{ term: '温蒂 甲', start: 3, end: 7 }])
  })

  it('不解析未分隔自然句，也不把连续字符拆成登记词', () => {
    expect(triggers('温蒂的生产力怎么算')).toEqual([])
  })

  it('设施、职业与单字词不进入多关键词分支', () => {
    expect(triggers('制造站 生产力')).toEqual([])
    expect(triggers('医疗 提示')).toEqual([])
    expect(triggers('令 心情条件')).toEqual([])
  })

  it('同起点取最长完整词，未准入也不拆其内部短词', () => {
    expect(triggers('测试区')).toEqual([{ term: '测试区', start: 0, end: 3 }])
    // 「测试区 甲」是最长完整词且仅命中设施，未准入；不得回退拆出同时登记的干员名「测试区」。
    expect(triggers('前缀 测试区 甲 后缀')).toEqual([])
  })

  it('重复词只触发一次并保留出现顺序', () => {
    expect(triggers('温蒂 自动化组 温蒂').map((item) => item.term)).toEqual(['温蒂', '自动化组'])
  })
})

describe('facts 原子附带：整组装配与容量（ADR-013 决策 4）', () => {
  it('整组放入额度才附带，保留卡正文与解析路径', () => {
    const attachment = buildFactsAttachment(STORE, recognizeEntryTriggers(DICTIONARY, '温蒂'), 4_000)

    expect(attachment.delivered).toBe(true)
    expect(attachment.text).toContain(HEADER)
    expect(attachment.text).toContain('【温蒂】')
    expect(attachment.text).toContain('自动化·β')
    expect(attachment.deliveredCanonicals).toEqual(['温蒂'])
    expect(attachment.observations).toEqual([
      expect.objectContaining({ term: '温蒂', matched: ['温蒂'], delivered: ['温蒂'], omittedReason: null }),
    ])
  })

  it('整组放不下时整组不附带并给原因，不截断卡正文', () => {
    const triggers = recognizeEntryTriggers(DICTIONARY, '温蒂')
    const full = buildFactsAttachment(STORE, triggers, 100_000)
    const quota = HEADER.length + full.observations[0]!.chars

    const attachment = buildFactsAttachment(STORE, triggers, quota)

    expect(attachment.delivered).toBe(false)
    expect(attachment.deliveredCanonicals).toEqual([])
    expect(attachment.text).toContain('未附带')
    expect(attachment.text).not.toContain('【温蒂】')
    expect(attachment.observations[0]).toMatchObject({
      term: '温蒂',
      matched: ['温蒂'],
      delivered: [],
      omittedReason: expect.stringContaining('未放入剩余附带额度'),
    })
  })

  it('跨词共享卡只渲染一次，后到词用共享卡补齐并标记完整', () => {
    const triggers = recognizeEntryTriggers(DICTIONARY, '温蒂 自动化组')
    const attachment = buildFactsAttachment(STORE, triggers, 4_000)

    expect((attachment.text.match(/【温蒂】/g) ?? []).length).toBe(1)
    expect(attachment.text).toContain('【测试甲】')
    expect(attachment.deliveredCanonicals).toEqual(['温蒂', '测试甲'])
    expect(attachment.observations[1]).toMatchObject({ term: '自动化组', matched: ['温蒂', '测试甲'], delivered: ['温蒂', '测试甲'], omittedReason: null })
  })

  it('额度放不下分区头时不产生附带正文', () => {
    const attachment = buildFactsAttachment(STORE, recognizeEntryTriggers(DICTIONARY, '温蒂'), 1)

    expect(attachment).toMatchObject({ text: '', delivered: false, deliveredCanonicals: [], observations: [] })
  })

  it('额度只够分区头、连未附带提示都放不下时不写入无内容分区', () => {
    const attachment = buildFactsAttachment(STORE, recognizeEntryTriggers(DICTIONARY, '温蒂'), HEADER.length + 3)

    expect(attachment.text).toBe('')
    expect(attachment.delivered).toBe(false)
    expect(attachment.observations[0]).toMatchObject({ delivered: [], omittedReason: expect.stringContaining('未放入剩余附带额度') })
    expect(attachment.observations[0]!.chars).toBe(0)
  })
})

describe('rag_search 内部 facts 附带集成（hybrid 真实 store）', () => {
  it('仅 facts 非空也计一次成功，并记录触发/送达观测', async () => {
    const batch = await hybridExecutor('刻俄柏').executeBatch([call('a', 'rag_search', { query: '刻俄柏' })])
    const item = batch.results[0]!

    expect(item.status).toBe('success')
    expect(item.injectedIds).toEqual([])
    expect(item.data.startsWith(HEADER)).toBe(true)
    expect(item.data).toContain('【刻俄柏】')
    expect(item.attachedFacts).toEqual([
      expect.objectContaining({ term: '刻俄柏', matched: ['刻俄柏'], delivered: ['刻俄柏'], omittedReason: null }),
    ])
    expect(batch.snapshot).toMatchObject({ successUsed: 1, attemptUsed: 1, executed: 1 })
  })

  it('bm25 与显式关闭附带都保持纯 RAG，不加载 facts', async () => {
    const bm25 = await createKnowledgeToolExecutor({
      config: { ...loadConfig(), retriever: 'bm25' as const },
      query: { id: 'BM25', category: 'fact', question: '刻俄柏' },
      chunks: [],
      index: buildIndex([]),
    }, 5).executeBatch([call('a', 'rag_search', { query: '刻俄柏' })])

    expect(bm25.results[0]).toMatchObject({ status: 'empty' })
    expect(bm25.results[0]!.attachedFacts).toBeUndefined()
    expect(bm25.results[0]!.data).not.toContain(HEADER)
    expect(bm25.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 1 })

    const off = await hybridExecutor('刻俄柏', { attachFacts: false }).executeBatch([call('a', 'rag_search', { query: '刻俄柏' })])

    expect(off.results[0]).toMatchObject({ status: 'empty' })
    expect(off.results[0]!.attachedFacts).toBeUndefined()
    expect(off.results[0]!.data).not.toContain(HEADER)
  })

  it('设施大集合整组超出额度时不附带并给原因，仍判空', async () => {
    const batch = await hybridExecutor('制造站').executeBatch([call('a', 'rag_search', { query: '制造站' })])
    const item = batch.results[0]!

    expect(item.status).toBe('empty')
    expect(item.data).toContain('未附带')
    expect(item.attachedFacts?.[0]).toMatchObject({
      term: '制造站',
      delivered: [],
      omittedReason: expect.stringContaining('未放入剩余附带额度'),
    })
    expect(batch.snapshot).toMatchObject({ successUsed: 0, executed: 1, remaining: 5 })
  })

  it('RAG 正文与附带同时送达仍只扣一次成功额度', async () => {
    const config = { ...loadConfig(), retriever: 'hybrid' as const }
    const chunks = [{ id: 'base/甲.md#刻俄柏', file: 'base/甲.md', heading: '刻俄柏', text: '刻俄柏制造站技能说明。', startLine: 1, endLine: 1 }]
    const batch = await createKnowledgeToolExecutor({
      config,
      query: { id: 'BOTH', category: 'fact', question: '刻俄柏' },
      chunks,
      index: buildIndex(chunks),
    }, 5).executeBatch([call('a', 'rag_search', { query: '刻俄柏' })])
    const item = batch.results[0]!

    expect(item.status).toBe('success')
    expect(item.injectedIds).toEqual(['base/甲.md#刻俄柏'])
    expect(item.data).toContain('刻俄柏制造站技能说明')
    expect(item.data).toContain('【刻俄柏】')
    expect(batch.snapshot).toMatchObject({ successUsed: 1, attemptUsed: 1 })
  })

  it('trace 记录一次外部 rag_search 调用及其内部附带观测', async () => {
    const config = { ...loadConfig(), retriever: 'hybrid' as const }
    const trace = createQueryTrace({ id: 'TRACE-ATTACH', category: 'fact', question: '刻俄柏有哪些技能？' })
    mockCall.mockReset()
    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [call('call_rag', 'rag_search', { query: '刻俄柏' })] }))
      .mockResolvedValueOnce(providerResult({ content: '刻俄柏可进驻制造站。' }))

    const result = await runQuery(
      { id: 'TRACE-ATTACH', category: 'fact', question: '刻俄柏有哪些技能？' },
      { config, thinking: 'off', dry: false, trace },
      [],
      buildIndex([]),
    )

    expect(result.status).toBe('completed')
    const toolEvent = trace.events.find((event) => event.type === 'tool_call') as Extract<(typeof trace.events)[number], { type: 'tool_call' }>
    expect(toolEvent).toMatchObject({
      tool: 'rag_search',
      status: 'success',
      attachedFacts: [expect.objectContaining({ term: '刻俄柏', delivered: ['刻俄柏'] })],
    })
    expect(JSON.parse(toolEvent.writtenContent ?? '{}')).toMatchObject({ data: expect.stringContaining(HEADER) })
  })

  it('facts-only rag_search 经 toolBatch 汇总到报告：计证据送达但不计旧 chunk 命中', async () => {
    const config = { ...loadConfig(), retriever: 'hybrid' as const }
    mockCall.mockReset()
    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [call('call_rag', 'rag_search', { query: '刻俄柏' })] }))
      .mockResolvedValueOnce(providerResult({ content: '刻俄柏可进驻制造站。' }))

    const result = await runQuery(
      { id: 'FACTS-ONLY', category: 'fact', question: '刻俄柏有哪些技能？' },
      { config, thinking: 'off', dry: false },
      [],
      buildIndex([]),
    )

    // rag_search 仅附带 facts（hitIds 为空）→ 该批次 successes=1、hitCount=0
    expect(result.status).toBe('completed')
    expect(result.records[0]?.toolBatch).toMatchObject({ attempts: 1, successes: 1, hitCount: 0, hitUnknown: 0 })

    // 端到端聚合：证据送达 1，旧 chunk 命中 0（不把 facts-only 成功读成没有证据）
    const report = aggregate(result.records)
    expect(report.toolStats).toMatchObject({ attempts: 1, successes: 1, hitCount: 0 })
    const markdown = renderMarkdown(report)
    expect(markdown).toContain('证据送达（成功） 1')
    expect(markdown).toContain('有命中（旧 chunk 口径，不含 facts-only 送达） 0')
  })
})

afterEach(() => vi.restoreAllMocks())

describe('rag_search 内部 facts 异常原子性与预算拒绝（ADR-013 步骤 5）', () => {
  const ATOMIC_CHUNKS = [{ id: 'base/甲.md#温蒂', file: 'base/甲.md', heading: '温蒂', text: '温蒂制造站技能说明。', startLine: 1, endLine: 1 }]

  function atomicExecutor(question: string, injectedIds: string[], overrides: Partial<BenchConfig> = {}) {
    const config = { ...loadConfig(), retriever: 'hybrid' as const, ...overrides }
    return createKnowledgeToolExecutor({
      config,
      query: { id: 'ATOM', category: 'fact', question },
      chunks: ATOMIC_CHUNKS,
      index: buildIndex(ATOMIC_CHUNKS),
      injectedIds,
    }, 5)
  }

  it('facts store 加载失败：整次 rag_search 报 error、fatal，共享注入列表不残留', async () => {
    const getStore = vi.spyOn(stores, 'getCardStore').mockImplementation(() => { throw new Error('测试 store 加载失败') })
    const injectedIds: string[] = []

    const batch = await atomicExecutor('温蒂', injectedIds).executeBatch([call('a', 'rag_search', { query: '温蒂' })])
    const item = batch.results[0]!

    expect(item).toMatchObject({ status: 'error', executed: true, fatal: true })
    expect(item.data).toContain('测试 store 加载失败')
    // 原子组装：RAG 正文已算出但分支抛错，不得留下本次未发送的注入记录。
    expect(item.injectedIds).toBeUndefined()
    expect(item.fulltextRanges).toBeUndefined()
    expect(item.attachedFacts).toBeUndefined()
    expect(injectedIds).toEqual([])
    expect(batch.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 1 })
    expect(getStore).toHaveBeenCalledTimes(1)
  })

  it('内部 factsSearch 抛错：整次 rag_search 报 error、fatal，已算出的 RAG 送达不写入共享列表', async () => {
    vi.spyOn(stores, 'getCardStore').mockReturnValue(STORE)
    const searchSpy = vi.spyOn(STORE, 'factsSearch').mockImplementation(() => { throw new Error('测试 facts 查询失败') })
    const injectedIds: string[] = []

    const batch = await atomicExecutor('温蒂', injectedIds).executeBatch([call('a', 'rag_search', { query: '温蒂' })])
    const item = batch.results[0]!

    expect(item).toMatchObject({ status: 'error', executed: true, fatal: true })
    expect(item.data).toContain('测试 facts 查询失败')
    expect(searchSpy).toHaveBeenCalledWith('温蒂')
    expect(injectedIds).toEqual([])
    expect(item.injectedIds).toBeUndefined()
    expect(batch.snapshot).toMatchObject({ successUsed: 0, attemptUsed: 1 })
  })

  it('预算拒绝的 rag_search 不触发内部 facts 查询，也不改动共享注入列表', async () => {
    const getStore = vi.spyOn(stores, 'getCardStore').mockReturnValue(STORE)
    const injectedIds: string[] = []
    const executor = atomicExecutor('温蒂', injectedIds, { toolAttemptLimit: 1 })

    const batch = await executor.executeBatch([
      call('a', 'rag_search', { query: '温蒂' }),
      call('b', 'rag_search', { query: '温蒂' }),
    ])

    expect(batch.results[1]).toMatchObject({ status: 'budget_exhausted', executed: false })
    // 只有获准执行的第一次调用加载 store 并查询。
    expect(getStore).toHaveBeenCalledTimes(1)
    expect(injectedIds).toEqual(['base/甲.md#温蒂'])
  })
})

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
