import { describe, expect, it, beforeEach, vi } from 'vitest'
import { loadConfig } from '../src/config.js'
import { buildIndex } from '../src/retriever.js'
import { buildSystemPrompt, runQuery } from '../src/agent.js'
import { createKnowledgeToolExecutor, serializeToolResult, toolsForRetriever } from '../src/tool-executor.js'
import { buildCardStore, getCardStore, serializeCards, serializeFactsMatches } from '../src/facts/store.js'
import { FACTS_FIXTURES } from '../src/facts/fixtures.js'
import type { ProviderResult } from '../src/types.js'
import type { DocChunk } from '../src/types.js'
import type { RecordCard } from '../src/facts/card.js'
import { createQueryTrace } from '../src/trace.js'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))
vi.mock('../src/provider.js', () => ({ callLLM: mockCall }))

function toolName(tool: Record<string, unknown>): string {
  const fn = tool.function as { name: string }
  return fn.name
}

const SYNTHETIC_CARDS: RecordCard[] = [
  {
    canonical: '测试甲',
    aliases: [],
    rarity: '4',
    class: '医疗',
    rooms: ['制造站', '办公室'],
    factionGroups: ['测试组一'],
    skillGroups: ['测试技能组'],
    skills: [
      { grantId: 'a0', room: '制造站', name: '锻造初式', unlockType: '初始解锁', target: '', effectText: '制造站生产力+5%', notes: '初始备注' },
      { grantId: 'a1', room: '制造站', name: '锻造进式', unlockType: '精英1提升', target: '', effectText: '制造站生产力+10%', notes: '升级备注', replacesGrantId: 'a0', equivalenceSkillNames: ['锻造进式', '锻造同效'] },
      { grantId: 'a2', room: '办公室', name: '联络术', unlockType: '初始解锁', target: '', effectText: '联络关键词', notes: '办公室备注' },
    ],
    notes: '卡级专词：全局约束',
  },
  {
    canonical: '测试乙',
    aliases: [],
    rarity: '4',
    class: '近卫',
    rooms: ['制造站'],
    factionGroups: ['测试组一'],
    skillGroups: ['测试技能组'],
    skills: [
      { grantId: 'b1', room: '制造站', name: '锻造同效', unlockType: '初始解锁', target: '', effectText: '制造站生产力+10%', equivalenceSkillNames: ['锻造进式', '锻造同效'] },
    ],
    notes: '',
  },
  {
    canonical: '测试丙',
    aliases: [],
    rarity: '4',
    class: '近卫',
    rooms: ['制造站'],
    factionGroups: ['测试组二'],
    skillGroups: [],
    skills: [
      { grantId: 'c1', room: '制造站', name: '锻造进式附注', unlockType: '初始解锁', target: '', effectText: '制造站生产力+1%' },
    ],
    notes: '',
  },
]

const SINGLE_TERM_CARDS: RecordCard[] = [
  {
    canonical: '测试甲',
    aliases: [],
    rarity: '4',
    class: '近卫',
    rooms: ['制造站'],
    factionGroups: ['测试组'],
    skillGroups: ['共享词'],
    skills: [{ grantId: 'a', room: '制造站', name: '甲技能', unlockType: '初始解锁', target: '', effectText: '测试效果', notes: '技能备注', equivalenceSkillNames: ['甲技能', '乙技能'] }],
    notes: '卡级备注',
  },
  {
    canonical: '共享词',
    aliases: [],
    rarity: '4',
    class: '医疗',
    rooms: ['办公室'],
    factionGroups: ['测试组'],
    skillGroups: [],
    skills: [{ grantId: 'b', room: '办公室', name: '乙技能', unlockType: '初始解锁', target: '', effectText: '测试效果', notes: '技能备注', equivalenceSkillNames: ['甲技能', '乙技能'] }],
    notes: '卡级备注',
  },
  {
    canonical: '测试丙',
    aliases: [],
    rarity: '4',
    class: '医疗',
    rooms: ['制造站'],
    factionGroups: ['另一组'],
    skillGroups: [],
    skills: [{ grantId: 'c', room: '制造站', name: '甲技能附注', unlockType: '初始解锁', target: '', effectText: '测试效果', notes: '技能备注' }],
    notes: '卡级备注',
  },
]

function canonicals(cards: RecordCard[]): string[] {
  return cards.map((card) => card.canonical)
}

describe('store：lookup 解析', () => {
  const store = buildCardStore(FACTS_FIXTURES)

  it('canonical 精确命中单卡', () => {
    const hits = store.lookup('刻俄柏')
    expect(hits).toHaveLength(1)
    expect(hits[0].canonical).toBe('刻俄柏')
  })

  it('技能名命中（裁缝·α → 巫恋）', () => {
    expect(store.lookup('裁缝·α').map((c) => c.canonical)).toEqual(['巫恋'])
  })

  it('技能组命中（莱茵科技类技能 → 多萝西）', () => {
    expect(store.lookup('莱茵科技类技能').map((c) => c.canonical)).toEqual(['多萝西'])
  })

  it('等价组技能名展开命中全部同效持有者', () => {
    expect(getCardStore().lookup('裁缝·β').map((card) => card.canonical)).toEqual(['卡夫卡', '折光', '明椒', '柏喙'])
  })

  it('未命中返回空列表', () => {
    expect(store.lookup('不存在的干员')).toEqual([])
  })
})

describe('store：queryOperators 分类过滤', () => {
  const store = getCardStore()

  it('按设施 room 过滤', () => {
    const canonicals = store.queryOperators({ room: '制造站' }).map((c) => c.canonical)
    expect(canonicals).toContain('刻俄柏')
    expect(canonicals).toContain('森蚺')
    expect(canonicals).not.toContain('巫恋')
  })

  it('按阵营 faction 过滤（怪物猎人小队 → 3）', () => {
    expect(store.queryOperators({ faction: '怪物猎人小队' })).toHaveLength(3)
  })

  it('按职业 profession 过滤（近卫）', () => {
    const canonicals = store.queryOperators({ profession: '近卫' }).map((c) => c.canonical)
    expect(canonicals).toContain('火龙S黑角')
    expect(canonicals).not.toContain('森蚺') // 森蚺为重装
  })

  it('组合过滤（萨尔贡 + 制造站 → 森蚺）', () => {
    const canonicals = store.queryOperators({ faction: '萨尔贡', room: '制造站' }).map((c) => c.canonical)
    expect(canonicals).toContain('森蚺')
  })

  it('termQuery 字面子串命中（木天蓼 → 怪猎三卡）', () => {
    expect(store.queryOperators({ termQuery: '木天蓼' })).toHaveLength(3)
  })

  it('excludeIds 按 canonical 排除', () => {
    const canonicals = store.queryOperators({ room: '制造站', excludeIds: ['  森蚺 ', '', '   '] }).map((c) => c.canonical)
    expect(canonicals).not.toContain('森蚺')
  })

  it('不存在的设施返回空', () => {
    expect(store.queryOperators({ room: '不存在设施' })).toEqual([])
  })

  it('room + termQuery 必须命中同一设施技能，不能跨设施串线', () => {
    const multiRoom: RecordCard = {
      canonical: '跨设施样例',
      aliases: [],
      rarity: '6',
      class: '术师',
      rooms: ['制造站', '会客室'],
      factionGroups: [],
      skillGroups: [],
      skills: [
        { name: '制造技能', unlockType: '初始解锁', target: '', effectText: '制造站专用关键词', room: '制造站', grantId: 'grant:1' },
        { name: '会客技能', unlockType: '初始解锁', target: '', effectText: '会客室其他内容', room: '会客室', grantId: 'grant:2' },
      ],
      notes: '',
    }
    const scopedStore = buildCardStore([multiRoom])
    expect(scopedStore.queryOperators({ room: '制造站', termQuery: '制造站专用' })).toHaveLength(1)
    expect(scopedStore.queryOperators({ room: '会客室', termQuery: '制造站专用' })).toHaveLength(0)
    const serialized = serializeCards(scopedStore.queryOperators({ room: '会客室' }), { room: '会客室' })
    expect(serialized).toContain('会客技能')
    expect(serialized).not.toContain('制造技能')
  })

  it('旧多设施 fixture 缺少技能 room 时宁可不命中，也不跨设施串线', () => {
    expect(store.queryOperators({ room: '控制中枢', termQuery: '每个发电站' })).toEqual([])
  })

  it('技能类别和人工备注也必须受 room 作用域约束', () => {
    expect(store.queryOperators({ room: '办公室', termQuery: '莱茵科技类技能' }).map((card) => card.canonical)).not.toContain('淬羽赫默')
    expect(store.queryOperators({ room: '会客室', termQuery: '标准化类技能' }).map((card) => card.canonical)).not.toContain('杰西卡')
    expect(store.queryOperators({ room: '办公室', termQuery: '技能级人工确认说明' })).toEqual([])
  })

  it('拒绝重复 canonical，避免索引静默覆盖', () => {
    expect(() => buildCardStore([FACTS_FIXTURES[0], { ...FACTS_FIXTURES[0] }])).toThrow('记录卡 canonical 重复')
  })

  it('serializeCards 渲染命中卡', () => {
    const text = serializeCards(store.lookup('迷迭香'))
    expect(text).toContain('迷迭香')
    expect(text).toContain('6星')
    expect(text).toContain('超感')
  })

  it('记录卡直接说明升级替换关系，并完整返回已审定干员备注', () => {
    const text = serializeCards(getCardStore().lookup('温蒂'))
    expect(text).toContain('【设施：制造站】初始解锁「自动化·β」')
    expect(text).toContain('【设施：制造站】精英 2 提升，替换「自动化·β」「仿生海龙」')
    expect(text).toContain('替换「自动化·β」')
    expect(serializeCards(getCardStore().lookup('巫恋'))).toContain('「低语」与初始「裁缝·α」并存')
    expect(serializeCards(getCardStore().lookup('孑'))).toContain('精英1并不必然优于精英0')
  })
})

describe('第一阶段合成卡契约', () => {
  const store = buildCardStore(SYNTHETIC_CARDS)

  it('T02 lookup 只做精确 canonical/技能/等价名解析，不把子串当命中', () => {
    expect(canonicals(store.lookup('测试甲'))).toEqual(['测试甲'])
    expect(canonicals(store.lookup('锻造初式'))).toEqual(['测试甲'])
    expect(canonicals(store.lookup('锻造进式'))).toEqual(['测试甲', '测试乙'])
    expect(canonicals(store.lookup('锻造同效'))).toEqual(['测试甲', '测试乙'])
    expect(canonicals(store.lookup('锻造进'))).toEqual([])
    expect(canonicals(store.lookup('锻造进式＝锻造同效'))).toEqual([])
  })

  it('termQuery 按连续字面子串匹配，不把含空格的短语拆成多词条件', () => {
    const makeCard = (canonical: string, effectText: string): RecordCard => ({
      canonical,
      aliases: [],
      rarity: '4',
      class: '医疗',
      rooms: ['制造站'],
      factionGroups: [],
      skillGroups: [],
      skills: [{ grantId: `${canonical}-skill`, room: '制造站', name: '测试技能', unlockType: '初始解锁', target: '', effectText }],
      notes: '',
    })
    const compact = buildCardStore([makeCard('连续串', '联络速度')])
    const spaced = buildCardStore([makeCard('带空格', '联络 速度')])

    expect(canonicals(compact.queryOperators({ termQuery: '联络速度' }))).toEqual(['连续串'])
    expect(canonicals(compact.queryOperators({ termQuery: '联络 速度' }))).toEqual([])
    expect(canonicals(spaced.queryOperators({ termQuery: '联络 速度' }))).toEqual(['带空格'])
  })

  it('T03 分类条件精确匹配、多个正向条件取交集且 excludeIds 只排除 canonical', () => {
    expect(canonicals(store.queryOperators({ room: '制造站' }))).toEqual(['测试甲', '测试乙', '测试丙'])
    expect(canonicals(store.queryOperators({ faction: '测试组一' }))).toEqual(['测试甲', '测试乙'])
    expect(canonicals(store.queryOperators({ profession: '医疗' }))).toEqual(['测试甲'])
    expect(canonicals(store.queryOperators({ termQuery: '锻造进' }))).toEqual(['测试甲', '测试乙', '测试丙'])
    expect(canonicals(store.queryOperators({ room: '制造站', faction: '测试组一', profession: '近卫' }))).toEqual(['测试乙'])
    expect(canonicals(store.queryOperators({ faction: '测试组一', excludeIds: ['测试乙'] }))).toEqual(['测试甲'])
  })

  it('T04 room 约束技能、技能组和卡级备注，不跨多设施串线', () => {
    expect(canonicals(store.queryOperators({ room: '制造站', termQuery: '联络' }))).toEqual([])
    expect(canonicals(store.queryOperators({ room: '制造站', termQuery: '卡级专词' }))).toEqual([])
    expect(canonicals(store.queryOperators({ room: '办公室', termQuery: '测试技能组' }))).toEqual([])
  })

  it('T05 canonical 命中仍返回卡，但 room 投影只展示对应设施技能并保留卡级字段', () => {
    const cards = store.queryOperators({ room: '制造站', termQuery: '测试甲' })
    expect(canonicals(cards)).toEqual(['测试甲'])
    const text = serializeCards(cards, { room: '制造站', termQuery: '测试甲', queryOperators: true })
    expect(text).toContain('查询范围说明：')
    expect(text).toContain('卡级专词：全局约束')
    expect(text).toContain('「锻造初式」')
    expect(text).toContain('「锻造进式」')
    expect(text).not.toContain('「联络术」')
  })

  it('T06/T14 技能命中裁剪到投影范围，canonical 命中无技能时回退 scopedSkills', () => {
    const skillHits = store.queryOperators({ room: '制造站', termQuery: '锻造进式' })
    expect(canonicals(skillHits)).toEqual(['测试甲', '测试乙', '测试丙'])
    const skillText = serializeCards(skillHits, { room: '制造站', termQuery: '锻造进式', queryOperators: true })
    expect(skillText).toContain('【设施：制造站】精英1提升「锻造进式」：制造站生产力+10%；替换「锻造初式」；备注：升级备注')
    expect(skillText).toContain('【设施：制造站】初始解锁「锻造同效」')
    expect(skillText).toContain('【设施：制造站】初始解锁「锻造进式附注」')
    expect(skillText).not.toContain('「联络术」')

    const canonicalText = serializeCards(store.queryOperators({ termQuery: '测试甲' }), { termQuery: '测试甲', queryOperators: true })
    expect(canonicalText).toContain('「锻造初式」')
    expect(canonicalText).toContain('「锻造进式」')
    expect(canonicalText).toContain('「联络术」')
  })

  it('兼容 fixture 缺少技能 room 时显示未知设施，不猜归属', () => {
    const card: RecordCard = {
      canonical: '缺设施标注',
      aliases: [],
      rarity: '4',
      class: '医疗',
      rooms: ['制造站'],
      factionGroups: [],
      skillGroups: [],
      skills: [{ name: '未标设施技能', unlockType: '初始解锁', target: '', effectText: '效果' }],
      notes: '',
    }
    expect(serializeCards([card])).toContain('【设施：未知设施】')
  })
})

describe('单词条 facts_search 精确索引', () => {
  const store = buildCardStore(SINGLE_TERM_CARDS)
  const names = (query: string) => store.factsSearch(query).matches.map((match) => match.card.canonical)

  it('U01：干员、技能和等价技能名按精确词条返回预期并集', () => {
    expect(names('测试甲')).toEqual(['测试甲'])
    expect(names('甲技能')).toEqual(['测试甲', '共享词'])
    expect(names('乙技能')).toEqual(['测试甲', '共享词'])
    expect(names('甲技')).toEqual([])
    expect(names('甲技能附注')).toEqual(['测试丙'])
  })

  it('U02：设施、阵营和职业都走同一个 query 入口', () => {
    expect(names('制造站')).toEqual(['测试甲', '测试丙'])
    expect(names('测试组')).toEqual(['测试甲', '共享词'])
    expect(names('医疗')).toEqual(['共享词', '测试丙'])
  })

  it.each([
    { query: '测试甲', canonical: '测试甲', category: 'operator', label: '干员正式名' },
    { query: '甲技能', canonical: '测试甲', category: 'skill', label: '技能' },
    { query: '共享词', canonical: '测试甲', category: 'skillGroup', label: '技能组' },
    { query: '制造站', canonical: '测试甲', category: 'room', label: '设施' },
    { query: '另一组', canonical: '测试丙', category: 'faction', label: '阵营' },
    { query: '近卫', canonical: '测试甲', category: 'class', label: '职业' },
  ] as const)('U09：$query 命中类别为 $category 并输出中文标签', ({ query, canonical, category, label }) => {
    const result = store.factsSearch(query)
    const match = result.matches.find((item) => item.card.canonical === canonical)
    expect(match?.categories).toEqual([category])
    expect(serializeFactsMatches(result)).toContain(`匹配类别：${label}`)
  })

  it('U03：同名跨类别并集按 canonical 去重并保留类别依据', () => {
    const result = store.factsSearch('共享词')
    expect(result.matches.map((match) => match.card.canonical)).toEqual(['测试甲', '共享词'])
    expect(result.matches[0]?.categories).toEqual(['skillGroup'])
    expect(result.matches[1]?.categories).toEqual(['operator'])
    expect(serializeFactsMatches(result)).toContain('匹配类别：技能组')
    expect(serializeFactsMatches(result)).toContain('匹配类别：干员正式名')
  })

  it('U04/U05：不做分词、子串兜底或内部空格改写，只 trim 首尾空白', () => {
    expect(names('制造站 近卫')).toEqual([])
    expect(names('未知词条')).toEqual([])
    const spaced = buildCardStore([{ ...SINGLE_TERM_CARDS[0]!, canonical: '测试 甲' }])
    expect(spaced.factsSearch('  测试 甲  ').matches.map((match) => match.card.canonical)).toEqual(['测试 甲'])
    expect(spaced.factsSearch('测试甲')).toMatchObject({ paths: [], matches: [] })
  })

  it('U06：精确空查仍可由执行器按合法 query 执行；索引自身不伪造事实', () => {
    expect(store.factsSearch('   ')).toEqual({ query: '', paths: [], matches: [] })
    expect(serializeFactsMatches(store.factsSearch('未知词条'))).toBe('未收录精确词条：未知词条')
  })

  it('U07：设施命中返回完整卡，不裁剪其他设施技能、替换和备注', () => {
    const card: RecordCard = {
      ...SINGLE_TERM_CARDS[0]!,
      skills: [
        ...SINGLE_TERM_CARDS[0]!.skills,
        { grantId: 'a1', room: '制造站', name: '甲技能升级', unlockType: '精英1提升', target: '', effectText: '升级效果', notes: '升级备注', replacesGrantId: 'a' },
        { grantId: 'a2', room: '办公室', name: '联络技能', unlockType: '初始解锁', target: '', effectText: '联络效果', notes: '联络备注' },
      ],
    }
    const text = serializeFactsMatches(buildCardStore([card]).factsSearch('制造站'))
    expect(text).toContain('「甲技能」')
    expect(text).toContain('「甲技能升级」')
    expect(text).toContain('「联络技能」')
    expect(text).toContain('替换「甲技能」')
    expect(text).toContain('升级备注')
    expect(text).toContain('联络备注')
  })

  it('U08：同卡跨类别只输出一次，宽查不套 topK 或 RAG 字符上限', () => {
    const sameCard = { ...SINGLE_TERM_CARDS[0]!, factionGroups: ['共享词'] }
    const sameStore = buildCardStore([sameCard])
    const same = sameStore.factsSearch('共享词')
    expect(same.matches).toHaveLength(1)
    expect(same.matches[0]?.categories).toEqual(['skillGroup', 'faction'])
    expect(serializeFactsMatches(same)).toContain('匹配类别：技能组、阵营')

    const wideCards = Array.from({ length: 100 }, (_, index) => ({ ...SINGLE_TERM_CARDS[0]!, canonical: `宽查${String(index + 1).padStart(3, '0')}` }))
    const wideStore = buildCardStore(wideCards)
    const wide = wideStore.factsSearch('制造站')
    expect(wide.matches).toHaveLength(100)
    expect(new Set(wide.matches.map((match) => match.card.canonical))).toHaveLength(100)
    expect(serializeFactsMatches(wide)).toContain('【宽查100】')
  })
})

describe('第一阶段 facts 结果 envelope', () => {
  it('T01 合法空查按 hitIds 判定 empty，并返回完整范围元数据', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({
      config,
      query: { id: 'FACTS-EMPTY', category: 'fact', question: '不存在的干员？' },
      chunks: [],
      index: buildIndex([]),
    }, 5)

    const result = await executor.executeBatch([
      { id: 'empty-one', name: 'facts_search', arguments: '{"query":"__不存在的规范名_核查__"}' },
      { id: 'empty-two', name: 'facts_search', arguments: '{"query":"不存在设施"}' },
    ])

    expect(result.results).toHaveLength(2)
    for (const item of result.results) {
      expect(item).toMatchObject({ status: 'empty', executed: true, hitIds: [], injectedIds: [], factsResult: {
        factsResultVersion: 4, matchedCount: 0, returnedCount: 0, complete: true, resolution: { paths: [] },
      } })
      expect(item.factsResult?.scope).toEqual(item.actualParams)
      const envelope = JSON.parse(serializeToolResult(item)) as Record<string, unknown>
       expect(envelope).toMatchObject({ status: 'empty', executed: true, factsResultVersion: 4, matchedCount: 0, returnedCount: 0, complete: true, resolution: { paths: [] } })
       expect(envelope.data).toContain('未收录精确词条')
    }
    expect(JSON.parse(serializeToolResult(result.results[0]!)).scope).toEqual({ query: '__不存在的规范名_核查__' })
    expect(JSON.parse(serializeToolResult(result.results[1]!)).scope).toEqual({ query: '不存在设施' })
    expect(result.snapshot).toMatchObject({ used: 2, executed: 2, remaining: 3 })
  })

  it('T07 参数错误不携带事实结果元数据，合法未知值仍是空查', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const executor = createKnowledgeToolExecutor({
      config,
      query: { id: 'FACTS-INVALID', category: 'fact', question: '参数边界？' },
      chunks: [],
      index: buildIndex([]),
    }, 5)

    const result = await executor.executeBatch([
      { id: 'invalid', name: 'facts_search', arguments: '{"query":"   "}' },
      { id: 'unknown-but-valid', name: 'facts_search', arguments: '{"query":"不存在职业"}' },
    ])
    expect(result.results[0]).toMatchObject({ status: 'invalid_params', executed: false })
    expect(result.results[0]?.factsResult).toBeUndefined()
    expect(JSON.parse(serializeToolResult(result.results[0]!))).not.toHaveProperty('factsResultVersion')
    expect(result.results[1]).toMatchObject({ status: 'empty', executed: true, factsResult: { factsResultVersion: 4, matchedCount: 0, complete: true, resolution: { paths: [] } } })
  })
})

describe('agent：facts 独立工具 schema 与系统提示', () => {
  it('facts 模式只暴露 facts_search', () => {
    expect(toolsForRetriever('facts').map((tool) => (tool.function as { name: string }).name))
      .toEqual(['facts_search'])
  })

  it('系统提示 facts 分支描述 operation 与预算', () => {
    const prompt = buildSystemPrompt('facts')
    expect(prompt).toContain('facts_search')
    expect(prompt).toContain('可用工具：facts_search')
    expect(prompt).toContain('工具积分预算：5 点')
  })
})

describe('runQuery（facts 模式）', () => {
  const chunks: DocChunk[] = []
  const factsSearchSpy = vi.spyOn(getCardStore(), 'factsSearch')

  function toolCall(name: string, args: string) {
    return { id: 'call_1', name, arguments: args }
  }

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

  beforeEach(() => {
    mockCall.mockReset()
    factsSearchSpy.mockClear()
  })

  async function runFactsSearchCall(argumentsText: string) {
    const config = loadConfig()
    config.retriever = 'facts'
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', argumentsText) } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    const result = await runQuery(
      { id: 'INVALID', category: 'fact', question: '测试 facts_search 参数' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )
    const secondCallMessages = mockCall.mock.calls[1]?.[0] as Array<{ role: string; content: string }> | undefined
    const toolResult = secondCallMessages?.find((message) => message.role === 'tool')?.content
    return { result, toolResult }
  }

  it.each([
    ['空对象', '{}'],
    ['非法 JSON', '{'],
    ['query 为 null', '{"query":null}'],
    ['query 为空串', '{"query":""}'],
    ['query 为空白', '{"query":"   "}'],
    ['额外字段', '{"query":"刻俄柏","room":"制造站"}'],
    ['query 为数组', '{"query":[]}'],
  ])('%s 被拒绝，且不查询或序列化干员卡', async (_label, argumentsText) => {
    const { result, toolResult } = await runFactsSearchCall(argumentsText)

    const structured = JSON.parse(toolResult ?? '{}') as { status: string; executed: boolean; data: string }
    expect(structured).toMatchObject({ status: 'invalid_params', executed: false })
    expect(structured.data).toContain('facts_search')
    expect(toolResult).not.toContain('【')
    expect(factsSearchSpy).not.toHaveBeenCalled()
    expect(result.toolRounds).toBe(1)
  })

  it('合法完整词条 trim 首尾但保留内部空格，并只传一个 query', async () => {
    await runFactsSearchCall('{"query":"  测试 甲 "}')
    expect(factsSearchSpy).toHaveBeenCalledWith('测试 甲')
  })

  it('facts 模式暴露 facts_search，派发并统计工具调用', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"刻俄柏"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '刻俄柏 制造站仓库上限+8' }))

    const result = await runQuery(
      { id: 'T01', category: 'fact', question: '刻俄柏有什么技能？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('刻俄柏 制造站仓库上限+8')
    expect(result.toolTrace[0]).toEqual(['facts_search'])
    expect(result.records[0].tools).toEqual(['facts_search'])
  })

  it('合法 facts 空查回写 empty 后仍允许 Agent 继续作答', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const index = buildIndex(chunks)
    const query = { id: 'FACTS-EMPTY-AGENT', category: 'fact' as const, question: '查一个不存在的干员' }

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"__不存在的规范名_核查__"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '知识库未查到该名称对应的记录卡。' }))

    const trace = createQueryTrace(query)
    const result = await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, index)

    expect(result.status).toBe('completed')
    expect(result.finalAnswer).toBe('知识库未查到该名称对应的记录卡。')
    const toolEvent = trace.events.find((event) => event.type === 'tool_call') as { status: string; executed: boolean; hitIds?: string[]; writtenContent: string }
    expect(toolEvent).toMatchObject({ status: 'empty', executed: true, hitIds: [] })
    expect(JSON.parse(toolEvent.writtenContent)).toMatchObject({ status: 'empty', matchedCount: 0, complete: true })
  })

  it('合法 facts 空查后仍允许继续一个新的合法查询再作答', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const index = buildIndex(chunks)
    const query = { id: 'FACTS-EMPTY-CONTINUE', category: 'fact' as const, question: '空查后继续查设施' }

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'empty-facts', name: 'facts_search', arguments: '{"query":"__不存在的规范名_核查__"}' }] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ id: 'new-facts', name: 'facts_search', arguments: '{"query":"制造站"}' }] }))
      .mockResolvedValueOnce(providerResult({ content: '新的设施查询已返回证据。' }))

    const trace = createQueryTrace(query)
    const result = await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, index)

    expect(result.finalAnswer).toBe('新的设施查询已返回证据。')
    expect(result.budget).toMatchObject({ used: 2, executed: 2, remaining: 3 })
    expect(result.toolTrace).toEqual([['facts_search'], ['facts_search']])
    expect(trace.events.filter((event) => event.type === 'tool_call').map((event) => event.type === 'tool_call' ? event.status : ''))
      .toEqual(['empty', 'success'])
    expect(factsSearchSpy).toHaveBeenCalledWith('制造站')
  })

  it('trace 记录 facts 的实际参数与 canonical 命中/注入 ID', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const index = buildIndex(chunks)
    const query = { id: 'TRACE-FACTS', category: 'fact' as const, question: '刻俄柏有什么技能？' }
    const trace = createQueryTrace(query)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"刻俄柏"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, index)

    expect(trace.events[1]).toMatchObject({
      type: 'tool_call',
      tool: 'facts_search',
      rawArguments: '{"query":"刻俄柏"}',
      actualParams: { query: '刻俄柏' },
      hitIds: ['刻俄柏'],
      injectedIds: ['刻俄柏'],
    })
    const writtenContent = (trace.events[1] as { writtenContent: string }).writtenContent
    expect(writtenContent).toContain('【刻俄柏】')
    expect(JSON.parse(writtenContent)).toMatchObject({ factsResultVersion: 4, matchedCount: 1, returnedCount: 1, complete: true, scope: { query: '刻俄柏' }, resolution: { paths: [{ kind: 'exact', term: '刻俄柏' }] } })
    const secondMessages = mockCall.mock.calls[1]?.[0] as Array<{ role: string; content: string }>
    expect(secondMessages.find((message) => message.role === 'tool')?.content).toBe(writtenContent)
  })

  it('facts_search 抛错时 trace 仍保留实际 query 参数', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const index = buildIndex(chunks)
    const query = { id: 'TRACE-FACTS-ERROR', category: 'fact' as const, question: 'facts_search 异常' }
    const trace = createQueryTrace(query)
    factsSearchSpy.mockImplementationOnce(() => {
      throw new Error('facts_search store 测试异常')
    })
    mockCall.mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"刻俄柏"}') } as any] }))

    const result = await runQuery(query, { config, thinking: 'off', dry: false, trace }, chunks, index)

    expect(result.status).toBe('failed')
    expect(result.terminationReason).toBe('tool_error')
    expect(result.failure?.message).toBe('facts_search store 测试异常')

    expect(trace.events[1]).toMatchObject({
      type: 'tool_call',
      tool: 'facts_search',
      actualParams: { query: '刻俄柏' },
      error: 'facts_search store 测试异常',
    })
  })

  it('facts 模式派发设施词条并保留完整结果契约', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"制造站"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '制造站干员包括……' }))

    const result = await runQuery(
      { id: 'T02', category: 'fact', question: '制造站有哪些干员？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('制造站干员包括……')
    expect(result.records[0].tools).toEqual(['facts_search'])
  })

  it('facts 工具超出检索预算时提示上限，不反复检索', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"刻俄柏"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"能天使"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    const result = await runQuery(
      { id: 'T03', category: 'fact', question: '刻俄柏？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('最终答案')
    // 工具调用继续由模型控制；本题两轮工具调用后直接作答。
    expect(result.toolRounds).toBe(2)
    expect(result.records[1].tools).toEqual(['facts_search'])
  })

  it('facts 工具请求超过检索预算后注入「已达上限」提示文本，不反复检索', async () => {
    const config = loadConfig()
    config.retriever = 'facts'
    config.toolBudget = 2
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"刻俄柏"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"能天使"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ toolCalls: [{ ...toolCall('facts_search', '{"query":"夕"}') } as any] }))
      .mockResolvedValueOnce(providerResult({ content: '最终答案' }))

    const result = await runQuery(
      { id: 'T04', category: 'fact', question: '刻俄柏？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    expect(result.finalAnswer).toBe('最终答案')
    expect(result.toolRounds).toBe(3)
    // 第 4 轮请求前的 messages 应含第 3 轮注入的预算耗尽提示。
    const msgs = mockCall.mock.calls[3]?.[0] as Array<{ role: string; content: string }>
    expect(msgs.some((m) => m.role === 'tool' && m.content.includes('budget_exhausted'))).toBe(true)
  })
})

describe('runQuery（hybrid 模式）', () => {
  const chunks: DocChunk[] = [
    {
      id: 'base/机制-制造站.md#效率计算',
      file: 'base/机制-制造站.md',
      heading: '效率计算',
      text: '制造站效率由基础效率与干员技能加成共同决定。',
      startLine: 1,
      endLine: 1,
    },
  ]

  beforeEach(() => mockCall.mockReset())

  it('同一 Agent 暴露并派发 rag_search 与 facts_search', async () => {
    const config = loadConfig()
    config.retriever = 'hybrid'
    const index = buildIndex(chunks)

    mockCall
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: 'call_rag', name: 'rag_search', arguments: '{"query":"制造站 效率计算"}' },
          { id: 'call_facts', name: 'facts_search', arguments: '{"query":"刻俄柏"}' },
        ],
        usage: { input: 100, output: 50, cached: 0, reasoning: 0 },
        model: 'qwen',
        truncated: false,
      })
      .mockResolvedValueOnce({
        content: '混合工具最终答案',
        toolCalls: [],
        usage: { input: 200, output: 60, cached: 0, reasoning: 0 },
        model: 'qwen',
        truncated: false,
      })

    const result = await runQuery(
      { id: 'HYBRID', category: 'fact', question: '制造站机制与刻俄柏技能是什么？' },
      { config, thinking: 'off', dry: false },
      chunks,
      index,
    )

    const exposed = (mockCall.mock.calls[0]?.[1] as Record<string, unknown>[]).map(toolName)
    expect(exposed).toEqual(['rag_search', 'facts_search', 'read_section'])
    expect(result.toolTrace[0]).toEqual(['rag_search', 'facts_search'])
    expect(result.injectedIds).toEqual(['base/机制-制造站.md#效率计算'])
    const secondMessages = mockCall.mock.calls[1]?.[0] as Array<{ role: string; tool_call_id?: string; content: string }>
    expect(secondMessages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_rag')).toBe(true)
    expect(secondMessages.some((message) => message.role === 'tool' && message.tool_call_id === 'call_facts' && message.content.includes('刻俄柏'))).toBe(true)
    expect(result.finalAnswer).toBe('混合工具最终答案')
  })
})
