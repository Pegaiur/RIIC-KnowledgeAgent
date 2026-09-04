/** 将规范化事实、类别、等价组和人工覆盖确定性投影为兼容 RecordCard。 */
import type { RecordCard, RecordSkill } from './card.js'
import { ALL_CURATIONS } from './curation/index.js'
import { resolveSkillEffectText, validateCurations, type CurationMode, type ValidatedCurations } from './curation/types.js'
import type { SkillEquivalenceGroup } from './equivalence.js'
import { loadEquivalenceGroups } from './equivalence.js'
import { loadReferenceFacts, type ReferenceFacts } from './references.js'
import { loadTaxonomy, type Taxonomy } from './taxonomy.js'

export interface RecordCardProjectionOptions {
  facts: ReferenceFacts
  taxonomy: Taxonomy
  equivalenceGroups: readonly SkillEquivalenceGroup[]
  curations: ValidatedCurations
  mode: CurationMode
}

function indexBy<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function appendNote(notes: string[], note: string | undefined): void {
  const normalized = note?.trim()
  if (normalized && !notes.includes(normalized)) notes.push(normalized)
}

/** 将一组已通过门禁的规范化输入投影为一张卡对应一个名册干员。 */
export function projectRecordCards(options: RecordCardProjectionOptions): RecordCard[] {
  const { facts, taxonomy, equivalenceGroups, curations, mode } = options
  const factById = indexBy(facts.skillFacts)
  const grantsByOperator = new Map<string, typeof facts.grants>()
  for (const grant of facts.grants) {
    const grants = grantsByOperator.get(grant.operatorId) ?? []
    grants.push(grant)
    grantsByOperator.set(grant.operatorId, grants)
  }

  const categoriesBySkill = new Map<string, string[]>()
  for (const category of taxonomy.skillCategories) {
    for (const skillId of category.skillIds) {
      const categories = categoriesBySkill.get(skillId) ?? []
      categories.push(category.name)
      categoriesBySkill.set(skillId, categories)
    }
  }
  const equivalencesBySkill = new Map<string, SkillEquivalenceGroup[]>()
  for (const group of equivalenceGroups) {
    for (const skillId of group.skillIds) {
      const groups = equivalencesBySkill.get(skillId) ?? []
      groups.push(group)
      equivalencesBySkill.set(skillId, groups)
    }
  }

  return facts.operators.map((operator) => {
    const operatorGrants = grantsByOperator.get(operator.id) ?? []
    const cardNotes: string[] = []
    if (mode === 'curated') appendNote(cardNotes, curations.operators.get(operator.id)?.notes)
    const skills: RecordSkill[] = operatorGrants.map((grant) => {
      const fact = factById.get(grant.skillId)
      if (!fact) throw new Error(`事实投影失败：grant 缺少 SkillFact：${grant.id}`)
      const equivalences = equivalencesBySkill.get(fact.id) ?? []
      if (equivalences.length > 1) throw new Error(`事实投影失败：SkillFact 命中多个等价组：${fact.id}`)
      const skillCuration = mode === 'curated' ? curations.skills.get(fact.id) : undefined
      const skillNotes: string[] = []
      if (mode === 'curated') {
        appendNote(skillNotes, skillCuration?.notes)
        appendNote(skillNotes, curations.grants.get(grant.id)?.notes)
      }
      return {
        grantId: grant.id,
        room: fact.room,
        name: fact.name,
        unlockType: grant.unlockText,
        target: fact.rawAnnotationText,
        effectText: resolveSkillEffectText(fact, mode, curations),
        ...(skillNotes.length === 0 ? {} : { notes: skillNotes.join('；') }),
        ...(grant.replacesGrantId === undefined ? {} : { replacesGrantId: grant.replacesGrantId }),
        skillCategories: categoriesBySkill.get(fact.id) ?? [],
        ...(equivalences.length === 0 ? {} : { equivalenceGroupId: equivalences[0].id }),
        ...(equivalences.length === 0 ? {} : { equivalenceSkillNames: [...equivalences[0].skillNames] }),
      }
    })

    return {
      canonical: operator.canonical,
      aliases: [],
      rarity: operator.rarity,
      class: operator.profession,
      rooms: [...operator.declaredRooms],
      factionGroups: [...operator.factionGroups],
      skillGroups: taxonomy.skillCategories
        .filter((category) => operatorGrants.some((grant) => category.skillIds.includes(grant.skillId)))
        .map((category) => category.name),
      skills,
      notes: cardNotes.join('；'),
    }
  })
}

/** 从仓库真源加载并投影全量 RecordCard；运行时切换前由最终门禁调用。 */
export function loadRecordCards(root: string, mode: CurationMode = 'curated'): RecordCard[] {
  const facts = loadReferenceFacts(root)
  const taxonomy = loadTaxonomy(root, facts)
  const equivalenceGroups = loadEquivalenceGroups(root, facts)
  const curations = validateCurations(facts, ALL_CURATIONS)
  return projectRecordCards({ facts, taxonomy, equivalenceGroups, curations, mode })
}
