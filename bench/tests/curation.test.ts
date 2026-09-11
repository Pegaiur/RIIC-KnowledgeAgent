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
      '乌尔比安', '乌有', '令', '伺夜', '八幡海铃', '图耶', '夕', '多萝西', '孑', '巫恋', '戴菲恩', '推进之王', '摩根', '斩业星熊', '斯卡蒂', '桃金娘', '歌蕾蒂娅', '水月', '泡泡', '清流', '温蒂', '火神', '灵知', '焰尾', '琴柳', '砾', '红云', '绮良', '能天使', '薇薇安娜', '迷迭香', '重岳', '银灰', '陈', '鸿雪', '黑键', '龙舌兰',
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
    for (const term of ['焰尾', '能天使', '水月', '斯卡蒂', '莱茵生命', '标准化类技能', '红松骑士团', '薇薇安娜', '蕾缪安', '红云', '红云组', '鸿雪', '鸿雪杜林组', '乌有', '人间烟火组', '黑键', '感知信息组', '琴柳', '夕', '砾', '自动化组', '泡泡组', '推进之王', '格拉斯哥帮组', '能天使组', '企鹅物流', '深海猎人组', '深巡＋乌尔比安', '赤金工艺组']) {
      const withNotes = curatedStore.factsSearch(term)
      const withoutNotes = rawStore.factsSearch(term)
      expect(withNotes.paths, term).toEqual(withoutNotes.paths)
      expect(withNotes.matches.map((match) => match.card.canonical), term)
        .toEqual(withoutNotes.matches.map((match) => match.card.canonical))
      expect(withNotes.matches.map((match) => match.categories), term)
        .toEqual(withoutNotes.matches.map((match) => match.categories))
    }
  })

  it('红云单卡提供两条可选分支导航，不把成员展开为本次命中', () => {
    const result = curatedStore.factsSearch('红云')
    expect(result.matches.map((match) => match.card.canonical)).toEqual(['红云'])
    const output = serializeFactsMatches(result)
    expect(output).toContain('本卡精一')
    expect(output).toContain('同站')
    expect(output).toContain('酒神和 Miss.Christine（均精二）')
    expect(output).toContain('稀音、帕拉斯、刻俄柏中任选两名精二')
    expect(output).toContain('两条分支择一即可')
    expect(output).toContain('搜索「红云组」')
    const followUp = curatedStore.factsSearch('红云组').matches.map((match) => match.card.canonical)
    expect(followUp).toEqual(expect.arrayContaining(['红云', '酒神', 'Miss.Christine', '稀音', '帕拉斯', '刻俄柏']))
  })

  it('合并保留：既有机制解释与组合导航并存，且水月导航保留精确搜索词与三人同站条件', () => {
    const wulian = curatedStore.factsSearch('巫恋').matches.find((match) => match.card.canonical === '巫恋')!.card
    expect(wulian.notes).toContain('低语')
    expect(wulian.notes).toContain('龙舌兰组')
    const jie = curatedStore.factsSearch('孑').matches.find((match) => match.card.canonical === '孑')!.card
    expect(jie.notes).toContain('摊贩经济')
    expect(jie.notes).toContain('喀兰贸易组')

    const ling = curatedStore.factsSearch('令').matches.find((match) => match.card.canonical === '令')!.card
    expect(ling.notes).toContain('桑葚')
    expect(ling.notes).toContain('琴柳')
    expect(ling.notes).toContain('不是启动必需')

    const shuiyue = serializeFactsMatches(curatedStore.factsSearch('水月'))
    expect(shuiyue).toContain('标准化类技能')
    expect(shuiyue).toContain('另配两名')
    expect(shuiyue).toContain('共三人')
  })

  it('新增核心卡在返回结果中含精确组合名', () => {
    const cases = [
      { term: '鸿雪', combo: '鸿雪杜林组' },
      { term: '绮良', combo: '鸿雪杜林组' },
      { term: '图耶', combo: '鸿雪杜林组' },
      { term: '乌有', combo: '人间烟火组' },
      { term: '黑键', combo: '感知信息组' },
      { term: '八幡海铃', combo: '叙拉古' },
      { term: '灵知', combo: '喀兰贸易组' },
      { term: '戴菲恩', combo: '格拉斯哥帮组' },
      { term: '重岳', combo: '人间烟火组' },
      { term: '薇薇安娜', combo: '红松骑士团组' },
      { term: '歌蕾蒂娅', combo: '深海猎人组' },
      { term: '斩业星熊', combo: '龙门中枢组' },
      { term: '清流', combo: '自动化组' },
      { term: '火神', combo: '泡泡组' },
      { term: '推进之王', combo: '格拉斯哥帮组' },
    ]
    for (const { term, combo } of cases) {
      const card = curatedStore.factsSearch(term).matches.find((match) => match.card.canonical === term)?.card
      expect(card, term).toBeDefined()
      expect(card!.notes, term).toContain(combo)
      expect(serializeFactsMatches(curatedStore.factsSearch(term)), term).toContain(combo)
    }
  })

  it('沿备注的组合名跟进查询返回成员角色与关键条件', () => {
    const output = serializeFactsMatches(curatedStore.factsSearch('鸿雪杜林组'))
    expect(output).toContain('鸿雪（核心）')
    expect(output).toContain('鸿雪、绮良、图耶均达到精二')
    expect(output).toContain('五名挂件中放满四名')
    const followUp = curatedStore.factsSearch('鸿雪杜林组').matches.map((match) => match.card.canonical)
    expect(followUp).toEqual(expect.arrayContaining(['鸿雪', '绮良', '图耶', '桃金娘']))
  })

  it('跨组合卡同时显示两个组合身份', () => {
    const cases = [
      { term: '能天使', combos: ['能天使组', '企鹅物流'] },
      { term: '乌尔比安', combos: ['深巡＋乌尔比安', '深海猎人组'] },
      { term: '令', combos: ['人间烟火组', '感知信息组'] },
      { term: '琴柳', combos: ['人间烟火组', '感知信息组'] },
      { term: '夕', combos: ['人间烟火组', '感知信息组'] },
      { term: '砾', combos: ['赤金工艺组', '红松骑士团组'] },
    ]
    for (const { term, combos } of cases) {
      const card = curatedStore.factsSearch(term).matches.find((match) => match.card.canonical === term)?.card
      expect(card, term).toBeDefined()
      for (const combo of combos) expect(card!.notes, `${term} → ${combo}`).toContain(combo)
    }
  })
})
