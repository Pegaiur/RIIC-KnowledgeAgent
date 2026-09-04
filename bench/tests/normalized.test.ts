import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseOperatorRoster,
  parseSkillFragment,
  renderSkillLine,
  type OperatorDefinition,
} from '../src/facts/normalized.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const nameListText = readFileSync(join(ROOT, 'knowledge/references/名册.md'), 'utf-8')

function roster(...rows: string[]): OperatorDefinition[] {
  return parseOperatorRoster(rows.join('\n'))
}

describe('parseOperatorRoster：名册规范化', () => {
  it('逐字段解析名册并以标准名作为稳定 operatorId', () => {
    expect(roster('- 甲 | ☆6 | 术师 | 制造站、控制中枢 | 萨尔贡')[0]).toEqual({
      id: '甲',
      canonical: '甲',
      rarity: '6',
      profession: '术师',
      declaredRooms: ['制造站', '控制中枢'],
      factionGroups: ['萨尔贡'],
    })
  })

  it('拒绝重复标准名', () => {
    expect(() => roster(
      '- 甲 | ☆6 | 术师 | 制造站',
      '- 甲 | ☆6 | 术师 | 制造站',
    )).toThrow('事实解析失败：名册出现重复标准名：甲')
  })

  it('当前名册完整解析为 425 名干员', () => {
    expect(parseOperatorRoster(nameListText)).toHaveLength(425)
  })
})

describe('parseSkillFragment：技能分片规范化', () => {
  const definitions = roster(
    '- 甲 | ☆6 | 术师 | 制造站',
    '- 乙 | ☆4 | 医疗 | 制造站',
  )
  const text = [
    '## 按干员',
    '',
    '### 甲 ☆6 · 术师',
    '',
    '- **初始解锁**「同名技能」（`buff_a`）：效果一　〔标签：通用生产/仓库容量；作用产物：赤金；作用职业：术师；引用术语：萨尔贡〕',
    '- **精英 2 提升，替换「同名技能」**「同名技能」（`buff_b`）：效果二　〔标签：通用生产〕',
    '',
    '### 乙 ☆4 · 医疗',
    '',
    '- **精英 1 解锁**「另一个技能」：效果三',
    '',
    '## 技能 → 持有者',
    '',
    '同名但 buffId 不同的是**两个不同技能**，已附 id 区分。',
    '',
    '- 「同名技能」（`buff_a`）：甲☆6(精0)',
    '- 「同名技能」（`buff_b`）：甲☆6(精2)',
    '- 「另一个技能」：乙☆4(精1)',
  ].join('\n')

  it('解析解锁类型、同名升级替换边、技能事实与索引', () => {
    const parsed = parseSkillFragment('制造站', text, definitions)
    expect(parsed.grants).toHaveLength(3)
    expect(parsed.grants[0]).toMatchObject({
      operatorId: '甲',
      unlockText: '初始解锁',
      unlockKind: 'initial',
      elite: 0,
      sourceBuffId: 'buff_a',
      sourceOrder: 1,
    })
    expect(parsed.grants[1]).toMatchObject({
      operatorId: '甲',
      unlockText: '精英 2 提升，替换「同名技能」',
      unlockKind: 'upgrade',
      elite: 2,
      replacesGrantId: parsed.grants[0].id,
      sourceBuffId: 'buff_b',
      sourceOrder: 2,
    })
    expect(parsed.grants[1].id).not.toBe(parsed.grants[0].id)
    expect(parsed.skillFacts).toHaveLength(3)
    expect(parsed.skillFacts[0]).toMatchObject({
      room: '制造站',
      name: '同名技能',
      rawEffectText: '效果一',
      rawAnnotationText: '标签：通用生产/仓库容量；作用产物：赤金；作用职业：术师；引用术语：萨尔贡',
      tags: ['通用生产', '仓库容量'],
      products: ['赤金'],
      professions: ['术师'],
      referencedTerms: ['萨尔贡'],
    })
    expect(parsed.indexEntries).toHaveLength(3)
    expect(parsed.stats).toEqual({ operatorSections: 2, grants: 3, indexEntries: 3 })
  })

  it('原文技能行可由规范化字段回渲染', () => {
    const parsed = parseSkillFragment('制造站', text, definitions)
    const grant = parsed.grants[0]
    const fact = parsed.skillFacts.find((item) => item.id === grant.skillId)!
    expect(renderSkillLine(grant, fact)).toBe(
      '- **初始解锁**「同名技能」（`buff_a`）：效果一　〔标签：通用生产/仓库容量；作用产物：赤金；作用职业：术师；引用术语：萨尔贡〕',
    )
  })

  it('当前制造站分片的 92 个干员小节和 146 条 grant 全部可消费', () => {
    const source = readFileSync(join(ROOT, 'knowledge/references/技能-制造站.md'), 'utf-8')
    const parsed = parseSkillFragment('制造站', source, parseOperatorRoster(nameListText))
    expect(parsed.stats).toEqual({ operatorSections: 92, grants: 146, indexEntries: 112 })
    expect(new Set(parsed.grants.map((grant) => grant.id)).size).toBe(146)
  })

  it.each([
    ['控制中枢', '技能-控制中枢.md', '丰川祥子', '丰富工作经验'],
    ['发电站', '技能-发电站.md', '协律', '澎湃紊流'],
    ['训练室', '技能-训练室.md', '焰影苇草', '红龙之血'],
  ])('%s 的同名升级技能按效果区分并闭合替换边', (room, file, operatorId, skillName) => {
    const source = readFileSync(join(ROOT, 'knowledge/references', file), 'utf-8')
    const parsed = parseSkillFragment(room, source, parseOperatorRoster(nameListText))
    const grants = parsed.grants.filter((grant) => grant.operatorId === operatorId)
    const named = grants.filter((grant) => parsed.skillFacts.find((fact) => fact.id === grant.skillId)?.name === skillName)
    expect(named).toHaveLength(2)
    expect(named[0].id).not.toBe(named[1].id)
    expect(named[1].replacesGrantId).toBe(named[0].id)
  })

  it('未知替换目标给出中文错误', () => {
    const broken = text.replace('替换「同名技能」', '替换「不存在」')
    expect(() => parseSkillFragment('制造站', broken, definitions)).toThrow(
      '事实解析失败：甲的升级技能找不到唯一替换目标：不存在',
    )
  })

  it('技能 bullet 未消费时立即失败', () => {
    const broken = text.replace('- **初始解锁**', '- 初始解锁')
    expect(() => parseSkillFragment('制造站', broken, definitions)).toThrow(
      '事实解析失败：制造站第 5 行技能 bullet 无法解析',
    )
  })

  it('索引漏项时立即失败', () => {
    const broken = text.replace('- 「另一个技能」：乙☆4(精1)', '')
    expect(() => parseSkillFragment('制造站', broken, definitions)).toThrow(
      '事实解析失败：技能索引与干员段落不一致',
    )
  })
})
