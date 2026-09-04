/**
 * 类别.md 的干员组与技能类别解析。
 *
 * 只解析「干员组」和「技能组」两节；技能组成员必须在全量 SkillFact 中唯一落点，
 * 不按模糊技能名静默连接。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FactsParseError, type SkillFact } from './normalized.js'
import type { ReferenceFacts } from './references.js'

export interface OperatorGroup {
  id: string
  name: string
  members: string[]
}

export interface SkillCategory {
  id: string
  name: string
  skillNames: string[]
  skillIds: string[]
}

export interface Taxonomy {
  facts: ReferenceFacts
  operatorGroups: OperatorGroup[]
  skillCategories: SkillCategory[]
}

function section(text: string, heading: string): string[] {
  const lines = text.split(/\r?\n/)
  const start = lines.indexOf(heading)
  if (start < 0) throw new FactsParseError(`类别真源缺少区段：${heading}`)
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? lines.length : end)
}

function parseListLine(line: string, label: string): { name: string; expectedCount: number; members: string[] } {
  const match = line.match(/^\-\s+\*\*(?<name>.+)\*\*（(?<count>\d+)）：(?<members>.+)$/)
  if (!match?.groups?.name || !match.groups.count || !match.groups.members) {
    throw new FactsParseError(`${label}存在无法解析的条目：${line}`)
  }
  const members = match.groups.members.split('、').map((member) => member.trim()).filter(Boolean)
  if (members.length !== Number(match.groups.count)) {
    throw new FactsParseError(`${label}数量标注不一致：${match.groups.name}`)
  }
  if (new Set(members).size !== members.length) {
    throw new FactsParseError(`${label}存在重复成员：${match.groups.name}`)
  }
  return { name: match.groups.name, expectedCount: Number(match.groups.count), members }
}

function parseOperatorGroups(text: string, facts: ReferenceFacts): OperatorGroup[] {
  const lines = section(text, '## 干员组（28 条）').filter((line) => line.trim())
  const groups: OperatorGroup[] = []
  const seen = new Set<string>()
  const operatorIds = new Set(facts.operators.map((operator) => operator.id))
  for (const line of lines) {
    const parsed = parseListLine(line, '干员组')
    if (seen.has(parsed.name)) throw new FactsParseError(`干员组出现重复名称：${parsed.name}`)
    for (const member of parsed.members) {
      if (!operatorIds.has(member)) throw new FactsParseError(`干员组存在名册外成员：${member}`)
    }
    seen.add(parsed.name)
    groups.push({ id: `operator-group:${parsed.name}`, name: parsed.name, members: parsed.members })
  }
  if (groups.length !== 28) throw new FactsParseError(`干员组数量不一致：${groups.length}`)

  const groupsByOperator = new Map<string, string[]>()
  for (const group of groups) {
    for (const member of group.members) {
      const names = groupsByOperator.get(member) ?? []
      names.push(group.name)
      groupsByOperator.set(member, names)
    }
  }
  for (const operator of facts.operators) {
    const actual = groupsByOperator.get(operator.id) ?? []
    if (actual.length !== operator.factionGroups.length || !actual.every((name) => operator.factionGroups.includes(name))) {
      throw new FactsParseError(`干员组与名册阵营字段不一致：${operator.canonical}`)
    }
  }
  return groups
}

function parseSkillCategories(text: string, facts: ReferenceFacts): SkillCategory[] {
  const lines = section(text, '## 技能组（5 条）').filter((line) => line.trim())
  const factByName = new Map<string, SkillFact[]>()
  for (const fact of facts.skillFacts) {
    const matches = factByName.get(fact.name) ?? []
    matches.push(fact)
    factByName.set(fact.name, matches)
  }

  const categories: SkillCategory[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const parsed = parseListLine(line, '技能类别')
    if (seen.has(parsed.name)) throw new FactsParseError(`技能类别出现重复名称：${parsed.name}`)
    const skillIds: string[] = []
    for (const skillName of parsed.members) {
      const matches = factByName.get(skillName) ?? []
      if (matches.length === 0) throw new FactsParseError(`技能类别存在未知技能：${skillName}`)
      if (matches.length !== 1) throw new FactsParseError(`技能类别技能无法唯一定位：${skillName}`)
      skillIds.push(matches[0].id)
    }
    seen.add(parsed.name)
    categories.push({ id: `skill-category:${parsed.name}`, name: parsed.name, skillNames: parsed.members, skillIds })
  }
  if (categories.length !== 5) throw new FactsParseError(`技能类别数量不一致：${categories.length}`)
  return categories
}

/** 注入全量 facts 解析类别与技能组，执行双向和精确落点核对。 */
export function parseTaxonomy(text: string, facts: ReferenceFacts): Taxonomy {
  return {
    facts,
    operatorGroups: parseOperatorGroups(text, facts),
    skillCategories: parseSkillCategories(text, facts),
  }
}

/** 从仓库真源读取类别.md。 */
export function loadTaxonomy(root: string, facts: ReferenceFacts): Taxonomy {
  try {
    return parseTaxonomy(readFileSync(join(root, 'knowledge', 'references', '类别.md'), 'utf-8'), facts)
  } catch (error) {
    if (error instanceof FactsParseError) throw error
    throw new FactsParseError('无法读取真源类别：knowledge/references/类别.md')
  }
}
