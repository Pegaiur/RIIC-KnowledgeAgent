import { describe, expect, it } from 'vitest'
import { loadReferenceFacts, REFERENCE_ROOMS } from '../src/facts/references.js'
import { ALL_CURATIONS } from '../src/facts/curation/index.js'
import { TERM_CURATIONS } from '../src/facts/curation/terms.js'
import { loadValidatedRecordCards } from '../src/facts/final.js'
import { buildCardStore, serializeFactsMatches } from '../src/facts/store.js'
import {
  grantCurationHash,
  resolveSkillEffectText,
  skillCurationHash,
  validateCurations,
  type SkillCuration,
} from '../src/facts/curation/types.js'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\')

describe('curation：九个设施独立人工优化批次', () => {
  it('每个设施都有独立批次，未覆盖技能安全回退原文', () => {
    const facts = loadReferenceFacts(ROOT)
    const validated = validateCurations(facts, ALL_CURATIONS)
    expect(ALL_CURATIONS.map((batch) => batch.room)).toEqual([...REFERENCE_ROOMS])
    expect(validated.skills.size).toBe(0)
    expect(validated.grants.size).toBe(0)
    expect([...validated.operators.keys()].sort()).toEqual([
      '乌尔比安', '令', '伺夜', '多萝西', '孑', '巫恋', '摩根', '斯卡蒂', '桃金娘', '水月', '泡泡', '温蒂', '焰尾', '能天使', '迷迭香', '银灰', '陈', '龙舌兰',
    ])
    const fact = facts.skillFacts[0]
    expect(resolveSkillEffectText(fact, 'raw', validated)).toBe(fact.rawEffectText)
    expect(resolveSkillEffectText(fact, 'curated', validated)).toBe(fact.rawEffectText)
  })

  it('有效 SkillCuration 使用原文指纹并可选择优化文本', () => {
    const facts = loadReferenceFacts(ROOT)
    const fact = facts.skillFacts[0]
    const curation: SkillCuration = {
      skillId: fact.id,
      expectedRawHash: skillCurationHash(fact),
      effectText: '已确认的表达优化',
      notes: '人工核对：仅改善表达',
    }
    const validated = validateCurations(facts, [{ room: fact.room, skills: [curation], grants: [], operators: [] }])
    expect(resolveSkillEffectText(fact, 'raw', validated)).toBe(fact.rawEffectText)
    expect(resolveSkillEffectText(fact, 'curated', validated)).toBe('已确认的表达优化')
    expect(grantCurationHash(facts.grants[0])).toMatch(/^[0-9a-f]{64}$/)
  })

  it('指纹失效、孤儿和空优化文本均给出中文错误', () => {
    const facts = loadReferenceFacts(ROOT)
    const fact = facts.skillFacts[0]
    const invalid: SkillCuration = { skillId: fact.id, expectedRawHash: 'invalid', effectText: '' }
    expect(() => validateCurations(facts, [{ room: fact.room, skills: [invalid], grants: [], operators: [] }])).toThrow(
      '事实优化失败：SkillCuration 原文指纹失效',
    )
    expect(() => validateCurations(facts, [{ room: fact.room, skills: [{ ...invalid, skillId: 'missing' }], grants: [], operators: [] }])).toThrow(
      '事实优化失败：SkillCuration 存在孤儿 skillId：missing',
    )
    expect(() => validateCurations(facts, [{ room: fact.room, skills: [{ ...invalid, expectedRawHash: skillCurationHash(fact) }], grants: [], operators: [] }])).toThrow(
      '事实优化失败：SkillCuration 优化文本不能为空',
    )
  })
})

describe('operator notes：组合跨引用导航', () => {
  const curated = loadValidatedRecordCards(ROOT, 'curated')
  const raw = loadValidatedRecordCards(ROOT, 'raw')
  const curatedStore = buildCardStore(curated, TERM_CURATIONS)
  const rawStore = buildCardStore(raw, TERM_CURATIONS)

  it('代表入口的返回卡携带指向缺失成员的导航', () => {
    const cases = [
      { term: '焰尾', canonical: '焰尾', target: '薇薇安娜' },
      { term: '能天使', canonical: '能天使', target: '蕾缪安' },
      { term: '多萝西', canonical: '多萝西', target: '淬羽赫默' },
    ]
    for (const { term, canonical, target } of cases) {
      const result = curatedStore.factsSearch(term)
      const card = result.matches.find((match) => match.card.canonical === canonical)?.card
      expect(card, term).toBeDefined()
      expect(card!.notes, term).toContain(target)
      expect(serializeFactsMatches(result), term).toContain(target)
    }
  })

  it('增加备注不改变 facts_search 的命中集合与路径', () => {
    for (const term of ['焰尾', '能天使', '水月', '斯卡蒂', '莱茵生命', '标准化类技能', '红松骑士团', '薇薇安娜', '蕾缪安']) {
      const withNotes = curatedStore.factsSearch(term)
      const withoutNotes = rawStore.factsSearch(term)
      expect(withNotes.paths, term).toEqual(withoutNotes.paths)
      expect(withNotes.matches.map((match) => match.card.canonical), term)
        .toEqual(withoutNotes.matches.map((match) => match.card.canonical))
      expect(withNotes.matches.map((match) => match.categories), term)
        .toEqual(withoutNotes.matches.map((match) => match.categories))
    }
  })

  it('已有备注保留，且水月导航保留精确搜索词与三人同站条件', () => {
    const wulian = curatedStore.factsSearch('巫恋').matches.find((match) => match.card.canonical === '巫恋')!.card
    expect(wulian.notes).toContain('低语')
    const jie = curatedStore.factsSearch('孑').matches.find((match) => match.card.canonical === '孑')!.card
    expect(jie.notes).toContain('摊贩经济')

    const shuiyue = serializeFactsMatches(curatedStore.factsSearch('水月'))
    expect(shuiyue).toContain('标准化类技能')
    expect(shuiyue).toContain('另配两名')
    expect(shuiyue).toContain('共三人')
  })
})
