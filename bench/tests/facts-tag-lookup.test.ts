import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import { buildCardStore, getCardStore, type TagCardMatch, type TagHit } from '../src/facts/store.js'
import type { RecordCard, RecordSkill } from '../src/facts/card.js'
import {
  FACTS_TAG_PAGE_CARDS,
  createKnowledgeToolExecutor,
  serializeToolResult,
  toolsForRetriever,
} from '../src/tool-executor.js'

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

function skill(partial: Partial<RecordSkill> & { name: string; room: string }): RecordSkill {
  return { unlockType: '初始解锁', target: '', effectText: '测试效果', ...partial }
}

/** 标签派生夹具：贸易站（设施序 5）早于制造站（设施序 8）。 */
const TAGGED_CARDS: RecordCard[] = [
  card('卡A', {
    class: '制造站',
    rooms: ['贸易站'],
    skills: [skill({ grantId: 'a1', room: '贸易站', name: '贸易一', tags: ['订单效率'] })],
  }),
  card('卡B', {
    rooms: ['制造站'],
    skills: [
      skill({ grantId: 'b1', room: '制造站', name: '制造一', tags: ['通用生产'] }),
      skill({ grantId: 'b2', room: '制造站', name: '制造二', unlockType: '精英1提升', tags: ['通用生产'], replacesGrantId: 'b1' }),
    ],
  }),
  card('卡C', {
    rooms: ['贸易站', '制造站'],
    skills: [
      skill({ grantId: 'c1', room: '贸易站', name: '贸易三', tags: ['订单效率'] }),
      skill({ grantId: 'c2', room: '制造站', name: '制造三', tags: ['通用生产'] }),
    ],
  }),
]

describe('store：标签反查派生', () => {
  const store = buildCardStore(TAGGED_CARDS)

  it('标签→设施→技能→grant→干员派生，卡级去重并按最小设施序稳定排序', () => {
    const result = store.factsSearchByTags(['通用生产', '订单效率'])
    expect(result.matchedTags).toEqual(['通用生产', '订单效率'])
    expect(result.missingTags).toEqual([])
    // 卡A/卡C 的最小设施序为贸易站，卡B 为制造站；同序按 canonical 升序。
    expect(result.cards.map((match) => match.card.canonical)).toEqual(['卡A', '卡C', '卡B'])
  })

  it('同卡多命中保留全部依据（不同标签、设施、技能）', () => {
    const result = store.factsSearchByTags(['通用生产', '订单效率'])
    const match = result.cards.find((item) => item.card.canonical === '卡C')!
    expect(match.hits).toHaveLength(2)
    expect(match.hits.map((hit) => hit.tag).sort()).toEqual(['订单效率', '通用生产'])
    expect(match.hits.map((hit) => hit.room).sort()).toEqual(['制造站', '贸易站'])
    expect([...match.matchedGrantIds].sort()).toEqual(['c1', 'c2'])
  })

  it('同卡同一标签多技能各保留一条命中，并携带解锁与替换', () => {
    const result = store.factsSearchByTags(['通用生产'])
    const match = result.cards.find((item) => item.card.canonical === '卡B')!
    expect(match.hits.map((hit) => hit.skillName)).toEqual(['制造一', '制造二'])
    const upgraded = match.hits.find((hit) => hit.skillName === '制造二')!
    expect(upgraded.grantId).toBe('b2')
    expect(upgraded.replacesGrantId).toBe('b1')
    expect(upgraded.unlockType).toBe('精英1提升')
  })

  it('未收录标签进入 missingTags，只做 trim 后精确匹配', () => {
    const result = store.factsSearchByTags(['  通用生产  ', '不存在标签'])
    expect(result.matchedTags).toEqual(['通用生产'])
    expect(result.missingTags).toEqual(['不存在标签'])
    expect(store.factsSearchByTags(['通用']).missingTags).toEqual(['通用'])
    expect(store.factsSearchByTags(['通用']).matchedTags).toEqual([])
  })

  it('同名职业/设施/技能组不自动合并：facets 只返回标签派生结果', () => {
    // 卡A 的职业与卡B 的设施都叫「制造站」，但都不是标签。
    const result = store.factsSearchByTags(['制造站'])
    expect(result.matchedTags).toEqual([])
    expect(result.missingTags).toEqual(['制造站'])
    expect(result.cards).toEqual([])
  })

  it('tag → 命中项索引可通过 store 反查命中项字段', () => {
    const hit = store.factsSearchByTags(['订单效率']).cards.find((item) => item.card.canonical === '卡A')!.hits[0]!
    expect(hit).toMatchObject({ tag: '订单效率', canonical: '卡A', room: '贸易站', skillName: '贸易一', grantId: 'a1', unlockType: '初始解锁' })
  })
})

function factsExecutor(limit = 3) {
  const config = loadConfig()
  config.retriever = 'hybrid'
  config.factsQueryListLimit = limit
  return createKnowledgeToolExecutor({
    config,
    query: { id: 'TAG', category: 'fact', question: '标签反查' },
    chunks: [],
    index: buildIndex([]),
  }, 10)
}

function call(id: string, params: unknown) {
  return { id, name: 'facts_search', arguments: JSON.stringify(params) }
}

function tagHit(tag: string, canonical: string, room: string, skillName: string, grantId: string): TagHit {
  return { tag, canonical, room, skillName, grantId, unlockType: '初始解锁' }
}

function tagMatch(target: RecordCard, hits: TagHit[]): TagCardMatch {
  return { card: target, matchedGrantIds: hits.map((hit) => hit.grantId!).filter(Boolean), hits }
}

afterEach(() => vi.restoreAllMocks())

describe('facts_search tags 参数 schema', () => {
  it('声明 queries、tags、offset 三个根字段且不要求任一必填，避免 anyOf', () => {
    const facts = toolsForRetriever('hybrid', 3).find((tool) => (tool.function as { name: string }).name === 'facts_search')!
    const fn = facts.function as {
      description: string
      parameters: { properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: boolean; anyOf?: unknown[] }
    }
    expect(Object.keys(fn.parameters.properties)).toEqual(['queries', 'tags', 'offset'])
    expect(fn.parameters.properties.tags).toMatchObject({ type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } })
    expect(fn.parameters.properties.offset).toMatchObject({ type: 'integer', minimum: 0 })
    expect(fn.parameters.required).toEqual([])
    expect(fn.parameters.additionalProperties).toBe(false)
    expect(fn.parameters.anyOf).toBeUndefined()
    expect(fn.description).toContain('tags')
    expect(fn.description).toMatch(/互斥/)
    expect(fn.description).toContain('offset')
  })
})

describe('facts_search tags 参数校验', () => {
  it.each([
    ['缺 queries 与 tags', {}],
    ['queries 与 tags 并存', { queries: ['刻俄柏'], tags: ['通用生产'] }],
    ['offset 与 queries 并存', { queries: ['刻俄柏'], offset: 0 }],
    ['tags 非数组', { tags: '通用生产' }],
    ['tags 空数组', { tags: [] }],
    ['tags 超上限', { tags: ['甲', '乙', '丙', '丁'] }],
    ['offset 负数', { tags: ['通用生产'], offset: -1 }],
    ['offset 非整数', { tags: ['通用生产'], offset: 1.5 }],
    ['tags 全为非法项', { tags: [1, '   '] }],
    ['额外字段', { tags: ['通用生产'], room: '制造站' }],
  ])('%s 整批拒绝为 invalid_params', async (_label, params) => {
    const batch = await factsExecutor().executeStep([call('bad', params)])
    const item = batch.results[0]!
    expect(item).toMatchObject({ status: 'invalid_params', executed: false })
    expect(item.factsResult).toBeUndefined()
    expect(item.data).toContain('facts_search')
  })

  it('元素级非法只记该项，合法标签继续执行', async () => {
    const batch = await factsExecutor().executeStep([call('mixed', { tags: ['通用生产', 1] })])
    const item = batch.results[0]!
    expect(item.status).toBe('success')
    expect(item.factsResult?.resolution.items).toEqual([
      { index: 0, query: '通用生产', status: 'success', paths: [], canonicals: expect.any(Array), message: null },
      { index: 1, query: null, status: 'invalid', paths: [], canonicals: [], message: '第 2 项必须是非空字符串' },
    ])
  })
})

describe('facts_search tags 执行与分页', () => {
  it('标签反查返回完整卡、命中依据与反查说明，元数据带 tagPage 与逐标签 resolution', async () => {
    const batch = await factsExecutor().executeStep([call('tags', { tags: ['通用生产'] })])
    const item = batch.results[0]!
    expect(item.status).toBe('success')
    expect(item.factsResult).toMatchObject({
      factsResultVersion: 7,
      scope: { tags: ['通用生产'], offset: 0 },
      tagPage: { offset: 0, limit: FACTS_TAG_PAGE_CARDS },
      resolution: { items: [expect.objectContaining({ index: 0, query: '通用生产', status: 'success', paths: [] })] },
    })
    expect(item.factsResult?.tagPage?.returnedCount).toBe(item.hitIds?.length)
    expect(item.factsResult?.tagPage?.matchedCount).toBeGreaterThanOrEqual(item.hitIds?.length ?? 0)
    expect(item.factsResult?.complete).toBe(item.factsResult?.tagPage?.complete)
    expect(item.data).toContain('同标签不等于完整效果等价')
    expect(item.data).toContain('命中依据：')
    expect(item.data).toContain('标签「通用生产」')
    const envelope = JSON.parse(serializeToolResult(item)) as { tagPage?: { complete: boolean } }
    expect(envelope.tagPage).toHaveProperty('complete')
  })

  it('未收录标签输出「未收录标签」且判空', async () => {
    const batch = await factsExecutor().executeStep([call('missing', { tags: ['__不存在标签__'] })])
    const item = batch.results[0]!
    expect(item).toMatchObject({ status: 'empty', executed: true, hitIds: [] })
    expect(item.data).toContain('未收录标签：__不存在标签__')
    expect(item.factsResult?.resolution.items[0]).toMatchObject({ index: 0, query: '__不存在标签__', status: 'empty', paths: [], canonicals: [] })
  })

  it('命中技能前置，其余技能保持原卡顺序且卡片完整', async () => {
    const store = getCardStore()
    const target = card('前置卡', {
      rooms: ['制造站'],
      skills: [
        skill({ grantId: 'x1', room: '制造站', name: '非命中技能' }),
        skill({ grantId: 'x2', room: '制造站', name: '命中技能', tags: ['前置标签'] }),
      ],
    })
    vi.spyOn(store, 'factsSearchByTags').mockReturnValue({
      matchedTags: ['前置标签'],
      missingTags: [],
      cards: [tagMatch(target, [{ tag: '前置标签', canonical: '前置卡', room: '制造站', skillName: '命中技能', grantId: 'x2', unlockType: '初始解锁', replacesGrantId: 'x1' }])],
    })
    const batch = await factsExecutor().executeStep([call('order', { tags: ['前置标签'] })])
    const data = batch.results[0]!.data
    expect(data.indexOf('「命中技能」')).toBeLessThan(data.indexOf('「非命中技能」'))
    // 其余技能（含被替换技能）仍在完整卡中，不截断。
    expect(data).toContain('替换「非命中技能」')
    expect(data).toContain('标签「前置标签」｜设施：制造站｜技能「命中技能」｜解锁：初始解锁，替换「非命中技能」')
  })

  it('按页上限分页并给出续读 offset，offset 越界返回空页且 complete=true', async () => {
    const wide = Array.from({ length: 25 }, (_, index) => card(`宽卡${String(index + 1).padStart(2, '0')}`, {
      rooms: ['制造站'],
      skills: [skill({ grantId: `g${index}`, room: '制造站', name: `技能${index}`, tags: ['宽标签'] })],
    }))
    const matches = wide.map((target) => tagMatch(target, [tagHit('宽标签', target.canonical, '制造站', target.skills[0]!.name, target.skills[0]!.grantId!)]))
    vi.spyOn(getCardStore(), 'factsSearchByTags').mockReturnValue({ matchedTags: ['宽标签'], missingTags: [], cards: matches })

    const first = (await factsExecutor().executeStep([call('p1', { tags: ['宽标签'] })])).results[0]!
    expect(first.factsResult).toMatchObject({ complete: false, tagPage: { offset: 0, limit: FACTS_TAG_PAGE_CARDS, matchedCount: 25, returnedCount: FACTS_TAG_PAGE_CARDS, complete: false, nextOffset: FACTS_TAG_PAGE_CARDS } })
    expect(first.hitIds).toHaveLength(FACTS_TAG_PAGE_CARDS)

    const second = (await factsExecutor().executeStep([call('p2', { tags: ['宽标签'], offset: FACTS_TAG_PAGE_CARDS })])).results[0]!
    expect(second.factsResult).toMatchObject({ complete: true, tagPage: { offset: FACTS_TAG_PAGE_CARDS, returnedCount: 5, complete: true, nextOffset: null } })
    expect(second.hitIds).toHaveLength(5)

    const beyond = (await factsExecutor().executeStep([call('p3', { tags: ['宽标签'], offset: 100 })])).results[0]!
    expect(beyond).toMatchObject({ status: 'empty', executed: true, hitIds: [] })
    expect(beyond.factsResult).toMatchObject({ complete: true, tagPage: { offset: 100, returnedCount: 0, complete: true, nextOffset: null } })
    expect(beyond.data).toContain('offset 超出')

    expect(first.data).toContain(`续读 next_offset=${FACTS_TAG_PAGE_CARDS}`)

    // offset 恰等于命中总数：已读完，不再提示越界
    const atEnd = (await factsExecutor().executeStep([call('p4', { tags: ['宽标签'], offset: 25 })])).results[0]!
    expect(atEnd.factsResult).toMatchObject({ complete: true, tagPage: { offset: 25, returnedCount: 0, complete: true, nextOffset: null } })
    expect(atEnd.data).not.toContain('offset 超出')
  })

  it('tags 跨标签共享卡在各标签 resolution 下都保留 canonical', async () => {
    const store = getCardStore()
    const shared = card('共享卡', {
      rooms: ['制造站'],
      skills: [
        skill({ grantId: 's-a', room: '制造站', name: '技能甲', tags: ['标签甲'] }),
        skill({ grantId: 's-b', room: '制造站', name: '技能乙', tags: ['标签乙'] }),
      ],
    })
    vi.spyOn(store, 'factsSearchByTags').mockReturnValue({
      matchedTags: ['标签甲', '标签乙'],
      missingTags: [],
      cards: [
        tagMatch(shared, [
          tagHit('标签甲', '共享卡', '制造站', '技能甲', 's-a'),
          tagHit('标签乙', '共享卡', '制造站', '技能乙', 's-b'),
        ]),
      ],
    })
    const item = (await factsExecutor().executeStep([call('shared', { tags: ['标签甲', '标签乙'] })])).results[0]!
    expect(item.factsResult?.resolution.items.map((entry) => entry.canonicals)).toEqual([['共享卡'], ['共享卡']])
  })
})

describe('facts_search queries 路径回归', () => {
  it('queries 路径保持完整返回与 complete=true，不携带 tagPage', async () => {
    const batch = await factsExecutor().executeStep([call('queries', { queries: ['刻俄柏'] })])
    const item = batch.results[0]!
    expect(item.status).toBe('success')
    expect(item.factsResult).toMatchObject({ factsResultVersion: 7, complete: true, scope: { queries: ['刻俄柏'] } })
    expect(item.factsResult).not.toHaveProperty('tagPage')
  })
})
