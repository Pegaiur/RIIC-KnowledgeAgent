import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadReferenceFacts, REFERENCE_ROOMS } from '../src/facts/references.js'
import { renderSkillLine } from '../src/facts/normalized.js'

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\//, '').replace(/\//g, '\\')

describe('references：正式输入与 raw 临时区隔离', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'facts-input-boundary-'))
    mkdirSync(join(root, 'knowledge', 'facts'), { recursive: true })
    for (const file of ['名册.md', ...REFERENCE_ROOMS.map((room) => `技能-${room}.md`)]) {
      copyFileSync(join(ROOT, 'knowledge', 'facts', file), join(root, 'knowledge', 'facts', file))
    }
  })

  afterEach(() => {
    // root 仅由本组 beforeEach 创建，清理范围限于该用例的临时根目录。
    rmSync(root, { recursive: true, force: true })
  })

  it('只有 facts 时可加载，raw 中的同名文件和临时稿不影响结果', () => {
    const rawDir = join(root, 'knowledge', 'raw')
    expect(existsSync(rawDir)).toBe(false)
    const facts = loadReferenceFacts(root)
    expect(facts.operators).toHaveLength(425)
    expect(facts.grants).toHaveLength(913)

    mkdirSync(rawDir)
    for (const file of ['名册.md', '技能-制造站.md', '临时稿.md']) {
      writeFileSync(join(rawDir, file), '临时内容，不是合法 facts 输入', 'utf-8')
    }
    expect(loadReferenceFacts(root)).toEqual(facts)
  })

  it.each([
    ['名册.md', '无法读取真源名册'],
    ['技能-制造站.md', '无法读取真源技能分片'],
  ])('正式输入 %s 缺失时，即使 raw 存在有效副本也直接失败', (file, message) => {
    const rawDir = join(root, 'knowledge', 'raw')
    mkdirSync(rawDir)
    copyFileSync(join(root, 'knowledge', 'facts', file), join(rawDir, file))
    rmSync(join(root, 'knowledge', 'facts', file))

    expect(() => loadReferenceFacts(root)).toThrowError(`${message}：knowledge/facts/${file}`)
  })
})

describe('references：九个设施事实批次', () => {
  it('九个技能分片共用当前练度投影，不残留旧的三星门槛', () => {
    for (const room of REFERENCE_ROOMS) {
      const source = readFileSync(join(ROOT, 'knowledge', 'facts', `技能-${room}.md`), 'utf-8')
      expect(source).toContain('一星、二星干员通常在达到 30 级')
      expect(source).toContain('三星、四星干员通常在精一阶段')
      expect(source).toContain('五星、六星干员通常在精二阶段')
      expect(source).toContain('不能把一、二星的常见规则扩展到三星')
      expect(source).not.toContain('一至三星干员满级即解锁')
      expect(source).not.toContain('scripts/build_refs.py')
    }
  })

  it('完整解析 425 名干员、586 个小节、913 条 grant、747 条索引和 705 个 SkillFact', () => {
    const facts = loadReferenceFacts(ROOT)
    expect(facts.operators).toHaveLength(425)
    expect(facts.skillFacts).toHaveLength(705)
    expect(facts.grants).toHaveLength(913)
    expect(facts.fragments).toHaveLength(9)
    expect(facts.fragments.reduce((sum, fragment) => sum + fragment.stats.operatorSections, 0)).toBe(586)
    expect(facts.fragments.reduce((sum, fragment) => sum + fragment.stats.indexEntries, 0)).toBe(747)
    expect(facts.grants.filter((grant) => grant.replacesGrantId !== undefined)).toHaveLength(167)
  })

  it.each([
    ['办公室', 32, 47],
    ['发电站', 31, 49],
    ['会客室', 54, 91],
    ['加工站', 78, 124],
    ['控制中枢', 65, 96],
    ['贸易站', 77, 120],
    ['宿舍', 78, 105],
    ['训练室', 79, 135],
    ['制造站', 92, 146],
  ])('%s 批次的干员小节与 grant 数量准确', (room, sections, grants) => {
    const facts = loadReferenceFacts(ROOT)
    const fragment = facts.fragments.find((item) => item.room === room)!
    expect(fragment.stats.operatorSections).toBe(sections)
    expect(fragment.stats.grants).toBe(grants)
    expect(fragment.grants.every((grant) => facts.operators.some((operator) => operator.id === grant.operatorId))).toBe(true)
    expect(fragment.grants.map((grant) => grant.sourceOrder)).toEqual(
      Array.from({ length: grants }, (_, index) => index + 1),
    )
  })

  it('名册声明设施集合与全量 grant 推导集合逐名完全相等', () => {
    const facts = loadReferenceFacts(ROOT)
    const roomsByOperator = new Map<string, Set<string>>()
    for (const grant of facts.grants) {
      const fragment = facts.fragments.find((item) => item.grants.some((candidate) => candidate.id === grant.id))!
      const rooms = roomsByOperator.get(grant.operatorId) ?? new Set<string>()
      rooms.add(fragment.room)
      roomsByOperator.set(grant.operatorId, rooms)
    }
    for (const operator of facts.operators) {
      expect([...roomsByOperator.get(operator.id) ?? []].sort()).toEqual([...operator.declaredRooms].sort())
    }
    expect(roomsByOperator.size).toBe(425)
    expect(REFERENCE_ROOMS).toHaveLength(9)
  })

  it('每个 grant 均能由原始技能效果、注记和 buffId 回渲染命中真源', () => {
    const facts = loadReferenceFacts(ROOT)
    for (const fragment of facts.fragments) {
      const source = fragment.sourceText
      const skillById = new Map(fragment.skillFacts.map((fact) => [fact.id, fact]))
      for (const grant of fragment.grants) {
        expect(source).toContain(renderSkillLine(grant, skillById.get(grant.skillId)!))
      }
    }
  })
})
