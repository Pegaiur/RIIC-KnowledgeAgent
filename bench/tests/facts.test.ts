import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findNameRow, parseNameRow, verifyMechanicalCard } from '../src/facts/mechanical.js'
import { FACTS_FIXTURES } from '../src/facts/fixtures.js'
import type { RecordCard } from '../src/facts/card.js'

/** 真源名册（唯一来源）：按 canonical 定位出处行，供 0 差异核对 */
const NAME_LIST_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../knowledge/raw/名册.md')
const nameListText = readFileSync(NAME_LIST_PATH, 'utf-8')

describe('mechanical：名册.md 解析（程序化预填机械字段）', () => {
  it('解析「单设施、无组」的行（rarity 去 ☆ 为数字字符串）', () => {
    expect(parseNameRow('- 刻俄柏 | ☆6 | 术师 | 制造站')).toEqual({
      canonical: '刻俄柏',
      rarity: '6',
      class: '术师',
      rooms: ['制造站'],
      factionGroups: [],
    })
  })

  it('解析「多设施、有组」的行（顿号分隔房间与组）', () => {
    expect(parseNameRow('- 森蚺 | ☆6 | 重装 | 制造站、控制中枢 | 萨尔贡')).toEqual({
      canonical: '森蚺',
      rarity: '6',
      class: '重装',
      rooms: ['制造站', '控制中枢'],
      factionGroups: ['萨尔贡'],
    })
  })

  it('名册行缺失所属阵营组时 factionGroups 为空数组', () => {
    expect(parseNameRow('- 伊内丝 | ☆6 | 先锋 | 会客室、办公室').factionGroups).toEqual([])
  })
})

describe('findNameRow：按标准名定位真源名册行', () => {
  it('能天使精确命中本体行，不被「新约能天使」误配', () => {
    const row = findNameRow(nameListText, '能天使')
    expect(row).toBe('- 能天使 | ☆6 | 狙击 | 贸易站 | 能天使')
  })

  it('未命中（未知干员）返回 null', () => {
    expect(findNameRow(nameListText, '不存在的干员')).toBeNull()
  })
})

describe('程序化核对断言：机械字段与真源名册行逐字段 0 差异', () => {
  for (const card of FACTS_FIXTURES) {
    it(`${card.canonical} 机械字段与真源名册行逐字段一致（0 差异）`, () => {
      const row = findNameRow(nameListText, card.canonical)
      expect(row).not.toBeNull()
      // 逐字段精确比对（强于子串包含：parseNameRow 拆分后逐字段相等）
      expect(parseNameRow(row!)).toEqual({
        canonical: card.canonical,
        rarity: card.rarity,
        class: card.class,
        rooms: card.rooms,
        factionGroups: card.factionGroups,
      })
      // 程序化核对断言（0 差异，单一实现双消费）
      const res = verifyMechanicalCard(card, row!)
      expect(res.ok).toBe(true)
      expect(res.mismatches).toEqual([])
    })
  }

  it('篡改机械字段（非法房间）被断言打回', () => {
    const card = FACTS_FIXTURES[0]
    const row = findNameRow(nameListText, card.canonical)!
    const tampered: RecordCard = { ...card, rooms: ['宿舍'] }
    const res = verifyMechanicalCard(tampered, row)
    expect(res.ok).toBe(false)
    expect(res.mismatches).toContain('rooms：宿舍')
  })

  it('机械字段缺失（空 canonical）被断言打回', () => {
    const card = FACTS_FIXTURES[1]
    const row = findNameRow(nameListText, card.canonical)!
    const tampered: RecordCard = { ...card, canonical: '' }
    expect(verifyMechanicalCard(tampered, row).ok).toBe(false)
  })

  it('设施集合顺序变化也被断言打回', () => {
    const card = FACTS_FIXTURES.find((item) => item.rooms.length > 1)!
    const row = findNameRow(nameListText, card.canonical)!
    const tampered: RecordCard = { ...card, rooms: [...card.rooms].reverse() }
    const res = verifyMechanicalCard(tampered, row)
    expect(res.ok).toBe(false)
    expect(res.mismatches[0]).toContain('rooms：')
  })
})
