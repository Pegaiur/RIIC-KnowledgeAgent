/** 全量 facts-first 最终门禁与运行时投影入口。 */
import type { RecordCard, RecordSkill } from './card.js'
import { ALL_CURATIONS } from './curation/index.js'
import { validateCurations, type CurationMode } from './curation/types.js'
import { loadEquivalenceGroups } from './equivalence.js'
import { FACTS_FIXTURES } from './fixtures.js'
import { FactsParseError } from './normalized.js'
import { loadReferenceFacts } from './references.js'
import { projectRecordCards } from './project.js'
import { loadTaxonomy } from './taxonomy.js'

const EXPECTED_OPERATORS = 425
const EXPECTED_FRAGMENTS = 9
const EXPECTED_OPERATOR_SECTIONS = 586
const EXPECTED_GRANTS = 913
const EXPECTED_REPLACEMENTS = 167
const EXPECTED_OPERATOR_GROUPS = 28
const EXPECTED_OPERATOR_GROUP_MEMBERS = 193
const EXPECTED_SKILL_CATEGORIES = 5
const EXPECTED_EQUIVALENCE_GROUPS = 82

function normalizeFixtureName(name: string): string {
  return name.replace(/^["“](.*)["”]$/u, '$1')
}

/** fixture 的 target 是历史人工缩写；仅在兼容回归中还原为原文注记口径。 */
function normalizeFixtureTarget(target: string): string {
  if (!target) return ''
  return /^(?:标签|作用产物|作用职业|引用术语)：/u.test(target) ? target : `标签：${target}`
}

function comparableSkill(skill: Pick<RecordSkill, 'name' | 'unlockType' | 'target' | 'effectText'>, fixture: boolean): string {
  return JSON.stringify([
    fixture ? normalizeFixtureName(skill.name) : normalizeFixtureName(skill.name),
    skill.unlockType,
    fixture ? normalizeFixtureTarget(skill.target) : skill.target,
    skill.effectText,
  ])
}

function compareSkillMultiset(actual: readonly RecordSkill[], expected: readonly RecordSkill[]): boolean {
  const left = actual.map((skill) => comparableSkill(skill, false)).sort()
  const right = expected.map((skill) => comparableSkill(skill, true)).sort()
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertFixtureCompatibility(cards: readonly RecordCard[]): void {
  const cardsByCanonical = new Map(cards.map((card) => [card.canonical, card]))
  for (const fixture of FACTS_FIXTURES) {
    const actual = cardsByCanonical.get(fixture.canonical)
    if (!actual) throw new FactsParseError(`fixture 回归缺少干员：${fixture.canonical}`)
    if (actual.rarity !== fixture.rarity || actual.class !== fixture.class
      || JSON.stringify(actual.rooms) !== JSON.stringify(fixture.rooms)
      || JSON.stringify(actual.factionGroups) !== JSON.stringify(fixture.factionGroups)
      || JSON.stringify(actual.skillGroups) !== JSON.stringify(fixture.skillGroups)) {
      throw new FactsParseError(`fixture 回归机械字段不一致：${fixture.canonical}`)
    }
    if (!compareSkillMultiset(actual.skills, fixture.skills)) {
      throw new FactsParseError(`fixture 回归技能兼容字段不一致：${fixture.canonical}`)
    }
  }
}

function assertFullFacts(root: string): ReturnType<typeof loadReferenceFacts> {
  const facts = loadReferenceFacts(root)
  if (facts.operators.length !== EXPECTED_OPERATORS) throw new FactsParseError(`全量干员数量不一致：${facts.operators.length}`)
  if (facts.fragments.length !== EXPECTED_FRAGMENTS) throw new FactsParseError(`设施分片数量不一致：${facts.fragments.length}`)
  if (facts.fragments.reduce((sum, fragment) => sum + fragment.stats.operatorSections, 0) !== EXPECTED_OPERATOR_SECTIONS) {
    throw new FactsParseError('全量干员设施小节数量不一致')
  }
  if (facts.grants.length !== EXPECTED_GRANTS) throw new FactsParseError(`全量 grant 数量不一致：${facts.grants.length}`)
  if (facts.grants.filter((grant) => grant.replacesGrantId !== undefined).length !== EXPECTED_REPLACEMENTS) {
    throw new FactsParseError('全量替换边数量不一致')
  }
  return facts
}

/** 通过全量事实门禁并返回指定模式的 RecordCard；未通过时不暴露半成品。 */
export function loadValidatedRecordCards(root: string, mode: CurationMode = 'curated'): RecordCard[] {
  const facts = assertFullFacts(root)
  const taxonomy = loadTaxonomy(root, facts)
  if (taxonomy.operatorGroups.length !== EXPECTED_OPERATOR_GROUPS
    || taxonomy.operatorGroups.reduce((sum, group) => sum + group.members.length, 0) !== EXPECTED_OPERATOR_GROUP_MEMBERS
    || taxonomy.skillCategories.length !== EXPECTED_SKILL_CATEGORIES) {
    throw new FactsParseError('类别真源全量计数不一致')
  }
  const equivalenceGroups = loadEquivalenceGroups(root, facts)
  if (equivalenceGroups.length !== EXPECTED_EQUIVALENCE_GROUPS) {
    throw new FactsParseError(`技能等价组数量不一致：${equivalenceGroups.length}`)
  }
  const curations = validateCurations(facts, ALL_CURATIONS)
  const rawCards = projectRecordCards({ facts, taxonomy, equivalenceGroups, curations, mode: 'raw' })
  assertFixtureCompatibility(rawCards)
  return mode === 'raw' ? rawCards : projectRecordCards({ facts, taxonomy, equivalenceGroups, curations, mode })
}
