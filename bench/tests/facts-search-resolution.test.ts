import { describe, expect, it } from 'vitest'
import { buildCardStore, serializeFactsMatches } from '../src/facts/store.js'
import type { RecordCard } from '../src/facts/card.js'
import type { ComboEntry, TermCurations } from '../src/facts/terms.js'

const evidence = { path: 'knowledge/guides/测试.md', section: '测试组' }

const cards: RecordCard[] = [
  { canonical: '测试甲', aliases: [], rarity: '4', class: '医疗', rooms: [], factionGroups: ['共享组', '共享词'], skillGroups: [], skills: [], notes: '' },
  { canonical: '共享词', aliases: [], rarity: '4', class: '近卫', rooms: [], factionGroups: [], skillGroups: [], skills: [], notes: '' },
  { canonical: '测试乙', aliases: [], rarity: '4', class: '重装', rooms: [], factionGroups: ['共享组', '共享词'], skillGroups: [], skills: [], notes: '' },
]

const terms: TermCurations = {
  aliases: [{ text: '测试甲', targets: ['operator:测试甲', 'operator:测试乙'], evidence: [evidence] }],
  substrings: [],
  combos: [{
    id: 'combo:共享词', name: '共享词',
    members: [{ target: 'operator:测试甲', role: 'core' }, { target: 'operator:共享词', role: 'support' }],
    conditions: ['测试条件'], coverage: 'listed', evidence: [evidence],
  }],
  legacyNames: [
    { text: '旧共享词', action: 'redirect', target: 'combo:共享词', evidence: [evidence] },
    { text: '拒绝词', action: 'reject', reason: '该名称已明确废弃', evidence: [evidence] },
  ],
}

describe('facts 查询级解析', () => {
  const store = buildCardStore(cards, terms)

  it('同词精确、别名和搭配全部返回，卡去重且按输入卡序稳定', () => {
    const result = store.factsSearch('测试甲')
    expect(result.query).toBe('测试甲')
    expect(result.paths.map((path) => path.kind)).toEqual(['exact', 'alias'])
    expect(result.paths[0]).toMatchObject({ kind: 'exact', category: 'operator', memberIds: ['测试甲'] })
    expect(result.paths[1]).toMatchObject({ kind: 'alias', targets: ['operator:测试甲', 'operator:测试乙'], memberIds: ['测试甲', '测试乙'] })
    expect(result.matches.map((match) => match.card.canonical)).toEqual(['测试甲', '测试乙'])
    expect(result.matches[0]?.categories).toEqual(['operator'])
    expect(result.matches[1]?.categories).toEqual([])

    const shared = store.factsSearch('共享词')
    expect(shared.paths.map((path) => path.kind)).toEqual(['exact', 'exact', 'combo'])
    expect(shared.paths[0]).toMatchObject({ category: 'operator', memberIds: ['共享词'] })
    expect(shared.paths[1]).toMatchObject({ category: 'faction', memberIds: ['测试甲', '测试乙'] })
    expect(shared.paths[2]).toMatchObject({ combo: expect.objectContaining({ id: 'combo:共享词' }), memberIds: ['测试甲', '共享词'] })
    expect(shared.matches.map((match) => match.card.canonical)).toEqual(['测试甲', '共享词', '测试乙'])
    expect(shared.matches[0]?.categories).toEqual(['faction'])
    expect(shared.matches[1]?.categories).toEqual(['operator'])
    expect(shared.matches[2]?.categories).toEqual(['faction'])
  })

  it('旧称直接命中目标搭配，拒绝路径和合法精确路径互不遮蔽', () => {
    const legacy = store.factsSearch('旧共享词')
    expect(legacy.paths).toHaveLength(1)
    expect(legacy.paths[0]).toMatchObject({ kind: 'legacy', term: '旧共享词', combo: { id: 'combo:共享词' }, memberIds: ['测试甲', '共享词'] })
    expect(legacy.matches.map((match) => match.card.canonical)).toEqual(['测试甲', '共享词'])

    const rejected = store.factsSearch('拒绝词')
    expect(rejected).toMatchObject({ query: '拒绝词', matches: [], paths: [{ kind: 'rejected', reason: '该名称已明确废弃', memberIds: [] }] })

    const exactAndRejected = buildCardStore([
      ...cards,
      { ...cards[0]!, canonical: '拒绝词' },
    ], {
      ...terms,
      legacyNames: [{ text: '拒绝词', action: 'reject', reason: '该名称已明确废弃', evidence: [evidence] }],
    }).factsSearch('拒绝词')
    expect(exactAndRejected.paths.map((path) => path.kind)).toEqual(['exact', 'rejected'])
    expect(exactAndRejected.matches.map((match) => match.card.canonical)).toEqual(['拒绝词'])
  })

  it('只 trim 首尾，不把组合成员或目标名称递归为其他路径', () => {
    const result = store.factsSearch('  旧共享词  ')
    expect(result.query).toBe('旧共享词')
    expect(result.paths.map((path) => path.kind)).toEqual(['legacy'])
    expect(store.factsSearch('测试甲 共享词').paths).toEqual([])
    expect(store.factsSearch('德狼').paths).toEqual([])
  })

  it('序列化混合路径、组合条件和纯拒绝时不回退为未知词模板', () => {
    const mixed = serializeFactsMatches(store.factsSearch('测试甲'))
    expect(mixed).toContain('词条解析：测试甲')
    expect(mixed).toContain('精确：干员正式名')
    expect(mixed).toContain('别名：测试甲 → 测试甲、测试乙')
    expect(mixed).toContain('【测试乙】')
    expect(mixed).not.toContain('未收录精确词条')

    const combo = serializeFactsMatches(store.factsSearch('共享词'))
    expect(combo).toContain('组合：共享词 → 共享词')
    expect(combo).toContain('条件：测试条件')
    expect(combo).toContain('测试甲（核心）')

    const rejected = serializeFactsMatches(store.factsSearch('拒绝词'))
    expect(rejected).toContain('拒绝：拒绝词')
    expect(rejected).toContain('该名称已明确废弃')
    expect(rejected).not.toContain('未收录精确词条')
  })
})

const substringEvidence = { path: 'knowledge/references/歧义.md', section: '一、子串包含对（31 组，自动生成）' }

const substringCards: RecordCard[] = [
  { canonical: '测试甲', aliases: [], rarity: '4', class: '医疗', rooms: [], factionGroups: [], skillGroups: [], skills: [], notes: '' },
  { canonical: '长测试甲', aliases: [], rarity: '5', class: '近卫', rooms: [], factionGroups: [], skillGroups: [], skills: [], notes: '' },
  { canonical: '测试甲乙', aliases: [], rarity: '5', class: '重装', rooms: [], factionGroups: [], skillGroups: [], skills: [], notes: '' },
]

const substringTerms: TermCurations = {
  aliases: [],
  substrings: [{
    text: '测试甲', targets: ['operator:长测试甲', 'operator:测试甲乙'], evidence: [substringEvidence],
  }],
  combos: [],
  legacyNames: [],
}

function substringCombo(name: string, id: ComboEntry['id']): ComboEntry {
  return {
    id, name,
    members: [{ target: 'operator:长测试甲', role: 'core' }, { target: 'operator:测试甲乙', role: 'core' }],
    conditions: ['同站进驻'], coverage: 'listed', evidence: [substringEvidence],
  }
}

describe('facts 子串对查询路径', () => {
  it('S6 短名精确返回自身并按下标登记返回全部长名，卡片按输入卡序去重', () => {
    const result = buildCardStore(substringCards, substringTerms).factsSearch('测试甲')
    expect(result.paths.map((path) => path.kind)).toEqual(['exact', 'substring'])
    expect(result.paths[0]).toMatchObject({ kind: 'exact', category: 'operator', memberIds: ['测试甲'] })
    expect(result.paths[1]).toMatchObject({
      kind: 'substring', term: '测试甲',
      targets: ['operator:长测试甲', 'operator:测试甲乙'], memberIds: ['长测试甲', '测试甲乙'],
      evidence: [substringEvidence],
    })
    expect(result.matches.map((match) => match.card.canonical)).toEqual(['测试甲', '长测试甲', '测试甲乙'])
    expect(result.matches.map((match) => match.categories)).toEqual([['operator'], [], []])
    expect(serializeFactsMatches(result)).toContain('子串：测试甲 → 长测试甲、测试甲乙')
  })

  it('S7 同名别名仅覆盖一个长名时仍保留完整子串目标与全部成员，顺序 exact → alias → substring', () => {
    const result = buildCardStore(substringCards, {
      ...substringTerms,
      aliases: [{ text: '测试甲', targets: ['operator:长测试甲'], evidence: [substringEvidence] }],
    }).factsSearch('测试甲')
    expect(result.paths.map((path) => path.kind)).toEqual(['exact', 'alias', 'substring'])
    expect(result.paths[2]).toMatchObject({
      kind: 'substring', targets: ['operator:长测试甲', 'operator:测试甲乙'], memberIds: ['长测试甲', '测试甲乙'],
    })
    expect(result.matches.map((match) => match.card.canonical)).toEqual(['测试甲', '长测试甲', '测试甲乙'])
  })

  it('S8 全部长名被同名组合覆盖时省略子串路径', () => {
    const result = buildCardStore(substringCards, {
      ...substringTerms,
      combos: [substringCombo('测试甲', 'combo:测试甲')],
    }).factsSearch('测试甲')
    expect(result.paths.map((path) => path.kind)).toEqual(['exact', 'combo'])
    expect(result.matches.map((match) => match.card.canonical)).toEqual(['测试甲', '长测试甲', '测试甲乙'])
  })

  it('S8 全部长名被同名旧称搭配覆盖时省略子串路径', () => {
    const result = buildCardStore(substringCards, {
      ...substringTerms,
      combos: [substringCombo('覆盖组', 'combo:覆盖组')],
      legacyNames: [{ text: '测试甲', action: 'redirect', target: 'combo:覆盖组', evidence: [substringEvidence] }],
    }).factsSearch('测试甲')
    expect(result.paths.map((path) => path.kind)).toEqual(['exact', 'legacy'])
    expect(result.matches.map((match) => match.card.canonical)).toEqual(['测试甲', '长测试甲', '测试甲乙'])
  })

  it('长名查询不反查短名，未登记子串不扩展', () => {
    const store = buildCardStore(substringCards, substringTerms)
    const long = store.factsSearch('长测试甲')
    expect(long.paths.map((path) => path.kind)).toEqual(['exact'])
    expect(long.matches.map((match) => match.card.canonical)).toEqual(['长测试甲'])
    expect(store.factsSearch('测试').paths).toEqual([])
    expect(store.factsSearch('光').paths).toEqual([])
  })
})
