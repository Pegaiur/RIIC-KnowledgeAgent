import { describe, expect, it } from 'vitest'
import type { RecordCard } from '../src/facts/card.js'
import { validateTermCurations, type TermCurations } from '../src/facts/terms.js'

const cards: RecordCard[] = [
  {
    canonical: '测试甲', aliases: [], rarity: '4', class: '医疗', rooms: ['制造站'],
    factionGroups: [], skillGroups: [], skills: [], notes: '',
  },
  {
    canonical: '测试乙', aliases: [], rarity: '4', class: '近卫', rooms: ['贸易站'],
    factionGroups: [], skillGroups: [], skills: [], notes: '',
  },
  {
    canonical: '测试甲乙', aliases: [], rarity: '5', class: '重装', rooms: ['控制中枢'],
    factionGroups: [], skillGroups: [], skills: [], notes: '',
  },
]

const evidence = { path: 'knowledge/guides/测试.md', section: '测试组合' }

function validData(): TermCurations {
  return {
    aliases: [{ text: '甲别名', targets: ['operator:测试甲'], evidence: [evidence] }],
    combos: [{
      id: 'combo:测试组', name: '测试组',
      members: [{ target: 'operator:测试甲', role: 'core' }, { target: 'operator:测试乙', role: 'important' }],
      conditions: ['两名干员共同进驻'], coverage: 'listed', evidence: [evidence],
    }],
    substrings: [{ text: '测试甲', targets: ['operator:测试甲乙'], evidence: [evidence] }],
  }
}

describe('facts 词条登记校验', () => {
  it('接受合法的多目标别名、具名搭配和子串对', () => {
    expect(validateTermCurations(cards, validData())).toEqual(validData())
  })

  it.each([
    ['空别名', (data: TermCurations) => ({ ...data, aliases: [{ ...data.aliases[0]!, text: '  ' }] })],
    ['空来源', (data: TermCurations) => ({ ...data, aliases: [{ ...data.aliases[0]!, evidence: [] }] })],
    ['空来源小节', (data: TermCurations) => ({ ...data, combos: [{ ...data.combos[0]!, evidence: [{ ...evidence, section: ' ' }] }] })],
    ['重复别名定义', (data: TermCurations) => ({ ...data, aliases: [...data.aliases, data.aliases[0]!] })],
    ['重复搭配定义', (data: TermCurations) => ({ ...data, combos: [...data.combos, data.combos[0]!] })],
    ['重复别名目标', (data: TermCurations) => ({ ...data, aliases: [{ ...data.aliases[0]!, targets: ['operator:测试甲', 'operator:测试甲'] }] })],
    ['悬空干员目标', (data: TermCurations) => ({ ...data, aliases: [{ ...data.aliases[0]!, targets: ['operator:不存在'] }] })],
    ['重复搭配成员', (data: TermCurations) => ({ ...data, combos: [{ ...data.combos[0]!, members: [{ target: 'operator:测试甲', role: 'core' }, { target: 'operator:测试甲', role: 'important' }] }] })],
    ['开放搭配缺少范围', (data: TermCurations) => ({ ...data, combos: [{ ...data.combos[0]!, coverage: 'open', openScope: undefined }] })],
    ['封闭登记误填开放范围', (data: TermCurations) => ({ ...data, combos: [{ ...data.combos[0]!, openScope: '其他成员' }] })],
    ['子串短名非规范干员', (data: TermCurations) => ({ ...data, substrings: [{ ...data.substrings[0]!, text: '不存在短名' }] })],
    ['子串目标为空', (data: TermCurations) => ({ ...data, substrings: [{ ...data.substrings[0]!, targets: [] }] })],
    ['子串目标不包含短名', (data: TermCurations) => ({ ...data, substrings: [{ ...data.substrings[0]!, targets: ['operator:测试乙'] }] })],
    ['子串自指目标', (data: TermCurations) => ({ ...data, substrings: [{ ...data.substrings[0]!, text: '测试甲', targets: ['operator:测试甲'] }] })],
    ['子串目标重复', (data: TermCurations) => ({ ...data, substrings: [{ ...data.substrings[0]!, targets: ['operator:测试甲乙', 'operator:测试甲乙'] }] })],
    ['子串目标悬空', (data: TermCurations) => ({ ...data, substrings: [{ ...data.substrings[0]!, targets: ['operator:不存在'] }] })],
    ['子串短名重复', (data: TermCurations) => ({ ...data, substrings: [data.substrings[0]!, data.substrings[0]!] })],
    ['子串缺少来源', (data: TermCurations) => ({ ...data, substrings: [{ ...data.substrings[0]!, evidence: [] }] })],
    ['缺少 substrings 数组', (data: TermCurations) => ({ ...data, substrings: undefined as unknown as TermCurations['substrings'] })],
  ])('%s时失败并给出中文原因', (_label, mutate) => {
    expect(() => validateTermCurations(cards, mutate(validData()) as TermCurations)).toThrowError(/事实词条登记失败：/u)
  })

  it('允许同一查询词在别名与规范搭配索引中合法重叠', () => {
    const data = validData()
    data.aliases = [{ text: '测试组', targets: ['operator:测试甲'], evidence: [evidence] }]
    expect(() => validateTermCurations(cards, data)).not.toThrow()
  })

  it('允许子串短名与别名索引同名，且多目标子串对合法', () => {
    const data = validData()
    data.aliases = [{ text: '测试甲', targets: ['operator:测试乙'], evidence: [evidence] }]
    data.substrings = [{ text: '测试甲', targets: ['operator:测试甲乙'], evidence: [evidence] }]
    expect(() => validateTermCurations(cards, data)).not.toThrow()
  })
})
