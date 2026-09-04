import { describe, expect, it } from 'vitest'
import { loadReferenceFacts, REFERENCE_ROOMS } from '../src/facts/references.js'
import { ALL_CURATIONS } from '../src/facts/curation/index.js'
import {
  grantCurationHash,
  resolveSkillEffectText,
  skillCurationHash,
  validateCurations,
  type SkillCuration,
} from '../src/facts/curation/types.js'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\')

describe('curation：九个设施独立人工优化批次', () => {
  it('每个设施都有独立批次，空覆盖安全回退原文', () => {
    const facts = loadReferenceFacts(ROOT)
    const validated = validateCurations(facts, ALL_CURATIONS)
    expect(ALL_CURATIONS.map((batch) => batch.room)).toEqual([...REFERENCE_ROOMS])
    expect(validated.skills.size).toBe(0)
    expect(validated.grants.size).toBe(0)
    expect(validated.operators.size).toBe(0)
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
