import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TERM_CURATIONS } from '../src/facts/curation/terms.js'
import { loadValidatedRecordCards } from '../src/facts/final.js'
import { validateTermCurations } from '../src/facts/terms.js'

const COMBO_NAMES = [
  '龙舌兰组', '能天使组', '叙拉古', '喀兰贸易组', '格拉斯哥帮组', '鸿雪杜林组', '人间烟火组', '企鹅物流', '深巡＋乌尔比安',
  '自动化组', '赤金工艺组', '红云组', '红松骑士团组', '深海猎人组', '泡泡组', '水月标准化组', '莱茵科技', '感知信息组', '龙门中枢组',
] as const

function sourceSection(path: string, section: string): string {
  const lines = readFileSync(join(process.cwd(), path), 'utf8').split('\n')
  const heading = lines.findIndex((line) => /^#{1,6}\s+/u.test(line) && line.replace(/^#{1,6}\s+/u, '').trim() === section)
  if (heading < 0) throw new Error(`找不到来源小节：${path}#${section}`)
  const level = /^(#+)/u.exec(lines[heading]!)?.[1].length ?? 6
  const end = lines.slice(heading + 1).findIndex((line) => {
    const match = /^(#+)\s+/u.exec(line)
    return match !== null && match[1]!.length <= level
  })
  return lines.slice(heading, end < 0 ? undefined : heading + 1 + end).join('\n')
}

describe('facts 人工词条登记', () => {
  it('登记首批19个具名搭配且不接入简写合称', () => {
    expect(TERM_CURATIONS.combos.map((combo) => combo.name)).toEqual(COMBO_NAMES)
    expect(TERM_CURATIONS.aliases).toHaveLength(4)
    expect(TERM_CURATIONS.legacyNames).toHaveLength(3)
    const aliases = TERM_CURATIONS.aliases.map((entry) => entry.text)
    const legacyNames = TERM_CURATIONS.legacyNames.map((entry) => entry.text)
    for (const unsupported of ['德狼', '能蕾', '银崖', '孑拉德']) {
      expect(aliases).not.toContain(unsupported)
      expect(legacyNames).not.toContain(unsupported)
    }
  })

  it('别名目标按证据登记，推王保留两个目标', () => {
    expect(TERM_CURATIONS.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: '维娜', targets: ['operator:维娜·维多利亚'] }),
      expect.objectContaining({ text: '德狗', targets: ['operator:德克萨斯'] }),
      expect.objectContaining({ text: '拉狗', targets: ['operator:拉普兰德'] }),
      expect.objectContaining({ text: '推王', targets: ['operator:推进之王', 'operator:维娜·维多利亚'] }),
    ]))
  })

  it('每条登记的 evidence 文件和小节均可从仓库核对', () => {
    for (const entry of [...TERM_CURATIONS.aliases, ...TERM_CURATIONS.combos, ...TERM_CURATIONS.legacyNames]) {
      for (const source of entry.evidence) {
        const content = sourceSection(source.path, source.section)
        const entryName = 'text' in entry ? entry.text : entry.name
        expect(content, `${source.path}#${source.section}`).toContain(entryName)
        if ('targets' in entry) {
          for (const target of entry.targets) expect(content).toContain(target.slice('operator:'.length))
        }
        if ('members' in entry) {
          for (const member of entry.members) expect(content).toContain(member.target.slice('operator:'.length))
        }
        if ('action' in entry && entry.action === 'redirect') expect(content).toContain(entry.target.slice('combo:'.length))
      }
    }
  })

  it('全部登记可由真实记录卡校验，且关键组合边界被保留', () => {
    const cards = loadValidatedRecordCards(process.cwd(), 'curated')
    expect(() => validateTermCurations(cards, TERM_CURATIONS)).not.toThrow()

    const redCloud = TERM_CURATIONS.combos.find((combo) => combo.name === '红云组')!
    expect(redCloud.coverage).toBe('listed')
    expect(redCloud.conditions.join('；')).toContain('任选一条')
    expect(redCloud.conditions.join('；')).toContain('酒神')
    expect(redCloud.conditions.join('；')).toContain('稀音、帕拉斯、刻俄柏三人中任选两名')
    expect(redCloud.conditions.join('；')).toContain('豆苗精一')

    const siracusa = TERM_CURATIONS.combos.find((combo) => combo.name === '叙拉古')!
    expect(siracusa.conditions.join('；')).toContain('贝洛内精二')

    const kjerag = TERM_CURATIONS.combos.find((combo) => combo.name === '喀兰贸易组')!
    expect(kjerag.conditions.join('；')).toContain('崖心、琳琅诗怀雅精二')

    const tailor = TERM_CURATIONS.combos.find((combo) => combo.name === '龙舌兰组')!
    expect(tailor.coverage).toBe('open')
    expect(tailor.openScope).toContain('裁缝')
    expect(tailor.members.map((member) => member.target)).toEqual(expect.arrayContaining([
      'operator:巫恋', 'operator:龙舌兰', 'operator:柏喙', 'operator:折光', 'operator:明椒', 'operator:卡夫卡',
    ]))

    const perception = TERM_CURATIONS.combos.find((combo) => combo.name === '感知信息组')!
    expect(perception.conditions.join('；')).toContain('絮雨进办公室')
    expect(perception.conditions.join('；')).toContain('琴柳进控制中枢或宿舍')
    expect(perception.conditions.join('；')).toContain('爱丽丝、车尔尼、塑心主要通过宿舍侧技能参与')
    expect(perception.conditions.join('；')).toContain('令通过控制中枢技能参与')

    const bubble = TERM_CURATIONS.combos.find((combo) => combo.name === '泡泡组')!
    expect(bubble.conditions.join('；')).toContain('贝娜精零')
  })

  it('旧称只直接重定向到正式搭配', () => {
    expect(TERM_CURATIONS.legacyNames).toEqual([
      expect.objectContaining({ text: '迷迭香感知链', action: 'redirect', target: 'combo:感知信息组' }),
      expect.objectContaining({ text: '巫恋裁缝核', action: 'redirect', target: 'combo:龙舌兰组' }),
      expect.objectContaining({ text: '龙门中枢制造组', action: 'redirect', target: 'combo:龙门中枢组' }),
    ])
  })
})
