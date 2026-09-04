import { describe, expect, it } from 'vitest'
import { loadReferenceFacts } from '../src/facts/references.js'
import { loadEquivalenceGroups } from '../src/facts/equivalence.js'

const ROOT = process.cwd()

describe('equivalence：技能等价组精确拼装', () => {
  it('解析 82 个等价组并为每个成员连接精确 SkillFact', () => {
    const facts = loadReferenceFacts(ROOT)
    const groups = loadEquivalenceGroups(ROOT, facts)
    expect(groups).toHaveLength(82)
    expect(groups.every((group) => group.skillNames.length >= 2)).toBe(true)
    expect(groups.every((group) => group.skillIds.every((id) => facts.skillFacts.some((fact) => fact.id === id)))).toBe(true)
    expect(new Set(groups.map((group) => group.id)).size).toBe(82)

    const battleLog = groups.find((group) => group.skillNames.includes('作战指导录像'))
    expect(battleLog?.skillIds.filter((id) => facts.skillFacts.find((fact) => fact.id === id)?.name === '作战指导录像')).toHaveLength(2)
  })

  it('澎湃紊流的 10% 与 15% 等价组不会因同名而串线', () => {
    const groups = loadEquivalenceGroups(ROOT, loadReferenceFacts(ROOT))
      .filter((group) => group.skillNames.includes('澎湃紊流'))
    expect(groups).toHaveLength(2)
    expect(groups.map((group) => group.effectText).sort()).toEqual([
      '进驻发电站时，无人机充能速度+10%',
      '进驻发电站时，无人机充能速度+15%',
    ])
    expect(groups[0].id).not.toBe(groups[1].id)
    expect(groups[0].skillIds[groups[0].skillNames.indexOf('澎湃紊流')]).not.toBe(
      groups[1].skillIds[groups[1].skillNames.indexOf('澎湃紊流')],
    )
  })
})
