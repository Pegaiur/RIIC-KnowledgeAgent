/**
 * 人工优化层：与 references 解析结果分离，避免重新解析覆盖人工确认内容。
 * 本轮只提供原文指纹校验与 curated 回退；未确认的表达不主动生成。
 */
import { hashSkillFact, hashSkillGrant, type OperatorSkillGrant, type RoomId, type SkillFact } from '../normalized.js'
import type { ReferenceFacts } from '../references.js'

export interface SkillCuration {
  skillId: string
  expectedRawHash: string
  effectText?: string
  notes?: string
}

export interface GrantCuration {
  grantId: string
  expectedGrantHash: string
  notes?: string
}

export interface OperatorCuration {
  operatorId: string
  notes?: string
}

export interface CurationBatch {
  room: RoomId
  skills: SkillCuration[]
  grants: GrantCuration[]
  operators: OperatorCuration[]
}

export type CurationMode = 'raw' | 'curated'

export interface ValidatedCurations {
  skills: Map<string, SkillCuration>
  grants: Map<string, GrantCuration>
  operators: Map<string, OperatorCuration>
}

/** 与计划中的 expectedRawHash 对齐的 SkillFact 指纹。 */
export function skillCurationHash(fact: SkillFact): string {
  return hashSkillFact(fact)
}

/** 与计划中的 expectedGrantHash 对齐的 grant 指纹。 */
export function grantCurationHash(grant: OperatorSkillGrant): string {
  return hashSkillGrant(grant)
}

function assertNonEmpty(value: string | undefined, label: string): void {
  if (value !== undefined && value.trim() === '') {
    throw new Error(`事实优化失败：${label} 优化文本不能为空`)
  }
}

/** 校验一组设施人工优化，不要求所有事实都有人工作文。 */
export function validateCurations(facts: ReferenceFacts, batches: readonly CurationBatch[]): ValidatedCurations {
  const factById = new Map(facts.skillFacts.map((fact) => [fact.id, fact]))
  const grantById = new Map(facts.grants.map((grant) => [grant.id, grant]))
  const operatorById = new Map(facts.operators.map((operator) => [operator.id, operator]))
  const grantRoomById = new Map(facts.fragments.flatMap((fragment) => fragment.grants.map((grant) => [grant.id, fragment.room] as const)))
  const skills = new Map<string, SkillCuration>()
  const grants = new Map<string, GrantCuration>()
  const operators = new Map<string, OperatorCuration>()

  for (const batch of batches) {
    for (const curation of batch.skills) {
      const fact = factById.get(curation.skillId)
      if (!fact) throw new Error(`事实优化失败：SkillCuration 存在孤儿 skillId：${curation.skillId}`)
      if (fact.room !== batch.room) throw new Error(`事实优化失败：SkillCuration 设施不一致：${curation.skillId}`)
      if (skills.has(curation.skillId)) throw new Error(`事实优化失败：SkillCuration 重复：${curation.skillId}`)
      if (curation.expectedRawHash !== skillCurationHash(fact)) {
        throw new Error(`事实优化失败：SkillCuration 原文指纹失效：${curation.skillId}`)
      }
      assertNonEmpty(curation.effectText, 'SkillCuration')
      assertNonEmpty(curation.notes, 'SkillCuration 备注')
      skills.set(curation.skillId, curation)
    }

    for (const curation of batch.grants) {
      const grant = grantById.get(curation.grantId)
      if (!grant) throw new Error(`事实优化失败：GrantCuration 存在孤儿 grantId：${curation.grantId}`)
      if (grantRoomById.get(curation.grantId) !== batch.room) throw new Error(`事实优化失败：GrantCuration 设施不一致：${curation.grantId}`)
      if (grants.has(curation.grantId)) throw new Error(`事实优化失败：GrantCuration 重复：${curation.grantId}`)
      if (curation.expectedGrantHash !== grantCurationHash(grant)) {
        throw new Error(`事实优化失败：GrantCuration 原文指纹失效：${curation.grantId}`)
      }
      assertNonEmpty(curation.notes, 'GrantCuration 备注')
      grants.set(curation.grantId, curation)
    }

    for (const curation of batch.operators) {
      if (!operatorById.has(curation.operatorId)) {
        throw new Error(`事实优化失败：OperatorCuration 存在孤儿 operatorId：${curation.operatorId}`)
      }
      if (operators.has(curation.operatorId)) throw new Error(`事实优化失败：OperatorCuration 重复：${curation.operatorId}`)
      assertNonEmpty(curation.notes, 'OperatorCuration 备注')
      operators.set(curation.operatorId, curation)
    }
  }

  return { skills, grants, operators }
}

/** curated 模式有有效优化时取优化文本，否则回退 references 原文。 */
export function resolveSkillEffectText(fact: SkillFact, mode: CurationMode, curations: ValidatedCurations): string {
  if (mode === 'curated') {
    const effectText = curations.skills.get(fact.id)?.effectText
    if (effectText !== undefined) return effectText
  }
  return fact.rawEffectText
}

/** 创建未覆盖的设施批次，供各设施独立模块使用。 */
export function emptyCurationBatch(room: RoomId): CurationBatch {
  return { room, skills: [], grants: [], operators: [] }
}
