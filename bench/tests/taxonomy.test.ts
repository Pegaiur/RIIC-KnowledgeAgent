import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadReferenceFacts } from '../src/facts/references.js'
import { loadTaxonomy } from '../src/facts/taxonomy.js'

const ROOT = process.cwd()

describe('taxonomy：类别.md 干员组与技能类别', () => {
  it('精确解析 28 个干员组和 5 个技能类别，并连接到全量 facts', () => {
    const facts = loadReferenceFacts(ROOT)
    const taxonomy = loadTaxonomy(ROOT, facts)
    expect(taxonomy.operatorGroups).toHaveLength(28)
    expect(taxonomy.operatorGroups.reduce((sum, group) => sum + group.members.length, 0)).toBe(193)
    expect(taxonomy.skillCategories).toHaveLength(5)
    expect(taxonomy.skillCategories.map((category) => category.name)).toEqual([
      '标准化类技能',
      '红松骑士团类技能',
      '莱茵科技类技能',
      '部分技能',
      '金属工艺类技能',
    ])
    expect(taxonomy.operatorGroups.find((group) => group.name === '怪物猎人小队')?.members).toEqual([
      '火龙S黑角',
      '麒麟R夜刀',
      '泰拉大陆调查团',
    ])
    const standardization = taxonomy.skillCategories.find((category) => category.name === '标准化类技能')!
    expect(standardization.skillNames).toEqual(['标准化·α', '标准化·β'])
    expect(standardization.skillIds).toHaveLength(2)
    expect(new Set(standardization.skillIds).size).toBe(2)
    expect(standardization.skillIds.every((id) => facts.skillFacts.some((fact) => fact.id === id))).toBe(true)
  })

  it('名册阵营字段与类别干员组双向完全相等', () => {
    const taxonomy = loadTaxonomy(ROOT, loadReferenceFacts(ROOT))
    const groupByMember = new Map<string, string[]>()
    for (const group of taxonomy.operatorGroups) {
      for (const member of group.members) {
        const groups = groupByMember.get(member) ?? []
        groups.push(group.name)
        groupByMember.set(member, groups)
      }
    }
    for (const operator of taxonomy.facts.operators) {
      expect((groupByMember.get(operator.canonical) ?? []).sort()).toEqual([...operator.factionGroups].sort())
    }
  })

  it('类别.md 是唯一读取源且关键节存在', () => {
    expect(readFileSync(join(ROOT, 'knowledge/references/类别.md'), 'utf-8')).toContain('## 干员组（28 条）')
  })
})
