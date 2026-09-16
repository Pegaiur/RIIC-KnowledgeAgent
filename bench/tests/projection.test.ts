import { describe, expect, it } from 'vitest'
import { loadReferenceFacts } from '../src/facts/references.js'
import { ALL_CURATIONS } from '../src/facts/curation/index.js'
import { grantCurationHash, skillCurationHash, validateCurations } from '../src/facts/curation/types.js'
import { loadTaxonomy } from '../src/facts/taxonomy.js'
import { loadEquivalenceGroups } from '../src/facts/equivalence.js'
import { projectRecordCards } from '../src/facts/project.js'

const ROOT = process.cwd()

function loadInputs() {
  const facts = loadReferenceFacts(ROOT)
  return {
    facts,
    taxonomy: loadTaxonomy(ROOT, facts),
    equivalenceGroups: loadEquivalenceGroups(ROOT, facts),
    curations: validateCurations(facts, ALL_CURATIONS),
  }
}

describe('projection：规范化事实投影 RecordCard', () => {
  it('raw 投影 425 张卡并保留每条 grant 的设施与替换边', () => {
    const inputs = loadInputs()
    const cards = projectRecordCards({ ...inputs, mode: 'raw' })

    expect(cards).toHaveLength(425)
    expect(cards.flatMap((card) => card.skills)).toHaveLength(913)
    const senan = cards.find((card) => card.canonical === '森蚺')!
    const beta = senan.skills.find((skill) => skill.name === '自动化·β')!
    const alpha = senan.skills.find((skill) => skill.name === '自动化·α')!
    expect(beta.room).toBe('制造站')
    expect(beta.replacesGrantId).toBe(alpha.grantId)
    expect(beta.target).toContain('标签：')
    expect(beta.effectText).toContain('每个发电站')
  })

  it('raw 与 curated 模式都把来源标签投影进 RecordSkill.tags', () => {
    const inputs = loadInputs()
    const fact = inputs.facts.skillFacts.find((item) => item.name === '自动化·β' && item.room === '制造站')!
    expect(fact.tags.length).toBeGreaterThan(0)
    for (const mode of ['raw', 'curated'] as const) {
      const cards = projectRecordCards({ ...inputs, mode })
      const beta = cards.find((cardItem) => cardItem.canonical === '森蚺')!.skills.find((item) => item.name === '自动化·β')!
      expect(beta.tags).toEqual(fact.tags)
    }
  })

  it('raw 与 curated 模式都把注记数组投影进 RecordSkill，且与 SkillFact 同源', () => {
    const inputs = loadInputs()
    const fact = inputs.facts.skillFacts.find((item) => item.name === '源石技艺理论应用' && item.room === '制造站')!
    expect(fact.products).toEqual(['赤金', '作战记录', '源石碎片'])
    expect(fact.referencedTerms).toEqual(['莱茵科技类技能'])
    const grant = inputs.facts.grants.find((item) => item.skillId === fact.id)!

    for (const mode of ['raw', 'curated'] as const) {
      const skills = projectRecordCards({ ...inputs, mode }).flatMap((card) => card.skills)
      const skill = skills.find((item) => item.grantId === grant.id)!
      expect(skill.target).toBe(fact.rawAnnotationText)
      expect(skill.products).toEqual(fact.products)
      expect(skill.professions).toEqual(fact.professions)
      expect(skill.referencedTerms).toEqual(fact.referencedTerms)
    }
  })

  it('全量投影的注记数组总是存在（空为 []），命中等价组时投影共同描述原文', () => {
    const inputs = loadInputs()
    const cards = projectRecordCards({ ...inputs, mode: 'raw' })
    const skills = cards.flatMap((card) => card.skills)

    for (const skill of skills) {
      expect(Array.isArray(skill.products)).toBe(true)
      expect(Array.isArray(skill.professions)).toBe(true)
      expect(Array.isArray(skill.referencedTerms)).toBe(true)
    }

    const grouped = skills.filter((skill) => skill.equivalenceGroupId !== undefined)
    expect(grouped.length).toBeGreaterThan(0)
    for (const skill of grouped) {
      const group = inputs.equivalenceGroups.find((item) => item.id === skill.equivalenceGroupId)!
      expect(skill.equivalenceSkillNames).toEqual(group.skillNames)
      expect(skill.equivalenceEffectText).toBe(group.effectText)
    }
    expect(skills.filter((skill) => skill.equivalenceGroupId === undefined)
      .every((skill) => skill.equivalenceEffectText === undefined)).toBe(true)
  })

  it('professions 仅在注记声明时非空（训练室样本）', () => {
    const inputs = loadInputs()
    const fact = inputs.facts.skillFacts.find((item) => item.room === '训练室' && item.professions.length > 0)!
    const grant = inputs.facts.grants.find((item) => item.skillId === fact.id)!
    const skill = projectRecordCards({ ...inputs, mode: 'raw' })
      .flatMap((card) => card.skills)
      .find((item) => item.grantId === grant.id)!
    expect(skill.professions).toEqual(fact.professions)
  })

  it('同名升级和等价组均按 SkillFact/grant 精确分开', () => {
    const inputs = loadInputs()
    const cards = projectRecordCards({ ...inputs, mode: 'raw' })

    const sakiko = cards.find((card) => card.canonical === '丰川祥子')!
    const repeated = sakiko.skills.filter((skill) => skill.name === '丰富工作经验')
    expect(repeated).toHaveLength(2)
    expect(new Set(repeated.map((skill) => skill.grantId)).size).toBe(2)
    expect(new Set(repeated.map((skill) => skill.replacesGrantId).filter(Boolean)).size).toBe(1)

    const xielv = cards.find((card) => card.canonical === '协律')!
    const turbulent = xielv.skills.filter((skill) => skill.name === '澎湃紊流')
    expect(turbulent).toHaveLength(2)
    expect(new Set(turbulent.map((skill) => skill.equivalenceGroupId)).size).toBe(2)
  })

  it('curated 有有效覆盖时替换效果，无覆盖时回退原文', () => {
    const inputs = loadInputs()
    const fact = inputs.facts.skillFacts.find((item) => item.name === '自动化·α')!
    const grant = inputs.facts.grants.find((item) => item.operatorId === '森蚺' && item.skillId === fact.id)!
    const curations = validateCurations(inputs.facts, [
      {
        room: fact.room,
        skills: [{ skillId: fact.id, expectedRawHash: skillCurationHash(fact), effectText: '人工确认后的效果原文', notes: '共享技能说明' }],
        grants: [{
          grantId: grant.id,
          expectedGrantHash: grantCurationHash(grant),
          notes: '当前干员持有说明',
        }],
        operators: [],
      },
    ])

    const curated = projectRecordCards({ ...inputs, curations, mode: 'curated' })
    const raw = projectRecordCards({ ...inputs, mode: 'raw' })
    const curatedSkill = curated.find((card) => card.canonical === '森蚺')!.skills.find((skill) => skill.name === '自动化·α')!
    const rawSkill = raw.find((card) => card.canonical === '森蚺')!.skills.find((skill) => skill.name === '自动化·α')!
    expect(curatedSkill.effectText).toBe('人工确认后的效果原文')
    expect(curatedSkill.notes).toBe('共享技能说明；当前干员持有说明')
    expect(rawSkill.effectText).not.toBe('人工确认后的效果原文')
    expect(rawSkill.notes).toBeUndefined()
  })
})
