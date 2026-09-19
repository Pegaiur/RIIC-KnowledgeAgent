import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadReferenceFacts } from '../src/facts/references.js'
import { loadEquivalenceGroups } from '../src/facts/equivalence.js'

const ROOT = process.cwd()

describe('equivalence：正式输入与 raw 临时区隔离', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'equivalence-input-boundary-'))
    mkdirSync(join(root, 'knowledge', 'facts'), { recursive: true })
    copyFileSync(join(ROOT, 'knowledge', 'facts', '技能等价组.md'), join(root, 'knowledge', 'facts', '技能等价组.md'))
  })

  afterEach(() => {
    // root 仅由本组 beforeEach 创建，清理范围限于该用例的临时根目录。
    rmSync(root, { recursive: true, force: true })
  })

  it('只有正式等价组时可加载，raw 中的同名临时稿不影响结果', () => {
    const facts = loadReferenceFacts(ROOT)
    const rawDir = join(root, 'knowledge', 'raw')
    expect(existsSync(rawDir)).toBe(false)
    const groups = loadEquivalenceGroups(root, facts)
    expect(groups).toHaveLength(82)

    mkdirSync(rawDir)
    writeFileSync(join(rawDir, '技能等价组.md'), '临时内容，不是合法等价组输入', 'utf-8')
    expect(loadEquivalenceGroups(root, facts)).toEqual(groups)
  })

  it('正式等价组缺失时，即使 raw 存在有效副本也直接失败', () => {
    const facts = loadReferenceFacts(ROOT)
    const rawDir = join(root, 'knowledge', 'raw')
    mkdirSync(rawDir)
    copyFileSync(join(root, 'knowledge', 'facts', '技能等价组.md'), join(rawDir, '技能等价组.md'))
    rmSync(join(root, 'knowledge', 'facts', '技能等价组.md'))

    expect(() => loadEquivalenceGroups(root, facts)).toThrowError('无法读取真源技能等价组：knowledge/facts/技能等价组.md')
  })
})

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
